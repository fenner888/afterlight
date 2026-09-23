import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, execute, advance, capacity, connectedLoad, serviceStatus, nextTransition, stateHash, phase } from '../src/domain.ts';
import { worldMinutes, formatWorldTime, formatDuration, dayPhase, SCENARIOS } from '../src/scenario.ts';
import { replay } from '../src/history.ts';
import { Clock } from '../src/clock.ts';

const act = (state, action) => {
  const result = execute(state, { ...action, tick: state.tick, sequence: state.commands.length });
  assert.equal(result.ok, true, result.message);
  return result.state;
};
const dispatch = (state, crew = 'crew-1', target = 'feeder-a') => act(state, { type: 'dispatch', crew, target });
const connect = (state, target) => act(state, { type: 'reconnect', target });
const both = () => dispatch(dispatch(initialState()), 'crew-2', 'feeder-b');
const rejected = (state, action) => {
  const before = structuredClone(state);
  const result = execute(state, { tick: state.tick, sequence: state.commands.length, ...action });
  assert.equal(result.ok, false);
  assert.strictEqual(result.state, state);
  assert.deepEqual(state, before);
  return result;
};

for (const [priority, first, remaining, downtime] of [
  ['clinic and pump', ['clinic', 'pump'], ['housing-a', 'housing-b', 'beacon'], [0, 480, 480, 240, 480]],
  ['housing', ['housing-a', 'housing-b'], ['clinic', 'pump', 'beacon'], [120, 240, 240, 480, 480]],
]) {
  test(`reference oracle: ${priority}`, () => {
    let state = both();
    state = advance(state, 240);
    for (const id of first) state = connect(state, id);
    assert.equal(connectedLoad(state), 6);
    state = advance(state, 480);
    assert.equal(connectedLoad(state), 6);
    for (const id of remaining) state = connect(state, id);
    assert.equal(capacity(state), 13);
    assert.equal(connectedLoad(state), 13);
    assert.deepEqual(Object.values(state.services).map(s => s.downtime), downtime);
    assert.equal(state.services.clinic.backupRemaining, priority === 'housing' ? 0 : 120);
    assert.equal(stateHash(replay(state.commands, 480)), stateHash(state));
  });
}

test('initial state has no grid power and clinic backup is not downtime', () => {
  const state = initialState();
  assert.equal(capacity(state), 0);
  assert.equal(serviceStatus(state, 'clinic'), 'backup');
  assert.equal(serviceStatus(state, 'beacon'), 'offline');
  const later = advance(state, 360);
  assert.equal(state.services.clinic.backupRemaining, 360);
  assert.equal(later.services.clinic.downtime, 0);
  assert.equal(serviceStatus(later, 'clinic'), 'offline');
  assert.equal(advance(later, 361).services.clinic.downtime, 1);
});

test('travel, repairs and capacity have exact boundaries and never reconnect', () => {
  const start = both();
  assert.equal(nextTransition(start), 60);
  assert.equal(advance(start, 59).crews['crew-1'].phase, 'traveling');
  assert.equal(advance(start, 60).crews['crew-1'].phase, 'repairing');
  assert.equal(capacity(advance(start, 239)), 0);
  assert.equal(capacity(advance(start, 240)), 6);
  assert.equal(capacity(advance(start, 479)), 6);
  const end = advance(start, 480);
  assert.equal(capacity(end), 13);
  assert.equal(connectedLoad(end), 0);
  assert.equal(serviceStatus(end, 'clinic'), 'offline');
  assert.equal(end.crews['crew-1'].location, 'feeder-a');
  assert.equal(end.crews['crew-2'].location, 'feeder-b');
});

test('waiting alone adds no capacity; B alone provides seven; sequential travel is 120 ticks', () => {
  assert.equal(capacity(advance(dispatch(initialState()), 1000)), 6);
  assert.equal(capacity(advance(dispatch(initialState(), 'crew-2', 'feeder-b'), 480)), 7);
  let state = advance(dispatch(initialState()), 240);
  state = dispatch(state, 'crew-1', 'feeder-b');
  assert.equal(state.crews['crew-1'].arriveAt, 360);
  assert.equal(state.crews['crew-1'].completeAt, 780);
  assert.equal(capacity(advance(state, 779)), 6);
  assert.equal(capacity(advance(state, 780)), 13);
});

