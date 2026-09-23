# AFTERLIGHT

A storm knocks out a miniature coastal district. With two repair crews and limited backup power, bring essential services back online—then watch the neighborhood light up.

**Status: Storm 01 first-playable blockout implemented September 21, 2026. Awaiting human gameplay review before detailed art or additional features. Not released.**

Prepared for Hackyard Yard #3, “One Screen.” The live lineup lists @fenner888 as checked in. Build window: September 21–25, 2026, opening and closing at 18:00 UTC / 2 PM Eastern. Event page and FAQ reverified at kickoff.

## Start here

- [Design direction](DESIGN.md): scene, interaction and reference images.
- [Mission](specs/mission.md), [technical plan](specs/tech-stack.md), [roadmap](specs/roadmap.md).
- [First playable](specs/first-playable/plan.md): prove the decisions with a blockout before art.
- [Staged capacity scenario](specs/first-playable/scenario.md): service loads, feeder repairs and a hand-calculated priority comparison.
- [Dedicated task handoff](HANDOFF.md).
- [Competition/concept research](references/concept-review.md): prior evidence and limits.

## Run locally

Node >=22.18 and npm. Install the verified lockfile with `npm ci --ignore-scripts`, then `npm run dev -- --port 5173 --strictPort`. The development server is loopback-only.

Checks: `npm test`, `npm run build`, `npm run test:browser` (installed Chrome required), and `npm audit`. Browser tests start their own production preview on port 5197; build first. See [validation results and limitations](specs/first-playable/validation.md).

For a quick paused run, inspect Feeder A and dispatch Crew 1, then Feeder B and Crew 2. Use **Next event** twice to reach minute 4. Choose clinic + pump or both housing groups. The next repair at minute 8 makes full restoration possible, but each remaining service must be reconnected explicitly. **Review replay** is read-only; **Return to live** preserves your run. Restart requires confirmation. Nothing is persisted when you reload.

## The loop

Inspect → prioritize → assign a crew → repair capacity → reconnect loads → compare decisions in replay.

Storm 01 repairs capacity in two stages: 6 CU, then 13 CU after the second feeder repair. Players choose which services to reconnect during the gap; repair never reconnects them automatically. Blocked roads and flooding are outside the first release. Service lighting and event history must reflect actual simulation state.

One persistent district, with no signup or API key required to play. This is a fictional game, not an infrastructure or emergency tool.

[Yard #3](https://hackyard.tech/yards/yard-3) · [Rules](https://hackyard.tech/faq)

Images are AI-generated design targets, not screenshots, completed features or performance evidence. Not approved runtime assets. No public release or license decision yet.
