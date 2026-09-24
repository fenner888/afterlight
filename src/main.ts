import './style.css';
import { initialState, execute, advance, capacity, connectedLoad, serviceStatus, nextTransition, phase } from './domain.ts';
import type { Action, DomainEvent, State } from './domain.ts';
import { Clock } from './clock.ts';
import { replay } from './history.ts';
import { DistrictScene } from './scene/index.ts';
import { Sound } from './audio.ts';
import type { Cue } from './audio.ts';
import { SERVICES, SERVICE_IDS, FEEDER_IDS, NODE_IDS, CREW_IDS, LABELS, SCENARIOS, SCENARIO_IDS, upstreamCapacity, depotTravel, crossTravel, isNode, isService, isFeeder, formatTime, formatDuration, formatWorldTime, dayPhase, sunriseTick } from './scenario.ts';
import type { NodeId, ServiceId, CrewId, ScenarioId, ScenarioConfig } from './scenario.ts';

const element = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing interface element: ${id}`);
  return result as T;
};
const text = (id: string, value: string): void => { element(id).textContent = value; };
const button = (id: string): HTMLButtonElement => element<HTMLButtonElement>(id);
type RunSummary = { downtimes: Record<ServiceId, number>; order: { tick: number; target: ServiceId }[]; backupRemaining: number; endTick: number };
let current: ScenarioId = 'storm-01';
let live = initialState(current);
const configOf = (state: State): ScenarioConfig => SCENARIOS[state.scenario];
// World-clock shorthand — every helper takes the scenario's tick-0 minutes.
const wt = (tick: number, state: State): string => formatWorldTime(tick, configOf(state).worldStart);
let review: State | null = null;
let selected: NodeId = 'clinic';
const liveClock = new Clock();
const reviewClock = new Clock();
let lastClockTime = performance.now();
let lastFrameTime = 0;
let historyKey = '';
let scene: DistrictScene | null = null;
let frameHandle = 0;
let metricsTime = 0;
let backupWarned = false;
let liveArchived = false;
let decisionMessage = '';
let popoverNode: NodeId | null = null;
let popoverReturnFocus: HTMLElement | null = null;
let popoverKey = '';
let summaryKey = '';
let summaryDismissed = false;
// Latest completed runs per storm (in-memory only, kept for the comparison summary).
const completedRuns: Record<ScenarioId, RunSummary[]> = { 'storm-01': [], 'storm-02': [], 'storm-03': [] };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const frameSamples: number[] = [];
const sound = new Sound();
let eventCursor = live.events.length;
const audioDebug = { cues: [] as string[], get state() { return sound.state; }, get muted() { return sound.muted; } };
const fireCue = (name: Cue, service?: ServiceId): void => {
  audioDebug.cues.push(name);
  sound.cue(name, service ? { service } : undefined);
};
const eventCue = (event: DomainEvent): void => {
  if (event.kind === 'arrived') fireCue('hydraulic');
  else if (event.kind === 'repaired') fireCue('repaired');
  else if (event.kind === 'reconnected') fireCue('reconnect', event.node as ServiceId);
  else if (event.kind === 'disconnected') fireCue('disconnect');
  else if (event.kind === 'backup-expired') fireCue('generator-stop');
};
const view = (): State => review ?? live;
const clock = (): Clock => review ? reviewClock : liveClock;
const picker = element<HTMLSelectElement>('node-select');
const cursor = element<HTMLInputElement>('cursor');
const speed = element<HTMLSelectElement>('speed');
const dialog = element<HTMLDialogElement>('restart-dialog');
const statusNames = { grid: 'Grid powered', backup: 'Backup power', offline: 'Offline' };
const feederNames = { faulted: 'Faulted', reserved: 'Crew en route', repairing: 'Repairing', repaired: 'Repaired' };

for (const [index, id] of NODE_IDS.entries()) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = `${String(index + 1).padStart(2, '0')} / ${LABELS[id]}`;
  picker.append(option);
}
const serviceElements = new Map<ServiceId, { button: HTMLButtonElement; status: HTMLElement; time: HTMLElement }>();
for (const id of SERVICE_IDS) {
  const item = document.createElement('button');
  item.className = 'service-cell';
  item.dataset.service = id;
  const label = document.createElement('strong');
  label.textContent = LABELS[id];
  const status = document.createElement('span');
  status.className = 'service-state';
  const time = document.createElement('span');
  time.className = 'service-time';
  item.append(label, status, time);
  item.addEventListener('click', () => activateNode(id));
  element('service-strip').append(item);
  serviceElements.set(id, { button: item, status, time });
}
const capacityBar = element('capacity-bar');
const segments: HTMLElement[] = [];
for (let i = 0; i < 13; i++) {
  const segment = document.createElement('span');
  segment.className = 'seg';
  capacityBar.append(segment);
  segments.push(segment);
}
const crewElements = new Map<CrewId, { status: HTMLElement; estimate: HTMLElement; progress: HTMLProgressElement }>();
for (const id of CREW_IDS) {
  const container = document.createElement('div');
  container.className = 'crew';
  container.dataset.crew = id;
  const title = document.createElement('div');
  title.className = 'crew-title';
  const label = document.createElement('span');
  label.textContent = LABELS[id];
  const status = document.createElement('span');
  title.append(label, status);
  const estimate = document.createElement('p');
  estimate.className = 'crew-state';
  const progress = document.createElement('progress');
  progress.max = 1;
  progress.value = 0;
  progress.setAttribute('aria-label', `${LABELS[id]} task progress`);
  container.append(title, estimate, progress);
  element('crews').append(container);
  crewElements.set(id, { status, estimate, progress });
}

function feedback(message: string, error = false): void {
  text('feedback', message);
  element('feedback').dataset.error = String(error);
}

function selectNode(id: NodeId): void {
  selected = id;
  element('inspector-body').hidden = false;
  button('toggle-inspector').setAttribute('aria-expanded', 'true');
  text('toggle-inspector', 'Hide inspector');
  refresh();
}

function activateNode(id: NodeId): void {
  selectNode(id);
  openPopover(id);
}

function openPopover(id: NodeId): void {
  if (popoverNode !== id) {
    const active = document.activeElement;
    // Never capture the popover's own chrome — a same-moment re-render can leave
    // focus on it, and restoring there would trap focus inside the hidden dialog.
    if (active instanceof HTMLElement && !active.closest('#node-actions')) popoverReturnFocus = active;
  }
  popoverNode = id;
  popoverKey = '';
  if (scene) scene.popoverOpen = true;
  element('node-actions').hidden = false;
  text('popover-message', '');
  updatePopover();
  positionPopover();
  const first = element('node-actions').querySelector<HTMLElement>('#popover-actions button:not(:disabled)') ?? element('popover-close');
  first.focus();
}

function closePopover(): void {
  if (!popoverNode) return;
  popoverNode = null;
  if (scene) scene.popoverOpen = false;
  element('node-actions').hidden = true;
  if (popoverReturnFocus && popoverReturnFocus !== document.body && popoverReturnFocus.isConnected) popoverReturnFocus.focus();
  else if (document.activeElement instanceof HTMLElement && element('node-actions').contains(document.activeElement)) document.activeElement.blur();
  popoverReturnFocus = null;
}

function updatePopover(): void {
  if (!popoverNode) return;
  const state = view();
  const cfg = configOf(state);
  const id = popoverNode;
  const readOnly = review !== null || clock().pendingTicks > 0;
  text('popover-title', LABELS[id]);
  text('popover-flavor', isService(id) ? SERVICES[id].flavor : '');
  const status = element('popover-status');
  const actions = element('popover-actions');
  if (isFeeder(id)) {
    const condition = state.feeders[id];
    const crewId = CREW_IDS.find(crew => state.crews[crew].target === id && state.crews[crew].phase !== 'idle');
    if (condition === 'faulted') {
      status.textContent = `Faulted. +${cfg.feeders[id].capacity} CU · ${formatDuration(depotTravel)} travel · ${formatDuration(cfg.feeders[id].repairTicks)} repair.`;
    } else if (condition === 'repaired') {
      status.textContent = `Repaired · +${cfg.feeders[id].capacity} CU online. Reconnect services to use it.`;
    } else if (crewId) {
      const crew = state.crews[crewId];
      status.textContent = crew.phase === 'traveling'
        ? `${LABELS[crewId]} en route · arrives in ${formatDuration(crew.arriveAt - state.tick)}`
        : `${LABELS[crewId]} repairing · done in ${formatDuration(crew.completeAt - state.tick)}`;
    }
  } else if (isService(id)) {
    const service = state.services[id];
    status.textContent = `${statusNames[serviceStatus(state, id)]} · ${SERVICES[id].load} CU load${cfg.backup[id] ? ` · backup ${formatDuration(service.backupRemaining)}` : ''} · downtime ${formatDuration(service.downtime)}`;
  } else {
    status.textContent = id === 'supply' ? `Intact · ${upstreamCapacity} CU source feeding the shared district bus.` : 'Crew origin · no service load.';
  }
  const key = `${id}|${isFeeder(id) ? state.feeders[id] : isService(id) ? String(state.services[id].connected) : ''}|${CREW_IDS.map(crew => `${state.crews[crew].phase}:${state.crews[crew].target}`).join('')}|${readOnly}|${capacity(state)}|${connectedLoad(state)}`;
  if (key !== popoverKey) {
    const hadFocus = element('node-actions').contains(document.activeElement);
    popoverKey = key;
    actions.replaceChildren();
    text('popover-hint', '');
    if (isFeeder(id) && state.feeders[id] === 'faulted') {
      for (const crew of CREW_IDS) {
        const action = document.createElement('button');
        const crewState = state.crews[crew];
        const away = crewState.phase === 'away';
        const busy = crewState.phase !== 'idle';
        action.dataset.crew = crew;
        action.textContent = away ? `${LABELS[crew]} · back ${wt(crewState.returnAt, state)}` : busy ? `${LABELS[crew]} · busy at ${LABELS[crewState.target!]}` : `Send ${LABELS[crew]}`;
        action.disabled = busy || readOnly;
        if (!busy) action.addEventListener('click', () => command({ type: 'dispatch', crew, target: id }));
        actions.append(action);
      }
    } else if (isService(id)) {
      const connected = state.services[id].connected;
      const action = document.createElement('button');
      action.className = 'primary-action';
      action.textContent = connected ? `Disconnect (release ${SERVICES[id].load} CU)` : `Reconnect (${SERVICES[id].load} CU)`;
      action.disabled = readOnly;
      action.addEventListener('click', () => command({ type: connected ? 'disconnect' : 'reconnect', target: id }));
      actions.append(action);
      const headroom = capacity(state) - connectedLoad(state);
      if (!connected && SERVICES[id].load > headroom) text('popover-hint', `Needs ${SERVICES[id].load} CU · ${Math.max(0, headroom)} CU free`);
    }
    if (hadFocus) (actions.querySelector<HTMLElement>('button:not(:disabled)') ?? element('popover-close')).focus();
  }
}

const narrowScene = matchMedia('(max-width: 600px)');

function positionPopover(): void {
  if (!popoverNode) return;
  const popover = element('node-actions');
  const host = element('scene-markers');
  const hostRect = host.getBoundingClientRect();
  if (narrowScene.matches) {
    popover.style.left = '';
    popover.style.top = '';
    return;
  }
  const anchor = scene?.anchor(popoverNode) ?? { x: hostRect.width / 2, y: 24, w: 0, h: 0 };
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const obstacles = scene ? NODE_IDS.filter(id => id !== popoverNode).flatMap(id => scene!.anchor(id) ?? []) : [];
  for (const selector of ['.camera-tools', '.scene-note', '.guidance-overlay', '.capacity-overlay']) {
    const overlay = document.querySelector<HTMLElement>(`#scene ${selector}`);
    if (!overlay) continue;
    const rect = overlay.getBoundingClientRect();
    obstacles.push({ x: rect.left - hostRect.left, y: rect.top - hostRect.top, w: rect.width, h: rect.height });
  }
  const covers = (left: number, top: number): number =>
    obstacles.filter(other => left < other.x + other.w + 6 && left + width > other.x - 6 && top < other.y + other.h + 6 && top + height > other.y - 6).length;
  const inside = (left: number, top: number): boolean => left >= 8 && top >= 8 && left + width <= hostRect.width - 8 && top + height <= hostRect.height - 8;
  const candidates = [
    { left: anchor.x + anchor.w + 10, top: anchor.y + anchor.h / 2 - height / 2 },
    { left: anchor.x - width - 10, top: anchor.y + anchor.h / 2 - height / 2 },
    { left: anchor.x + anchor.w / 2 - width / 2, top: anchor.y + anchor.h + 10 },
    { left: anchor.x + anchor.w / 2 - width / 2, top: anchor.y - height - 10 },
  ];
  let best = candidates[0]!;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const left = Math.max(8, Math.min(candidate.left, Math.max(8, hostRect.width - width - 8)));
    const top = Math.max(8, Math.min(candidate.top, Math.max(8, hostRect.height - height - 8)));
    const score = covers(left, top) * 100 + (inside(candidate.left, candidate.top) ? 0 : 10);
    if (score < bestScore) { bestScore = score; best = { left, top }; }
  }
  popover.style.left = `${best.left}px`;
  popover.style.top = `${best.top}px`;
}

