# Yard #3: competitive review and concept directions

Reviewed September 19, 2026. Planning only. No project code, registration, submission, deployment, or model requests.

Planning refinement, September 19: AFTERLIGHT's numeric source of truth is now [Storm 01](../specs/first-playable/scenario.md). The first repair supplies limited capacity; the second increases it. Blocked roads and flooding are excluded from the entire first release. Original concept images are visual references only; state controls runtime lighting and event history. The other concept directions below remain historical alternatives.

## Evidence boundary

Read every one of the 11 submission detail pages listed for Yard #2. Inspected the current Splat Lab landing page and Bonfire live interface, including Bonfire's expanded controls. Read the public Bonfire and Elsehow repository descriptions and consulted the Underclass repository page. This was a concept/presentation review, not a code audit or an end-to-end test of all projects. Demo videos were not watched in full. Splat Lab's repository returned 404 through the web reader, and the live Underclass page timed out. Neither result establishes that the project is permanently unavailable. Current live apps may include post-competition changes.

Sources: [Yard #2](https://hackyard.tech/yards/yard-2), [Yard #3](https://hackyard.tech/yards/yard-3), [general rules](https://hackyard.tech/faq).

## All Yard #2 submissions

Capabilities below describe the submitted project claims unless explicitly identified as observed. Votes were visible at review time and are not a technical quality score.

| Entry | Votes | Concept | My design takeaway |
|---|---:|---|---|
| [Splat Lab](https://hackyard.tech/yards/yard-2/bf2620b3-7587-49f7-9b10-092066c283ef) | 7 | Child-friendly game creation with live previews. | A specific audience, recognizable identity and a tangible creation outcome. Current landing page has a cohesive illustrated world. |
| [Bonfire](https://hackyard.tech/yards/yard-2/20c6de04-8025-44ca-b398-b8cfca367e93) | 4 | Interactive Three.js fire, tending, fuel and environments. | Immediate atmosphere plus optional depth. Observed controls for fuel, burn speed, camera, poking stick and per-piece lifecycle. |
| [Construction job-cost ledger](https://hackyard.tech/yards/yard-2/10954e60-f8e2-4b87-9528-e64a034962ba) | 3 | Budgets, draws and change orders separated by building project. | Domain-specific usefulness can compete with spectacle. |
| [Dark Relic](https://hackyard.tech/yards/yard-2/0598f93f-a3db-4c83-b3fe-4f7dbb238446) | 2 | Third-person extraction game with a compact encounter. | Stakes and a complete gameplay loop; a Windows build adds trial friction. |
| [Elsehow](https://hackyard.tech/yards/yard-2/c29c4861-2eb2-49e0-9abb-8ab91ed9d947) | 1 | Image-to-spatial-sound instrument with inspectable mappings. | Surprising transformation, immediate specimen and explicit limits. |
| [Riff Lab](https://hackyard.tech/yards/yard-2/491dd86d-b8e7-487d-8b97-aa666610e603) | 1 | Guitar playing to notes, tab and rhythm. | Strong musician use case; transcription accuracy is a substantial validation burden. |
| [Chirrp](https://hackyard.tech/yards/yard-2/81cee074-b901-4e3d-959d-b6261437dd3b) | 0 | Procedural sound effects for games and websites. | Reusable output beyond the event; a library needs an excellent hands-on playground. |
| [GTFO Info](https://hackyard.tech/yards/yard-2/3147d75f-0dc9-40ce-b8d4-44ae85669207) | 0 | Data-broker discovery and opt-out service. | Clear pain point, but sensitive inputs, external dependencies and trust make casual demos harder. Claims were not independently validated. |
| [BIPU Quai wallet explainer](https://hackyard.tech/yards/yard-2/86b27b30-c06e-41ad-b470-39cc7d948c59) | 0 | Educational crypto browser extension, with wallet ambitions. | Explainable interactions have value; installation and niche terminology add friction. |
| [Orgaut](https://hackyard.tech/yards/yard-2/7fc4c3fa-4cc9-430b-a6b4-19fe8dd1ac92) | 0 | Local file organization with a small classifier. | Concrete time-saving loop; moving real files requires trust and recoverability. |
| [Underclass](https://hackyard.tech/yards/yard-2/b3e58e31-9948-43f0-b51a-7c7d46a58ebb) | 0 | AI user-awareness experiment presented as a public office. | A research question can become a place and an interaction, not merely a results table. Model-based judgments still require qualification. |

The displayed votes sum to 18. That is too little evidence to infer reliable audience preferences or explain why one project beat another. The concepts themselves are more useful competitive evidence.

## Design criteria for our entry

- The first useful interaction should work without login, keys, downloads or private uploads.
- The whole experience should remain in one persistent scene. Panels explain the scene rather than replace it.
- Every major interaction should have visible consequences and support undo or replay.
- The visitor should understand the premise within seconds and discover additional depth through play.
- Use sound optionally, with mute and reduced-motion support. Do not require sound, color perception or precision dragging.
- Make a smaller system believable through causality, detail and responsive controls rather than filling it with disconnected features.
- Retain value after the first visual surprise through challenges, experimentation, saving and sharing.

## Direction 1 — AFTERLIGHT (working title, recommended)

### Premise

A miniature coastal district sits on a physical-looking emergency operations table. A storm disrupts its power network. Keep essential services operating while restoring the district with limited crews and backup capacity.

It is a fictional resilience sandbox, not an operational emergency planning or electrical engineering tool. The simulation's simplifying assumptions are visible.

### What the visitor does

1. Open directly into a working district: warm windows, harbor lights, moving service vehicles and weather over the model.
2. Start an authored incident. A feeder goes down and affected buildings dim. Clicking a building shows its dependencies and backup time.
3. Select a crew and its repair target; choose which loads to reconnect. Dragging is optional, with click/select and keyboard equivalents.
4. Watch crews physically travel and repairs change the scene. Restoring one service can create a new capacity constraint elsewhere.
5. Pause and scrub the recorded run, branch from a decision, and compare outcomes under the same scenario seed.

### The memorable moment

The player repairs the first feeder, then explicitly reconnects the clinic. Its windows and equipment indicators return. The first feeder provides only 6 CU against 13 CU of total demand, so the player must prioritize services. The second feeder repair adds 7 CU; explicit reconnection of the remaining services then completes recovery. Waiting alone does not remove the capacity constraint.

### Interaction and visual detail

- Tilt-shift or orthographic Three.js tabletop, restrained camera movement, tactile switches and printed map labels.
- Dependency overlay draws only relevant connections when a building is selected.
- Distinct states for powered, backup, isolated and failed; shape/text indicators accompany color.
- Animated repair vans and work lights show actual travel and repair state; rain provides atmosphere. Authored roads remain traversable. Blocked roads and flooding are outside the first release.
- One thin event strip records actions. An inspector stays beside the city. No routed pages or setup wizard.
- Normal, pause and accelerated time; actions log their exact simulation time.
- Optional restrained ambience, radio tones and repair-completion cues. No need for AI voices.

### Why someone returns

Different starting faults, alternate priorities, a shared challenge seed and a readable after-action replay. After the competition, this could expand into an educational resilience game or facilitated training exercise, subject to expert validation before professional claims.

### Model/harness role

AI is optional at runtime. The core experience must work without API latency. A later model-assisted debrief could explain the recorded actions, with references to specific events. A model must not invent hidden causes, alter scores or decide the simulation's physics. A future scenario authoring tool would emit validated configurations into fixed mechanics.

### Build-week boundary

One district, roughly 8–10 functional nodes, two repair crews, one primary utility network, three authored incidents, deterministic state transitions, undo/replay, local save and a URL-encoded challenge seed. Clip generation, multiplayer, live infrastructure data, open-ended agents and general-purpose city construction are outside the first release.

Tests should cover capacity conservation, dependency transitions, legal actions, pause/resume, seed reproducibility, replay fidelity, restoration/undo, keyboard operation and reduced-motion behavior. Set a measurable performance budget on Mark's actual test hardware before selecting effects.

### Risk

Three simultaneous hard problems: simulation, interaction design and 3D presentation. The core city must be playable with simple blocks before detailed art begins. If the restoration decisions are dull, visual polish will not rescue it.

## Direction 2 — CHAIN REACTION (working title)

A tactile kinetic workshop for building tiny cause-and-effect machines on one workbench. Place ramps, balls, hinged levers, switches and gates. Release a ball, inspect the failure, rewind and adjust until it rings a bell or reaches a target.

Distinctive interactions: slow motion, force/contact overlay, ghost replay of the previous attempt, adjustable friction and constrained build challenges. Save a machine as a shareable configuration and challenge a friend to solve it with one fewer part.

Visual direction: machined aluminum, translucent acrylic, cork surfaces and warm workshop light. Motion and satisfying contact sounds are central. The camera stays on the same workbench.

Useful beyond a demo: browser puzzle toy, introductory mechanics experiments and user-created challenges. Treat it as an illustrative simulation, not a precision physics instrument.

Week scope: a largely 2D constrained physics plane presented in 3D, six object types, three challenges and editable free play. A full arbitrary 3D physics editor is out of scope. Main risks: collision stability, touch manipulation, and too much onboarding. This is the strongest alternative if playful invention matters more than operational decision-making.

## Direction 3 — PAPER WEATHER (working title)

A living paper landscape where the visitor shapes a catchment and experiments with rain. Raise a hill, lower a channel, place a porous patch or barrier, then watch water paths and accumulation respond. Compare two designs against the same storm.

Distinctive interactions: sculpt with a brush, pause a storm, inspect a water path, scrub rainfall intensity, and replay a before/after comparison directly on the terrain. The paper layers and inked contour lines make it feel like an interactive museum exhibit.

Useful beyond a demo: a creative geography learning tool with shareable terrain puzzles. This must clearly distinguish a simplified grid-based runoff model from real flood prediction.

Week scope: one small heightfield, basic water accounting, three edit tools, a few challenges and a comparison view. No real addresses, flood-risk advice, erosion engine or fluid-dynamics accuracy claims. Main risk: believable water behavior and performance. It is the most visually unusual option but has greater scientific communication risk.

## Recommendation and decision gate

AFTERLIGHT has the strongest combination of a visible story, meaningful decisions, replay and a connection to Mark's systems/security interests without repeating the fly, news desk or model-evaluation viewer. CHAIN REACTION is the stronger pick for broad playful appeal. PAPER WEATHER is the stronger pick for an art/science exhibit.

These are proposed directions, not globally novel inventions and not predictions of winning. Before selecting one, make the choice on the interaction someone will want to repeat, not the number of listed features.

Planning can happen now. Yard #3 requires the entrant's project code to be written during September 21 at 18:00 UTC through September 25 at 18:00 UTC. Scrolling, overlays and in-screen panels are allowed; separate routes and progressive wizard flows are not. Do not start implementation ahead of that window.
