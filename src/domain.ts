import { CREW_IDS, FEEDER_IDS, SERVICE_IDS, SERVICES, SCENARIOS, LABELS, upstreamCapacity, depotTravel, crossTravel, isService, isCrew, isFeeder, validateScenario, formatWorldTime } from './scenario.ts';
import type { CrewId, FeederId, ServiceId, NodeId, ScenarioId, ScenarioConfig } from './scenario.ts';

export type Action = { type: 'dispatch'; crew: CrewId; target: FeederId } | { type: 'reconnect' | 'disconnect'; target: ServiceId };
export type Command = Action & { tick: number; sequence: number };
export type EventKind = 'incident' | 'dispatched' | 'arrived' | 'repaired' | 'reconnected' | 'disconnected' | 'backup-expired' | 'returned';
export type DomainEvent = { id: number; tick: number; kind: EventKind; node: NodeId; text: string };
export type ServiceState = { connected: boolean; backupRemaining: number; backupUsed: number; downtime: number };
export type CrewState = { phase: 'idle' | 'traveling' | 'repairing' | 'away'; location: 'depot' | FeederId; origin: 'depot' | FeederId; target: FeederId | null; departedAt: number; arriveAt: number; completeAt: number; returnAt: number };
export type State = {
  scenario: ScenarioId; version: number; seed: number; tick: number;
  services: Record<ServiceId, ServiceState>;
  feeders: Record<FeederId, 'faulted' | 'reserved' | 'repairing' | 'repaired'>;
  crews: Record<CrewId, CrewState>;
  commands: Command[];
  events: DomainEvent[];
};
export type Result = { ok: boolean; state: State; message: string };

const configOf = (state: State): ScenarioConfig => SCENARIOS[state.scenario];

export function initialState(id: ScenarioId = 'storm-01'): State {
  const config = SCENARIOS[id];
  validateScenario(config);
  return {
    scenario: id, version: config.version, seed: config.seed, tick: 0,
    services: Object.fromEntries(SERVICE_IDS.map(service => [service, { connected: false, backupRemaining: config.backup[service], backupUsed: 0, downtime: 0 }])) as State['services'],
    feeders: { 'feeder-a': 'faulted', 'feeder-b': 'faulted' },
    crews: Object.fromEntries(CREW_IDS.map(crew => [crew, {
      phase: config.returnAt[crew] > 0 ? 'away' : 'idle',
      location: 'depot', origin: 'depot', target: null,
      departedAt: 0, arriveAt: 0, completeAt: 0, returnAt: config.returnAt[crew],
    }])) as State['crews'],
    commands: [],
    events: [{ id: 0, tick: 0, kind: 'incident', node: 'supply', text: config.incidentText }],
  };
}

export const capacity = (state: State): number => Math.min(upstreamCapacity, FEEDER_IDS.reduce((sum, id) => sum + (state.feeders[id] === 'repaired' ? configOf(state).feeders[id].capacity : 0), 0));
export const connectedLoad = (state: State): number => SERVICE_IDS.reduce((sum, id) => sum + (state.services[id].connected ? SERVICES[id].load : 0), 0);
export const serviceStatus = (state: State, id: ServiceId): 'grid' | 'backup' | 'offline' => state.services[id].connected ? 'grid' : state.services[id].backupRemaining > 0 ? 'backup' : 'offline';
export type Phase = 'dispatch' | 'restore' | 'restored';
export const phase = (state: State): Phase =>
  SERVICE_IDS.every(id => state.services[id].connected) ? 'restored'
    : capacity(state) === 0 && CREW_IDS.some(id => state.crews[id].phase === 'idle') && FEEDER_IDS.some(id => state.feeders[id] === 'faulted') ? 'dispatch'
    : 'restore';

function record(state: State, kind: EventKind, node: NodeId, text: string): void {
  state.events.push({ id: state.events.length, tick: state.tick, kind, node, text });
}

function parseCommand(raw: unknown): Command | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const keys = input.type === 'dispatch' ? ['type', 'crew', 'target', 'tick', 'sequence'] : ['type', 'target', 'tick', 'sequence'];
  if (Object.keys(input).length !== keys.length || !keys.every(key => Object.hasOwn(input, key))) return null;
  if (!Number.isSafeInteger(input.tick) || !Number.isSafeInteger(input.sequence) || (input.tick as number) < 0 || (input.sequence as number) < 0 || typeof input.target !== 'string') return null;
  if (input.type === 'dispatch' && typeof input.crew === 'string' && isCrew(input.crew) && isFeeder(input.target)) return input as Command;
  if ((input.type === 'reconnect' || input.type === 'disconnect') && isService(input.target)) return input as Command;
  return null;
}