function taskText(state: State): string {
  const cfg = configOf(state);
  const current = phase(state);
  if (current === 'restored') {
    const restored = restoredTick(state);
    return state.tick >= sunriseTick(cfg)
      ? `Every light came back on at ${wt(restored, state)}. The sun is up — review your run.`
      : `Every light is back on at ${wt(restored, state)}. Watch the sun come up, or review your run.`;
  }
  const working = CREW_IDS.filter(id => state.crews[id].phase === 'traveling' || state.crews[id].phase === 'repairing');
  const idle = CREW_IDS.filter(id => state.crews[id].phase === 'idle');
  const away = CREW_IDS.filter(id => state.crews[id].phase === 'away');
  const awayNote = away.length ? ` ${LABELS[away[0]!]} is back at ${wt(state.crews[away[0]!].returnAt, state)}.` : '';
  const clinic = state.services.clinic;
  const generator = !clinic.connected && clinic.backupRemaining > 0 ? ` Clinic generator until ${wt(state.tick + clinic.backupRemaining, state)}.` : '';
  const rolling = (id: CrewId): string => `${LABELS[id]} ${state.crews[id].phase === 'traveling' ? 'is rolling to' : 'is repairing'} ${LABELS[state.crews[id].target!]}.`;
  if (current === 'dispatch') {
    if (working.length === 0) {
      if (away.length && idle.length === 1) return `Send ${LABELS[idle[0]!]} — click a broken feeder.${awayNote}`;
      return 'Send both crews — click a broken feeder on the map.';
    }
    const idleCrew = idle[0];
    const openFeeder = FEEDER_IDS.find(id => state.feeders[id] === 'faulted');
    const next = idleCrew && openFeeder ? ` Send ${LABELS[idleCrew]} to ${LABELS[openFeeder]} — the longer it waits, the later that repair finishes.` : awayNote;
    return `${rolling(working[0]!)}${next}`;
  }
  // A crew is away while the other is out — call out the return time.
  if (away.length && working.length === 1 && state.crews[working[0]!].phase === 'traveling') {
    return `${rolling(working[0]!)}${awayNote}`;
  }
  if (capacity(state) === 0) {
    const estimate = (id: (typeof FEEDER_IDS)[number]): string => {
      const crew = working.map(crew => state.crews[crew]).find(crew => crew.target === id);
      return wt(crew ? crew.completeAt : state.tick + depotTravel + cfg.feeders[id].repairTicks, state);
    };
    const estimates = FEEDER_IDS
      .filter(id => state.feeders[id] === 'reserved' || state.feeders[id] === 'repairing')
      .map(id => `${LABELS[id]} due ${estimate(id)}`);
    return `Crews working. ${estimates.join(' · ') || 'Repairs underway'}.${generator}${awayNote}`;
  }
  const free = capacity(state) - connectedLoad(state);
  return `${free} of ${capacity(state)} units free. Click a dark building to reconnect it.${generator}${awayNote}`;
}

