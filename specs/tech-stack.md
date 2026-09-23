# Technical plan

September 21, 2026 kickoff: first playable authorized within the build window. Packages must pass registry, repository, age and download-history checks before installation.

## First-playable stack

Vanilla strict TypeScript 5.9.3, Three.js 0.186.0, @types/three 0.186.0 and Vite 8.3.0; native accessible HTML/CSS UI. Node's built-in test runner tests the pure TypeScript domain; @playwright/test 1.63.0 covers browser behavior. Pin direct dependencies exactly and lock transitive dependencies published before September 14, 2026. Development server binds to loopback only. No React or UI framework is needed for this milestone.
System font fallbacks and procedural geometry only; no external runtime assets, audio, storage, URLs containing game state, backend, database, auth, payments, analytics or inference. Data classification: fictional service states only, no PII, health records, payments, uploads or minor-specific data. No environment secrets required. Static hosting and versioned saves remain later, approval-gated work.

## Deterministic architecture

Pure simulation owns state. Validated commands carry simulation tick and stable order; Storm 01 has no random draws and stores scenario version 1 and a fixed seed. Fixed simulation steps, interpolated crew presentation. Never silently clamp elapsed time and change outcomes. Hidden tabs pause with no hidden-time catch-up and require explicit resume; visible long frames queue all elapsed fixed ticks and process bounded batches. Commands cannot overtake queued time. The first-playable requirements define pause, stepping and read-only replay semantics.
Renderer does not decide completion, capacity or repair durations. Vans visualize domain travel progress. Service lights and event history derive from actual domain state and the current replay cursor, never image contents or illustrative timestamps. First-playable replay reconstructs from the initial scenario and accepted command log, preserving the untouched live state. Snapshots, branching and persistence are deferred; future replay must not duplicate sound/persistence effects.
Scenario validation, domain transitions/commands, clock, history, renderer and UI are separate modules. Persistence will be a separate module only after review.

## Performance and validation

Use the locked planning units, timing/order rules and hand-calculated [Storm 01 reference](first-playable/scenario.md) before code; update that spec first if the design changes. Bound imported data size, versions, fields and numbers; malformed input returns safely to a valid scenario.
Targets remain 60 fps on Mark's primary desktop at 1440×900 and usable 30 fps on a selected phone at reduced quality. The validation document records a preliminary headless M4/Chrome sample, not real-phone validation. Provisional blockout budgets: at most 400 renderer-reported draw calls and 10,000 triangles, one 1024×1024 shadow map and pixel ratio capped at 1.5. Recheck budgets with real-device evidence before detailed art. Report p50/p95 and long gaps, not just averages. Low frame rate cannot change replay results.

## Alternatives

Unreal rejected for this browser-first compact entry. Blender optional for build-week assets. Runtime AI deferred; any future debrief must cite real logged events and pass a separate evaluation suite.

## Security gate

No backend means route auth/payment matrices currently N/A, not passed tests. Still audit dependencies/licenses, scan secrets, constrain imports, inspect generated code and test unavailable-storage/WebGL failures before release.
