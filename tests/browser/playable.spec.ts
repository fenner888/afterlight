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
const simTick = async (page: Page) => {
  const [minutes, seconds] = (await page.locator('#time').textContent())!.split(':').map(Number);
  return minutes * 60 + seconds;
};
const simText = (ticks: number) => `${Math.floor(ticks / 60).toString().padStart(2, '0')}:${Math.floor(ticks % 60).toString().padStart(2, '0')}`;
const durationText = (ticks: number) => `${Math.floor(ticks / 60)}h ${Math.floor(ticks % 60).toString().padStart(2, '0')}m`;
const worldText = (ticks: number) => {
  const minutes = (((19 * 60 + 30 + ticks) % 1440) + 1440) % 1440;
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${Math.floor(minutes % 60).toString().padStart(2, '0')}`;
};
// Time now starts on the first dispatch, so Crew 2 can be sent a few ticks after
// 0 — its arrival inserts an extra next-event step before Feeder A completes.
const advanceTo = async (page: Page, tick: number) => {
  for (let n = 0; n < 12 && (await simTick(page)) < tick; n++) await page.locator('#next-event').click();
  await expect(page.locator('#time')).toHaveText(simText(tick));
};
// Crew 2's dispatch tick from the event log — Feeder B timing keys off it, and
// a paused second dispatch resumes the clock, so the tick can't be read from #time.
const crew2DispatchTick = async (page: Page) => {
  const ticks = await page.locator('#events li').evaluateAll(items =>
    items.map(item => ({ tick: Number((item as HTMLElement).dataset.tick), text: item.textContent ?? '' })));
  return ticks.find(event => event.text.includes('Crew 2 dispatched'))?.tick ?? 0;
};
// Returns Crew 2's dispatch tick so callers can compute Feeder B timing.
const dispatchBoth = async (page: Page) => {
  await page.locator('#speed').selectOption('1');
  await sendCrew(page, 'feeder-a', 'crew-1');
  await sendCrew(page, 'feeder-b', 'crew-2');
  await ensurePaused(page);
  return crew2DispatchTick(page);
};
const dispatchBothInspector = async (page: Page) => {
  await page.locator('#speed').selectOption('1');
  await inspect(page, 'feeder-a');
  await page.locator('#dispatch-1').click();
  await ensurePaused(page);
  await inspect(page, 'feeder-b');
  await page.locator('#dispatch-2').click();
  await ensurePaused(page);
  return crew2DispatchTick(page);
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
  await expect(page.locator('#backup')).toHaveText('6h 00m');
  await expect(page.locator('#capacity')).toHaveText('0');
  await expect(page.locator('#render-notice')).toBeHidden();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('[data-state="offline"]')).toHaveCount(4);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => !url.startsWith(location.origin)))).toEqual([]);
  await page.screenshot({ path: info.outputPath('desktop-initial.png'), fullPage: true });
});

test('clicking a feeder marker opens the action popover; time starts on the first dispatch', async ({ page }) => {
  await clickMarker(page, 'feeder-a');
  await expect(page.locator('#node-actions')).toBeVisible();
  await expect(page.locator('#node-actions')).toContainText('Feeder A');
  await expect(page.locator('#node-actions [data-crew="crew-1"]')).toHaveText('Send Crew 1');
  await page.locator('#node-actions [data-crew="crew-1"]').click();
  await expect(page.locator('#events li')).toHaveCount(2);
  await expect(page.locator('#mode')).toHaveText('RUNNING');
  await expect(page.locator('#task-banner')).toContainText('the longer it waits');
  // The remaining faulted feeder's popover opens with the idle crew focused.
  await expect(page.locator('#node-actions')).toContainText('Feeder B');
  await expect(page.locator('#node-actions [data-crew="crew-2"]')).toBeFocused();
  await page.locator('#node-actions [data-crew="crew-2"]').click();
  await expect(page.locator('#mode')).toHaveText('RUNNING');
});

test('the first dispatch starts the clock and offers the remaining feeder', async ({ page }) => {
  await clickMarker(page, 'feeder-a');
  await page.locator('#node-actions [data-crew="crew-1"]').click();
  await expect(page.locator('#mode')).toHaveText('RUNNING', { timeout: 1000 });
  await expect(page.locator('#world-time')).not.toContainText('19:30', { timeout: 10000 });
  await expect(page.locator('#node-actions')).toContainText('Feeder B');
  await expect(page.locator('#node-actions [data-crew="crew-2"]')).toBeFocused();
});

test('a lone dispatched crew keeps moving while the other waits', async ({ page }) => {
  await sendCrew(page, 'feeder-a', 'crew-1');
  await expect(page.locator('#mode')).toHaveText('RUNNING');
  await page.keyboard.press('Escape');
  await expect(page.locator('#node-actions')).toBeHidden();
  await page.waitForTimeout(3000);
  const estimate = await page.locator('#crews [data-crew="crew-1"] .crew-state').textContent();
  const match = estimate!.match(/(\d+)h (\d+)m/);
  expect(match).not.toBeNull();
  expect(Number(match![1]) * 60 + Number(match![2])).toBeLessThan(60);
});

for (const priority of ['clinic', 'housing']) {
  test(`complete ${priority} strategy matches the numeric oracle`, async ({ page }, info) => {
    const delayB = await dispatchBoth(page);
    await next(page, '01:00');
    await advanceTo(page, 240);
    await expect(page.locator('#capacity')).toHaveText('6');
    await expect(page.locator('#load')).toHaveText('0');
    for (const id of priority === 'clinic' ? ['clinic', 'pump'] : ['housing-a', 'housing-b']) await reconnect(page, id);
    await expect(page.locator('#load')).toHaveText('6');
    if (priority === 'housing') {
      await next(page, '06:00');
      await expect(page.locator('[data-service="clinic"] .service-state')).toHaveText('Offline');
    }
    await advanceTo(page, 480 + delayB);
    await expect(page.locator('#capacity')).toHaveText('13');
    await expect(page.locator('#load')).toHaveText('6');
    for (const id of priority === 'clinic' ? ['housing-a', 'housing-b', 'beacon'] : ['clinic', 'pump', 'beacon']) await reconnect(page, id);
    await expect(page.locator('#load')).toHaveText('13');
    await expect(downtime(page, 'clinic')).toHaveText(priority === 'clinic' ? 'Out 0h 00m' : `Out ${durationText(120 + delayB)}`);
    await expect(downtime(page, 'housing-a')).toHaveText(priority === 'clinic' ? `Out ${durationText(480 + delayB)}` : 'Out 4h 00m');
    await expect(downtime(page, 'housing-b')).toHaveText(priority === 'clinic' ? `Out ${durationText(480 + delayB)}` : 'Out 4h 00m');
    await expect(downtime(page, 'pump')).toHaveText(priority === 'clinic' ? 'Out 4h 00m' : `Out ${durationText(480 + delayB)}`);
    await expect(downtime(page, 'beacon')).toHaveText(`Out ${durationText(480 + delayB)}`);
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
  await advanceTo(page, 240);
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
  await expect(page.locator('#backup')).toHaveText('2h 00m');
  await expect(page.locator('[data-service="housing-a"] .service-state')).toHaveText('Offline');
  await reconnect(page, 'housing-a');
  await expect(page.locator('#load')).toHaveText('5');
});

test('rejected reconnection explains the shortfall inside the popover', async ({ page }) => {
  await dispatchBoth(page);
  await next(page, '01:00');
  await advanceTo(page, 240);
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
  const delayB = await crew2DispatchTick(page);
  await next(page, '01:00');
  await advanceTo(page, 240);
  await expect(page.locator('#world-time')).toContainText('23:30');
  await reconnect(page, 'clinic');
  await reconnect(page, 'pump');
  await advanceTo(page, 480 + delayB);
  await expect(page.locator('#world-time')).toContainText(worldText(480 + delayB));
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
  await expect(page.locator('#mode')).toHaveText('RUNNING');
  await sendCrew(page, 'feeder-b', 'crew-2');
  const delayB = await crew2DispatchTick(page);
  await page.locator('#speed').selectOption('30');
  await ensureRunning(page);
  await expect(page.locator('#time')).toHaveText('04:00', { timeout: 20000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#decision')).toContainText('6 units online');
  await reconnectPopover(page, 'clinic');
  await reconnectPopover(page, 'pump');
  await expect(page.locator('#load')).toHaveText('6');
  await page.locator('#resume').click();
  await expect(page.locator('#time')).toHaveText(simText(480 + delayB), { timeout: 20000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#decision')).toContainText('13 units online');
  for (const id of ['housing-a', 'housing-b', 'beacon']) await reconnectPopover(page, id);
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#decision')).toContainText('All services restored');
  await expect(page.locator('#resume')).toHaveText('View summary');
  await expect(summaryDowntime(page, 'clinic')).toHaveText('0h 00m');
  await expect(summaryDowntime(page, 'housing-a')).toHaveText(durationText(480 + delayB));
  await expect(summaryDowntime(page, 'housing-b')).toHaveText(durationText(480 + delayB));
  await expect(summaryDowntime(page, 'pump')).toHaveText('4h 00m');
  await expect(summaryDowntime(page, 'beacon')).toHaveText(durationText(480 + delayB));
  await expect(page.locator('#summary')).toContainText('backup remaining 2h 00m');
});

test('clinic backup warning and expiry auto-pause on a housing-first run', async ({ page }) => {
  test.setTimeout(90000);
  await page.locator('#speed').selectOption('1');
  await sendCrew(page, 'feeder-a', 'crew-1');
  await ensurePaused(page);
  await sendCrew(page, 'feeder-b', 'crew-2');
  const delayB = await crew2DispatchTick(page);
  await page.locator('#speed').selectOption('30');
  await ensureRunning(page);
  await expect(page.locator('#time')).toHaveText('04:00', { timeout: 20000 });
  await reconnectPopover(page, 'housing-a');
  await reconnectPopover(page, 'housing-b');
  await page.locator('#resume').click();
  await expect(page.locator('#time')).toHaveText('05:00', { timeout: 20000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#decision')).toContainText('fuel left');
  await page.locator('#resume').click();
  await expect(page.locator('#time')).toHaveText('06:00', { timeout: 20000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  await expect(page.locator('#decision')).toContainText('gone dark');
  await page.locator('#resume').click();
  await expect(page.locator('#time')).toHaveText(simText(480 + delayB), { timeout: 20000 });
  await expect(page.locator('#decision')).toContainText('13 units online');
});

test('try a different order resets without a dialog and compares session runs', async ({ page }) => {
  test.setTimeout(120000);
  const completeRun = async () => {
    await page.locator('#speed').selectOption('1');
    await sendCrew(page, 'feeder-a', 'crew-1');
    await ensurePaused(page);
    await sendCrew(page, 'feeder-b', 'crew-2');
    const delayB = await crew2DispatchTick(page);
    await page.locator('#speed').selectOption('30');
    await ensureRunning(page);
    await expect(page.locator('#time')).toHaveText('04:00', { timeout: 20000 });
    await reconnectPopover(page, 'clinic');
    await reconnectPopover(page, 'pump');
    await page.locator('#resume').click();
    await expect(page.locator('#time')).toHaveText(simText(480 + delayB), { timeout: 20000 });
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
  await expect(page.locator('#mode')).toHaveText('RUNNING');
  // Blur first: the auto-opened Feeder B popover focuses Send Crew 2, which Space would click.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
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

test('guidance overlay sits inside the top of the scene', async ({ page }) => {
  test.setTimeout(60000);
  const scene = await page.locator('#scene').boundingBox();
  const banner = await page.locator('#task-banner').boundingBox();
  expect(banner).not.toBeNull();
  expect(banner!.y).toBeGreaterThanOrEqual(scene!.y - 1);
  expect(banner!.y + banner!.height).toBeLessThanOrEqual(scene!.y + 80);
  const capacityOverlay = await page.locator('.capacity-overlay').boundingBox();
  expect(capacityOverlay!.y).toBeGreaterThanOrEqual(scene!.y - 1);
  expect(capacityOverlay!.x + capacityOverlay!.width).toBeGreaterThanOrEqual(scene!.x + scene!.width - 24);
  await page.locator('#speed').selectOption('30');
  await sendCrew(page, 'feeder-a', 'crew-1');
  await sendCrew(page, 'feeder-b', 'crew-2');
  await expect(page.locator('#mode')).toHaveText('RUNNING');
  await expect(page.locator('#time')).toHaveText('04:00', { timeout: 20000 });
  await expect(page.locator('#mode')).toHaveText('PAUSED');
  const sceneAfter = await page.locator('#scene').boundingBox();
  const decision = await page.locator('#decision').boundingBox();
  expect(decision!.y).toBeGreaterThanOrEqual(sceneAfter!.y - 1);
  expect(decision!.y + decision!.height).toBeLessThanOrEqual(sceneAfter!.y + 140);
  await expect(page.locator('#task-banner')).toBeHidden();
});

test('replay restores matching lights and past history without mutating live run', async ({ page }) => {
  const delayB = await dispatchBoth(page);
  await next(page, '01:00');
  await advanceTo(page, 240);
  await reconnect(page, 'clinic');
  await reconnect(page, 'pump');
  await advanceTo(page, 480 + delayB);
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
  await page.locator('#cursor').fill(String(480 + delayB));
  expect(await page.locator('#events').textContent()).toBe(history);
  await page.locator('#return-live').click();
  await expect(page.locator('#time')).toHaveText(simText(480 + delayB));
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
  await expect(page.locator('#backup')).toHaveText('6h 00m');
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
  await expect(page.locator('#mode')).toHaveText('RUNNING');
  await activate('#inspect-b');
  // The auto-opened Feeder B popover focuses Send Crew 2 — Enter dispatches it.
  await expect(page.locator('#node-actions [data-crew="crew-2"]')).toBeFocused();
  const sent = async () => (await page.locator('#crews [data-crew="crew-2"] .crew-state').textContent())!.includes('Feeder B');
  for (let n = 0; n < 10 && !(await sent()); n++) await page.keyboard.press('Enter');
  expect(await sent()).toBe(true);
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
  await advanceTo(page, 240);
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
  await advanceTo(page, 240);
  await reconnect(page, 'clinic');
  await page.evaluate(() => (window as unknown as { restoreGraphics: () => void }).restoreGraphics());
  await expect(page.locator('#render-notice')).toBeHidden();
  await expect(page.locator('#load')).toHaveText('4');
  await expect(page.locator('#time')).toHaveText('04:00');
});

test('reduced motion completes the incident with no decorative animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const delayB = await dispatchBoth(page);
  await next(page, '01:00');
  await advanceTo(page, 240);
  await reconnect(page, 'clinic');
  await reconnect(page, 'pump');
  await advanceTo(page, 480 + delayB);
  for (const id of ['housing-a', 'housing-b', 'beacon']) await reconnect(page, id);
  await expect(page.locator('#load')).toHaveText('13');
  await expect(page.locator('#summary')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('desktop clarity: scene fills most of the viewport and the header stays compact', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const scene = await page.locator('#scene').boundingBox();
  expect(scene!.height).toBeGreaterThanOrEqual(0.6 * 900);
  const header = await page.locator('.masthead').boundingBox();
  expect(header!.height).toBeLessThanOrEqual(56);
  const strip = await page.locator('#service-strip').boundingBox();
  expect(strip!.height).toBeLessThanOrEqual(56);
  const transport = await page.locator('.transport').boundingBox();
  expect(transport!.height).toBeLessThanOrEqual(56);
});

test('mobile clarity: world time stays visible with no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#world-time')).toBeVisible();
  await expect(page.locator('#world-time')).toContainText('19:30');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const scene = await page.locator('#scene').boundingBox();
  expect(scene!.height).toBeGreaterThanOrEqual(0.45 * 844);
});

test('briefing states the stakes and the generator deadline', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#briefing')).toBeVisible();
  await expect(page.locator('#briefing')).toContainText('until about 01:30');
  await expect(page.locator('#briefing')).toContainText('Storm 01 — After the storm');
});

test('parallel dispatch decision quotes real ETAs and the header hides sim time', async ({ page }) => {
  test.setTimeout(60000);
  const delayB = await dispatchBoth(page);
  expect(await page.locator('#task-banner').textContent()).not.toMatch(/\b\d\d:\d\d \(estimates?\)/);
  await expect(page.locator('.masthead time')).toHaveCount(1);
  await expect(page.locator('#time')).toBeHidden();
  await next(page, '01:00');
  await advanceTo(page, 240);
  await expect(page.locator('#decision')).toContainText('Feeder A is back — 6 units online');
  await expect(page.locator('#decision')).toContainText('runs out at 01:30');
  await expect(page.locator('#decision')).toContainText(`isn't due until ${worldText(480 + delayB)}`);
});

