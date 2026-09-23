# Roadmap

## Current phase

Storm 01 first-playable blockout implemented September 21, 2026 after kickoff authorization. Deterministic domain, manual reconnection/reallocation, crew motion, per-service downtime, keyboard flow, pause and read-only replay are ready for Mark's gameplay review. Stop here: no detailed art, additional features, commits or deployment before that review.

## Build-week proposal

2026: September 21 18:00 UTC through September 25 18:00 UTC. No automatic kickoff.

The first implementation milestone is limited to Storm 01, two crews and the staged-capacity loop, including reallocation, backup expiry, per-service downtime, keyboard, pause and replay. Mark reviews the running blockout before any additional features or detailed art. Later dates below are conditional release proposals, not authorization to advance automatically; commits and deployment also require Mark's review.

1. Sep 21: reverify rules, scope and stack; initialize repo within window. Deterministic domain and one-incident blockout. Prove inspect → dispatch → repair → reconnect.
2. Sep 22: prove staged feeder capacity and the [reference priority comparison](first-playable/scenario.md), crew progress, keyboard and initial replay. Human gameplay review before detailed art.
3. Sep 23: city art, bounded lighting/effects and other two incidents; preserve determinism/performance.
4. Sep 24: branch/compare, save/resume/share, responsive/accessibility and failure tests. Cut optional polish before core tests.
5. Sep 25 before cutoff: security/dependency/license/secret/dead-code review, staging and actual browser evidence, human release approval, public demo/repo/submission.

## Backlog

Clip exports, scenario editor, advanced camera tours, educational facilitation, event-grounded AI debrief. Not first-release commitments.

Blocked roads, flooding mechanics and flooding events are excluded from the first release. Adding any later would require a new scope/spec decision.

## Shipped

Nothing publicly shipped. The local blockout is implemented and under review; it is not a released game.
