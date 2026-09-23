# Storms 02 and 03 — reference scenarios

Approved by Mark on September 23, 2026 (build: September 23–24). Hand-calculated here, like [Storm 01](scenario.md), under exactly the same rules: units, loads, one crew per target, travel before work, separate repair and reconnect, backup that drains only off-grid and never recharges, and the tick ordering (accounting → due transitions in stable key order → commands). Storm 01's numbers and outcomes must not change.

One tick is one simulation second, which is one world minute. `h` below means world hours (60 ticks).

## Shared across all storms

- Same district, the same nine nodes, and the same service loads: clinic 4, Housing A 3, Housing B 3, pump 2, beacon 1, for 13 CU in total. Upstream supply is 13.
- Travel times are the same: depot to feeder 60 ticks, feeder to feeder 120.
- Each storm defines its own feeder capacities (which must sum to 13), repair durations, clinic backup, world start time and crew availability. The other services never have backup.
- **New mechanic, crew availability.** A crew can start **away** with a `returnAt` tick. While away it can't be dispatched; the rejection names its return time. At `returnAt` it becomes idle at the depot, and the game records a `returned` event ("Crew 2 is back at the depot."). The due-transition key is the crew ID (e.g. `crew-2`), sorted with the other keys. `nextTransition` includes `returnAt`.
- **Sunrise tick** = (06:30 − world start) mod 24h. Storm 01: 660, Storm 02: 840, Storm 03: 450.

## Storm 02 — Crew Short

| Setting | Value |
|---|---|
| World start | 16:30 (daylight; dusk at 19:30, night from 20:30) |
| Feeder A | 6 CU, repair 180 |
| Feeder B | 7 CU, repair 420 |
| Clinic backup | 360 (until 22:30 if never connected) |
| Crew 1 | at the depot, available at tick 0 |
| Crew 2 | away; `returnAt` 120 (18:30) |

Reference command logs. Each dispatch or reconnect happens at the stated tick, while paused.

**X — Crew 1 to the quick feeder.** Crew 1 → A at 0 (arrives 60, done 240). Crew 2 → B at 120 (arrives 180, done 600). Capacity: 6 at 240 (20:30), 13 at 600 (02:30).
- X1: at 240 reconnect clinic and pump; at 600 reconnect Housing A, Housing B and beacon.
- X2: at 240 reconnect Housing A and Housing B. Clinic backup expires at 360 and the clinic is offline for [360, 600). At 600 reconnect clinic, pump and beacon.

**Y — Crew 1 to the slow feeder.** Crew 1 → B at 0 (arrives 60, done 480). Crew 2 → A at 120 (arrives 180, done 360). Capacity: 6 at 360 (22:30), 13 at 480 (00:30).
- At tick 360 the clinic backup expiry (key `clinic`) and Feeder A's repair (key `feeder-a/crew-2`) are both due. Expiry runs first, then the repair, then commands. A clinic reconnected at 360 therefore has no positive-duration outage.
- Y1: at 360 reconnect clinic and pump; at 480 reconnect Housing A, Housing B and beacon.
- Y2: at 360 reconnect Housing A and Housing B; the clinic is offline for [360, 480). At 480 reconnect clinic, pump and beacon.

Downtime in ticks (= world minutes) until full restoration:

| Service | X1 | X2 | Y1 | Y2 |
|---|---:|---:|---:|---:|
| Clinic | 0 | 240 | 0 | 120 |
| Housing A | 600 | 240 | 480 | 360 |
| Housing B | 600 | 240 | 480 | 360 |
| Pumping station | 240 | 600 | 360 | 480 |
| Harbor beacon | 600 | 600 | 480 | 480 |
| **Unweighted total** | **2040** | **1920** | **1800** | **1800** |
| Fully restored | 600 (02:30) | 600 | 480 (00:30) | 480 |

The lesson: sending your only crew to the slow feeder gets everyone back two hours sooner. The quick feeder gets the first power on two hours sooner (20:30 vs 22:30). The totals are arithmetic context only, not a score.

## Storm 03 — The Long Dark