function showDecision(title: string, guidance: string, label = 'Resume', cueName: Cue = 'decision'): void {
  decisionMessage = title;
  liveClock.setRunning(false);
  text('decision-title', title);
  text('decision-text', guidance);
  text('resume', label);
  element('decision').hidden = false;
  fireCue(cueName);
  feedback(`Paused at ${wt(live.tick, live)} — ${title}.`);
}

function resumeLive(): void {
  decisionMessage = '';
  liveClock.setRunning(true);
  lastClockTime = performance.now();
  refresh();
}

function backupWarnTick(state: State): number | null {
  const clinic = state.services.clinic;
  if (backupWarned || clinic.connected || clinic.backupRemaining <= 60) return null;
  return state.tick + clinic.backupRemaining - 60;
}

function decisionCheck(before: State, after: State): boolean {
  for (const id of FEEDER_IDS) {
    if (before.feeders[id] !== 'repaired' && after.feeders[id] === 'repaired') {
      const online = capacity(after);
      const demand = SERVICE_IDS.reduce((sum, service) => sum + (after.services[service].connected ? 0 : SERVICES[service].load), 0);
      const clinic = after.services.clinic;
      const other = FEEDER_IDS.find(feeder => feeder !== id)!;
      const otherCrew = CREW_IDS.map(crew => after.crews[crew]).find(crew => crew.target === other && crew.phase !== 'idle');
      let guidance: string;
      if (online >= demand) {
        guidance = 'Enough for everyone. Reconnect every building still dark.';
      } else {
        const clauses: string[] = [];
        if (!clinic.connected && clinic.backupRemaining > 0) clauses.push(`The clinic generator runs out at ${wt(after.tick + clinic.backupRemaining, after)}`);
        if (otherCrew) clauses.push(`${LABELS[other]} isn't due until ${wt(otherCrew.completeAt, after)}`);
        guidance = `Not enough for everyone (${upstreamCapacity} needed).`;
        if (clauses.length) guidance += ` ${clauses.join('; ')}.`;
        guidance += ' Click buildings to reconnect, then Resume.';
      }
      showDecision(`${LABELS[id]} is back — ${online} units online`, guidance);
      return true;
    }
  }
  // An away crew coming home pauses like any other decision point; when a
  // feeder still needs a crew, open its popover with the Send button focused.
  for (const id of CREW_IDS) {
    if (before.crews[id].phase === 'away' && after.crews[id].phase === 'idle') {
      const openFeeder = FEEDER_IDS.find(feeder => after.feeders[feeder] === 'faulted');
      showDecision(`${LABELS[id]} is back at the depot`, openFeeder ? `Send it to ${LABELS[openFeeder]}.` : 'Both feeders are covered.');
      if (openFeeder) activateNode(openFeeder);
      return true;
    }
  }
  const previous = before.services.clinic;
  const clinic = after.services.clinic;
  if (previous.backupRemaining > 0 && clinic.backupRemaining === 0 && !clinic.connected) {
    showDecision('The clinic has gone dark', `It stays dark until you reconnect it — ${SERVICES.clinic.load} units.`);
    return true;
  }
  if (!backupWarned && !clinic.connected && previous.backupRemaining > 60 && clinic.backupRemaining > 0 && clinic.backupRemaining <= 60) {
    backupWarned = true;
    const free = capacity(after) - connectedLoad(after);
    // The swap hint only applies when enough capacity exists to hold the
    // clinic — e.g. Storm 03's 4-CU Feeder A fully occupied by other services.
    const canSwap = capacity(after) >= SERVICES.clinic.load && free < SERVICES.clinic.load;
    showDecision(
      'Clinic generator: 1h of fuel left',
      `At ${wt(after.tick + clinic.backupRemaining, after)} the clinic goes dark unless it's reconnected.${canSwap ? ` Disconnect another building to free ${SERVICES.clinic.load} units, or let it go.` : ''}`,
      'Resume',
      'backup-warn',
    );
    return true;
  }
  const sunrise = sunriseTick(configOf(after));
  if (phase(after) === 'restored' && before.tick < sunrise && after.tick === sunrise) {
    showDecision('Dawn breaks over the district', 'The sun is up — the storm is over. Open the summary to review your run.', 'View summary', 'sunrise');
    return true;
  }
  return false;
}

