import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const begin = async (page: Page) => {
  await page.locator('#begin').click();
  await expect(page.locator('#briefing')).toBeHidden();
};
const inspect = async (page: Page, id: string) => { await page.locator('#node-select').selectOption(id); };
// Idle camera drift moves markers every frame, so clicks bypass the stability check.
const clickMarker = async (page: Page, id: string) => { await marker(page, id).focus(); await marker(page, id).dispatchEvent('click'); };
const marker = (page: Page, id: string) => page.locator(`#scene-markers [data-node="${id}"]`);
const sendCrew = async (page: Page, feeder: string, crew: 'crew-1' | 'crew-2') => {
  await page.keyboard.press('Escape');
  await clickMarker(page, feeder);
  await expect(page.locator('#node-actions')).toBeVisible();
  await page.locator(`#node-actions [data-crew="${crew}"]`).click();
};
const ensurePaused = async (page: Page) => {
  if ((await page.locator('#mode').textContent()) === 'RUNNING') await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('PAUSED');
};
const ensureRunning = async (page: Page) => {
  if ((await page.locator('#mode').textContent()) !== 'RUNNING') await page.locator('#play').click();
  await expect(page.locator('#mode')).toHaveText('RUNNING');
};
const dispatchBoth = async (page: Page) => {
  await page.locator('#speed').selectOption('1');
  await sendCrew(page, 'feeder-a', 'crew-1');
  await ensurePaused(page);
  await sendCrew(page, 'feeder-b', 'crew-2');
  await ensurePaused(page);
};
const dispatchBothInspector = async (page: Page) => {
  await page.locator('#speed').selectOption('1');
  await inspect(page, 'feeder-a');
  await page.locator('#dispatch-1').click();
  await ensurePaused(page);
  await inspect(page, 'feeder-b');
  await page.locator('#dispatch-2').click();
  await ensurePaused(page);
};
const reconnect = async (page: Page, id: string) => {
  await inspect(page, id);
  await page.locator('#connection-action').click();
};
const reconnectPopover = async (page: Page, id: string) => {
  await page.keyboard.press('Escape');
  await clickMarker(page, id);
  await expect(page.locator('#node-actions')).toBeVisible();
  await page.locator('#node-actions .primary-action').click();
};
const next = async (page: Page, time: string) => {
  await page.locator('#next-event').click();
  await expect(page.locator('#time')).toHaveText(time);
};
const downtime = (page: Page, id: string) => page.locator(`[data-service="${id}"] .service-time`);
const summaryDowntime = (page: Page, id: string) => page.locator(`#summary td[data-downtime="${id}"]`).last();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#briefing')).toBeVisible();
  await begin(page);
  await expect(page.locator('#node-select option')).toHaveCount(9);
  (page as Page & { runtimeErrors: string[] }).runtimeErrors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { runtimeErrors: string[] }).runtimeErrors).toEqual([]);
});

test('initial state, working WebGL and no external runtime requests', async ({ page }, info) => {
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#world-time')).toContainText('19:30');
  await expect(page.locator('#task-banner')).toContainText('broken feeder');
  await expect(page.locator('#backup')).toHaveText('06:00');
  await expect(page.locator('#capacity')).toHaveText('0');
  await expect(page.locator('#render-notice')).toBeHidden();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('[data-state="offline"]')).toHaveCount(4);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => !url.startsWith(location.origin)))).toEqual([]);
  await page.screenshot({ path: info.outputPath('desktop-initial.png'), fullPage: true });
});

test('clicking a feeder marker opens the action popover; time starts when both crews are out', async ({ page }) => {
  await clickMarker(page, 'feeder-a');
  await expect(page.locator('#node-actions')).toBeVisible();
  await expect(page.locator('#node-actions')).toContainText('Feeder A');
  await expect(page.locator('#node-actions [data-crew="crew-1"]')).toHaveText('Send Crew 1');
  await page.locator('#node-actions [data-crew="crew-1"]').click();
  await expect(page.locator('#events li')).toHaveCount(2);
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#task-banner')).toContainText('press Space');
  await page.keyboard.press('Escape');
  await clickMarker(page, 'feeder-b');
  await page.locator('#node-actions [data-crew="crew-2"]').click();
  await expect(page.locator('#mode')).toHaveText('RUNNING');
});

