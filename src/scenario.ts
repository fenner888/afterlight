export const SERVICE_IDS = ['clinic', 'housing-a', 'housing-b', 'pump', 'beacon'] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export const FEEDER_IDS = ['feeder-a', 'feeder-b'] as const;
export type FeederId = (typeof FEEDER_IDS)[number];

export const CREW_IDS = ['crew-1', 'crew-2'] as const;
export type CrewId = (typeof CREW_IDS)[number];

export const NODE_IDS = ['clinic', 'housing-a', 'housing-b', 'pump', 'beacon', 'feeder-a', 'feeder-b', 'supply', 'depot'] as const;
export type NodeId = (typeof NODE_IDS)[number];

export const SCENARIO_IDS = ['storm-01', 'storm-02', 'storm-03'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const isService = (id: string): id is ServiceId => SERVICE_IDS.some(service => service === id);
export const isFeeder = (id: string): id is FeederId => FEEDER_IDS.some(feeder => feeder === id);
export const isCrew = (id: string): id is CrewId => CREW_IDS.some(crew => crew === id);
export const isNode = (id: string): id is NodeId => NODE_IDS.some(node => node === id);
export const isScenarioId = (id: string): id is ScenarioId => SCENARIO_IDS.some(scenario => scenario === id);

// Shared across every storm: one 13-CU trunk, five services, identical travel times.
export const upstreamCapacity = 13;
export const depotTravel = 60;
export const crossTravel = 120;

export const SERVICES: Record<ServiceId, { label: string; load: number; flavor: string; description?: string }> = {
  clinic: {
    label: 'Clinic', load: 4,
    flavor: 'Overnight ward — the district\u2019s only generator.',
    // Description is computed per scenario: reserve hours differ by storm.
  },
  'housing-a': {
    label: 'Housing A', load: 3,
    flavor: 'The west apartment block.',
    description: 'Its full 3 CU load must fit before the windows can return.',
  },
  'housing-b': {
    label: 'Housing B', load: 3,
    flavor: 'The east apartment block above the harbor shops.',
    description: 'Housing A and B together need 6 CU.',
  },
  pump: {
    label: 'Pumping station', load: 2,
    flavor: 'Water pressure for the hill streets.',
    description: 'A 2 CU service with no backup; it is not a dependency of any other service.',
  },
  beacon: {
    label: 'Harbor beacon', load: 1,
    flavor: 'Guides the fishing boats home.',
    description: 'The harbor light needs 1 CU. Repairing a feeder alone does not turn the beacon on.',
  },
};

export const LABELS: Record<NodeId | CrewId, string> = {
  ...Object.fromEntries(SERVICE_IDS.map(id => [id, SERVICES[id].label])) as Record<ServiceId, string>,
  'feeder-a': 'Feeder A',
  'feeder-b': 'Feeder B',
  supply: 'Upstream supply',
  depot: 'Crew depot',
  'crew-1': 'Crew 1',
  'crew-2': 'Crew 2',
};

export type ScenarioConfig = {
  id: ScenarioId;
  version: number;
  seed: number;
  number: 1 | 2 | 3;
  /** Storm label, e.g. 'Storm 01' — used in picker cards, briefing and summary. */
  subtitle: string;
  /** Incident name, e.g. 'Crew Short' — shown next to INCIDENT 0N in the header. */
  title: string;
  pickerLine: string;
  briefing: readonly string[];
  incidentText: string;
  /** World-clock minutes at tick 0 (0–1439). */
  worldStart: number;
  backup: Record<ServiceId, number>;
  feeders: Record<FeederId, { capacity: number; repairTicks: number }>;
  /** Ticks until each crew becomes available (0 = waiting at the depot). */
  returnAt: Record<CrewId, number>;
};

export const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  'storm-01': {
    id: 'storm-01',
    version: 1,
    seed: 1,
    number: 1,
    subtitle: 'Storm 01',
    title: 'After the storm',
    pickerLine: 'Dusk. Not enough early power for everyone.',
    briefing: [
      '19:30. A storm has knocked out both feeders into the harbor district. Every building is dark.',
      'The clinic is on its generator — 6 hours of fuel, until about 01:30. Nothing else has backup.',
      'Two crews wait at the depot. Feeder A is the quick fix (3h, 6 of the 13 units the district needs). Feeder B is slow (7h, the other 7).',
      'When power returns there won\u2019t be enough for everyone. You decide who gets it first.',
    ],
    incidentText: 'Storm 01: both feeders faulted. Clinic operating on backup.',
    worldStart: 19 * 60 + 30,
    backup: { clinic: 360, 'housing-a': 0, 'housing-b': 0, pump: 0, beacon: 0 },
    feeders: { 'feeder-a': { capacity: 6, repairTicks: 180 }, 'feeder-b': { capacity: 7, repairTicks: 420 } },
    returnAt: { 'crew-1': 0, 'crew-2': 0 },
  },
  'storm-02': {
    id: 'storm-02',
    version: 1,
    seed: 1,
    number: 2,
    subtitle: 'Storm 02',
    title: 'Crew Short',
    pickerLine: 'Afternoon. One crew now, the other later.',
    briefing: [
      '16:30. A squall line has knocked out both feeders. The district is dark in broad daylight.',
      'Crew 2 is still out on a job across town — back at the depot around 18:30. Crew 1 is ready now.',
      'Feeder A is the quick fix (3h, 6 of 13 units). Feeder B is slow (7h, the other 7). The clinic generator lasts until about 22:30.',
      'Where do you send your only crew?',
    ],
    incidentText: 'Storm 02: both feeders faulted. Crew 2 away until 18:30. Clinic operating on backup.',
    worldStart: 16 * 60 + 30,
    backup: { clinic: 360, 'housing-a': 0, 'housing-b': 0, pump: 0, beacon: 0 },
    feeders: { 'feeder-a': { capacity: 6, repairTicks: 180 }, 'feeder-b': { capacity: 7, repairTicks: 420 } },
    returnAt: { 'crew-1': 0, 'crew-2': 120 },
  },
  'storm-03': {
    id: 'storm-03',
    version: 1,
    seed: 1,
    number: 3,
    subtitle: 'Storm 03',
    title: 'The Long Dark',
    pickerLine: 'Near midnight. Four units, a failing generator, and a swap to time.',
    briefing: [
      '23:00. A late storm has taken both feeders. It\u2019s a long way to sunrise.',
      'The clinic generator has 5 hours of fuel — until about 04:00. Nothing else has backup.',
      'Feeder A is quick (2h) but carries only 4 units — exactly the clinic\u2019s load. Feeder B is slow (6h, the other 9).',
      'You can disconnect one building to power another at any time.',
    ],
    incidentText: 'Storm 03: both feeders faulted. Clinic operating on backup.',
    worldStart: 23 * 60,
    backup: { clinic: 300, 'housing-a': 0, 'housing-b': 0, pump: 0, beacon: 0 },
    feeders: { 'feeder-a': { capacity: 4, repairTicks: 120 }, 'feeder-b': { capacity: 9, repairTicks: 360 } },
    returnAt: { 'crew-1': 0, 'crew-2': 0 },
  },
};

