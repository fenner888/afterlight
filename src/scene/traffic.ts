import type { FeederId } from '../scenario.ts';

// Traffic awareness — pure route/yield logic, no three.js (Node-testable).
// Heading convention matches vehicles.ts: forward = (cos h, -sin h), so a route
// segment (dx,dz) has heading -atan2(dz, dx). Truck local +x is the nose.
export type Point = { x: number; z: number; reverse?: boolean };
export type Pose = Point & { heading: number };

// Real truck footprint from buildTruck: length 1.9, width .78 (stripe is the
// widest body part). The yield/parking footprint adds clearance margins.
export const TRUCK_LENGTH = 1.9;
export const TRUCK_WIDTH = .78;
export const FOOT_LENGTH = TRUCK_LENGTH + .5;
export const FOOT_WIDTH = TRUCK_WIDTH + .2;

// Depot bays: nose-out at the two garage doors (doors face +z at depot ±.72),
// rear at the door line, nose toward the quay apron. Depot sits at (-3.5, 4.6).
export const depotBay = (index: 0 | 1): Pose => ({ x: -3.5 + (index ? .72 : -.72), z: 6.85, heading: -Math.PI / 2 });

// Feeder park spots (moved from vehicles.ts — the feeder-A visibility fix
// depends on these): A on the west road at the yard's south junction, B on the
// link road east of its yard.
export const PARK: Record<FeederId, Point> = {
  'feeder-a': { x: -8, z: -1.4 },
  'feeder-b': { x: 7.1, z: -1.8 },
};

// Canonical parked pose per feeder (the depot-route arrival heading). Live
// play keeps the route-end pose instead — this is the replay/reset fallback.
export const parkPose = (feeder: FeederId): Pose =>
  ({ ...PARK[feeder], heading: feeder === 'feeder-a' ? Math.PI / 2 : Math.PI });

// Lane plan. The apron lane runs along the open quay apron south of the bays;
// z is chosen so a truck on it clears a parked bay truck's nose footprint
// (parked footprint ends z 8.05; lane footprint half-width .49) and stays on
// the deck (edge z 9.4). The apron run north to the access road keeps x -.9:
// the sidewalk pair at x [-2.1,-1.6] and [-.2,.3] leaves that strip open.
const APRON_Z = 8.65;
const ACCESS_X = -.9;   // apron approach between the kerb sidewalks
const LANE_W = -1.2;    // depot access road, west lane — Feeder A-bound
const LANE_E = -.6;     // depot access road, east lane — Feeder B-bound
const MAIN_N = 1.4;     // main road, north lane — westbound / A-bound
const MAIN_S = 2.2;     // main road, south lane — eastbound / B-bound
const LINK_W = -2.25;   // northern link, north lane — westbound / A-bound
const LINK_E = -1.95;   // northern link, south lane — eastbound / B-bound
const PA = PARK['feeder-a'];
const PB = PARK['feeder-b'];

// Lane-offset polylines. Every vertex sits on asphalt or the depot apron;
// parked bay trucks and kerb-parked cars are avoided by construction (the
// exhaustive Node test asserts their footprints never overlap).
export function routeFor(index: 0 | 1, origin: 'depot' | FeederId, target: FeederId): Point[] {
  if (origin === 'depot') {
    const bay = depotBay(index);
    const lane = target === 'feeder-a' ? LANE_W : LANE_E;
    const main = target === 'feeder-a' ? MAIN_N : MAIN_S;
    const trunk: Point[] = [
      { x: bay.x, z: bay.z },          // nose-out bay
      { x: bay.x, z: APRON_Z },        // forward onto the apron lane
      { x: ACCESS_X, z: APRON_Z },     // east along the apron
      { x: ACCESS_X, z: 6.4 },         // north, joining the access road
      { x: lane, z: 5.9 },             // settle into the destination lane
      { x: lane, z: main },            // up the access road to the junction
    ];
    return target === 'feeder-a'
      ? [...trunk, { x: -8, z: MAIN_N }, { x: PA.x, z: PA.z }]               // west lane, then north to the yard
      : [...trunk, { x: 8, z: MAIN_S }, { x: 8, z: PB.z }, { x: PB.x, z: PB.z }]; // east lane, then north and kerb-side
  }
  // Feeder -> feeder: the northern link road is the direct path; keep to the
  // destination lane so opposite-direction traffic stays separated.
  const link = target === 'feeder-a' ? LINK_W : LINK_E;
  const from = PARK[origin];
  const to = PARK[target];
  return [
    { x: from.x, z: from.z },
    { x: from.x, z: link },
    { x: to.x, z: link },
    { x: to.x, z: to.z },
  ];
}