for (const priority of ['clinic', 'housing']) {
  test(`complete ${priority} strategy matches the numeric oracle`, async ({ page }, info) => {
    await dispatchBoth(page);
    await next(page, '01:00');
    await next(page, '04:00');
    await expect(page.locator('#capacity')).toHaveText('6');
    await expect(page.locator('#load')).toHaveText('0');
    for (const id of priority === 'clinic' ? ['clinic', 'pump'] : ['housing-a', 'housing-b']) await reconnect(page, id);
    await expect(page.locator('#load')).toHaveText('6');
    if (priority === 'housing') {
      await next(page, '06:00');
      await expect(page.locator('[data-service="clinic"] .service-state')).toHaveText('Offline');
    }
    await next(page, '08:00');
    await expect(page.locator('#capacity')).toHaveText('13');
    await expect(page.locator('#load')).toHaveText('6');
    for (const id of priority === 'clinic' ? ['housing-a', 'housing-b', 'beacon'] : ['clinic', 'pump', 'beacon']) await reconnect(page, id);
    await expect(page.locator('#load')).toHaveText('13');
    await expect(downtime(page, 'clinic')).toHaveText(priority === 'clinic' ? 'Out 00:00' : 'Out 02:00');
    await expect(downtime(page, 'housing-a')).toHaveText(priority === 'clinic' ? 'Out 08:00' : 'Out 04:00');
    await expect(downtime(page, 'housing-b')).toHaveText(priority === 'clinic' ? 'Out 08:00' : 'Out 04:00');
    await expect(downtime(page, 'pump')).toHaveText(priority === 'clinic' ? 'Out 04:00' : 'Out 08:00');
    await expect(downtime(page, 'beacon')).toHaveText('Out 08:00');
    await expect(page.locator('[data-state="grid"]')).toHaveCount(5);
    await expect(page.locator('#summary')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${priority}-restored.png`), fullPage: true });
  });
}

test('capacity failures are feedback, never history; disconnect reallocates explicitly', async ({ page }) => {
  await page.locator('#connection-action').click();
  await expect(page.locator('#feedback')).toContainText('4 CU; 0 CU');
  await expect(page.locator('#events li')).toHaveCount(1);
  await dispatchBoth(page);
  await next(page, '01:00');
  await next(page, '04:00');
  await reconnect(page, 'clinic');
  await reconnect(page, 'pump');
  const eventCount = await page.locator('#events li').count();
  await reconnect(page, 'housing-a');
  await expect(page.locator('#feedback')).toContainText('3 CU; 0 CU');
  await expect(page.locator('#events li')).toHaveCount(eventCount);
  await expect(page.locator('#load')).toHaveText('6');
  await inspect(page, 'clinic');
  await page.locator('#connection-action').click();
  await expect(page.locator('#load')).toHaveText('2');
  await expect(page.locator('#node-status')).toHaveText('Backup power');
  await expect(page.locator('#backup')).toHaveText('02:00');
  await expect(page.locator('[data-service="housing-a"] .service-state')).toHaveText('Offline');
  await reconnect(page, 'housing-a');
  await expect(page.locator('#load')).toHaveText('5');
});

test('rejected reconnection explains the shortfall inside the popover', async ({ page }) => {
  await dispatchBoth(page);
  await next(page, '01:00');
  await next(page, '04:00');
  await reconnectPopover(page, 'clinic');
  await reconnectPopover(page, 'pump');
  await clickMarker(page, 'housing-a');
  await page.locator('#node-actions .primary-action').click();
  await expect(page.locator('#popover-message')).toContainText('3 CU; 0 CU');
  await expect(page.locator('#load')).toHaveText('6');
});

test('cinematic plays on Begin, world clock tracks sim time and sunrise ends at 06:30', async ({ page }) => {
  test.setTimeout(90000);
  await expect(page.locator('#scene-canvas')).toHaveAttribute('data-cinematic', 'done', { timeout: 10000 });
  await page.locator('#speed').selectOption('1');
  await sendCrew(page, 'feeder-a', 'crew-1');
  await ensurePaused(page);
  await sendCrew(page, 'feeder-b', 'crew-2');
  await ensurePaused(page);
  await next(page, '01:00');
  await next(page, '04:00');
  await expect(page.locator('#world-time')).toContainText('23:30');
  await reconnect(page, 'clinic');
  await reconnect(page, 'pump');
  await next(page, '08:00');
  await expect(page.locator('#world-time')).toContainText('03:30');
  for (const id of ['housing-a', 'housing-b', 'beacon']) await reconnect(page, id);
  await expect(page.locator('#summary')).toBeVisible();
  await page.locator('#sunrise').click();
  await expect(page.locator('#mode')).toHaveText('RUNNING');
  await expect(page.locator('#time')).toHaveText('11:00', { timeout: 30000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#world-time')).toContainText('06:30');
  await expect(page.locator('#decision')).toContainText('Dawn');
});

test('auto-pause at repair completions and restored run summary', async ({ page }) => {
  test.setTimeout(90000);
  await page.locator('#speed').selectOption('1');
  await sendCrew(page, 'feeder-a', 'crew-1');
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await sendCrew(page, 'feeder-b', 'crew-2');
  await page.locator('#speed').selectOption('30');
  await ensureRunning(page);
  await expect(page.locator('#time')).toHaveText('04:00', { timeout: 20000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#decision')).toContainText('6 CU');
  await reconnectPopover(page, 'clinic');
  await reconnectPopover(page, 'pump');
  await expect(page.locator('#load')).toHaveText('6');
  await page.locator('#resume').click();
  await expect(page.locator('#time')).toHaveText('08:00', { timeout: 20000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#decision')).toContainText('13 CU');
  for (const id of ['housing-a', 'housing-b', 'beacon']) await reconnectPopover(page, id);
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#decision')).toContainText('All services restored');
  await expect(page.locator('#resume')).toHaveText('View summary');
  await expect(summaryDowntime(page, 'clinic')).toHaveText('00:00');
  await expect(summaryDowntime(page, 'housing-a')).toHaveText('08:00');
  await expect(summaryDowntime(page, 'housing-b')).toHaveText('08:00');
  await expect(summaryDowntime(page, 'pump')).toHaveText('04:00');
  await expect(summaryDowntime(page, 'beacon')).toHaveText('08:00');
  await expect(page.locator('#summary')).toContainText('backup remaining 02:00');
});

test('clinic backup warning and expiry auto-pause on a housing-first run', async ({ page }) => {
  test.setTimeout(90000);
  await page.locator('#speed').selectOption('1');
  await sendCrew(page, 'feeder-a', 'crew-1');
  await ensurePaused(page);
  await sendCrew(page, 'feeder-b', 'crew-2');
  await page.locator('#speed').selectOption('30');
  await ensureRunning(page);
  await expect(page.locator('#time')).toHaveText('04:00', { timeout: 20000 });
  await reconnectPopover(page, 'housing-a');
  await reconnectPopover(page, 'housing-b');
  await page.locator('#resume').click();
  await expect(page.locator('#time')).toHaveText('05:00', { timeout: 20000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#decision')).toContainText('backup');
  await page.locator('#resume').click();
  await expect(page.locator('#time')).toHaveText('06:00', { timeout: 20000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#decision')).toContainText('backup');
  await page.locator('#resume').click();
  await expect(page.locator('#time')).toHaveText('08:00', { timeout: 20000 });
  await expect(page.locator('#decision')).toContainText('13 CU');
});

test('try a different order resets without a dialog and compares session runs', async ({ page }) => {
  test.setTimeout(120000);
  const completeRun = async () => {
    await page.locator('#speed').selectOption('1');
    await sendCrew(page, 'feeder-a', 'crew-1');
    await ensurePaused(page);
    await sendCrew(page, 'feeder-b', 'crew-2');
    await page.locator('#speed').selectOption('30');
    await ensureRunning(page);
    await expect(page.locator('#time')).toHaveText('04:00', { timeout: 20000 });
    await reconnectPopover(page, 'clinic');
    await reconnectPopover(page, 'pump');
    await page.locator('#resume').click();
    await expect(page.locator('#time')).toHaveText('08:00', { timeout: 20000 });
    for (const id of ['housing-a', 'housing-b', 'beacon']) await reconnectPopover(page, id);
    await expect(page.locator('#summary')).toBeVisible();
  };
  await completeRun();
  await expect(page.locator('#summary')).toContainText('This run');
  await page.locator('#try-again').click();
  await expect(page.locator('#restart-dialog')).toBeHidden();
  await expect(page.locator('#time')).toHaveText('00:00');
  await expect(page.locator('#summary')).toBeHidden();
  await expect(page.locator('#events li')).toHaveCount(1);
  await completeRun();
  await expect(page.locator('#summary')).toContainText('Run 1');
  await expect(page.locator('#summary')).toContainText('This run');
  await expect(page.locator('#summary th[scope="col"]')).toHaveCount(3);
});

test('keyboard shortcuts: space toggles time, digits select, Escape closes the popover', async ({ page }) => {
  await page.locator('#speed').selectOption('1');
  await sendCrew(page, 'feeder-a', 'crew-1');
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Space');
  await expect(page.locator('#mode')).toHaveText('RUNNING');
  await page.keyboard.press('Space');
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await page.keyboard.press('Space');
  await expect(page.locator('#mode')).toHaveText('RUNNING');
  await page.keyboard.press('Space');
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await clickMarker(page, 'feeder-b');
  await expect(page.locator('#node-actions')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#node-actions')).toBeHidden();
  await page.keyboard.press('6');
  await expect(page.locator('#inspector-title')).toHaveText('Feeder A');
  await expect(page.locator('#node-actions')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('guidance slot sits above the scene and never covers markers', async ({ page }) => {
  test.setTimeout(60000);
  const scene = await page.locator('#scene').boundingBox();
  const banner = await page.locator('#task-banner').boundingBox();
  expect(banner).not.toBeNull();
  expect(banner!.y + banner!.height).toBeLessThanOrEqual(scene!.y);
  await page.locator('#speed').selectOption('30');
  await sendCrew(page, 'feeder-a', 'crew-1');
  await sendCrew(page, 'feeder-b', 'crew-2');
  await expect(page.locator('#mode')).toHaveText('RUNNING');
  await expect(page.locator('#time')).toHaveText('04:00', { timeout: 20000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  const sceneAfter = await page.locator('#scene').boundingBox();
  const decision = await page.locator('#decision').boundingBox();
  expect(decision!.y + decision!.height).toBeLessThanOrEqual(sceneAfter!.y);
  await expect(page.locator('#task-banner')).toBeHidden();
});

test('replay restores matching lights and past history without mutating live run', async ({ page }) => {
  await dispatchBoth(page);
  await next(page, '01:00');
  await next(page, '04:00');
  await reconnect(page, 'clinic');
  await reconnect(page, 'pump');
  await next(page, '08:00');
  const history = await page.locator('#events').textContent();
  await page.locator('#replay').click();
  await expect(page.locator('#mode')).toHaveText('REPLAY');
  await expect(page.locator('#time')).toHaveText('00:00');
  await inspect(page, 'clinic');
  await expect(page.locator('#connection-action')).toBeDisabled();
  await page.locator('#cursor').fill('239');
  await expect(page.locator('#load')).toHaveText('0');
  await expect(page.locator('#node-status')).toHaveText('Backup power');
  expect(await page.locator('#events li').evaluateAll(items => items.every(item => Number((item as HTMLElement).dataset.tick) <= 239))).toBe(true);
  await page.locator('#cursor').fill('240');
  await expect(page.locator('#load')).toHaveText('6');
  await expect(page.locator('#node-status')).toHaveText('Grid powered');
  await page.locator('#cursor').fill('480');
  expect(await page.locator('#events').textContent()).toBe(history);
  await page.locator('#return-live').click();
  await expect(page.locator('#time')).toHaveText('08:00');
  await expect(page.locator('#load')).toHaveText('6');
  expect(await page.locator('#events').textContent()).toBe(history);
});

test('clock freezes while paused and requires explicit resume after hidden tab', async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await begin(page);
  const time = () => page.locator('#time').textContent();
  await page.locator('#play').click();
  await page.clock.runFor(2000);
  expect(await time()).not.toBe('00:00');
  await page.locator('#play').click();
  // Any real-time sliver was consumed by this pause; capture the frozen value.
  const frozen = await time();
  await page.clock.runFor(5000);
  expect(await time()).toBe(frozen);
  await page.locator('#play').click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenAt = await time();
  await page.clock.runFor(60000);
  expect(await time()).toBe(hiddenAt);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(1000);
  expect(await time()).toBe(hiddenAt);
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await page.locator('#play').click();
  await page.clock.runFor(1000);
  expect(await time()).not.toBe(hiddenAt);
});

test('restart cancel and Escape preserve the run; confirmation resets it', async ({ page }) => {
  await dispatchBoth(page);
  await next(page, '01:00');
  await page.locator('#restart').click();
  await expect(page.locator('#restart-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#time')).toHaveText('01:00');
  await page.locator('#restart').click();
  await page.locator('#cancel-restart').click();
  await expect(page.locator('#time')).toHaveText('01:00');
  await page.locator('#restart').click();
  await page.locator('#confirm-restart').click();
  await expect(page.locator('#time')).toHaveText('00:00');
  await expect(page.locator('#events li')).toHaveCount(1);
  await expect(page.locator('#backup')).toHaveText('06:00');
});

test('keyboard-only full restoration using native buttons preserves focus across updates', async ({ page }) => {
  const activate = async (selector: string) => {
    for (let n = 0; n < 80; n++) {
      if (await page.locator(selector).evaluate(el => el === document.activeElement)) {
        await page.keyboard.press('Enter');
        return;
      }
      await page.keyboard.press('Tab');
    }
    throw new Error(`Cannot keyboard-reach ${selector}`);
  };
  const nextUntil = async (selector: string, value: string) => {
    for (let n = 0; n < 4 && (await page.locator(selector).textContent()) !== value; n++) await activate('#next-event');
    await expect(page.locator(selector)).toHaveText(value);
  };
  await page.locator('#speed').selectOption('1');
  await activate('#inspect-a');
  await expect(page.locator('#inspector-title')).toHaveText('Feeder A');
  await expect(page.locator('#node-actions')).toBeVisible();
  await activate('#node-actions [data-crew="crew-1"]');
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await activate('#inspect-b');
  await activate('#node-actions [data-crew="crew-2"]');
  if ((await page.locator('#mode').textContent()) === 'RUNNING') await activate('#play');
  await nextUntil('#capacity', '6');
  for (const id of ['clinic', 'pump']) {
    await activate(`[data-service="${id}"]`);
    await activate('#node-actions .primary-action');
    await expect(page.locator('#inspector-title')).toHaveText(id === 'clinic' ? 'Clinic' : 'Pumping station');
  }
  await nextUntil('#capacity', '13');
  for (const id of ['housing-a', 'housing-b', 'beacon']) {
    await activate(`[data-service="${id}"]`);
    await activate('#node-actions .primary-action');
  }
  await expect(page.locator('#load')).toHaveText('13');
  await expect(page.locator('#summary')).toBeVisible();
});

for (const [width, height] of [[320, 740], [390, 844], [800, 600], [1440, 900]]) {
  test(`layout ${width}x${height} stays within viewport with reduced motion`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.locator('canvas')).toBeVisible();
    const scene = await page.locator('#scene').boundingBox();
    expect(scene?.height).toBeGreaterThan(300);
    if (width === 1440) {
      const transport = await page.locator('.transport').boundingBox();
      expect(transport!.y + transport!.height).toBeLessThanOrEqual(height);
    }
    if (width <= 800) {
      await page.locator('#toggle-inspector').click();
      await expect(page.locator('#inspector-body')).toBeHidden();
      await inspect(page, 'feeder-a');
      await expect(page.locator('#inspector-body')).toBeVisible();
      await page.locator('#dispatch-1').click();
    }
    await page.screenshot({ path: info.outputPath(`viewport-${width}.png`), fullPage: true });
  });
}

test('WebGL failure and unavailable storage leave the HTML game usable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type.startsWith('webgl')) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof HTMLCanvasElement.prototype.getContext;
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('Storage unavailable'); } });
  });
  await page.reload();
  await begin(page);
  await expect(page.locator('#render-notice')).toContainText('3D view unavailable');
  await dispatchBothInspector(page);
  await next(page, '01:00');
  await next(page, '04:00');
  await reconnect(page, 'clinic');
  await expect(page.locator('#load')).toHaveText('4');
  await expect(page.locator('#node-status')).toHaveText('Grid powered');
});

test('WebGL context loss recovers without resetting state', async ({ page }) => {
  await dispatchBoth(page);
  await next(page, '01:00');
  await page.locator('canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
    const extension = gl!.getExtension('WEBGL_lose_context')!;
    (window as unknown as { restoreGraphics: () => void }).restoreGraphics = () => extension.restoreContext();
    extension.loseContext();
  });
  await expect(page.locator('#render-notice')).toContainText('3D view interrupted');
  await next(page, '04:00');
  await reconnect(page, 'clinic');
  await page.evaluate(() => (window as unknown as { restoreGraphics: () => void }).restoreGraphics());
  await expect(page.locator('#render-notice')).toBeHidden();
  await expect(page.locator('#load')).toHaveText('4');
  await expect(page.locator('#time')).toHaveText('04:00');
});

test('reduced motion completes the incident with no decorative animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dispatchBoth(page);
  await next(page, '01:00');
  await next(page, '04:00');
  await reconnect(page, 'clinic');
  await reconnect(page, 'pump');
  await next(page, '08:00');
  for (const id of ['housing-a', 'housing-b', 'beacon']) await reconnect(page, id);
  await expect(page.locator('#load')).toHaveText('13');
  await expect(page.locator('#summary')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
});