function advanceLive(ticks: number): void {
  const target = live.tick + ticks;
  while (live.tick < target) {
    let boundary = target;
    const transition = nextTransition(live);
    const warn = backupWarnTick(live);
    if (transition !== null && transition < boundary) boundary = transition;
    if (warn !== null && warn < boundary) boundary = warn;
    const sunrise = sunriseTick(configOf(live));
    if (phase(live) === 'restored' && live.tick < sunrise && sunrise < boundary) boundary = sunrise;
    const before = live;
    live = advance(live, boundary);
    if (decisionCheck(before, live)) break;
  }
}

function sync(now = performance.now()): void {
  const currentTime = Math.max(now, lastClockTime);
  const ticks = clock().consume(currentTime - lastClockTime);
  lastClockTime = currentTime;
  if (!ticks) return;
  if (review) {
    review = replay(live.commands, Math.min(live.tick, review.tick + ticks), live.scenario);
    if (review.tick === live.tick) reviewClock.setRunning(false);
  } else advanceLive(ticks);
  refresh();
}

function shakeCapacity(): void {
  if (reducedMotion.matches) return;
  capacityBar.classList.remove('shake');
  void capacityBar.offsetWidth;
  capacityBar.classList.add('shake');
  setTimeout(() => capacityBar.classList.remove('shake'), 320);
}

function command(action: Action): void {
  sync();
  if (review) { feedback('Replay is read-only. Return to live before changing the district.', true); return; }
  if (liveClock.pendingTicks > 0) { feedback('Processing queued simulation time. Resume time and wait for catch-up before issuing a command.', true); return; }
  const result = execute(live, { ...action, tick: live.tick, sequence: live.commands.length });
  live = result.state;
  feedback(result.message, !result.ok);
  if (!result.ok) {
    fireCue('reject');
    shakeCapacity();
    if (popoverNode) text('popover-message', result.message);
    refresh();
    return;
  }
  if (popoverNode) text('popover-message', '');
  if (action.type === 'dispatch') {
    if (!liveClock.running) {
      decisionMessage = '';
      liveClock.setRunning(true);
      lastClockTime = performance.now();
    }
    const idleCrew = CREW_IDS.find(id => live.crews[id].phase === 'idle');
    const openFeeder = FEEDER_IDS.find(id => live.feeders[id] === 'faulted');
    if (idleCrew && openFeeder) {
      feedback(`${LABELS[action.crew]} rolling to ${LABELS[action.target]}. Send ${LABELS[idleCrew]} to ${LABELS[openFeeder]} next.`);
      activateNode(openFeeder);
    } else feedback(`${LABELS[action.crew]} rolling to ${LABELS[action.target]} — time is running.`);
  }
  if (phase(live) === 'restored') {
    showDecision('All services restored', 'The summary shows how long each service was dark.', 'View summary');
  }
  refresh();
}

const restoredTick = (s: State): number => s.events.filter(e => e.kind === 'reconnected').at(-1)?.tick ?? s.tick;

function summarize(state: State): RunSummary {
  return {
    downtimes: Object.fromEntries(SERVICE_IDS.map(id => [id, state.services[id].downtime])) as Record<ServiceId, number>,
    order: state.events.filter(event => event.kind === 'reconnected').map(event => ({ tick: event.tick, target: event.node as ServiceId })),
    backupRemaining: state.services.clinic.backupRemaining,
    endTick: restoredTick(state),
  };
}