| Setting | Value |
|---|---|
| World start | 23:00 (night; dawn 05:00, sunrise 06:30) |
| Feeder A | 4 CU, repair 120 |
| Feeder B | 9 CU, repair 360 |
| Clinic backup | 300 (until 04:00 if never connected) |
| Crews | both at the depot, available at tick 0 |

Parallel dispatch at 0: Crew 1 → A (arrives 60, done 180 = 02:00) and Crew 2 → B (arrives 60, done 420 = 06:00). The backup warning pauses at 240 (03:00, one hour of fuel left) if the clinic is still off-grid.

- **S — safe:** at 180 reconnect clinic (4/4 CU; 120 backup ticks preserved). At 420 reconnect Housing A, Housing B, pump and beacon.
- **C — swap in time:** at 180 reconnect Housing A and beacon (4/4). At 300 the clinic backup expires. Then, the same tick: disconnect Housing A, disconnect beacon, reconnect clinic, with no positive-duration clinic outage. At 420 reconnect everything still dark.
- **C′ — swap at the warning:** as C, but the swap happens at 240. The clinic keeps 60 ticks of backup.
- **G — no swap:** at 180 reconnect Housing A and beacon. The clinic is offline for [300, 420). At 420 reconnect clinic, Housing B and pump.

| Service | S | C | C′ | G |
|---|---:|---:|---:|---:|
| Clinic | 0 | 0 | 0 | 120 |
| Housing A | 420 | 300 | 360 | 180 |
| Housing B | 420 | 420 | 420 | 420 |
| Pumping station | 420 | 420 | 420 | 420 |
| Harbor beacon | 420 | 300 | 360 | 180 |
| **Unweighted total** | **1680** | **1440** | **1560** | **1320** |

In C, Housing A is offline for [0, 180) and [300, 420). Trying to reconnect the clinic at 180 while Housing A and beacon hold 4/4 CU must be rejected ("needs 4 CU; 0 CU headroom").

The lesson: reallocation. Disconnecting one service to power another is legal and recorded, and its timing matters.

## Copy (authoritative)

Incident picker cards (in the briefing dialog):
- **Storm 01 · After the storm**: "Dusk. Not enough early power for everyone."
- **Storm 02 · Crew Short**: "Afternoon. One crew now, the other later."
- **Storm 03 · The Long Dark**: "Near midnight. Four units, a failing generator, and a swap to time."

Storm 02 briefing:
1. "16:30. A squall line has knocked out both feeders. The district is dark in broad daylight."
2. "Crew 2 is still out on a job across town — back at the depot around 18:30. Crew 1 is ready now."
3. "Feeder A is the quick fix (3h, 6 of 13 units). Feeder B is slow (7h, the other 7). The clinic generator lasts until about 22:30."
4. "Where do you send your only crew?"

Storm 03 briefing:
1. "23:00. A late storm has taken both feeders. It's a long way to sunrise."
2. "The clinic generator has 5 hours of fuel — until about 04:00. Nothing else has backup."
3. "Feeder A is quick (2h) but carries only 4 units — exactly the clinic's load. Feeder B is slow (6h, the other 9)."
4. "You can disconnect one building to power another at any time."

Incident events (the tick-0 event text): Storm 02 "Storm 02: both feeders faulted. Crew 2 away until 18:30. Clinic operating on backup."; Storm 03 "Storm 03: both feeders faulted. Clinic operating on backup."

Task banner and decision additions:
- While a crew is away and no crew is out: "Send Crew 1 — click a broken feeder. Crew 2 is back at {hh:mm}."
- While a crew is away and the other is out: "{Crew} is rolling to {Feeder}. Crew 2 is back at {hh:mm}."
- Crew returns: pause with the decision card "Crew 2 is back at the depot" / "Send it to {faulted feeder}." Also open that feeder's popover with Send focused, as for the first dispatch. If no feeder is faulted, show the card with "Both feeders are covered." and don't open a popover.
- Backup-warning card fix, for all storms: show the "Disconnect another building to free 4 units" clause only when capacity ≥ 4 and headroom < 4. Otherwise end after "unless it's reconnected."