test('sound starts on Begin, toggles with M, and cues follow live events only', async ({ page }) => {
  test.setTimeout(90000);
  const cues = () => page.evaluate(() => (window as unknown as { __audio: { cues: string[] } }).__audio.cues.slice());
  const state = () => page.evaluate(() => (window as unknown as { __audio: { state: string } }).__audio.state);
  expect(await state()).toBe('running');
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sound-toggle')).toHaveText('Sound on');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('m');
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#sound-toggle')).toHaveText('Sound off');
  await page.keyboard.press('m');
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  await dispatchBoth(page);
  await next(page, '01:00');
  await advanceTo(page, 240);
  await reconnect(page, 'clinic');
  await reconnect(page, 'pump');
  await reconnect(page, 'housing-a');
  expect(await cues()).toContain('reconnect');
  expect(await cues()).toContain('reject');
  const beforeReplay = await cues();
  await page.locator('#replay').click();
  await page.locator('#cursor').fill('200');
  await page.locator('#cursor').fill('60');
  expect(await cues()).toEqual(beforeReplay);
});

// Camera control — full orbit, eased commands, zoom-to-cursor, drift gating.
const cameraState = (page: Page) => page.evaluate(() =>
  (window as unknown as { __scene: { cameraState(): { theta: number; phi: number; distance: number; target: { x: number; z: number } } } }).__scene.cameraState());