function renderSummary(): void {
  const panel = element('summary');
  panel.replaceChildren();
  const state = live;
  const cfg = configOf(state);
  const title = document.createElement('h2');
  title.id = 'summary-title';
  title.tabIndex = -1;
  title.textContent = `${cfg.subtitle} — run complete`;
  const sub = document.createElement('p');
  sub.className = 'summary-sub';
  sub.textContent = `All five services restored · total simulated time ${formatDuration(state.tick)} · clinic backup remaining ${formatDuration(state.services.clinic.backupRemaining)}`;
  const outcome = document.createElement('p');
  outcome.className = 'summary-outcome';
  const clinicDowntime = state.services.clinic.downtime;
  const housingDowntime = Math.max(state.services['housing-a'].downtime, state.services['housing-b'].downtime);
  outcome.textContent = `${clinicDowntime === 0 ? 'The clinic never lost power.' : `The clinic was dark for ${formatDuration(clinicDowntime)}.`} Homes were dark for up to ${formatDuration(housingDowntime)}.`;
  panel.append(title, sub, outcome);
  const downtimeTitle = document.createElement('h3');
  downtimeTitle.textContent = 'SERVICE DOWNTIME';
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  // Latest three runs of this storm side by side; the current run is last.
  const runs = [...completedRuns[live.scenario].slice(-2), summarize(state)];
  for (const label of ['Service', ...runs.map((_, i) => `Run ${i + 1}`)]) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const id of SERVICE_IDS) {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = LABELS[id];
    row.append(name);
    for (const run of runs) {
      const cell = document.createElement('td');
      cell.dataset.downtime = id;
      cell.textContent = formatDuration(run.downtimes[id]);
      row.append(cell);
    }
    body.append(row);
  }
  const restoredRow = document.createElement('tr');
  const restoredName = document.createElement('th');
  restoredName.scope = 'row';
  restoredName.textContent = 'Fully restored';
  restoredRow.append(restoredName);
  for (const run of runs) {
    const cell = document.createElement('td');
    cell.textContent = wt(run.endTick, state);
    restoredRow.append(cell);
  }
  body.append(restoredRow);
  table.append(head, body);
  const orderTitle = document.createElement('h3');
  orderTitle.textContent = 'RECONNECTION ORDER';
  const orderColumns = document.createElement('div');
  orderColumns.className = 'order-columns';
  for (const [index, run] of runs.entries()) {
    const column = document.createElement('div');
    column.className = 'order-col';
    const runLabel = document.createElement('span');
    runLabel.className = 'order-run';
    runLabel.textContent = `Run ${index + 1}`;
    column.append(runLabel);
    if (!run.order.length) {
      const empty = document.createElement('span');
      empty.className = 'order-empty';
      empty.textContent = 'No reconnections';
      column.append(empty);
    } else {
      const list = document.createElement('ol');
      for (const step of run.order) {
        const item = document.createElement('li');
        item.textContent = `${LABELS[step.target]} · ${wt(step.tick, state)}`;
        list.append(item);
      }
      column.append(list);
    }
    orderColumns.append(column);
  }
  const actions = document.createElement('div');
  actions.className = 'summary-actions';
  const sunrise = document.createElement('button');
  sunrise.id = 'sunrise';
  sunrise.textContent = 'Watch the sun come up';
  sunrise.addEventListener('click', () => {
    fireCue('sunrise');
    speed.value = '30';
    liveClock.setSpeed(30);
    resumeLive();
    feedback('Time running: 30 simulated seconds per real second — pausing at dawn.');
  });
  const retry = document.createElement('button');
  retry.id = 'try-again';
  retry.className = 'primary-action';
  retry.textContent = 'Try a different order';
  retry.addEventListener('click', () => {
    archiveRun();
    resetRun();
    feedback(`New ${cfg.subtitle} run. Time is paused.`);
  });
  const another = document.createElement('button');
  another.id = 'try-another';
  another.textContent = 'Try another storm';
  another.addEventListener('click', () => openPicker());
  const reviewButton = document.createElement('button');
  reviewButton.id = 'summary-replay';
  reviewButton.textContent = 'Review replay';
  reviewButton.addEventListener('click', () => startReplay());
  const close = document.createElement('button');
  close.id = 'summary-close';
  close.textContent = 'Back to district';
  close.addEventListener('click', () => { summaryDismissed = true; element('summary').hidden = true; button('play').focus(); });
  if (live.tick < sunriseTick(cfg)) actions.append(sunrise);
  actions.append(retry, another, reviewButton, close);
  panel.append(downtimeTitle, table, orderTitle, orderColumns, actions);
}

function archiveRun(): void {
  if (!liveArchived && phase(live) === 'restored') {
    const list = completedRuns[live.scenario];
    list.push(summarize(live));
    while (list.length > 3) list.shift();
    liveArchived = true;
  }
}

function resetRun(): void {
  live = initialState(current);
  review = null;
  liveClock.reset();
  reviewClock.reset();
  lastClockTime = performance.now();
  backupWarned = false;
  liveArchived = false;
  decisionMessage = '';
  historyKey = '';
  summaryKey = '';
  summaryDismissed = false;
  sound.reset();
  eventCursor = live.events.length;
  element('summary').hidden = true;
  closePopover();
  selectNode('clinic');
}

