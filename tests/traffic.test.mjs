import test from 'node:test';
import assert from 'node:assert/strict';
import {
  depotBay, parkPose, routeFor, routeLength, poseAt, returnRoute,
  footprintsOverlap, Traffic, FOOT_LENGTH, FOOT_WIDTH, TRUCK_LENGTH, TRUCK_WIDTH,
  RETURN_DRIVE,
} from '../src/scene/traffic.ts';

const TICK_RATE = 10;             // sim ticks per real second at Normal speed
const DEPOT_TRIP = 60, CROSS_TRIP = 120;
const DT = 1 / 60;

// Asphalt rectangles mirrored from buildings.ts; the last entry is the depot
// apron drive between the quay link and the seawall edge.
const ROADS = [
  { x0: -12.25, x1: 12.25, z0: .975, z1: 2.625 },  // main east-west
  { x0: -8.75, x1: -7.25, z0: -8, z1: 8 },         // west north-south
  { x0: 7.25, x1: 8.75, z0: -8, z1: 8 },           // east north-south
  { x0: -8, x1: 8, z0: -2.675, z1: -1.525 },       // northern link
  { x0: -1.6, x1: -.2, z0: 1.8, z1: 6.4 },         // depot access
  { x0: -5.8, x1: -.2, z0: 5.6, z1: 7 },           // south quay link
  { x0: -6, x1: .6, z0: 7, z1: 9.4 },              // depot apron (paved)
];
const onRoad = (p) => ROADS.some((r) => p.x >= r.x0 - .01 && p.x <= r.x1 + .01 && p.z >= r.z0 - .01 && p.z <= r.z1 + .01);

// The six parked civilian cars in vehicles.ts — footprint = body + margins
// (length + .5, width + .2, matching the truck rule).
const CARS = [
  { x: -10.7, z: 1.32, heading: 0, l: 1.52, w: .68 },
  { x: -10.7, z: 2.28, heading: Math.PI, l: 1.7, w: .7 },
  { x: -8.48, z: -6.6, heading: Math.PI / 2, l: 1.52, w: .68 },
  { x: 8.48, z: -6.9, heading: -Math.PI / 2, l: 1.7, w: .7 },
  { x: -8.48, z: -4.8, heading: Math.PI / 2, l: 1.52, w: .68 },
  { x: 8.48, z: -4.8, heading: -Math.PI / 2, l: 1.7, w: .7 },
];

const ROUTES = [
  [0, 'depot', 'feeder-a'], [0, 'depot', 'feeder-b'],
  [1, 'depot', 'feeder-a'], [1, 'depot', 'feeder-b'],
  [0, 'feeder-a', 'feeder-b'], [1, 'feeder-a', 'feeder-b'],
  [0, 'feeder-b', 'feeder-a'], [1, 'feeder-b', 'feeder-a'],
];

test('routes stay on asphalt and never cross a parked footprint', () => {
  for (const [index, origin, target] of ROUTES) {
    const route = routeFor(index, origin, target);
    const tag = `crew${index + 1} ${origin}->${target}`;
    for (const p of route) assert.ok(onRoad(p), `${tag} leaves asphalt at (${p.x},${p.z})`);
    // Sweep the whole corridor: the footprint at every .05 units along the
    // route must clear every parked truck and parked car. A truck parked at a
    // feeder may sit at either arrival heading.
    const len = routeLength(route);
    const obstacles = [...CARS];
    for (const bay of [0, 1])
      if (!(origin === 'depot' && bay === index)) obstacles.push({ ...depotBay(bay), l: FOOT_LENGTH, w: FOOT_WIDTH });
    for (const f of ['feeder-a', 'feeder-b'])
      if (f !== origin && f !== target) for (const heading of [Math.PI / 2, -Math.PI / 2, Math.PI])
        obstacles.push({ x: parkPose(f).x, z: parkPose(f).z, heading, l: FOOT_LENGTH, w: FOOT_WIDTH });
    for (let d = 0; d <= len; d += .05) {
      const pose = poseAt(route, d);
      for (const o of obstacles)
        assert.ok(!footprintsOverlap(pose, { x: o.x, z: o.z, heading: o.heading }, FOOT_LENGTH, FOOT_WIDTH, o.l, o.w),
          `${tag} hits parked footprint at d=${d.toFixed(2)} (${pose.x.toFixed(2)},${pose.z.toFixed(2)}) vs (${o.x},${o.z})`);
    }
  }
});

