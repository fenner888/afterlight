# First playable — requirements

Scope: exactly one incident (Storm 01), two crews and staged capacity restoration in one interactive coastal blockout. The playable loop is inspect → dispatch → repair → reconnect, with explicit power reallocation, backup expiry, keyboard controls, pause and replay. Show Mark the running blockout and stop for review before detailed art or additional features.

Additional incidents, branching/comparison UI and save/resume/share belong to the later release proposal, not this first-playable milestone. No new features, commits or deployment without Mark's review.

- One persistent scene, nine functional nodes and exactly two crews, using only the authoritative [Storm 01 scenario](scenario.md). Start with simple blockout geometry.
- Powered, backup, isolated, faulted and repairing states with text and visual cues.
- Repair and reconnect are separate validated actions.
- Two parallel feeders restore capacity in stages: A adds 6 CU; B adds 7 CU. Total service load is 13 CU. With parallel dispatch at tick 0, depot travel plus repairs complete at minutes 4 and 8 respectively. No capacity grows merely by waiting after a repair.
- Service loads: clinic 4 CU, each housing group 3 CU, pump 2 CU, beacon 1 CU. Clinic has six simulation minutes of backup; other services have none. Follow the scenario's backup, timing and command-order rules.
- Each reconnection must fit available capacity; disconnect is an explicit way to reprioritize. Repair completion never reconnects services automatically.
- Invalid commands explain the problem without partial mutation.
- Simulation-time backup expiry and repair progress; pause freezes time progression, while explicit commands may still change state at the paused tick as defined in the scenario.
- Visible deterministic crew destination, travel and work.
- Same scenario version/seed/commands reproduce final state.
- At least one service-downtime tradeoff; no hidden unavoidable failure blamed on player.
- Reproduce the scenario's hand-calculated clinic-and-pump versus housing comparison, including per-service downtime. No aggregate safety score or implied optimal policy.
- Display accumulated downtime for each service separately from backup time remaining and grid-connection state. A clinic operating on backup has zero service downtime; only intervals without grid or backup count. A separate comparison screen is not required for the first playable.
- Full click/select and keyboard repair flow; drag/audio optional.
- Explicit restart with clear reset intent. Persistence is deferred; when added later, it must not silently erase saves and must recover safely from corrupt data.
- First release excludes blocked roads, flooding mechanics and flooding events. Authored travel routes remain traversable; weather is atmosphere only.
- Images are visual references only. Runtime service lighting, feeder indicators and event history follow actual simulation state and the current replay cursor. Future estimates must be separate from completed history.

## Kickoff interaction decisions — September 21

- Start paused. Playback speeds are 1, 10 and 30 simulation seconds per real second, explicitly labeled. A single-tick step and a paused advance-to-next-transition control allow exact decisions without reaction-time pressure.
- Hidden tabs pause immediately and never catch up hidden time; resuming is explicit. Visible long frames retain all elapsed simulation time as queued fixed ticks, processed in bounded batches without dropping ticks. New commands wait until that queue is drained. Pause freezes queued advancement without discarding it; restart intentionally resets it.
- Replay scrubs ticks from zero through the live run's latest tick, includes all accepted commands at the cursor tick in recorded order, and is read-only. Returning to live restores the untouched live state. Restart requires confirmation and discards the current in-memory run; branching remains deferred.
- Event history includes only the initial incident, accepted actions and actual transitions at or before the cursor. Rejections appear as separate accessible feedback. Backup time, connection state and per-service downtime remain outside the canvas.
- The scene uses simple procedural buildings, state-driven windows, an orthographic camera with bounded orbit/zoom/reset, selected dependency paths and crew vans on authored routes. No detailed art pass or pre-build image reuse.
- Small viewports keep the scene above a dismissible inspector; all nine nodes also have native keyboard-accessible selection controls. Reduced motion disables camera damping; no decorative weather or audio in this milestone.
- WebGL initialization/context failure leaves the complete HTML control loop usable and displays an explicit fallback notice. Rendering recovery does not reset domain state.

## Review gate feedback — September 21 (Mark)

Mark reviewed the running blockout. Verdict: it works but the process is unclear and messy (dropdown → dispatch → dropdown → dispatch → Start; crews appear to do nothing), and the whole experience must be far more detailed: visual art and atmosphere, feedback and motion, UI and narrative, then gameplay depth. These decisions supersede the kickoff interaction decisions where they conflict. The numeric scenario, command semantics and determinism rules are unchanged.