function refresh(): void {
  const state = view();
  const cfg = configOf(state);
  text('incident-number', `INCIDENT ${String(cfg.number).padStart(2, '0')}`);
  text('incident-title', cfg.title);
  const newEvents = live.events.slice(eventCursor);
  eventCursor = live.events.length;
  if (!review) for (const event of newEvents) eventCue(event);
  const currentClock = clock();
  const available = capacity(state);
  const load = connectedLoad(state);
  const headroom = available - load;
  const catchingUp = currentClock.pendingTicks > 0;
  const readOnly = review !== null || catchingUp;
  text('time', formatTime(state.tick));
  text('world-time', `${dayPhase(state.tick, cfg.worldStart).toUpperCase()} · ${wt(state.tick, state)}`);
  text('mode', review ? 'REPLAY' : currentClock.running ? 'RUNNING' : 'PAUSED');
  text('load', String(load));
  text('capacity', String(available));
  text('headroom', `${headroom} CU headroom · ${upstreamCapacity} CU demand`);

  picker.value = selected;
  text('node-number', String(NODE_IDS.indexOf(selected) + 1).padStart(2, '0'));
  text('inspector-title', LABELS[selected]);
  element('service-detail').hidden = !isService(selected);
  element('feeder-detail').hidden = !isFeeder(selected);
  if (isService(selected)) {
    const service = state.services[selected];
    const definition = SERVICES[selected];
    const status = serviceStatus(state, selected);
    text('node-status', statusNames[status]);
    element('node-status').dataset.tone = status;
    text('node-flavor', definition.flavor);
    text('node-description', selected === 'clinic'
      ? `${formatDuration(cfg.backup.clinic)} of reserve. Grid power preserves what remains; it never recharges the backup.`
      : definition.description ?? '');
    text('service-load', `${definition.load} CU`);
    text('backup', cfg.backup[selected] ? formatDuration(service.backupRemaining) : 'None');
    text('downtime', formatDuration(service.downtime));
    text('connection', service.connected ? 'Connected' : 'Isolated');
    text('connection-action', service.connected ? 'Disconnect service' : 'Reconnect service');
    button('connection-action').disabled = readOnly;
    text('connection-hint', review ? 'Read-only replay. Return to live to issue commands.' : service.connected ? `Disconnect to release ${definition.load} CU. No other service reconnects automatically.` : `${definition.load} CU required · ${headroom} CU available. ${definition.load > headroom ? 'Repair a feeder or free capacity first.' : 'Reconnection is immediate, including while paused.'}`);
  } else if (isFeeder(selected)) {
    const definition = cfg.feeders[selected];
    text('node-status', feederNames[state.feeders[selected]]);
    element('node-status').dataset.tone = state.feeders[selected] === 'repaired' ? 'grid' : state.feeders[selected] === 'faulted' ? 'faulted' : 'backup';
    text('node-flavor', '');
    text('node-description', `Adds ${definition.capacity} CU to the shared district bus. One crew travels, then repairs; services stay disconnected until you choose them.`);
    text('feeder-capacity', `+${definition.capacity} CU`);
    text('repair-duration', formatDuration(definition.repairTicks));
    for (const [index, id] of CREW_IDS.entries()) {
      const feederTaken = state.feeders[selected] !== 'faulted';
      const crew = state.crews[id];
      button(`dispatch-${index + 1}`).disabled = readOnly || crew.phase !== 'idle' || feederTaken;
      text(`dispatch-${index + 1}`, `Dispatch ${LABELS[id]}${crew.phase === 'away' ? ` · back ${wt(crew.returnAt, state)}` : crew.phase !== 'idle' ? ' · busy' : feederTaken ? ' · feeder has a crew' : ''}`);
    }
    text('dispatch-hint', review ? 'Read-only replay. Return to live to dispatch.' : state.feeders[selected] === 'repaired' ? 'Capacity is available. Inspect a service to reconnect it.' : state.feeders[selected] === 'faulted' ? `Depot travel: ${formatDuration(depotTravel)}. Travel from the other feeder: ${formatDuration(crossTravel)}. Busy crews cannot be reassigned.` : 'This feeder already has a crew. Repair cannot be accelerated or cancelled.');
  } else {
    text('node-status', selected === 'supply' ? `Intact · ${upstreamCapacity} CU source` : 'Crew origin · no service load');
    element('node-status').dataset.tone = 'grid';
    text('node-flavor', '');
    text('node-description', selected === 'supply' ? 'Supply is intact. The two parallel feeders are the fault: repair either one to make some capacity available to every service.' : 'Crews operate from the depot. Each can repair one feeder at a time. All authored routes remain traversable.');
  }
  text('a-state', `${feederNames[state.feeders['feeder-a']]} · ${cfg.feeders['feeder-a'].capacity} CU`);
  text('b-state', `${feederNames[state.feeders['feeder-b']]} · ${cfg.feeders['feeder-b'].capacity} CU`);
  text('crew-availability', `${CREW_IDS.filter(id => state.crews[id].phase === 'idle').length} available`);
  for (const id of SERVICE_IDS) {
    const item = serviceElements.get(id)!;
    const status = serviceStatus(state, id);
    item.button.setAttribute('aria-pressed', String(id === selected));
    item.status.textContent = statusNames[status];
    item.status.dataset.tone = status;
    item.time.textContent = `Out ${formatDuration(state.services[id].downtime)}`;
    item.button.setAttribute('aria-label', `${LABELS[id]}, ${statusNames[status]}, downtime ${formatDuration(state.services[id].downtime)}`);
  }
  for (const id of CREW_IDS) {
    const crew = state.crews[id];
    const item = crewElements.get(id)!;
    item.status.textContent = crew.phase === 'idle' ? 'Available' : crew.phase === 'away' ? 'On another job' : crew.phase === 'traveling' ? 'Traveling' : 'Repairing';
    item.estimate.textContent = crew.phase === 'away' ? `Back at ${wt(crew.returnAt, state)}` : crew.phase === 'idle' ? `At ${LABELS[crew.location]}` : `${LABELS[crew.target!]} · ${crew.phase === 'traveling' ? 'arrival' : 'repair'} in ${formatDuration((crew.phase === 'traveling' ? crew.arriveAt : crew.completeAt) - state.tick)}`;
    item.progress.hidden = crew.phase === 'idle' || crew.phase === 'away';
    item.progress.value = crew.phase === 'idle' || crew.phase === 'away' ? 0 : (state.tick - crew.departedAt) / (crew.completeAt - crew.departedAt);
  }
  text('play', currentClock.running ? 'Pause time' : state.tick === 0 ? 'Start time' : 'Resume time');
  button('play').disabled = review !== null && state.tick === live.tick;
  button('step').disabled = currentClock.running || catchingUp || (review !== null && review.tick === live.tick);
  button('next-event').disabled = currentClock.running || catchingUp || review !== null || (nextTransition(state) === null && backupWarnTick(state) === null);
  button('replay').hidden = review !== null;
  button('replay').disabled = live.tick === 0 && live.commands.length === 0;
  button('return-live').hidden = review === null;
  speed.value = String(currentClock.speed);
  cursor.disabled = review === null;
  cursor.max = String(live.tick);
  cursor.value = String(state.tick);
  cursor.setAttribute('aria-valuetext', `${wt(state.tick, state)} of ${wt(live.tick, live)}`);
  text('cursor-label', review ? 'REPLAY CURSOR' : 'LIVE RUN');
  text('cursor-time', `${wt(state.tick, state)} / ${wt(live.tick, live)}`);
  text('history-context', `${state.events.length > 30 ? 'Latest 30 actual' : 'Actual'} events through ${wt(state.tick, state)}${review ? ' · replay' : ''}`);
  const key = `${review !== null}/${state.events.length}/${state.events.at(-1)?.text}`;
  if (key !== historyKey) {
    historyKey = key;
    const list = element('events');
    list.replaceChildren(...state.events.slice(-30).map(event => {
      const item = document.createElement('li');
      item.dataset.tick = String(event.tick);
      const time = document.createElement('time');
      time.textContent = wt(event.tick, state);
      const content = document.createElement('span');
      content.textContent = event.text;
      item.append(time, content);
      return item;
    }));
    list.scrollTop = list.scrollHeight;
  }
  text('task-banner', review ? `Read-only replay at ${wt(state.tick, state)}. Your live run is preserved.` : taskText(state));
  const decisionOpen = Boolean(decisionMessage) && !currentClock.running && !review;
  element('decision').hidden = !decisionOpen;
  element('task-banner').hidden = decisionOpen;
  for (const [index, segment] of segments.entries()) {
    segment.dataset.fill = index < load ? 'load' : index < available ? 'spare' : 'empty';
  }
  capacityBar.setAttribute('aria-label', `${load} of ${available} CU allocated, 13 CU demand`);
  if (phase(state) !== 'restored') summaryDismissed = false;
  const showSummary = phase(state) === 'restored' && !currentClock.running && !review && !summaryDismissed;
  if (showSummary) {
    const summaryStateKey = `${completedRuns[live.scenario].length}/${live.commands.length}/${live.tick}`;
    if (summaryStateKey !== summaryKey) {
      summaryKey = summaryStateKey;
      renderSummary();
    }
    element('summary').hidden = false;
  } else {
    element('summary').hidden = true;
  }
  updatePopover();
  positionPopover();
  scene?.update(state, selected);
}