// An away crew drives in over the last 30 ticks before its returnAt.
export const RETURN_DRIVE = 30;

// Return drive for a crew coming back from an outside job: enters on the main
// road's westbound lane at the east end, turns down the access road and along
// the apron, then backs straight into its nose-out bay. The final vertex's
// `reverse` flag keeps the nose facing south while the truck travels north.
export function returnRoute(index: 0 | 1): Point[] {
  const bay = depotBay(index);
  return [
    { x: 12.25, z: MAIN_N },
    { x: ACCESS_X, z: MAIN_N },
    { x: ACCESS_X, z: APRON_Z },
    { x: bay.x, z: APRON_Z },
    { x: bay.x, z: bay.z, reverse: true },
  ];
}

// The contested depot zone: the single-lane access road with its junction
// mouth, plus the apron pad. Bays sit just outside so a departure waiting for
// an inbound truck holds at the door instead of blocking the yard. Only the
// returning crew's drive reserves it — normal departures keep the corridor
// rules.
export function inDepotZone(p: Point): boolean {
  return (Math.abs(p.x - ACCESS_X) < 1.05 && p.z > 1.2 && p.z < 7.0)
    || (p.x > -6.3 && p.x < .9 && p.z > 7.1 && p.z < 9.55);
}

// The east junction is the other contested crossing: the returner's westbound
// lane crosses the Feeder-B route where it turns north onto the east road.
// Sized so a waiting truck holds a full body-length clear of the crossing.
export function inEastJunction(p: Point): boolean {
  return p.x > 7 && p.x < 9.8 && p.z > .9 && p.z < 2.9;
}

export function routeLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  return total;
}

// Position + segment heading at an along-route distance.
export function poseAt(points: Point[], distance: number): Pose {
  if (!points.length) return { x: 0, z: 0, heading: 0 };
  if (points.length === 1) return { ...points[0]!, heading: 0 };
  let remaining = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!, to = points[i]!;
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    // A `reverse` segment drives backward: the nose stays opposite the travel
    // direction (e.g. a truck stays nose-south while backing into its bay).
    let heading = length ? -Math.atan2(to.z - from.z, to.x - from.x) : 0;
    if (to.reverse) heading += heading > 0 ? -Math.PI : Math.PI;
    if (remaining <= length || i === points.length - 1) {
      const t = length ? Math.min(1, remaining / length) : 0;
      return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t, heading };
    }
    remaining -= length;
  }
  const last = points.at(-1)!;
  return { ...last, heading: 0 };
}

// SAT overlap of two oriented rectangles (length along the nose axis).
// `bLength`/`bWidth` allow a smaller obstacle (e.g. a parked car); default is
// symmetric — both rects use `length`/`width`.
export function footprintsOverlap(a: Pose, b: Pose, length: number, width: number, bLength = length, bWidth = width): boolean {
  const fa = { x: Math.cos(a.heading), z: -Math.sin(a.heading) };
  const sa = { x: Math.sin(a.heading), z: Math.cos(a.heading) };
  const fb = { x: Math.cos(b.heading), z: -Math.sin(b.heading) };
  const sb = { x: Math.sin(b.heading), z: Math.cos(b.heading) };
  for (const axis of [fa, sa, fb, sb]) {
    const ra = Math.abs(axis.x * fa.x + axis.z * fa.z) * length / 2 + Math.abs(axis.x * sa.x + axis.z * sa.z) * width / 2;
    const rb = Math.abs(axis.x * fb.x + axis.z * fb.z) * bLength / 2 + Math.abs(axis.x * sb.x + axis.z * sb.z) * bWidth / 2;
    const centre = Math.abs((b.x - a.x) * axis.x + (b.z - a.z) * axis.z);
    if (centre > ra + rb) return false;
  }
  return true;
}

