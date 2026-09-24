# AFTERLIGHT

A storm knocks out a miniature coastal district. With two repair crews and not enough power for everyone, you decide what comes back first — then watch the neighborhood light up.

**▶ Play: [fenner888.github.io/afterlight](https://fenner888.github.io/afterlight/)** (desktop Chrome, Edge, Safari or Firefox; sound on)

A one-screen systems puzzle for [Hackyard Yard #3](https://hackyard.tech/yards/yard-3), theme **"One Screen."** It is a browser game, and everything happens on a single diorama and panel. There are no accounts, no backend and no install.

> Fictional game units and simplified rules. Not electrical engineering or emergency advice.

## How to play

1. **Pick a storm.** Each incident is a single night in the same district.
2. **Send your crews.** Click a broken feeder (substation) on the map and send a crew. Time starts on your first dispatch.
3. **Decide who gets power.** When a feeder comes back, the game pauses and there usually isn't enough for everyone. Click dark buildings to reconnect them; the capacity bar shows what fits. Repairs never reconnect anything automatically, so the choice is always yours.
4. **Watch the consequences.** Windows, streetlights, the pump and the harbor beacon follow the real simulated state. The clinic runs on a generator with limited fuel.
5. **Compare.** The run summary shows how long each service was dark, with your last three runs side by side. There is deliberately no score, only tradeoffs.

| Storm | Starts | What it's about |
|---|---|---|
| 01 · After the storm | 19:30 dusk | The first 6 units: the clinic and pump, or both housing blocks? |
| 02 · Crew Short | 16:30 afternoon | One crew now and one back at 18:30. Quick fix first, or slow fix first? |
| 03 · The Long Dark | 23:00 night | 4 units, a generator that dies at 04:00, and a swap you have to time. |

**Controls**

| Action | Mouse, trackpad or touch | Keyboard |
|---|---|---|
| Orbit | drag | ← → rotate, ↑ ↓ tilt |
| Zoom (toward the cursor) | wheel or pinch | + − |
| Pan | right-drag or Shift-drag | — |
| Focus on a spot | double-click | — |
| Reset the view | "Reset view" button | 0 |
| Time | — | Space: play/pause · N: next event · R: replay |
| Select a node | — | 1–9 |
| Sound | header toggle | M |

Every action is also available through native HTML controls: the district selector, the service strip and the inspector. Keyboard-only play, reduced motion and a no-WebGL fallback are all supported.

## What's under the hood

- **Deterministic simulation.** A pure TypeScript domain (`src/domain.ts`) runs on integer ticks. One tick is one simulated second, which is one world minute. Commands are validated and recorded, and replay rebuilds any moment from the command log. Frame rate can never change an outcome.
- **Hand-calculated scenarios.** Every storm's reference runs were worked out by hand before any code ([Storm 01](specs/first-playable/scenario.md), [Storms 02–03](specs/first-playable/incidents.md)). The test suite asserts each run's exact per-service downtimes.
- **Three.js diorama, all procedural.** There are no model or texture files. Materials, stone, brick, asphalt, water normals, sky, clouds and rain are generated in code. The scene also has planar water reflections, a day/night cycle driven by the world clock, bloom and automatic quality scaling.
- **Traffic.** The utility trucks follow authored lanes and yield to each other. That logic is a pure module whose tests simulate every dispatch order and delay.
- **Procedural sound.** Rain, wind, generator hum, trucks, relays and a sunrise swell are all synthesized with Web Audio, with no audio files.
- **Small footprint.** The only runtime dependency is `three`. Versions are pinned exactly and locked.

## Simplifications (on purpose)

Loads are all-or-nothing and there are no line losses or surges. There is one shared district bus, and crews can't be cancelled once dispatched. Travel times are fixed. Flooding, blocked roads and random failures are out of scope. This is a puzzle about priorities, not a power-flow model.

## Run locally

Requires Node ≥ 22.18 and npm.

```sh
npm ci --ignore-scripts
npm run dev -- --port 5173 --strictPort   # http://127.0.0.1:5173
```

Checks:

```sh
npm test               # domain, scenario, replay, clock and traffic tests (Node test runner)
npm run build          # strict typecheck + production build
npm run test:browser   # Playwright against a production preview (installed Chrome)
npm run test:cross     # smoke subset on Playwright WebKit and Firefox
npm audit
```

Validation results and known gaps: [validation.md](specs/first-playable/validation.md).

## Project docs

[Design brief](DESIGN.md) · [Requirements](specs/first-playable/requirements.md) · [Roadmap](specs/roadmap.md) · [Tech stack](specs/tech-stack.md)

All code and every rendered asset were produced during the Yard #3 build window (September 21–25, 2026); the specs record the design decisions as they were made.

## License

[MIT](LICENSE)