// Mirrors Fleet's TruckInput mapping: schedule distance from domain progress,
// priority = earlier departedAt then lower crew index.
const runScenario = (plan) => {
  const traffic = new Traffic();
  const crews = plan.map((p, i) => ({
    i, origin: p.origin ?? 'depot', target: p.target ?? null,
    depart: p.depart ?? Number.POSITIVE_INFINITY,
    trip: p.trip ?? DEPOT_TRIP,
    route: null, len: 0, parkedAt: null,
    parkedPose: p.parked ?? depotBay(i),
  }));
  let maxLate = 0;
  const lastArrive = Math.max(...crews.map((c) => c.target ? c.depart + c.trip : 0));
  const poses = [];
  for (let t = 0; t < lastArrive / TICK_RATE + 3; t += DT) {
    const simNow = t * TICK_RATE;
    const inputs = crews.map((c) => {
      if (c.target && simNow >= c.depart && !c.route) {
        c.route = routeFor(c.i, c.origin, c.target);
        c.len = routeLength(c.route);
      }
      if (!c.route)
        return { route: null, scheduleDistance: 0, nominalSpeed: 0, priority: 100 + c.i, snap: false, parked: c.parkedPose };
      const arrived = simNow >= c.depart + c.trip;
      return {
        route: c.route,
        scheduleDistance: (arrived ? 1 : (simNow - c.depart) / c.trip) * c.len,
        nominalSpeed: c.len * TICK_RATE / c.trip,
        priority: c.depart * 2 + c.i,
        snap: false,
        parked: null,
      };
    });
    const step = traffic.step(inputs, DT);
    poses.push(step);
    assert.ok(!footprintsOverlap(step[0], step[1], FOOT_LENGTH, FOOT_WIDTH),
      `truck footprints overlap at t=${t.toFixed(2)}: (${step[0].x.toFixed(2)},${step[0].z.toFixed(2)}) vs (${step[1].x.toFixed(2)},${step[1].z.toFixed(2)})`);
    for (const c of crews) {
      if (!c.route) continue;
      for (const [ci, car] of CARS.entries())
        assert.ok(!footprintsOverlap(step[c.i], { x: car.x, z: car.z, heading: car.heading }, FOOT_LENGTH, FOOT_WIDTH, car.l, car.w),
          `crew${c.i + 1} hits parked car ${ci} at t=${t.toFixed(2)}`);
      if (arrivedAt(c, simNow) && traffic.parked(c.i) && c.parkedAt === null) {
        c.parkedAt = t;
        maxLate = Math.max(maxLate, t - (c.depart + c.trip) / TICK_RATE);
      }
    }
  }
  return { crews, maxLate, poses };
};
const arrivedAt = (c, simNow) => c.target && simNow >= c.depart + c.trip;