export type TruckInput = {
  route: Point[] | null;        // null = parked (at a bay or feeder kerb)
  scheduleDistance: number;     // where the domain clock says the truck is
  nominalSpeed: number;         // world units per real second at current pace
  priority: number;             // lower wins: departedAt * 2 + crew index
  snap: boolean;                // replay / reduced motion / time jumps
  parked: Pose | null;          // pose to hold while route is null
  returning?: boolean;          // inbound depot return drive (reserves the zone)
};

// How far ahead (seconds of projected motion on both routes) a truck checks
// before advancing — long enough that a head-on conflict on the parallel main
// road lanes is seen before either enters it. The yield check uses a slightly
// fatter footprint than the asserted one so a held truck keeps real clearance.
const LOOKAHEAD = 1.4;
const SAMPLES = 6;
const YIELD_LENGTH = FOOT_LENGTH + .6;
const YIELD_WIDTH = FOOT_WIDTH + .2;
const EPS = 1e-6;

// Shown distance trails the schedule: it chases at up to 1.6x nominal speed
// and holds whenever proceeding would put this truck's footprint over a
// higher-priority moving truck's projected footprint. Parked trucks are never
// yield targets — authored routes clear them by design.
export class Traffic {
  private shown: number[] = [];
  private lens: number[] = [];
  private lastSchedule: number[] = [];
  private lastRoute: (Point[] | null)[] = [];
  private poses: Pose[] = [];

  step(trucks: TruckInput[], dt: number): Pose[] {
    const lens = trucks.map(t => (t.route ? routeLength(t.route) : 0));
    // Higher priority (earlier departure) steps first so followers react to
    // the leader's new position within the same frame.
    const order = trucks.map((_, i) => i).sort((a, b) => trucks[a]!.priority - trucks[b]!.priority);
    for (const i of order) {
      const input = trucks[i]!;
      const len = lens[i]!;
      this.lens[i] = len;
      if (!input.route) {
        this.shown[i] = 0;
        this.lastRoute[i] = null;
        this.lastSchedule[i] = input.scheduleDistance;
        this.poses[i] = input.parked ?? this.poses[i] ?? { x: 0, z: 0, heading: 0 };
        continue;
      }
      const lastSchedule = this.lastSchedule[i] ?? input.scheduleDistance;
      const jump = input.scheduleDistance - lastSchedule;
      let shown = this.shown[i] ?? 0;
      if (input.snap || this.lastRoute[i] !== input.route || jump < -EPS || jump > .25 * len) {
        shown = input.scheduleDistance;
      } else {
        let next = Math.min(shown + 1.6 * input.nominalSpeed * dt, input.scheduleDistance, len);
        if (next > shown + EPS && this.conflicts(trucks, lens, i, next, this.poseOf(i))) next = shown;
        shown = next;
      }
      this.shown[i] = shown;
      this.lastRoute[i] = input.route;
      this.lastSchedule[i] = input.scheduleDistance;
      this.poses[i] = poseAt(input.route, shown);
    }
    return this.poses.slice();
  }

  // True while the truck is still working along its route (en route or doing
  // the post-arrival catch-up drive); false once parked at the route end.
  moving(index: number): boolean {
    return this.lastRoute[index] !== null && this.lastRoute[index] !== undefined && this.shown[index]! < this.lens[index]! - EPS;
  }

  parked(index: number): boolean {
    return !this.moving(index);
  }