### Guided incident flow

- The screen opens on a short skippable briefing overlay (storm → blackout → "two crews, two broken feeders"), then a persistent task banner above the district states the current step. No routes; everything stays on one screen.
- Phases, driven by domain state: **Dispatch** (until both crews are assigned or any capacity exists) → **Restore** (capacity available, load below demand) → **Restored** (all five services connected). The banner text, highlighted nodes and available actions follow the phase.
- Primary interaction is direct: clicking a feeder in the scene or its card opens a contextual action popover with "Send Crew 1" / "Send Crew 2" (busy crews shown as unavailable with reason). Clicking a service reconnects it if it fits, or explains the shortfall without mutation. The inspector remains as detail/secondary controls; the node dropdown remains for keyboard/fallback but is no longer the primary path.
- **Automatic time**: the run starts paused at tick 0. Time starts automatically when both crews have been dispatched (so parallel dispatch always lands at tick 0 and the reference 04:00 / 08:00 completions hold); a player who wants to roll with one crew presses Space/Play, and the banner says so.
- One guidance slot: the task banner and decision card occupy the same fixed slot beneath the district heading (the decision card replaces the task banner while a decision is pending); the old objective subtitle is removed. Floating popovers must stay inside the scene bounds and never cover the guidance slot or the camera tools. Time **auto-pauses** at decision points: a feeder repair completing, clinic backup expiry and clinic backup below one minute (a warning pause, once). Each auto-pause shows a decision banner ("6 CU online · 13 CU demand — choose what comes back first") and a Resume control. Time also auto-pauses when all five services are connected and shows the run summary. Manual pause/resume, speed, next-event and replay remain available.
- Run summary at Restored: per-service downtime, the reconnection order chosen, clinic backup remaining, and a side-by-side with any earlier runs in the same session (in-memory only, same scenario version/seed). "Try a different order" restarts without a confirmation dialog when the run is complete; mid-run restart still confirms. No aggregate score, ranking or "optimal" language.
- The "+1 second" step control moves to the diagnostics disclosure; keyboard shortcuts: Space play/pause, N next event, R replay, 1–9 select node, Escape closes popover/overlay.

### Feedback and motion

- Crews: vans drive with headlights and beacon strobe along authored roads; on arrival a work state shows a lit work-lamp, sparks/flicker at the substation and a progress ring with remaining time above the feeder. Idle vans wait at the depot.
- Services: reconnection lights windows with a brief flicker-on (≤ 600 ms, presentation only); disconnection dims them. Clinic on backup pulses amber slowly; below one minute it pulses faster. Power lines from each substation to services are drawn dark when dead and glowing when energized and connected.
- Capacity bar in the district header fills as load is allocated; rejected actions shake the bar and speak the shortfall in the live region.
- All motion is presentation derived from domain state; reduced motion replaces flicker/strobe/sparks with instant state changes and keeps progress rings and text.

### Art and atmosphere (still procedural, no external assets)

- Sea plane with animated low-amplitude waves along the coast edge, seawall and harbor pier under the beacon; rain particles and wet-ground specular; puddles.
- More detailed procedural buildings: window grids per building with per-state emissive, rooftop details, streetlights per block that come on with their housing group, clinic generator glow.
- Sky and key light progress from storm-dark to a warm "afterlight" dawn as connected load rises 0 → 13 CU; lightning flashes only during the Dispatch phase and only without reduced motion.

### Sequencing

1. Guided flow, automatic time, direct interaction, feedback and motion. (done)
2. Art and atmosphere pass. (done — superseded by the realism pass below)
3. Realism and day/night pass (below).
4. Run summary comparison polish and narrative copy.
5. Gameplay depth (additional authored incidents per the roadmap) only after 1–4 are reviewed.

## Realism and day/night — September 21 (Mark, second review)

Mark's verdict on the atmosphere pass: still not realistic enough to win; wants real Three.js/WebGL rendering quality and a day/night situation. Direction (presentation only; the numeric scenario, commands and determinism are unchanged):

### World clock