const fitDistance = (page: Page) => page.evaluate(() => (window as unknown as { __scene: { fittedDistance: number } }).__scene.fittedDistance);
const settle = (page: Page) => page.waitForTimeout(500); // outlast the ~350 ms ease
const groundPoint = (page: Page, x: number, z: number) => page.evaluate(([wx, wz]) => {
  const s = (window as unknown as { __scene: never }).__scene as {
    camera: { position: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } } } };
    renderer: { domElement: { getBoundingClientRect(): DOMRect } };
  };
  const v = new s.camera.position.constructor(wx!, .45, wz!).project(s.camera);
  const c = s.renderer.domElement.getBoundingClientRect();
  return { x: c.left + (v.x + 1) * c.width / 2, y: c.top + (-v.y + 1) * c.height / 2 };
}, [x, z]);

test('camera orbits a full 360 degrees past the old azimuth clamp', async ({ page }) => {
  const start = await cameraState(page);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowRight'); await settle(page); }
  const end = await cameraState(page);
  let delta = Math.abs(end.theta - start.theta) % (Math.PI * 2);
  delta = Math.min(delta, Math.PI * 2 - delta);
  expect(delta * 180 / Math.PI).toBeGreaterThanOrEqual(170);
});

test('zoom clamps between 0.22x and 1.8x the fitted distance', async ({ page }) => {
  const fit = await fitDistance(page);
  for (let i = 0; i < 8; i++) {
    await page.locator('#zoom-in').click();
    await settle(page);
    const s = await cameraState(page);
    expect(s.distance).toBeGreaterThanOrEqual(fit * .215);
  }
  expect((await cameraState(page)).distance).toBeLessThanOrEqual(fit * .23);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('0');
  await settle(page);
  for (let i = 0; i < 4; i++) {
    await page.locator('#zoom-out').click();
    await settle(page);
  }
  expect((await cameraState(page)).distance).toBeGreaterThanOrEqual(fit * 1.75);
  expect((await cameraState(page)).distance).toBeLessThanOrEqual(fit * 1.81);
});