  // Would advancing truck i to `next` put its footprint over a higher-priority
  // moving truck's path? Checks the immediate next pose plus projected poses
  // through the lookahead window on both routes.
  private conflicts(trucks: TruckInput[], lens: number[], i: number, next: number, from: Pose): boolean {
    const me = trucks[i]!;
    const candidate = poseAt(me.route!, next);
    const candidateInZone = inDepotZone(candidate);
    // Universal don't-ram: never advance into another truck's current body,
    // whatever the priority. Real body dims — lane passing stays legal.
    for (let j = 0; j < trucks.length; j++) {
      if (j !== i && footprintsOverlap(candidate, this.poseOf(j), TRUCK_LENGTH, TRUCK_WIDTH)) return true;
    }
    // Shared crossings are first-come: whoever is inside proceeds, a new
    // entrant waits outside — an occupant can always drive out, so no
    // deadlock.
    if (inEastJunction(candidate)) {
      for (let j = 0; j < trucks.length; j++) {
        if (j !== i && inEastJunction(this.poseOf(j))) return true;
      }
    }
    // Depot-zone rules sit above priority: an active return drive reserves the
    // single-lane yard, so a new departure waits at its bay; a truck already
    // inside is grandfathered and clears. The inbound truck waits outside the
    // mouth until whoever is inside has left — a departure cannot reverse out
    // of its way, and the zone is too tight for corridor margins to arbitrate.
    if (me.returning) {
      if (candidateInZone) {
        for (let j = 0; j < trucks.length; j++) {
          if (j !== i && inDepotZone(this.poseOf(j))) return true;
        }
      }
      // A returner yields by centreline distance, not footprint: the two main-
      // road lanes are only .8 apart — narrower than the yield margin — so an
      // eastbound truck may legally pass abreast while the returner keeps a
      // real-body clearance. It still holds for a leader on its own line.
      for (let j = 0; j < trucks.length; j++) {
        if (j === i) continue;
        const other = trucks[j]!;
        if (other.priority >= me.priority) continue;
        if (!other.route || this.shown[j]! >= lens[j]! - EPS) continue;
        for (let d = 0; d <= lens[j]! - this.shown[j]!; d += .25) {
          const pj = poseAt(other.route, this.shown[j]! + d);
          if (Math.hypot(candidate.x - pj.x, candidate.z - pj.z) < .55) return true;
        }
      }
      return false;
    }
    if (candidateInZone) {
      if (!inDepotZone(from)) {
        for (let j = 0; j < trucks.length; j++) {
          const other = trucks[j]!;
          if (j !== i && other.returning && other.route && this.shown[j]! < lens[j]! - EPS) return true;
        }
      }
      // Inside the yard the corridor check is suspended, so keep a direct
      // footprint gap to whatever is in front — convoying is fine, touching
      // is not.
      for (let j = 0; j < trucks.length; j++) {
        if (j !== i && footprintsOverlap(candidate, this.poseOf(j), FOOT_LENGTH, FOOT_WIDTH)) return true;
      }
    }
    for (let j = 0; j < trucks.length; j++) {
      if (j === i) continue;
      const other = trucks[j]!;
      if (other.priority >= me.priority) continue;
      if (!other.route || this.shown[j]! >= lens[j]! - EPS) continue; // only moving trucks
      const vi = 1.6 * me.nominalSpeed;
      const vj = 1.6 * other.nominalSpeed;
      // My candidate vs the other truck's entire remaining corridor — I may
      // only occupy poses its path will never cover, so a held truck can never
      // be overrun from behind. My footprint carries the yield margin. Inside
      // the depot zone the zone rules above decide instead — corridor margins
      // are wider than the yard is and would deadlock a queued departure.
      if (!candidateInZone) {
        for (let d = 0; d <= lens[j]! - this.shown[j]!; d += .25) {
          const pj = poseAt(other.route, this.shown[j]! + d);
          if (footprintsOverlap(candidate, pj, YIELD_LENGTH, YIELD_WIDTH, FOOT_LENGTH, FOOT_WIDTH)) return true;
        }
        // Both projected forward through the lookahead window — keeps a
        // following truck off the leader's tail in a shared corridor.
        for (let s = 0; s <= SAMPLES; s++) {
          const t = LOOKAHEAD * s / SAMPLES;
          const pi = poseAt(me.route!, Math.min(next + vi * t, lens[i]!));
          const pj = poseAt(other.route, Math.min(this.shown[j]! + vj * t, lens[j]!));
          if (footprintsOverlap(pi, pj, YIELD_LENGTH, YIELD_WIDTH)) return true;
        }
      }
    }
    return false;
  }

  private poseOf(index: number): Pose {
    return this.poses[index] ?? { x: 0, z: 0, heading: 0 };
  }
}