test('capacity zero, exact, one-over and three-over; rejection does not mutate', () => {
  rejected(initialState(), { type: 'reconnect', target: 'beacon' });
  let state = connect(advance(both(), 240), 'clinic');
  assert.match(rejected(state, { type: 'reconnect', target: 'housing-a' }).message, /3 CU.*2 CU/);
  state = connect(state, 'pump');
  rejected(state, { type: 'reconnect', target: 'housing-a' });
  rejected(state, { type: 'reconnect', target: 'clinic' });
  state = act(state, { type: 'disconnect', target: 'pump' });
  assert.equal(connectedLoad(state), 4);
  rejected(state, { type: 'disconnect', target: 'pump' });
  assert.equal(serviceStatus(state, 'housing-a'), 'offline');
});

test('backup pauses on reconnect, resumes on disconnect and never recharges', () => {
  let state = connect(advance(both(), 240), 'clinic');
  state = advance(state, 480);
  assert.equal(state.services.clinic.backupRemaining, 120);
  state = act(state, { type: 'disconnect', target: 'clinic' });
  assert.equal(serviceStatus(state, 'clinic'), 'backup');
  state = advance(state, 600);
  assert.equal(state.services.clinic.downtime, 0);
  assert.equal(state.services.clinic.backupRemaining, 0);
  state = advance(state, 620);
  state = connect(state, 'clinic');
  assert.equal(state.services.clinic.downtime, 20);
  assert.equal(state.services.clinic.backupRemaining, 0);
});

test('same-tick expiry and reconnection have no positive-duration outage', () => {
  let state = advance(both(), 360);
  assert.equal(state.events.at(-1).kind, 'backup-expired');
  state = connect(state, 'clinic');
  assert.equal(state.services.clinic.downtime, 0);
  assert.equal(state.events.at(-1).kind, 'reconnected');
  assert.equal(state.events.at(-1).tick, 360);
});

test('crew and target exclusivity, repair condition and unsupported actions', () => {
  const state = dispatch(initialState());
  rejected(state, { type: 'dispatch', crew: 'crew-1', target: 'feeder-b' });
  rejected(state, { type: 'dispatch', crew: 'crew-2', target: 'feeder-a' });
  rejected(state, { type: 'cancel', crew: 'crew-1' });
  rejected(advance(state, 240), { type: 'dispatch', crew: 'crew-2', target: 'feeder-a' });
});

test('unknown keys, nonfinite numbers, stale order and unsupported targets are rejected', () => {
  const state = initialState();
  for (const raw of [null, [], 42, {}, { type: 'reconnect', target: 'clinic', tick: NaN, sequence: 0 }]) {
    assert.equal(execute(state, raw).ok, false);
  }
  for (const extra of [{ tick: -1 }, { tick: 1 }, { sequence: 5 }, { unexpected: true }, { target: '__proto__' }, { target: '<img>' }]) {
    rejected(state, { type: 'reconnect', target: 'clinic', ...extra });
  }
  assert.throws(() => advance(state, -1));
  assert.throws(() => advance(state, Infinity));
});

test('replay preserves live history, excludes future events and reconstructs same-tick actions', () => {
  let state = connect(advance(both(), 240), 'clinic');
  state = connect(state, 'pump');
  state = advance(state, 480);
  const original = structuredClone(state);
  const before = replay(state.commands, 239);
  assert.equal(connectedLoad(before), 0);
  assert.ok(before.events.every(event => event.tick <= 239));
  assert.equal(connectedLoad(replay(state.commands, 240)), 6);
  assert.deepEqual(replay(state.commands, 480), state);
  assert.deepEqual(replay(state.commands, 480), state);
  assert.deepEqual(state, original);
});

test('varied advance batches produce identical full state', () => {
  let state = both();
  for (let tick = 1; tick <= 1000; tick++) state = advance(state, tick);
  assert.equal(stateHash(state), stateHash(advance(both(), 1000)));
});

test('clock pause, speed, long frames and fractional schedules do not lose time', () => {
  const run = (schedule) => {
    const clock = new Clock();
    clock.setRunning(true);
    clock.setSpeed(10);
    let ticks = 0;
    for (const delta of schedule) ticks += clock.consume(delta);
    while (clock.pendingTicks > 0) ticks += clock.consume(0);
    return ticks;
  };
  assert.equal(run([48000]), 480);
  assert.equal(run(Array(480).fill(100)), 480);
  assert.equal(run(Array(2880).fill(1000 / 60)), 480);
  const clock = new Clock();
  assert.equal(clock.consume(10000), 0);
  clock.setRunning(true);
  clock.setSpeed(30);
  assert.equal(clock.consume(20000), 300);
  assert.equal(clock.pendingTicks, 300);
  clock.setRunning(false);
  assert.equal(clock.consume(60000), 0);
  assert.equal(clock.pendingTicks, 300);
  clock.setRunning(true);
  assert.equal(clock.consume(0), 300);
  assert.throws(() => clock.setSpeed(7));
  assert.throws(() => clock.consume(NaN));
});