test('tilt clamps at 12 degrees from top-down and 84 degrees at harbour level', async ({ page }) => {
  for (let i = 0; i < 9; i++) { await page.locator('#tilt-up').click(); await settle(page); }
  expect((await cameraState(page)).phi).toBeCloseTo(Math.PI / 15, 2); // 12 deg
  for (let i = 0; i < 9; i++) { await page.locator('#tilt-down').click(); await settle(page); }
  expect((await cameraState(page)).phi).toBeCloseTo(Math.PI * 84 / 180, 2);
});

test('reset returns to the fitted view after orbit and zoom', async ({ page }) => {
  const home = await cameraState(page);
  await page.locator('#rotate-left').click();
  await page.locator('#zoom-in').click();
  await settle(page);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('0');
  await settle(page);
  const end = await cameraState(page);
  expect(Math.abs(end.theta - home.theta) * 180 / Math.PI).toBeLessThan(1);
  expect(Math.abs(end.phi - home.phi) * 180 / Math.PI).toBeLessThan(1);
  expect(Math.abs(end.distance - home.distance) / home.distance).toBeLessThan(.01);
});

test('wheel zooms toward the cursor and the target stays on the platform', async ({ page }) => {
  // Tilt up first: at the default shallow angle OrbitControls' tilt limit pins
  // the target (the camera still dollies along the cursor ray); past ~70° from
  // vertical the focus target tracks the cursor too.
  for (let i = 0; i < 2; i++) { await page.locator('#tilt-up').click(); await settle(page); }
  const point = await groundPoint(page, 8, -2.5); // apron-side ground by Feeder B
  const before = await cameraState(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -600);
  await settle(page);
  const after = await cameraState(page);
  expect(after.distance).toBeLessThan(before.distance);
  expect(after.target.x).toBeGreaterThan(before.target.x); // moved toward Feeder B's side
  expect(Math.abs(after.target.x)).toBeLessThanOrEqual(11);
  expect(Math.abs(after.target.z)).toBeLessThanOrEqual(8.5);
});

test('idle drift stays suppressed after a camera input', async ({ page }) => {
  await page.locator('#rotate-right').click();
  await settle(page);
  const first = (await cameraState(page)).theta;
  await page.waitForTimeout(3000);
  expect(Math.abs((await cameraState(page)).theta - first)).toBeLessThan(.005);
});

test('marker picking still works rotated 180 degrees', async ({ page }) => {
  for (let i = 0; i < 6; i++) { await page.locator('#rotate-right').click(); await settle(page); }
  await clickMarker(page, 'feeder-a');
  await expect(page.locator('#node-actions')).toBeVisible();
  await expect(page.locator('#popover-title')).toHaveText('Feeder A');
});

test('camera commands apply instantly under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const before = (await cameraState(page)).theta;
  await page.locator('#rotate-left').click();
  await page.waitForTimeout(80);
  expect(Math.abs((await cameraState(page)).theta - before)).toBeCloseTo(Math.PI / 6, 2);
});
