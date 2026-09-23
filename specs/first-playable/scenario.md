# First playable — staged capacity reference scenario

Numeric baseline, September 19, 2026. Implemented and checked in the September 21 first-playable blockout; see validation.md for evidence and limits. This remains the authoritative numeric specification for Storm 01, scenario version 1. Other release incidents require their own validated configurations; they must not silently change this reference run.

## Units, network and initial state

Capacity units (CU) are fictional game units, not electrical engineering quantities. Loads are constant, indivisible and served fully or not at all: no startup surge, partial supply, transmission losses or automatic load shedding. One simulation tick is one simulated second; the minutes below are simulation time, independent of wall time and playback speed.

Nine functional nodes: upstream supply, Substation A/Feeder A, Substation B/Feeder B, clinic, Housing A, Housing B, pumping station, harbor beacon and depot. Each substation and its feeder are one node. The depot is a crew origin with zero service load; the shared distribution bus is a logical connection, not an additional node.

The intact upstream supply can supply 13 CU. Two independent parallel feeders connect it to the same intact district bus. Every service can use either feeder; none depends on the pumping station or another service. Available capacity is the lesser of upstream capacity and the sum of repaired feeder capacities. There is no per-building feeder assignment or routing puzzle in this incident.

Start paused at tick 0, immediately after the storm: both feeders faulted, available capacity 0 CU, every service disconnected from the bus, both crews idle at the depot. The clinic operates on backup; all other services are offline. There are no later automatic faults, blocked roads, flooding events or random duration changes. All timings, loads and backup remaining are inspectable before starting.

## Service loads

| Service | Grid load | Initial backup | Initial service state |
|---|---:|---:|---|
| Clinic | 4 CU | 6 simulated minutes (360 ticks) | Operating on backup |
| Housing A | 3 CU | None | Offline |
| Housing B | 3 CU | None | Offline |
| Pumping station | 2 CU | None | Offline |
| Harbor beacon | 1 CU | None | Offline |
| **Total** | **13 CU** | | |

Clinic backup supplies only the clinic, consumes no feeder capacity, and drains only while the clinic is off grid and operating on backup. Grid reconnection stops backup depletion; it does not recharge it. A later manual disconnection resumes any remaining backup. With no reserve left, the disconnected clinic is offline. Downtime counts only intervals without either grid or backup service; backup operation is shown separately, not counted as an outage. The other services have no backup.

## Feeder repairs

| Target | Capacity added on completion | Depot travel | On-site repair | Completion if dispatched at tick 0 |
|---|---:|---:|---:|---:|
| Feeder A | 6 CU | 1 min / 60 ticks | 3 min / 180 ticks | Minute 4 / tick 240 |
| Feeder B | 7 CU | 1 min / 60 ticks | 7 min / 420 ticks | Minute 8 / tick 480 |

Either identical crew can repair either feeder. Assign one crew per target; crews cannot work on two targets at once or combine to accelerate one repair. Travel precedes work and consumes simulation time. A dispatched repair runs to completion; cancellation/reassignment while busy is unavailable in the first release. The two depot routes are always traversable. After completion the crew is idle at its target; travel between A and B takes 2 simulated minutes (120 ticks) if the other feeder still needs repair.

With both crews dispatched at tick 0, capacity progresses **0 → 6 → 13 CU** at minutes 0, 4 and 8. If B is repaired first under different commands, it supplies 7 CU alone; both repairs are independent. Waiting with only A repaired never raises its 6 CU limit. The second repair is what makes full restoration possible.

## Separate repair and connection actions

- Dispatch targets a faulted feeder and reserves one idle crew. Completion changes that feeder's condition and available capacity only. It never reconnects a service or changes its lights to grid-powered.
- Reconnect targets one disconnected service. It succeeds only if an intact supply path exists and the sum of already connected loads plus the requested load is at most available capacity. On success, it immediately reserves the full load and changes service state. There is no reconnection duration.
- Disconnect releases a connected service's full load immediately, allowing deliberate reprioritization. It changes service to backup or offline according to reserve. No automatic transfer of the freed capacity to another service occurs.
- Reject invalid actions without partial domain-state changes. Explain the requested load, available headroom or other unmet condition. A rejected action may appear as feedback but never as a completed repair/reconnection event.
- Pausing freezes elapsed simulation time, travel, repairs, backup drain and downtime. Inspection and explicit connection/dispatch commands remain possible at the paused tick and are recorded in stable order.