test('two-truck dispatch: no overlap, parks within 1s of arrival', () => {
  for (const first of [0, 1])
    for (const crossPair of [false, true])
      for (const gap of [0, 1, 5, 15, 30, 59]) {
        const targets = crossPair ? ['feeder-b', 'feeder-a'] : ['feeder-a', 'feeder-b'];
        const plan = [{}, {}];
        plan[first] = { target: targets[first], depart: 0 };
        plan[1 - first] = { target: targets[1 - first], depart: gap };
        const { crews, maxLate, poses } = runScenario(plan);
        const tag = `first=${first + 1} pair=${crossPair ? 'crossed' : 'straight'} gap=${gap}`;
        for (const c of crews) {
          assert.notEqual(c.parkedAt, null, `crew${c.i + 1} never parked (${tag})`);
          assert.ok(c.parkedAt - (c.depart + c.trip) / TICK_RATE <= 1,
            `crew${c.i + 1} parked ${(c.parkedAt - (c.depart + c.trip) / TICK_RATE).toFixed(2)}s late (${tag})`);
          const end = poses.at(-1)[c.i], want = parkPose(c.target);
          assert.ok(Math.hypot(end.x - want.x, end.z - want.z) < .01,
            `crew${c.i + 1} parked off-spot (${end.x.toFixed(2)},${end.z.toFixed(2)}) (${tag})`);
        }
        assert.ok(maxLate <= 1, `worst lateness ${maxLate.toFixed(2)}s (${tag})`);
      }
});

test('single truck tracks schedule exactly and never yields to a parked truck', () => {
  for (const index of [0, 1]) for (const target of ['feeder-a', 'feeder-b']) {
    const route = routeFor(index, 'depot', target);
    const len = routeLength(route);
    const other = depotBay(1 - index);
    const traffic = new Traffic();
    for (let t = 0; t < DEPOT_TRIP / TICK_RATE + 1; t += DT) {
      const simNow = t * TICK_RATE;
      const sched = Math.min(1, simNow / DEPOT_TRIP) * len;
      const [pose] = traffic.step([
        { route, scheduleDistance: sched, nominalSpeed: len * TICK_RATE / DEPOT_TRIP, priority: index, snap: false, parked: null },
        { route: null, scheduleDistance: 0, nominalSpeed: 0, priority: 100 + (1 - index), snap: false, parked: other },
      ], DT);
      const want = poseAt(route, sched);
      assert.ok(Math.hypot(pose.x - want.x, pose.z - want.z) < 1e-9,
        `crew${index + 1}->${target} lags at t=${t.toFixed(2)}: shown(${pose.x.toFixed(2)},${pose.z.toFixed(2)}) vs sched(${want.x.toFixed(2)},${want.z.toFixed(2)})`);
    }
  }
});

test('feeder-to-feeder run clears the truck parked at the depot', () => {
  for (const [origin, target] of [['feeder-a', 'feeder-b'], ['feeder-b', 'feeder-a']]) {
    const { crews, maxLate } = runScenario([
      { origin, target, depart: 0, trip: CROSS_TRIP, parked: parkPose(origin) },
      {},
    ]);
    assert.notEqual(crews[0].parkedAt, null, `crew never parked (${origin}->${target})`);
    assert.ok(maxLate <= 1, `late ${maxLate.toFixed(2)}s (${origin}->${target})`);
    assert.ok(Math.abs(crews[0].parkedAt - CROSS_TRIP / TICK_RATE) <= 1);
  }
});

