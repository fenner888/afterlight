# AFTERLIGHT — design brief

## The scene

A rain-soaked coastal neighborhood rendered as a carefully built tabletop model. The clinic runs on backup, apartment windows are dark, and a harbor beacon is out. Two utility vans wait for instructions. Repair a feeder, explicitly reconnect services, and watch their lights return.

The city is the focal point: a crafted playable object with a compact operations console, not unrelated dashboard cards.

## Visual references

- [Storm](references/concepts/afterlight-storm.png): clinic selected on backup, crew ready to dispatch.
- [Recovery](references/concepts/afterlight-recovery.png): same district, clinic restored, warm windows returning, a remaining feeder constraint.

Generated visual references only, not application screenshots or runtime assets. Geometry/UI inconsistencies between generated images are not requirements. The real implementation must use one consistent district. Runtime lighting follows actual grid/backup/offline state; a repaired feeder does not light disconnected buildings. See [prompts](references/concepts/PROMPTS.md).

## Composition

Desktop: thin header, city occupying about three quarters of the area, narrow right inspector and short bottom event timeline. No routes or wizard.
Small screens: city remains visible; inspector becomes a shallow dismissible panel. Exact minimum viewport needs testing.
Perspective three-quarter camera (narrow FOV, slow idle drift), limited orbit/zoom and reset — changed from orthographic in the realism pass (see [realism and day/night](specs/first-playable/requirements.md#realism-and-daynight--september-21-mark-second-review)). Selection ring plus text; only selected dependencies are highlighted.
The incident runs through one night: one simulated minute is one world hour, storm at 19:30, dawn as the reward.
Inspector: state, dependencies, backup remaining, service load, connected load/available capacity, crew availability, travel/repair time remaining, next valid action and reasons when blocked.
Timeline: pause, time speed, replay and branch. Comparison uses the same scenario version and seed. Completed history contains only actual events through the current replay cursor in the selected branch; any upcoming estimates are labeled separately. Do not reuse illustrative image timestamps or event text.

## District and art

The first playable has nine functional nodes: clinic, two housing groups, pumping station, harbor beacon, depot, two substations/feeders and upstream supply. The [reference scenario](specs/first-playable/scenario.md) defines their loads and shared network. Maximum 10 for the release; adding a local load requires a revised scenario with verified capacity. Decorative buildings are not extra simulated nodes.
Rain-dark concrete, muted brick, painted metal, low seawall, practical cables and readable rooftops. A few trees, puddles and work lamps.
Cool overcast ambient light against warm windows. Restrained wet reflections. No neon/holograms, excessive bloom or dense floating labels.
Rain and water are atmosphere, not fluid dynamics. Blocked roads, flooding mechanics and flooding events are excluded from the first release. Vans follow authored traversable routes; arrival, repair and completion have distinct states.
Start with procedural blockout geometry. Blender/glTF hero assets are optional later.

## Proposed tokens

- Background #11191E; panel #1B262D; divider #33434B.
- Text #E8E5DA; muted #A6B4B7; restored #8BC7B0; backup/attention #DFAC60; failed #D27B6C.
- Pair every state with text/icons/line styles; no color-only information.
- Humanist sans plus small monospace labels, two families maximum. Verify licenses/readability before choosing font files; system fallbacks initially.
- Spacing 4/8/12/16/24/32 px; quiet outlines; 4–8 px radii.
- Proposed interface transitions 140–220 ms. Reduced motion removes camera interpolation and decorative weather without hiding state. Procedural sound starts with the Begin click and has a visible mute toggle (M key); see the September 23 spec section.

## Interaction beats

1. Short skippable briefing, then premise and incident visible with a task banner naming the current step. Time starts on the first dispatch and auto-pauses at decision points (see [review gate feedback](specs/first-playable/requirements.md#review-gate-feedback--september-21-mark)).
2. Select clinic: backup and upstream fault become clear.
3. Click a faulted feeder in the scene: a contextual popover offers "Send Crew 1 / Send Crew 2"; keyboard and dropdown paths remain.
4. Dispatch both crews: each travels for one simulation minute; A takes three further minutes to repair and B takes seven. A's completion makes 6 CU available; no service reconnects automatically.
5. Choose clinic (4 CU) and pump (2 CU), or both housing groups (3 CU each). Explicit reconnections update lights and record actual events. Clinic backup lasts six off-grid minutes.
6. Attempt excessive reconnection: reject without mutation and explain the shortfall. Waiting alone cannot increase capacity. B's later repair adds 7 CU, making 13 CU available; explicitly reconnect remaining services, including the 1 CU beacon.
7. Pause, rewind and try another priority; compare per-service downtime using the reference scenario. Do not imply an aggregate safety score or a single optimal policy.

## Visual review gate

Human-playable blockout first. Later inspect actual runtime at agreed desktop/phone viewports, focus, contrast, motion and performance. Generated references never substitute for runtime evidence.