- World time is derived from the simulation tick: **1 simulation second = 1 world minute**, so one simulated minute is one world hour. The storm hits at **19:30** (civil dusk). Consequences: Feeder A repaired at 23:30, clinic backup expiry at 01:30, Feeder B at 03:30, astronomical dawn ~05:00, sunrise ~06:30 (simulation 11:00). Night is the play space; dawn is the reward.
- The header shows world time next to simulation time ("Night · 23:30 · sim 04:00"). Replay scrubbing moves the sky with the cursor. Everything sky-related is a pure function of tick (plus smoothing), never of wall-clock time.
- After all services are restored the summary offers **"Watch the sun come up"**: it simply resumes simulation time at 30× until world 06:30 (simulation 11:00) and then pauses. No downtime accrues; nothing in the domain changes.

### Rendering

- **Camera**: perspective, FOV 26–30°, elevated three-quarter view, bounded orbit/zoom/reset kept. Idle: a very slow drift (≤1.5° over ~20 s). Selecting a node eases the target toward it slightly. Reduced motion: static.
- **Sky and light**: physically based sky (three/examples `Sky`) with sun elevation/azimuth from world time; PMREM environment regenerated from that sky only when world time crosses a 20-world-minute bucket (never per frame). Night: star field, moon sprite with a cool directional "moonlight" key, deep blue ambient; exposure follows time of day. Weather layer: drifting cloud plane with procedural alpha; cloud cover and rain density fall as connected load rises (storm clears as the district recovers); lightning flashes light the clouds — dispatch phase only, deterministic timing from tick, none under reduced motion.
- **Water**: real planar reflection (three/examples `Water` or `Reflector`, ≤512 px texture, distortion + normal ripple from a canvas-generated normal map). Lit windows and the beacon must be visible in the reflection at night.
- **Materials**: PBR with procedurally generated canvas textures and normal maps — asphalt with lane markings and cracks, concrete, brick, corrugated metal and roof gravel, painted metal for vans and substations. Wet-surface roughness map animates subtly with rain. Windows are individual instanced quads with per-window deterministic on/off variation and warm/cool colour temperature when powered; a block lights up staggered over ~1.5 s (instant under reduced motion). Emissive intensities are tuned for bloom.
- **Lights**: sun/moon directional with fitted shadow camera (2048 map, PCFSoft); van headlights as spotlights only while moving; streetlights and windows emissive + additive light cones at night; work lamp point light at active substations; beacon rotating additive beam with soft edges.
- **Post-processing**: `EffectComposer` with subtle `UnrealBloomPass` (strength ≈ 0.35, threshold ≈ 0.85, radius ≈ 0.4) for night glow, `SMAAPass`, and a light vignette. No excessive bloom; daylight bloom near zero.
- **Cinematic beats (presentation, tick stays 0)**: pressing **Begin** plays a ≤4 s sequence: district alive at dusk → lightning → rolling blackout block by block → clinic generator kicks in amber → task banner appears. Skippable; reduced motion shows the final frame. On restoration the camera performs a slow pull-back.
- **Quality scaling**: DPR cap 1.5; if p95 frame time exceeds 22 ms for 3 s, disable bloom, then reflections, then lower DPR to 1 — announced in diagnostics, never silently changing state. Weak/absent WebGL2 keeps the HTML control loop usable exactly as before.
### Vehicles (Mark, third review — "update the vehicles")

- The two crews are **utility bucket trucks**, not boxes: chassis with wheel wells, six wheels (rims, tyres, rotating while moving), cab with tinted glass and mirrors, crew box with roll-up doors and ladder rack, amber light bar, reflective chevrons on the rear, headlights/tail lights as emissive plus the existing spotlights, a boom with a bucket folded on the roof while driving. Crew 1 is pale cream with an amber stripe; Crew 2 is muted teal with the same stripe — colours differ, silhouettes match.
- **Working state** at a substation: the truck parks beside the yard, outriggers extend, the boom rises and swings so the bucket sits over the transformer, work lamp on, amber strobe on. Boom animation is presentation eased from the crew's repair progress (arrive → 10 % of repair = fully raised; last 5 % = fold down), instant under reduced motion. When the crew is idle at the depot the truck is parked inside/at the garage, dark.
- Motion: wheels roll with distance travelled; body has a subtle suspension bob and lean into turns along the authored route (none under reduced motion). Headlights on while moving at night; tail lights on whenever moving.
- Set dressing: 5–7 parked civilian cars (two body types, muted colours, static, no lights) along kerbs, and one small delivery boat at the pier. They are decoration, not nodes.
- Everything stays procedural and dependency-free (three's bundled examples are allowed). Reduced motion removes drift, flicker, rain, lightning, wave motion and stagger, but the day/night state, lit windows and reflections remain.