picker.addEventListener('change', () => { if (isNode(picker.value)) selectNode(picker.value); });
button('inspect-a').addEventListener('click', () => activateNode('feeder-a'));
button('inspect-b').addEventListener('click', () => activateNode('feeder-b'));
button('connection-action').addEventListener('click', () => {
  if (isService(selected)) command({ type: live.services[selected].connected ? 'disconnect' : 'reconnect', target: selected });
});
for (const [index, crew] of CREW_IDS.entries()) button(`dispatch-${index + 1}`).addEventListener('click', () => { if (isFeeder(selected)) command({ type: 'dispatch', crew, target: selected }); });
function togglePlay(): void {
  sync();
  const running = !clock().running;
  clock().setRunning(running);
  if (running) decisionMessage = '';
  lastClockTime = performance.now();
  feedback(running ? `Time running: ${clock().speed} simulated seconds per real second.` : 'Time paused. Inspect and issue commands at this exact tick.');
  refresh();
}
button('play').addEventListener('click', togglePlay);
button('step').addEventListener('click', () => {
  if (clock().running || clock().pendingTicks) return;
  if (review) review = replay(live.commands, Math.min(live.tick, review.tick + 1), live.scenario);
  else {
    decisionMessage = '';
    const before = live;
    live = advance(live, live.tick + 1);
    decisionCheck(before, live);
  }
  refresh();
});
button('next-event').addEventListener('click', () => {
  if (review || liveClock.running || liveClock.pendingTicks) return;
  const transition = nextTransition(live);
  const warn = backupWarnTick(live);
  const tick = Math.min(transition ?? Number.POSITIVE_INFINITY, warn ?? Number.POSITIVE_INFINITY);
  if (!Number.isFinite(tick)) return;
  decisionMessage = '';
  const before = live;
  live = advance(live, tick);
  decisionCheck(before, live);
  feedback(`Advanced to ${wt(tick, live)} and stayed paused. ${live.events.at(-1)!.text}`);
  refresh();
});
speed.addEventListener('change', () => { const value = Number(speed.value); sync(); clock().setSpeed(value); refresh(); });
function startReplay(): void {
  sync();
  liveClock.setRunning(false);
  reviewClock.reset();
  review = replay(live.commands, 0, live.scenario);
  feedback('Read-only replay. Scrub or play the recording; return to live to continue your preserved run.');
  refresh();
  cursor.focus();
}
button('replay').addEventListener('click', startReplay);
function returnLive(): void {
  reviewClock.reset();
  review = null;
  lastClockTime = performance.now();
  feedback('Returned to the untouched live run. Time remains paused.');
  refresh();
  button('play').focus();
}
button('return-live').addEventListener('click', returnLive);
cursor.addEventListener('input', () => {
  if (!review) return;
  reviewClock.reset();
  review = replay(live.commands, Number(cursor.value), live.scenario);
  lastClockTime = performance.now();
  refresh();
});
button('toggle-inspector').addEventListener('click', () => {
  const body = element('inspector-body');
  body.hidden = !body.hidden;
  button('toggle-inspector').setAttribute('aria-expanded', String(!body.hidden));
  text('toggle-inspector', body.hidden ? 'Show inspector' : 'Hide inspector');
});
button('restart').addEventListener('click', () => {
  sync();
  clock().setRunning(false);
  refresh();
  pendingStorm = null;
  if (phase(live) === 'restored') {
    archiveRun();
    resetRun();
    feedback(`New ${SCENARIOS[current].subtitle} run. Time is paused.`);
    return;
  }
  text('restart-title', `Restart ${SCENARIOS[current].subtitle}?`);
  dialog.showModal();
});
button('cancel-restart').addEventListener('click', () => { pendingStorm = null; dialog.close(); });
button('confirm-restart').addEventListener('click', () => {
  archiveRun();
  dialog.close();
  if (pendingStorm) {
    const target = pendingStorm;
    pendingStorm = null;
    // A storm switch lands on that incident's briefing step.
    startStorm(target);
    return;
  }
  resetRun();
  feedback(`New ${SCENARIOS[current].subtitle} run. Time is paused.`);
});
button('resume').addEventListener('click', () => {
  if (phase(live) === 'restored' && !review) {
    decisionMessage = '';
    summaryDismissed = false;
    refresh();
    element('summary').querySelector<HTMLElement>('#summary-title')?.focus();
    return;
  }
  resumeLive();
});
button('popover-close').addEventListener('click', closePopover);
button('popover-details').addEventListener('click', () => {
  closePopover();
  if (element('inspector-body').hidden) button('toggle-inspector').click();
  element('inspector-title').focus();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (popoverNode) closePopover();
    return;
  }
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) return;
  if (document.querySelector('dialog[open]')) return;
  if (active?.closest('#node-actions')) return;
  if (event.key.startsWith('Arrow')) {
    if (!scene) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') scene.rotate(-Math.PI / 6);
    else if (event.key === 'ArrowRight') scene.rotate(Math.PI / 6);
    else if (event.key === 'ArrowUp') scene.tilt(-Math.PI / 18);
    else scene.tilt(Math.PI / 18);
    return;
  }
  if (event.key === '+' || event.key === '=') { scene?.zoom(.8); return; }
  if (event.key === '-' || event.key === '_') { scene?.zoom(1.25); return; }
  if (event.key === '0') { scene?.reset(); return; }
  if (event.key === ' ') {
    if (active && (active.tagName === 'BUTTON' || active.tagName === 'A')) return;
    event.preventDefault();
    togglePlay();
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'n') {
    if (!review && !liveClock.running && !liveClock.pendingTicks) button('next-event').click();
    return;
  }
  if (key === 'r') {
    if (review) returnLive();
    else if (!button('replay').disabled) startReplay();
    return;
  }
  if (key === 'm') {
    sound.setMuted(!sound.muted);
    syncSoundToggle();
    return;
  }
  if (/^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    const id = NODE_IDS[index];
    if (id) activateNode(id);
  }
});
const syncSoundToggle = (): void => {
  const muted = sound.muted;
  text('sound-toggle', muted ? 'Sound off' : 'Sound on');
  button('sound-toggle').setAttribute('aria-pressed', String(!muted));
};
button('sound-toggle').addEventListener('click', () => { sound.setMuted(!sound.muted); syncSoundToggle(); });
const briefing = element<HTMLDialogElement>('briefing');
let briefingIntent: 'begin' | 'skip' | null = null;
let pendingStorm: ScenarioId | null = null;
let briefed = false;
const runInProgress = (): boolean => live.tick > 0 || live.commands.length > 0;

// Picker cards are generated from SCENARIOS so card copy stays in scenario.ts.
for (const id of SCENARIO_IDS) {
  const config = SCENARIOS[id];
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'incident-card';
  card.dataset.storm = id;
  const name = document.createElement('strong');
  name.textContent = `${config.subtitle} · ${config.title}`;
  const line = document.createElement('span');
  line.textContent = config.pickerLine;
  card.append(name, line);
  card.addEventListener('click', () => chooseStorm(id));
  element('incident-cards').append(card);
}

