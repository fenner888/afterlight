import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, execute, advance, capacity, connectedLoad, serviceStatus, stateHash, phase } from '../src/domain.ts';
import { SCENARIOS, SCENARIO_IDS, validateScenario, sunriseTick } from '../src/scenario.ts';
import { replay } from '../src/history.ts';

const act = (state, action) => {
  const result = execute(state, { ...action, tick: state.tick, sequence: state.commands.length });
  assert.equal(result.ok, true, result.message);
  return result.state;
};
const dispatch = (state, crew, target) => act(state, { type: 'dispatch', crew, target });
const connect = (state, target) => act(state, { type: 'reconnect', target });
const disconnect = (state, target) => act(state, { type: 'disconnect', target });
const downtimes = state => ['clinic', 'housing-a', 'housing-b', 'pump', 'beacon'].map(id => state.services[id].downtime);

test('validateScenario accepts all three shipped storms', () => {
  for (const id of SCENARIO_IDS) assert.doesNotThrow(() => validateScenario(SCENARIOS[id]), id);
  assert.throws(() => validateScenario({ ...SCENARIOS['storm-02'], worldStart: 1440 }));
  assert.throws(() => validateScenario({ ...SCENARIOS['storm-02'], feeders: { 'feeder-a': { capacity: 5, repairTicks: 180 }, 'feeder-b': { capacity: 7, repairTicks: 420 } } }));
});

test('sunrise ticks are 660 / 840 / 450', () => {
  assert.equal(sunriseTick(SCENARIOS['storm-01']), 660);
  assert.equal(sunriseTick(SCENARIOS['storm-02']), 840);
  assert.equal(sunriseTick(SCENARIOS['storm-03']), 450);
});

