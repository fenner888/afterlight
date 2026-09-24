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
- **Automatic time**: the run starts paused at tick 0. Time starts on the **first** dispatch (Mark's approved rule; September 23 fix — waiting for the second crew left Crew 1 visibly stuck at the depot). If a crew and a faulted feeder remain, that feeder's popover opens immediately with the idle crew's Send button focused. The second dispatch therefore lands a few ticks later than 0, so Feeder B's completion shifts slightly; all ETAs and decision copy are computed from state. The hand-calculated reference runs in scenario.md (parallel dispatch at tick 0) remain the domain-test fixtures.
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
- After all services are restored the summary offers **"Watch the sun come up"**: it simply resumes simulation time at 30× until world 06:30 (simulation 11:00) and then pauses. No downtime accrues; nothing in the domain changes. The "Fully restored" row and the task banner always quote the tick of the final reconnection, not the current clock — after dawn the banner reads "Every light came back on at … — the sun is up" and the sunrise button is no longer offered.

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

## Clarity, sound and art — September 23 (Mark, fourth review)

Mark approved three passes for September 23 (clarity, sound, art), then Storms 02/03 with a comparison summary for September 24. Domain rules, numbers, commands and determinism are unchanged by all three passes.

### Clarity

Problem found in review: a first-time player sees two clocks, a scene squeezed into ~35 % of the viewport, and a dilemma that is only implied.

- **One clock.** The player only ever sees world time. Absolute moments use the world clock (`23:30`); durations use hours/minutes (`3h 00m`, `1h 50m`) via a `formatDuration(ticks)` helper (1 tick = 1 world minute). This applies to the header, task banner, decision cards, popovers, inspector readings, service strip, crew list, progress rings, event log, replay scrubber (`19:30 / 21:30`), run summary and ARIA text. Simulation `mm:ss` is shown only inside Diagnostics. Speed options read **Slow / Normal / Fast** (values 1 / 10 / 30 unchanged). Supersedes "world time next to simulation time" above.
- **Layout (1440×900).** Header ≤ 56 px holding brand, incident, status tag, phase + world clock, sound toggle, Restart. The scene fills the left column and is **≥ 60 % of viewport height**; the inspector stays on the right (~320 px). The "Bring the neighborhood back." heading row is removed. Task banner and decision card become an overlay at the scene's top-left; the capacity readout becomes a compact overlay at the scene's top-right. Service strip becomes one compact row (≤ 56 px) directly below the scene. Transport + scrubber become one row (≤ 56 px). The full event list moves into the inspector as a scrollable **Event log** section below crews (same `#events` list). Popover must not be covered by the overlays. At 390 px: scene first at ≥ 45 vh, strip and transport follow, inspector below; no horizontal overflow.
- **Remove dev chrome**: "STORM 01 / PROCEDURAL DIORAMA" scene note (keep N ↑), "FIRST PLAYABLE · V0.1", "Blockout" wording (Diagnostics stays, renamed "Diagnostics"), "There are no saved runs in this blockout." → "There are no saved runs."
- **Say the stakes.** Briefing (title "Storm 01 — After the storm"):
  1. "19:30. A storm has knocked out both feeders into the harbor district. Every building is dark."
  2. "The clinic is on its generator — 6 hours of fuel, until about 01:30. Nothing else has backup."
  3. "Two crews wait at the depot. Feeder A is the quick fix (3h, 6 of the 13 units the district needs). Feeder B is slow (7h, the other 7)."
  4. "When power returns there won't be enough for everyone. You decide who gets it first."
- Task banner (values computed from state, never hard-coded):
  - No crews out: "Send both crews — click a broken feeder on the map."
  - One crew out: "{Crew} is rolling to {Feeder}. Send {idle crew} to {faulted feeder} — the longer it waits, the later that repair finishes."
  - Waiting at 0 CU: "Crews working. {Feeder} due {hh:mm} · {Feeder} due {hh:mm}." plus " Clinic generator until {hh:mm}." while the clinic is on backup.
  - Capacity online: "{free} of {online} units free. Click a dark building to reconnect it." plus the clinic generator clause when relevant.
  - Restored: "Every light is back on at {hh:mm}. Watch the sun come up, or review your run."
- Decision cards:
  - A feeder repaired while demand still exceeds capacity: title "{Feeder} is back — {online} units online"; text "Not enough for everyone ({demand} needed)." + (clinic on backup) " The clinic generator runs out at {hh:mm}" + (other feeder repairing) "; {Feeder} isn't due until {hh:mm}" + ". Click buildings to reconnect, then Resume."
  - A feeder repaired with capacity for all remaining load: "{Feeder} is back — {online} units online" / "Enough for everyone. Reconnect every building still dark."
  - Backup warning (one world hour left): "Clinic generator: 1h of fuel left" / "At {hh:mm} the clinic goes dark unless it's reconnected." + (free < 4) " Disconnect another building to free 4 units, or let it go."
  - Backup exhausted: "The clinic has gone dark" / "It stays dark until you reconnect it — 4 units."
  - Dawn: unchanged.
- Service flavor line shown first in inspector and popover (fiction only, no mechanics): Clinic "Overnight ward — the district's only generator."; Housing A "The west apartment block."; Housing B "The east apartment block above the harbor shops."; Pumping station "Water pressure for the hill streets."; Harbor beacon "Guides the fishing boats home." Existing mechanical descriptions follow, rewritten to durations in hours ("Six hours of reserve…").
- Run summary adds one factual outcome line before the table: "The clinic never lost power." or "The clinic was dark for {duration}." followed by "Homes were dark for up to {max housing downtime}." No score, no verdict.

### Sound

- Procedural Web Audio only (`AudioContext`, oscillators, filtered noise buffers, gain envelopes, one `DynamicsCompressor` limiter on the master). No audio files, no packages. Lives in `src/audio.ts`; it reads state/events and scene cues and never feeds back into the domain.
- The context is created/resumed by the **Begin** (or Skip) click; sound is **on by default** after that gesture. Header toggle button "Sound on/off" (`aria-pressed`) and the `M` key mute/unmute with a short fade. Hidden tab suspends the context; returning resumes it only if unmuted. No persistence of the preference in this milestone. WebGL failure does not disable sound.
- Master level conservative (peak ≲ −6 dBFS after the limiter); ambience sits well under event cues.
- Beds (continuous, crossfaded ≥ 1 s): rain (band-limited noise, level follows the scene's rain density), sea swell (low noise with slow gain LFO), wind (bandpassed noise, slow filter sweep, fades as the storm clears), clinic generator (low pulsed drone) while the clinic is on backup, faint transformer hum per repaired feeder.
- Cues: thunder rumble a short delay after each lightning flash (driven by the same deterministic lightning timing); truck engine drone while any crew travels, with a hydraulic whine as the boom raises; intermittent electrical crackle while repairing; feeder repaired = heavy relay clunk + hum swell; reconnect = relay click + a soft pitched chime per service; disconnect = descending click; rejected action = short dull buzz; backup warning = two soft alert tones; generator stop = sputter-out; decision pause = one quiet tone; sunrise = slow warm pad swell while rain/wind fade out.
- Replay: beds follow the replay cursor state; one-shot cues are silent while scrubbing/reviewing. Restart stops everything and re-arms. Reduced motion does not mute; it removes the lightning/thunder pairing only because lightning is already disabled.

### Traffic awareness (Mark, September 23 — "it drives right through the other car")

Cause: Crew 1's depot exit ran diagonally through Crew 2's parked bay, and both trucks shared one lane at different speeds (fixed 1 h travel regardless of route length). Presentation only — domain arrival ticks are unchanged.

- **Depot**: trucks wait nose-out (facing the apron) at the two garage doors, ready to roll. Each exits forward onto an apron lane that passes clear of the other bay, then joins the depot access road. No authored route may cross a parked truck's footprint or a parked civilian car.
- **Lanes**: on shared roads trucks keep to a lane by destination — Feeder A–bound on the west lane of the depot access road and the north (westbound) lane of the main road; Feeder B–bound on the east lane and the south (eastbound) lane. Lane offsets stay inside the asphalt.
- **Yielding**: each truck's shown position trails its schedule position along its route, moving at up to 1.6× its nominal speed. A truck holds whenever its next pose would overlap another moving truck's footprint (length + clearance margin). The truck that departed earlier has right of way; on a tie, the lower crew number goes first. A truck that is still catching up on arrival finishes the drive before its boom rises. In replay, after a time jump (Next event, scrubbing) or under reduced motion, trucks snap to their schedule pose.
- The route and yield logic is a pure module with no three.js import, so the Node test suite can simulate every dispatch order and delay and assert that no footprints ever overlap.

### Camera control (Mark, September 23 — "rotate and zoom better")

Before this change: azimuth was limited to ±35° around the default, polar angle to 32–81°, and distance to 0.55–1.7× the fitted distance. Pan was disabled, zoom always targeted the district centre, clicking a rotate button jumped 8.6° with no easing, and the idle drift plus selection easing fought user input. Supersedes the "bounded orbit/zoom" and "idle drift" notes under Rendering.

- **Orbit**: full 360° azimuth. Polar angle 12°–84° (near top-down to low harbour level). At close range the maximum polar angle tightens smoothly to 62°, so the camera can't sink into buildings.
- **Zoom**: 0.22× to 1.8× the fitted distance. Mouse wheel and trackpad pinch zoom **toward the cursor** (OrbitControls `zoomToCursor`).
- **Pan**: right-drag, Shift+drag, or a two-finger drag. The target is clamped to the platform (|x| ≤ 11, |z| ≤ 8.5) and its height stays fixed.
- **Focus**: double-clicking a point on the district eases the target to that point and closes in to about 0.45× the fitted distance.
- **Buttons**: rotate ±30°, tilt up/down 10°, zoom in/out 20%, and Reset view. All ease over about 350 ms; reduced motion makes each step instant.
- **Keys**: ←/→ rotate, ↑/↓ tilt, +/= and − zoom, 0 resets the view. All are ignored while typing in inputs or selects, and while a dialog is open. List them in the keys hint and Diagnostics.
- **No fighting the player**: any user camera input cancels in-flight camera animations. Idle drift runs only after 20 s without camera input, never while a popover is open, and never under reduced motion. Selecting a node no longer moves the camera. The restoration pull-back is skipped if the player moved the camera in the previous 10 s.
- Markers, the popover, ring labels and raycast picking follow the camera from every allowed angle.

### Storms 02/03, incident picker and run comparison (approved September 23)

Numbers and copy: [incidents.md](incidents.md).

- **Scenario configs.** `src/scenario.ts` exports `SCENARIOS: Record<ScenarioId, ScenarioConfig>` with id, version, seed, title, subtitle, pickerLine, briefing[], incidentText, worldStart (minutes), per-service backup, per-feeder capacity/repairTicks, and per-crew `returnAt` (0 = at the depot). Labels, loads, flavor, travel times and positions stay shared. `validateScenario(config)` checks every config at load.
- **Domain.** `initialState(id = 'storm-01')`. `State.scenario` selects the config. Every domain function reads the config from the state, never from a module-level "current scenario". Adding the away-crew phase is the only mechanic change. `replay(commands, cursor, id)`. Storm 01's reference runs and outcomes are unchanged.
- **World clock.** World time, day phase and sunrise tick take the scenario's worldStart. The presentation passes the active config; no hidden global. The 660 sunrise literal is replaced by `sunriseTick(config)`.
- **Picker.** The briefing dialog opens on the picker: three cards (title, subtitle, pickerLine). Choosing one shows that storm's briefing, then Begin/Skip. A header "Incidents" button reopens the picker. Choosing a different storm, or re-choosing one mid-run, asks for the same confirmation as Restart. The header incident label shows "INCIDENT 0N" and the title. Restart restarts the current storm.
- **Away crew in the scene.** While away, that truck isn't in the district. It drives in from the east end of the main road (westbound lane) over the 30 ticks before returnAt, down the access road, and reverses into its nose-out bay, arriving exactly at returnAt. Traffic yield rules apply. Cover it in the traffic tests (returning truck vs a departing Crew 1 at all dispatch ticks 0–119).
- **Run comparison.** Completed runs are kept in memory per storm for the session (no persistence): the latest three. The summary shows them as columns (Run 1/2/3) with per-service downtime, fully-restored world time and reconnection order. No score, no winner highlight, no colour-only difference. "Try a different order" restarts the same storm. The summary also offers "Try another storm", which opens the picker; picking a storm from a completed run switches directly without the restart confirmation (the run is already archived), while a mid-run pick still confirms.
- **Audio.** Crew return plays the `decision` cue. No new cues.

### Release polish (September 24)

- **Sunrise payoff.** After full restoration, the 06:30 dawn frame must read as a clear early morning, not a dim night:
  - Sky visibly brighter than night, with a warm horizon glow.
  - Sun disc visible above the distant shoreline.
  - Clouds at 25% coverage or less.
  - Rain off.
  - Exposure ramps up smoothly over the "Watch the sun come up" run.
  - Storm 02's 16:30 daylight still reads as an overcast squall while the district is unrestored.
  - Night looks are unchanged.
- **Phone action card.** At a viewport width of 600 px or less, the node popover docks as a bottom sheet inside the scene: full scene width, pinned to the scene's bottom edge, with the same content and focus behaviour. It never covers the service strip or transport row, and the scene is not reflowed.
- **Cross-browser.** The Playwright config gains `webkit` and `firefox` projects, and `npm run test:browser` stays Chrome-only by default. Tag a smoke subset `@smoke`: picker and Begin, dispatch both crews, a reconnect, the WebGL-or-fallback check, and the keyboard flow. `npm run test:cross` runs that subset on WebKit and Firefox. If WebGL is unavailable in a headless engine, the HTML fallback must still complete the smoke flow. Record the results and remaining gaps in validation.md.

### Art (buildings, trees, quay, boat, cars)

- Buildings: parapet/cornice caps, stepped massing, framed windows (inset with sill and lintel, instanced), ground-floor entrances with doors and awnings/canopies, drainpipes, rooftop clutter (HVAC boxes, vents, water tank on housing, antenna). Clinic: entrance canopy with a lit cross sign and a visible generator unit with exhaust stack. Pumping station: pipework and a tank. Lighthouse: gallery railing and glazed lantern room. A distant fog-faded shoreline with a few lit windows across the water (decoration, not nodes), which also softens the horizon band.
- Trees: clustered foliage (3–5 lumps with colour variation) on trunks, instanced; no single cones.
- Quay: the platform reads as a stone seawall standing in the water — coursed stone faces that continue below the waterline, capstone lip, darker waterline band, timber pilings under the pier, ladders, tyre fenders, riprap at one corner. No floating-slab edge.
- Boats: shaped hulls (pointed bow, sheer line, rub rail), wheelhouse with windows, mast with a small light, mooring lines to bollards, gentle bob (none under reduced motion).
- Cars: two body types (sedan, hatchback) with shaped profiles, glass, wheels, wet sheen; static, unlit.
- Budget at 1440×900 restored night: ≤ 1,150 draw calls, p95 frame ≤ 17.5 ms on the M4; use `InstancedMesh`/`BufferGeometryUtils.mergeGeometries` from three's bundled examples. Dispose everything on teardown.