At each tick boundary, first account for service/backup time over the preceding interval, then apply due travel/repair/backup-expiry transitions in stable node/crew ID order, then process player commands in recorded sequence order. Tick 0 has no preceding interval. A repair completing at tick 240 can therefore be followed by reconnections at that same tick. A backup expiry and reconnection at one tick cause no positive-duration outage. Presentation must not alter this ordering.

## Hand-calculated priority comparison

Both runs use the same scenario version and seed, no random values, and the same repair commands: at tick 0 dispatch Crew 1 to A and Crew 2 to B, then start time. Both arrive at minute 1. Pause at the stated decision ticks to issue commands without simulation time passing; these are reference command logs, not assumed human reaction speed.

| Time | Shared repair/capacity state | Clinic-and-pump priority | Housing priority |
|---|---|---|---|
| 0–4 min | Both repairs underway after travel; 0 CU | Clinic on backup; all other services offline | Same |
| Minute 4 | A finishes; 6 CU available; no automatic reconnections | Reconnect clinic (4), then pump (2): 6/6 CU. Clinic retains 2 backup minutes. | Reconnect Housing A (3), then Housing B (3): 6/6 CU. Clinic remains on backup. |
| Minute 6 | B still repairing; capacity remains 6 CU | Clinic and pump stay powered | Clinic backup expires; clinic becomes offline |
| Minute 8, before commands | B finishes; capacity becomes 13 CU | Existing loads remain 6 CU; housing and beacon still offline | Existing loads remain 6 CU; clinic, pump and beacon still offline |
| Minute 8, explicit commands | 7 CU of additional headroom | Reconnect Housing A (3), Housing B (3), beacon (1): 13/13 CU | Reconnect clinic (4), pump (2), beacon (1): 13/13 CU |

In the clinic-and-pump run, trying to reconnect Housing A at minute 4 would request 9 CU against 6 CU and must be rejected without mutation. Reconnecting only the clinic and Housing A would also fail: 4 + 3 = 7 > 6. Both housing groups fit together: 3 + 3 = 6.

Downtime is accumulated over [0, 8) simulated minutes, with all remaining services restored exactly at minute 8:

| Service | Clinic-and-pump priority | Housing priority |
|---|---:|---:|
| Clinic | 0 min: backup [0,4), grid [4,8) | 2 min: offline [6,8) |
| Housing A | 8 min: offline [0,8) | 4 min: offline [0,4) |
| Housing B | 8 min: offline [0,8) | 4 min: offline [0,4) |
| Pumping station | 4 min: offline [0,4) | 8 min: offline [0,8) |
| Harbor beacon | 8 min: offline [0,8) | 8 min: offline [0,8) |
| **Unweighted total** | **28 service-minutes** | **26 service-minutes** |

Housing priority reduces combined housing downtime by 8 service-minutes, at the cost of 2 clinic minutes and 4 pump minutes. Clinic-and-pump priority preserves uninterrupted clinic service and restores pumping earlier. Show the per-service comparison; the unweighted total is arithmetic context, not a safety score, population measure or declaration that either policy is best. Switching loads mid-run is legal and produces another recorded tradeoff; these two runs are examples, not the only strategies.

## State-driven presentation

The concept images establish mood, camera and composition only. Initial housing windows, pump operation and the beacon must show offline state even where the images depict light. Clinic backup uses a distinct, labeled limited-light presentation; grid power enables its normal restored lighting. Repair alone changes feeder indicators, not disconnected service lighting. Decorative work lamps must not imply that a service is supplied.

Event history contains only transitions and accepted actions that actually occurred, at their simulation ticks, through the current replay cursor and within the selected branch. Crew arrival/repair estimates belong in clearly labeled upcoming information, never completed history. No hard-coded image timestamps, “Reports of flooding,” or future “Crew en route” entries. Rewind must restore matching lights, service state and visible history; advancing replay must not duplicate events.
