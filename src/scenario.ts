export const SERVICE_IDS = ['clinic', 'housing-a', 'housing-b', 'pump', 'beacon'] as const;
export const FEEDER_IDS = ['feeder-a', 'feeder-b'] as const;
export const CREW_IDS = ['crew-1', 'crew-2'] as const;
export type ServiceId = typeof SERVICE_IDS[number];
export type FeederId = typeof FEEDER_IDS[number];
export type CrewId = typeof CREW_IDS[number];
export type NodeId = ServiceId | FeederId | 'supply' | 'depot';
export const NODE_IDS: readonly NodeId[] = ['clinic', 'housing-a', 'housing-b', 'pump', 'beacon', 'feeder-a', 'feeder-b', 'supply', 'depot'];

export const SERVICES: Record<ServiceId, { label: string; load: number; backup: number; description: string }> = {
  clinic: { label: 'Clinic', load: 4, backup: 360, description: 'Six minutes of reserve. Grid power preserves what remains; it never recharges the backup.' },
  'housing-a': { label: 'Housing A', load: 3, backup: 0, description: 'The west residential block. Its full 3 CU load must fit before the windows can return.' },
  'housing-b': { label: 'Housing B', load: 3, backup: 0, description: 'The east residential block. Both housing groups fit on Feeder A, but not alongside the clinic.' },
  pump: { label: 'Pumping station', load: 2, backup: 0, description: 'A 2 CU service. The pump has no backup and is not a dependency of any other service.' },
  beacon: { label: 'Harbor beacon', load: 1, backup: 0, description: 'The harbor light needs 1 CU. Repairing a feeder alone does not turn the beacon on.' },
};
export const FEEDERS: Record<FeederId, { label: string; capacity: number; repairTicks: number }> = {
  'feeder-a': { label: 'Feeder A', capacity: 6, repairTicks: 180 },
  'feeder-b': { label: 'Feeder B', capacity: 7, repairTicks: 420 },
};
export const LABELS: Record<NodeId | CrewId, string> = {
  ...Object.fromEntries(SERVICE_IDS.map(id => [id, SERVICES[id].label])) as Record<ServiceId, string>,
  'feeder-a': 'Feeder A', 'feeder-b': 'Feeder B', supply: 'Upstream supply', depot: 'Crew depot',
  'crew-1': 'Crew 1', 'crew-2': 'Crew 2',
};
export const SCENARIO = { id: 'storm-01', version: 1, seed: 1, upstreamCapacity: 13, depotTravel: 60, crossTravel: 120 } as const;
export const isService = (id: string): id is ServiceId => SERVICE_IDS.some(value => value === id);
export const isFeeder = (id: string): id is FeederId => FEEDER_IDS.some(value => value === id);
export const isCrew = (id: string): id is CrewId => CREW_IDS.some(value => value === id);
export const isNode = (id: string): id is NodeId => NODE_IDS.some(value => value === id);
export const formatTime = (ticks: number): string => `${Math.floor(ticks / 60).toString().padStart(2, '0')}:${Math.floor(ticks % 60).toString().padStart(2, '0')}`;

export type DayPhase = 'dusk' | 'night' | 'dawn' | 'day';
export const DAY_PHASES: readonly DayPhase[] = ['dusk', 'night', 'dawn', 'day'];
export const WORLD_START_MINUTES = 19 * 60 + 30;
export const worldMinutes = (tick: number): number => WORLD_START_MINUTES + tick;
export const formatWorldTime = (tick: number): string => {
  const minutes = ((worldMinutes(tick) % 1440) + 1440) % 1440;
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${Math.floor(minutes % 60).toString().padStart(2, '0')}`;
};
export const dayPhase = (tick: number): DayPhase => {
  const minutes = ((worldMinutes(tick) % 1440) + 1440) % 1440;
  if (minutes >= 20 * 60 + 30 || minutes < 5 * 60) return 'night';
  if (minutes < 6 * 60 + 30) return 'dawn';
  if (minutes < 19 * 60 + 30) return 'day';
  return 'dusk';
};

export function validateScenario(): void {
  const loads = SERVICE_IDS.map(id => SERVICES[id].load);
  const capacities = FEEDER_IDS.map(id => FEEDERS[id].capacity);
  if (loads.some(n => !Number.isSafeInteger(n) || n <= 0) || capacities.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error('Invalid scenario quantities.');
  if (loads.reduce((a, b) => a + b, 0) !== SCENARIO.upstreamCapacity || capacities.reduce((a, b) => a + b, 0) !== SCENARIO.upstreamCapacity) throw new Error('Scenario load and capacity must balance.');
  if (FEEDER_IDS.some(id => !Number.isSafeInteger(FEEDERS[id].repairTicks) || FEEDERS[id].repairTicks <= 0)) throw new Error('Invalid repair duration.');
}