export function execute(state: State, raw: unknown): Result {
  const config = configOf(state);
  const command = parseCommand(raw);
  const reject = (message: string): Result => ({ ok: false, state, message });
  if (!command) return reject('Invalid command. Check the action, target and finite integer timing.');
  if (command.tick !== state.tick || command.sequence !== state.commands.length) return reject('Stale command. Inspect the current tick and try again.');
  if (command.type === 'dispatch') {
    const crew = state.crews[command.crew];
    if (crew.phase === 'away') return reject(`${LABELS[command.crew]} is still on another job — back at ${formatWorldTime(crew.returnAt, config.worldStart)}.`);
    if (crew.phase !== 'idle') return reject(`${LABELS[command.crew]} is busy. Repairs cannot be cancelled or reassigned.`);
    if (state.feeders[command.target] !== 'faulted') return reject(`${LABELS[command.target]} is already assigned or repaired.`);
  } else {
    const service = state.services[command.target];
    if (command.type === 'disconnect' && !service.connected) return reject(`${LABELS[command.target]} is already disconnected.`);
    if (command.type === 'reconnect') {
      if (service.connected) return reject(`${LABELS[command.target]} is already connected.`);
      const headroom = capacity(state) - connectedLoad(state);
      if (SERVICES[command.target].load > headroom) return reject(`${LABELS[command.target]} needs ${SERVICES[command.target].load} CU; ${headroom} CU headroom available. ${capacity(state) === 0 ? 'Repair a feeder first.' : 'Disconnect a load or repair the other feeder.'}`);
    }
  }
  const next = structuredClone(state);
  next.commands.push({ ...command });
  if (command.type === 'dispatch') {
    const crew = next.crews[command.crew];
    crew.origin = crew.location;
    crew.target = command.target;
    crew.phase = 'traveling';
    crew.departedAt = state.tick;
    crew.arriveAt = state.tick + (crew.location === 'depot' ? depotTravel : crossTravel);
    crew.completeAt = crew.arriveAt + config.feeders[command.target].repairTicks;
    next.feeders[command.target] = 'reserved';
    record(next, 'dispatched', command.target, `${LABELS[command.crew]} dispatched to ${LABELS[command.target]}.`);
  } else {
    const connected = command.type === 'reconnect';
    next.services[command.target].connected = connected;
    record(next, connected ? 'reconnected' : 'disconnected', command.target, `${LABELS[command.target]} ${connected ? 'reconnected' : 'disconnected'} · ${SERVICES[command.target].load} CU ${connected ? 'allocated' : 'released'}.`);
  }
  return { ok: true, state: next, message: next.events.at(-1)!.text };
}

export function nextTransition(state: State): number | null {
  const ticks: number[] = [];
  for (const id of CREW_IDS) {
    const crew = state.crews[id];
    if (crew.phase === 'away') ticks.push(crew.returnAt);
    if (crew.phase === 'traveling') ticks.push(crew.arriveAt);
    if (crew.phase === 'repairing') ticks.push(crew.completeAt);
  }
  for (const id of SERVICE_IDS) {
    const service = state.services[id];
    if (!service.connected && service.backupRemaining > 0) ticks.push(state.tick + service.backupRemaining);
  }
  return ticks.length ? Math.min(...ticks) : null;
}

export function advance(state: State, targetTick: number): State {
  if (!Number.isSafeInteger(targetTick) || targetTick < state.tick) throw new Error('Advance requires a finite integer tick at or after the current tick.');
  if (targetTick === state.tick) return state;
  const next = structuredClone(state);
  const config = configOf(next);
  while (next.tick < targetTick) {
    const boundary = Math.min(targetTick, nextTransition(next) ?? targetTick);
    const elapsed = boundary - next.tick;
    const due: { key: string; run: () => void }[] = [];
    for (const id of SERVICE_IDS) {
      const service = next.services[id];
      if (service.connected) continue;
      if (service.backupRemaining > 0) {
        service.backupRemaining -= elapsed;
        service.backupUsed += elapsed;
        if (service.backupRemaining === 0) due.push({ key: id, run: () => record(next, 'backup-expired', id, `${LABELS[id]} backup exhausted. Service is offline.`) });
      } else service.downtime += elapsed;
    }
    next.tick = boundary;
    for (const id of CREW_IDS) {
      const crew = next.crews[id];
      if (crew.phase === 'away' && crew.returnAt === boundary) due.push({ key: id, run: () => {
        crew.phase = 'idle';
        crew.returnAt = 0;
        record(next, 'returned', 'depot', `${LABELS[id]} is back at the depot.`);
      } });
      const target = crew.target;
      if (target === null) continue;
      if (crew.phase === 'traveling' && crew.arriveAt === boundary) due.push({ key: `${target}/${id}`, run: () => {
        crew.phase = 'repairing';
        crew.location = target;
        next.feeders[target] = 'repairing';
        record(next, 'arrived', target, `${LABELS[id]} arrived at ${LABELS[target]}. Repair started.`);
      } });
      if (crew.phase === 'repairing' && crew.completeAt === boundary) due.push({ key: `${target}/${id}`, run: () => {
        crew.phase = 'idle';
        crew.target = null;
        next.feeders[target] = 'repaired';
        record(next, 'repaired', target, `${LABELS[target]} repaired · +${config.feeders[target].capacity} CU. Services remain disconnected until you reconnect them.`);
      } });
    }
    due.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).forEach(item => item.run());
  }
  return next;
}

export function stateHash(state: State): string {
  const text = JSON.stringify(state);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