test('different render schedules reproduce identical command-driven state hashes', () => {
  const run = schedule => {
    let state = both();
    const clock = new Clock();
    clock.setRunning(true);
    for (const decisionTick of [240, 480]) {
      const increments = schedule(24000);
      for (const elapsed of increments) {
        const ticks = clock.consume(elapsed);
        state = advance(state, state.tick + ticks);
      }
      while (clock.pendingTicks) state = advance(state, state.tick + clock.consume(0));
      assert.equal(state.tick, decisionTick);
      for (const target of decisionTick === 240 ? ['clinic', 'pump'] : ['housing-a', 'housing-b', 'beacon']) state = connect(state, target);
    }
    return stateHash(state);
  };
  const long = run(total => [total]);
  assert.equal(run(total => Array(total / 100).fill(100)), long);
  assert.equal(run(total => Array(total / 1000 * 60).fill(1000 / 60)), long);
});

test('phase follows dispatch, waiting, restore and restored', () => {
  assert.equal(phase(initialState()), 'dispatch');
  assert.equal(phase(dispatch(initialState())), 'dispatch');
  const sent = both();
  assert.equal(phase(sent), 'restore');
  assert.equal(phase(advance(sent, 240)), 'restore');
  assert.equal(phase(advance(sent, 480)), 'restore');
  let full = advance(sent, 480);
  for (const id of ['clinic', 'housing-a', 'housing-b', 'pump', 'beacon']) full = connect(full, id);
  assert.equal(phase(full), 'restored');
  assert.equal(phase(act(full, { type: 'disconnect', target: 'beacon' })), 'restore');
  const waiting = advance(dispatch(initialState(), 'crew-1', 'feeder-b'), 240);
  assert.equal(phase(waiting), 'dispatch');
});

test('durations format as hours and minutes with negative clamping', () => {
  assert.equal(formatDuration(0), '0h 00m');
  assert.equal(formatDuration(45), '0h 45m');
  assert.equal(formatDuration(110), '1h 50m');
  assert.equal(formatDuration(360), '6h 00m');
  assert.equal(formatDuration(-5), '0h 00m');
});

test('world clock maps ticks to 19:30 dusk through 06:30 day', () => {
  const start = SCENARIOS['storm-01'].worldStart;
  assert.equal(worldMinutes(0, start), 19 * 60 + 30);
  assert.equal(formatWorldTime(0, start), '19:30');
  assert.equal(dayPhase(0, start), 'dusk');
  assert.equal(formatWorldTime(60, start), '20:30');
  assert.equal(dayPhase(60, start), 'night');
  assert.equal(formatWorldTime(240, start), '23:30');
  assert.equal(dayPhase(240, start), 'night');
  assert.equal(formatWorldTime(480, start), '03:30');
  assert.equal(dayPhase(480, start), 'night');
  assert.equal(formatWorldTime(600, start), '05:30');
  assert.equal(dayPhase(600, start), 'dawn');
  assert.equal(formatWorldTime(660, start), '06:30');
  assert.equal(dayPhase(660, start), 'day');
  assert.equal(dayPhase(30, start), 'dusk');
  assert.equal(dayPhase(570, start), 'dawn');
});

test('generated command sequences preserve capacity, rejection immutability and replay', () => {
  let state = initialState();
  let random = 8675309;
  const pick = max => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % max; };
  const ids = ['clinic', 'housing-a', 'housing-b', 'pump', 'beacon'];
  for (let i = 0; i < 300; i++) {
    state = advance(state, state.tick + pick(30));
    const type = pick(3);
    const action = type === 0 ? { type: 'dispatch', crew: pick(2) ? 'crew-1' : 'crew-2', target: pick(2) ? 'feeder-a' : 'feeder-b' } : { type: type === 1 ? 'reconnect' : 'disconnect', target: ids[pick(ids.length)] };
    const before = structuredClone(state);
    const result = execute(state, { ...action, tick: state.tick, sequence: state.commands.length });
    if (!result.ok) assert.deepEqual(result.state, before);
    state = result.state;
    assert.ok(connectedLoad(state) >= 0 && connectedLoad(state) <= capacity(state));
    for (const service of Object.values(state.services)) {
      assert.ok(service.backupRemaining >= 0 && service.backupRemaining <= 360);
      assert.ok(service.downtime >= 0 && service.downtime <= state.tick);
    }
  }
  assert.deepEqual(replay(state.commands, state.tick), state);
});
