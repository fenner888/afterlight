# AFTERLIGHT — project rules

Read README.md, DESIGN.md, HANDOFF.md and specs/ before work. specs/ is the source of truth. Full gates: /Users/frank/hermes/projects/ship-safe-framework.md.

## First-playable authority

Mark explicitly authorized the build on September 21, 2026 after the 18:00 UTC kickoff. Implement only the Storm 01 first playable defined in specs/first-playable/: deterministic simulation, simple coastal blockout, keyboard controls, pause and read-only replay. Stop for Mark's review before detailed art, extra incidents, branching/comparison UI or persistence. No commits, publication or deployment without his review. Build window ends September 25 at 18:00 UTC (2 PM Eastern). Event rules were reverified at kickoff.
Pre-build images are design references, not implemented UI or eligible runtime assets. Verify eligibility before any reuse in the submission.
Do not spawn agents without explaining scope/cost and obtaining approval.

## Architecture

- Browser-first, one persistent scene. One fictional district, 8–10 functional nodes, two repair crews, one utility network.
- Installed: vanilla strict TypeScript 5.9.3, Three.js 0.186.0, @types/three 0.186.0, Vite 8.3.0 and Playwright 1.63.0. Native HTML/CSS UI; no UI framework. Exact direct versions and a lockfile; verify package age/history before any additions.
- Separate pure simulation, commands, event log, presentation and persistence. Render frame rate must not change outcomes.
- No backend, accounts, payments, real infrastructure data or runtime AI in v1.
- Any later AI feature requires a baseline, versioned cases, graders, red-team/regression coverage and release thresholds.
- Change specs before implementation direction changes. Human review before commit/release.

## Security and validation

- Fictional game, not validated electrical engineering or emergency advice. Explain simplifying assumptions.
- Strictly validate saves and challenge URLs: versions, size limits, finite values, allowlists. Never execute imported data or render labels as HTML.
- No secrets in bundles/logs. No auth tokens in localStorage. Local saves contain fictional state only.
- Backend auth is N/A while no backend exists. If added, rescope for server-side auth, ownership checks, 404 for unauthorized resources, input validation and rate limits.
- Verify npm package/repository/publication history before installing. Pin exact versions. Audit dependencies, licenses, secrets and dead code before release.
- Test deterministic outcomes, capacity bounds, legal actions, replay, persistence, keyboard, reduced motion, small viewports, WebGL failure and long frames. Disclose untested devices.
- Preserve unrelated work. Public repository, license and deployment need approval.

## Local development and verification

- Node >=22.18 required for native TypeScript tests; kickoff machine uses Node 26.7.0 and npm 11.19.0.
- `npm ci --ignore-scripts` installs the locked toolchain. No install scripts were needed for this macOS setup.
- `npm run dev -- --port 5173 --strictPort` starts the loopback-only development server.
- `npm test`: deterministic domain, command, replay and clock tests using Node's built-in runner.
- `npm run build`: strict typecheck including unused-symbol checks, then production build. Three.js currently triggers Vite's 500 kB chunk warning; do not suppress the limit as a workaround.
- `npm run test:browser`: production-browser checks; run the build first. Uses installed Chrome through Playwright, starts an isolated loopback preview on port 5197, and does not reuse existing servers. Port 4174 was occupied by unrelated work at kickoff; leave it alone.
- `npm audit`: dependency vulnerability check. Full release audit and human review remain required.
- Domain files are independent of rendering. No saves, imports, share URLs or backend exist in this milestone. Do not add them before the blockout review.
- Hidden tabs pause with explicit resume. Replay is read-only and preserves live state. Both are specified in first-playable requirements.
- Screenshots and browser failure traces are generated under ignored `test-results/`. If Devin blocks screenshot reads, obtain specific approval before temporarily changing that ignore entry, then restore it.