function showPickerStep(): void {
  element('incident-picker').hidden = false;
  element('incident-briefing').hidden = true;
  briefing.setAttribute('aria-labelledby', 'briefing-title');
  for (const card of element('incident-cards').querySelectorAll<HTMLElement>('.incident-card')) {
    card.dataset.current = String(card.dataset.storm === current);
  }
}

function showBriefingStep(id: ScenarioId): void {
  const config = SCENARIOS[id];
  text('storm-title', `${config.subtitle} — ${config.title}`);
  element('briefing-beats').replaceChildren(...config.briefing.map(line => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));
  element('incident-picker').hidden = true;
  element('incident-briefing').hidden = false;
  briefing.setAttribute('aria-labelledby', 'storm-title');
  button('begin').focus();
}

function openPicker(): void {
  sync();
  clock().setRunning(false);
  refresh();
  showPickerStep();
  if (!briefing.open) briefing.showModal();
}

function startStorm(id: ScenarioId): void {
  current = id;
  resetRun();
  showBriefingStep(id);
  if (!briefing.open) briefing.showModal();
}

function chooseStorm(id: ScenarioId): void {
  if (phase(live) === 'restored') {
    archiveRun();
    startStorm(id);
    return;
  }
  if (runInProgress()) {
    pendingStorm = id;
    briefing.close(); // no intent — the close handler leaves the run alone
    text('restart-title', id === current ? `Restart ${SCENARIOS[id].subtitle}?` : `Switch to ${SCENARIOS[id].subtitle}?`);
    dialog.showModal();
    return;
  }
  startStorm(id);
}

button('incidents').addEventListener('click', openPicker);
button('picker-back').addEventListener('click', showPickerStep);
button('begin').addEventListener('click', () => { briefingIntent = 'begin'; briefing.close(); });
button('skip-briefing').addEventListener('click', () => { briefingIntent = 'skip'; briefing.close(); });
briefing.addEventListener('cancel', event => {
  if (!element('incident-picker').hidden) {
    // First visit: the picker must be answered — there is no run to fall back to.
    if (!briefed && !runInProgress()) event.preventDefault();
    return;
  }
  // Escape on the briefing step behaves like Skip: start without the cinematic.
  briefingIntent = 'skip';
});
briefing.addEventListener('close', () => {
  const intent = briefingIntent;
  briefingIntent = null;
  if (intent === null) return; // programmatic close (confirm flow or picker dismiss)
  briefed = true;
  sound.start();
  syncSoundToggle();
  if (intent === 'begin') scene?.begin(); else scene?.skip();
});
element('scene').addEventListener('pointerdown', event => {
  if (!popoverNode || !(event.target instanceof HTMLElement)) return;
  if (event.target.closest('#node-actions') || event.target.closest('.map-marker')) return;
  closePopover();
});
if (new URLSearchParams(location.search).get('skipBriefing') !== '1') {
  showPickerStep();
  briefing.showModal();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    sync();
    clock().setRunning(false);
    sound.suspend();
    feedback('Paused because the tab was hidden. No hidden time is simulated; resume when ready.');
    refresh();
  } else if (!sound.muted) {
    sound.resume();
  }
  lastClockTime = performance.now();
  lastFrameTime = 0;
});

function renderNotice(message: string): void {
  text('render-notice', message);
  element('render-notice').hidden = !message;
}
try {
  scene = new DistrictScene(element('scene-canvas'), element('scene-markers'), activateNode, renderNotice);
} catch {
  renderNotice('3D view unavailable. You can still play the full incident using the district selector, service status buttons and inspector. WebGL2 is required for the diorama.');
  for (const id of ['rotate-left', 'rotate-right', 'tilt-up', 'tilt-down', 'zoom-in', 'zoom-out', 'reset-camera']) button(id).disabled = true;
}
// Loopback-only debug handle for screenshot/verification tooling.
if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
  if (scene) (window as unknown as Record<string, unknown>).__scene = scene;
  (window as unknown as Record<string, unknown>).__audio = audioDebug;
}
if (scene) scene.onLightning = () => fireCue('thunder');
button('reset-camera').addEventListener('click', () => scene?.reset());
button('rotate-left').addEventListener('click', () => scene?.rotate(-Math.PI / 6));
button('rotate-right').addEventListener('click', () => scene?.rotate(Math.PI / 6));
button('tilt-up').addEventListener('click', () => scene?.tilt(-Math.PI / 18));
button('tilt-down').addEventListener('click', () => scene?.tilt(Math.PI / 18));
button('zoom-in').addEventListener('click', () => scene?.zoom(.8));
button('zoom-out').addEventListener('click', () => scene?.zoom(1.25));

function frame(now: number): void {
  if (!document.hidden) {
    sync(now);
    const elapsed = lastFrameTime ? now - lastFrameTime : 0;
    lastFrameTime = now;
    if (elapsed > 0) { frameSamples.push(elapsed); if (frameSamples.length > 600) frameSamples.shift(); }
    scene?.render(view(), clock().fraction, clock().speed, review !== null);
    const soundState = view();
    const fallback = 1 - connectedLoad(soundState) / 13;
    sound.update({ state: soundState, review: review !== null, rain: scene?.rainDensity ?? fallback, storm: scene?.stormLevel ?? fallback, now: now / 1000 });
    if (popoverNode) positionPopover();
    // Compass arrow tracks the camera azimuth (north = world -z points up at
    // the default view; rotating the camera spins the arrow the same amount).
    element('north-arrow').style.transform = `rotate(${scene?.azimuth ?? 0}rad)`;
    if (now - metricsTime > 1000 && frameSamples.length) {
      metricsTime = now;
      const samples = [...frameSamples].sort((a, b) => a - b);
      text('metrics', `Recent visible frames: p50 ${samples[Math.floor(samples.length * .5)]!.toFixed(1)} ms · p95 ${samples[Math.floor(samples.length * .95)]!.toFixed(1)} ms · max ${samples.at(-1)!.toFixed(1)} ms (${samples.length} samples). ${scene?.metrics() ?? 'HTML fallback; no WebGL renderer.'}`);
    }
  }
  frameHandle = requestAnimationFrame(frame);
}
refresh();
frameHandle = requestAnimationFrame(frame);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  cancelAnimationFrame(frameHandle);
  scene?.dispose();
}, { once: true });