test('storm-02 crew-2 is away: dispatch rejects with its return clock, then it returns at 18:30', () => {
  let state = initialState('storm-02');
  assert.equal(state.crews['crew-2'].phase, 'away');
  const result = execute(state, { type: 'dispatch', crew: 'crew-2', target: 'feeder-a', tick: 0, sequence: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Crew 2 is still on another job — back at 18:30.');
  state = advance(state, 119);
  assert.equal(state.crews['crew-2'].phase, 'away');
  state = advance(state, 120);
  assert.equal(state.crews['crew-2'].phase, 'idle');
  assert.equal(state.crews['crew-2'].location, 'depot');
  const event = state.events.at(-1);
  assert.equal(event.kind, 'returned');
  assert.equal(event.tick, 120);
  assert.equal(event.text, 'Crew 2 is back at the depot.');
});

test('storm-02: one crew out while the other is away is restore, not dispatch', () => {
  let state = dispatch(initialState('storm-02'), 'crew-1', 'feeder-a');
  assert.equal(phase(state), 'restore');
  state = advance(state, 120);
  assert.equal(phase(state), 'dispatch'); // crew-2 home, feeder B still faulted
});

// Storm 02 reference logs (incidents.md): crew-1 out at 0, crew-2 back at 120.
for (const [name, first, second, picks, expected] of [
  ['X1', 'feeder-a', 'feeder-b', [['clinic', 'pump'], ['housing-a', 'housing-b', 'beacon']], [0, 600, 600, 240, 600]],
  ['X2', 'feeder-a', 'feeder-b', [['housing-a', 'housing-b'], ['clinic', 'pump', 'beacon']], [240, 240, 240, 600, 600]],
]) {
  test(`storm-02 ${name}: A first, then B at 120 — exact downtimes`, () => {
    let state = dispatch(initialState('storm-02'), 'crew-1', first);
    state = advance(state, 120);
    state = dispatch(state, 'crew-2', second);
    state = advance(state, 240);
    assert.equal(capacity(state), 6);
    for (const id of picks[0]) state = connect(state, id);
    assert.equal(connectedLoad(state), 6);
    state = advance(state, 600);
    assert.equal(capacity(state), 13);
    for (const id of picks[1]) state = connect(state, id);
    assert.deepEqual(downtimes(state), expected);
    assert.equal(stateHash(replay(state.commands, 600, 'storm-02')), stateHash(state));
  });
}

// Storm 02 Y: feeder B first, then A at 120. At 360 the clinic expiry and the
// feeder-A repair land on the same tick — expiry sorts before the repair.
for (const [name, picks, expected] of [
  ['Y1', [['clinic', 'pump'], ['housing-a', 'housing-b', 'beacon']], [0, 480, 480, 360, 480]],
  ['Y2', [['housing-a', 'housing-b'], ['clinic', 'pump', 'beacon']], [120, 360, 360, 480, 480]],
]) {
  test(`storm-02 ${name}: same-tick expiry and repair, exact downtimes`, () => {
    let state = dispatch(initialState('storm-02'), 'crew-1', 'feeder-b');
    state = advance(state, 120);
    state = dispatch(state, 'crew-2', 'feeder-a');
    state = advance(state, 360);
    const at360 = state.events.filter(event => event.tick === 360).map(event => event.kind);
    assert.ok(at360.indexOf('backup-expired') > -1 && at360.indexOf('backup-expired') < at360.indexOf('repaired'),
      `expiry must run before the same-tick repair: ${at360}`);
    assert.equal(capacity(state), 6);
    assert.equal(serviceStatus(state, 'clinic'), 'offline');
    for (const id of picks[0]) state = connect(state, id);
    assert.equal(connectedLoad(state), 6);
    state = advance(state, 480);
    assert.equal(capacity(state), 13);
    for (const id of picks[1]) state = connect(state, id);
    assert.deepEqual(downtimes(state), expected);
    assert.equal(stateHash(replay(state.commands, 480, 'storm-02')), stateHash(state));
  });
}

test('storm-02 Y1: clinic downtime stays 0 when reconnected on the expiry tick', () => {
  let state = dispatch(initialState('storm-02'), 'crew-1', 'feeder-b');
  state = advance(state, 120);
  state = dispatch(state, 'crew-2', 'feeder-a');
  state = connect(advance(state, 360), 'clinic');
  assert.equal(state.services.clinic.downtime, 0);
  assert.equal(state.services.clinic.backupRemaining, 0);
});

// Storm 03 reference logs: both crews out at 0; A done at 180, B at 420.
test('storm-03 S: clinic straight onto Feeder A — exact downtimes', () => {
  let state = initialState('storm-03');
  state = dispatch(state, 'crew-1', 'feeder-a');
  state = dispatch(state, 'crew-2', 'feeder-b');
  state = connect(advance(state, 180), 'clinic');
  assert.equal(capacity(state), 4);
  assert.equal(connectedLoad(state), 4);
  state = advance(state, 420);
  assert.equal(capacity(state), 13);
  for (const id of ['housing-a', 'housing-b', 'pump', 'beacon']) state = connect(state, id);
  assert.deepEqual(downtimes(state), [0, 420, 420, 420, 420]);
  assert.equal(state.services.clinic.backupRemaining, 120);
  assert.equal(stateHash(replay(state.commands, 420, 'storm-03')), stateHash(state));
});

for (const [name, swapTick, expected] of [
  ['C', 300, [0, 300, 420, 420, 300]],
  ['C′', 240, [0, 360, 420, 420, 360]],
]) {
  test(`storm-03 ${name}: the swap at ${swapTick === 300 ? 'expiry' : 'the warning'} keeps the clinic at 0`, () => {
    let state = initialState('storm-03');
    state = dispatch(state, 'crew-1', 'feeder-a');
    state = dispatch(state, 'crew-2', 'feeder-b');
    state = advance(state, 180);
    state = connect(state, 'housing-a');
    state = connect(state, 'beacon');
    assert.equal(connectedLoad(state), 4);
    state = advance(state, swapTick);
    assert.equal(state.services.clinic.backupRemaining, 300 - swapTick);
    state = disconnect(state, 'housing-a');
    state = disconnect(state, 'beacon');
    state = connect(state, 'clinic');
    assert.equal(state.services.clinic.downtime, 0);
    state = advance(state, 420);
    for (const id of ['housing-a', 'housing-b', 'pump', 'beacon']) state = connect(state, id);
    assert.deepEqual(downtimes(state), expected);
    assert.equal(stateHash(replay(state.commands, 420, 'storm-03')), stateHash(state));
  });
}

test('storm-03 C: reconnecting the clinic over a full Feeder A is rejected', () => {
  let state = initialState('storm-03');
  state = dispatch(state, 'crew-1', 'feeder-a');
  state = dispatch(state, 'crew-2', 'feeder-b');
  state = advance(state, 180);
  state = connect(state, 'housing-a');
  state = connect(state, 'beacon');
  const before = structuredClone(state);
  const result = execute(state, { type: 'reconnect', target: 'clinic', tick: state.tick, sequence: state.commands.length });
  assert.equal(result.ok, false);
  assert.match(result.message, /needs 4 CU; 0 CU headroom/);
  assert.deepEqual(result.state, before);
});

test('storm-03 G: letting the clinic go dark costs it 120 ticks', () => {
  let state = initialState('storm-03');
  state = dispatch(state, 'crew-1', 'feeder-a');
  state = dispatch(state, 'crew-2', 'feeder-b');
  state = advance(state, 180);
  state = connect(state, 'housing-a');
  state = connect(state, 'beacon');
  state = advance(state, 300);
  assert.equal(serviceStatus(state, 'clinic'), 'offline');
  state = advance(state, 420);
  for (const id of ['clinic', 'housing-b', 'pump']) state = connect(state, id);
  assert.deepEqual(downtimes(state), [120, 180, 420, 420, 180]);
  assert.equal(stateHash(replay(state.commands, 420, 'storm-03')), stateHash(state));
});
