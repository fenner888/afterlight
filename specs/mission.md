# Mission

A compact systems puzzle: restore a fictional coastal district after a storm using two crews and limited capacity. Show consequences and let visitors reconsider choices through replay.

## Audience and value

Curious browser visitors and hackathon judges; no technical background required. Immediate interaction, visible recovery, meaningful priorities, replay and authored challenges.

## Primary flows

1. Start an authored incident in the persistent district.
2. Inspect a service and its dependency/backup.
3. Assign one of two crews to a valid repair.
4. Reconnect selected loads within available capacity; repair the second feeder to increase capacity, then explicitly reconnect remaining services.
5. Pause, replay, branch and compare under the same seed.
6. Save/resume locally or open a validated shared challenge configuration.

## Scope and exclusions

One district, 8–10 functional nodes, two crews, one simplified network, three authored incidents. Time controls, event history, keyboard alternatives, reduced motion and mute.
No multiplayer, accounts, payments, real infrastructure feeds, live AI decisions, open world, general city construction, fluid/electrical solver, clip generation or professional advice. Blocked roads, flooding mechanics and flooding events are excluded from the entire first release; authored routes remain traversable.

The first playable uses the nine-node [Storm 01 reference scenario](first-playable/scenario.md): 13 CU of service demand, a 6 CU first feeder repair and a second repair adding 7 CU. The clinic's backup creates a visible choice between uninterrupted clinic service and earlier housing restoration. Repair and service reconnection remain separate actions. Images guide appearance only; actual state drives service lighting and event history.

## Success gates, not claims

- First-time reviewer can identify a fault and complete a repair without a separate tutorial page.
- Scenario version/seed/command log reproduce domain state regardless of render frame rate.
- A visible capacity tradeoff and three incidents reward different priorities.
- Keyboard and touch alternatives complete the loop; real-device gaps disclosed.
- Measured runtime budgets on recorded hardware before release.
- Public demo/repo only after Mark's review and release checks.

Data: fictional public scenarios and local decisions. No personal information, credentials or analytics by default. Save/URL input is untrusted. No scientific validation claimed.