// Storm-02 return drive: Crew 2 comes back down the westbound lane and backs
// into its bay, due exactly at returnAt = 120. Its route exists (and reserves
// the single-lane depot yard) from returnAt - RETURN_DRIVE - 15, matching
// vehicles.ts, while the truck stays invisible until returnAt - RETURN_DRIVE.
// Crew 1 may be dispatched to either feeder at any tick 0–119. The pairwise
// check uses real truck bodies, not the yield margins: the two main-road lanes
// are .8 apart — narrower than FOOT_WIDTH — so a legal abreast pass keeps only
// .02 body clearance, which the assertions below verify explicitly.
test('return drive vs dispatch at every tick 0-119, both feeders', () => {
  const RETURN_AT = 120;
  const route = returnRoute(1);
  const len = routeLength(route);
  const nominal = len * TICK_RATE / RETURN_DRIVE;
  for (const target of ['feeder-a', 'feeder-b']) {
    for (let gap = 0; gap < RETURN_AT; gap++) {
      const traffic = new Traffic();
      const route1 = routeFor(0, 'depot', target);
      const len1 = routeLength(route1);
      const end = Math.max(gap + DEPOT_TRIP, RETURN_AT) + 30;
      let parked2 = null;
      let worstLate2 = -Infinity;
      for (let t = 0; t < end / TICK_RATE + 2; t += DT) {
        const simNow = t * TICK_RATE;
        const inputs = [
          simNow >= gap
            ? {
              route: route1,
              scheduleDistance: Math.min(1, (simNow - gap) / DEPOT_TRIP) * len1,
              nominalSpeed: len1 * TICK_RATE / DEPOT_TRIP,
              priority: gap * 2,
              snap: false, parked: null,
            }
            : { route: null, scheduleDistance: 0, nominalSpeed: 0, priority: 200, snap: false, parked: depotBay(0) },
          simNow >= RETURN_AT - RETURN_DRIVE - 15
            ? {
              route,
              scheduleDistance: Math.min(1, Math.max(0, (simNow - (RETURN_AT - RETURN_DRIVE)) / RETURN_DRIVE)) * len,
              nominalSpeed: nominal,
              priority: (RETURN_AT - RETURN_DRIVE) * 2 + 1,
              snap: false, parked: null, returning: true,
            }
            : { route: null, scheduleDistance: 0, nominalSpeed: 0, priority: 201, snap: false, parked: depotBay(1) },
        ];
        const step = traffic.step(inputs, DT);
        const tag = `target=${target} gap=${gap} t=${t.toFixed(2)}`;
        assert.ok(!footprintsOverlap(step[0], step[1], TRUCK_LENGTH, TRUCK_WIDTH),
          `truck bodies overlap (${tag})`);
        for (const [ci, pose] of step.entries())
          for (const [c, car] of CARS.entries())
            assert.ok(!footprintsOverlap(pose, { x: car.x, z: car.z, heading: car.heading }, TRUCK_LENGTH, TRUCK_WIDTH, car.l, car.w),
              `truck ${ci} hits parked car ${c} (${tag})`);
        if (parked2 === null && traffic.parked(1) && simNow > 0) {
          parked2 = simNow;
          worstLate2 = parked2 - RETURN_AT;
        }
      }
      assert.notEqual(parked2, null, `Crew 2 never parked (target=${target} gap=${gap})`);
      assert.ok(worstLate2 <= 10, `Crew 2 parked ${worstLate2.toFixed(1)} ticks after returnAt (target=${target} gap=${gap})`);
      const home = depotBay(1), endPose = poseAt(route, len);
      assert.ok(Math.hypot(endPose.x - home.x, endPose.z - home.z) < .01);
    }
  }
});

test('snap, backward schedule and large jumps pin the pose to schedule', () => {
  const route = routeFor(0, 'depot', 'feeder-a');
  const len = routeLength(route);
  const nominal = len * TICK_RATE / DEPOT_TRIP;
  const input = (scheduleDistance, snap = false) =>
    [{ route, scheduleDistance, nominalSpeed: nominal, priority: 0, snap, parked: null }];
  const near = (pose, d) => {
    const want = poseAt(route, d);
    assert.ok(Math.hypot(pose.x - want.x, pose.z - want.z) < 1e-9, `pose ${pose.x},${pose.z} vs ${want.x},${want.z}`);
  };
  const traffic = new Traffic();
  near(traffic.step(input(2), DT)[0], 2);
  // snap flag lands exactly on schedule even mid-route
  near(traffic.step(input(6, true), DT)[0], 6);
  // backward schedule snaps
  near(traffic.step(input(3), DT)[0], 3);
  // a jump over 25% of the route snaps
  near(traffic.step(input(3 + len * .3), DT)[0], 3 + len * .3);
  // a small forward step does not snap: advances at <=1.6x nominal
  const before = traffic.step(input(3 + len * .3 + .2), DT)[0];
  const want = poseAt(route, Math.min(3 + len * .3 + 1.6 * nominal * DT, 3 + len * .3 + .2));
  assert.ok(Math.hypot(before.x - want.x, before.z - want.z) < 1e-9);
});