export const formatTime = (tick: number): string =>
  `${Math.floor(tick / 60).toString().padStart(2, '0')}:${Math.floor(tick % 60).toString().padStart(2, '0')}`;

export const formatDuration = (tick: number): string =>
  `${Math.floor(Math.max(0, tick) / 60)}h ${Math.floor(Math.max(0, tick) % 60).toString().padStart(2, '0')}m`;

/** World-clock minutes at `tick`, given the scenario's tick-0 clock in minutes. */
export const worldMinutes = (tick: number, start: number): number => start + tick;

export const formatWorldTime = (tick: number, start: number): string => {
  const minutes = ((worldMinutes(tick, start) % 1440) + 1440) % 1440;
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${Math.floor(minutes % 60).toString().padStart(2, '0')}`;
};

export type DayPhase = 'day' | 'dusk' | 'night' | 'dawn';

export const dayPhase = (tick: number, start: number): DayPhase => {
  const minutes = ((worldMinutes(tick, start) % 1440) + 1440) % 1440;
  if (minutes >= 20 * 60 + 30 || minutes < 5 * 60) return 'night';
  if (minutes < 6 * 60 + 30) return 'dawn';
  if (minutes < 19 * 60 + 30) return 'day';
  return 'dusk';
};

/** Ticks from the scenario start until the 06:30 sunrise. */
export const sunriseTick = (config: ScenarioConfig): number =>
  ((6 * 60 + 30 - config.worldStart) % 1440 + 1440) % 1440;

export function validateScenario(config: ScenarioConfig): void {
  const loads = SERVICE_IDS.map(id => SERVICES[id].load);
  const capacities = FEEDER_IDS.map(id => config.feeders[id].capacity);
  const quantities = [...loads, ...capacities];
  if (quantities.some(n => !Number.isSafeInteger(n) || n <= 0)) {
    throw new Error('Service loads and feeder capacities must be positive integers.');
  }
  if (loads.reduce((a, b) => a + b, 0) !== upstreamCapacity) {
    throw new Error(`Service loads must total ${upstreamCapacity} CU.`);
  }
  if (capacities.reduce((a, b) => a + b, 0) !== upstreamCapacity) {
    throw new Error(`Feeder capacities must total ${upstreamCapacity} CU.`);
  }
  if (FEEDER_IDS.some(id => !Number.isSafeInteger(config.feeders[id].repairTicks) || config.feeders[id].repairTicks <= 0)) {
    throw new Error('Repair durations must be positive integers.');
  }
  if (SERVICE_IDS.some(id => !Number.isSafeInteger(config.backup[id]) || config.backup[id] < 0)) {
    throw new Error('Backup durations must be non-negative integers.');
  }
  if (CREW_IDS.some(id => !Number.isSafeInteger(config.returnAt[id]) || config.returnAt[id] < 0)) {
    throw new Error('Crew return ticks must be non-negative integers.');
  }
  if (!Number.isSafeInteger(config.worldStart) || config.worldStart < 0 || config.worldStart > 1439) {
    throw new Error('World start must be a minute of day (0–1439).');
  }
}

for (const id of SCENARIO_IDS) validateScenario(SCENARIOS[id]);
