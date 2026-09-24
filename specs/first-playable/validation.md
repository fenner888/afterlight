# Validation plan

**Current release: September 24, 2026** — see "September 24 release evidence" at the end. Earlier sections are kept as the dated record of each milestone; their test counts and open items were accurate on those dates.

## Domain

Capacity zero/exact/one-over; rejection preserves state.
Repair start/completion, fault isolation, upstream loss, backup expiry and simultaneous event ordering.
Double assignment, conflicting crews, invalid/stale commands and rejection of unsupported cancellation/reassignment while busy.
Pause, speeds, hidden tabs and long render frames.
Same seed/commands with varied frame schedules; replay/branch preserve original history.

## Storm 01 reference acceptance cases

Use [scenario.md](scenario.md) as the numeric oracle. The first-playable domain and browser suites exercise these cases; branching is deferred and is not claimed as tested.

- Two tick-0 dispatches: travel ends at tick 60; A completes at 240 and B at 480. Capacity is 0 before 240, 6 from 240 through 479, and 13 from 480. Delay or omit B and capacity must remain 6 until its actual completion. B alone provides 7.
- No repair auto-reconnects a service. At tick 480 before connection commands, the reference runs still use only 6 CU. After all explicit commands, load equals 13 CU.
- At 6 CU, clinic + pump and both housing groups each fit exactly. Clinic + one housing group requests 7 and fails; clinic + pump + housing requests 9 and fails. Rejection leaves connections, backup reserves and capacity unchanged. Zero capacity rejects even the 1 CU beacon.
- Disconnect frees the full load; reconnect consumes it once. Duplicate reconnect, duplicate disconnect and double dispatch are rejected without mutation. Freed capacity never auto-reconnects a different service.
- Clinic backup lasts 360 off-grid ticks. Reconnection at 240 preserves 120 ticks; later disconnection resumes that reserve without recharge. Backup consumes no feeder capacity. Paused time consumes neither reserve nor service uptime/downtime.
- Reproduce per-service downtime at tick 480: clinic-and-pump priority = clinic 0, Housing A 480, Housing B 480, pump 240, beacon 480 ticks; housing priority = clinic 120, Housing A 240, Housing B 240, pump 480, beacon 480 ticks. Totals are 1,680 and 1,560 service-seconds (28 and 26 service-minutes).
- Apply due transitions before commands at a shared tick. Repair then reconnect at 240 succeeds; backup expiry then reconnect at 360 adds no positive-duration outage. Same-tick connection commands use recorded order and cannot collectively exceed capacity.
- Initial lighting reflects clinic backup and all other services offline. Repair changes feeder indicators only; successful reconnect/disconnect and backup expiry change service lighting. Rewind/branch restore matching state, lights and history with no future or duplicate completed events.
- No blocked-road state, flooding mechanic or flooding event exists in first-release scenarios/UI. Do not copy illustrative image events or timestamps into the runtime history.

## Data and UI

Corrupt/oversized/unsupported saves and URLs; nonfinite/negative values; unknown keys; markup labels.
Storage unavailable; reset/export/import if enabled.
Keyboard-only completion, focus, accessible names, non-color/non-audio state.
Reduced motion, mute, touch, zoom, small viewport; essential data outside canvas.
Actual-browser performance with recorded hardware. WebGL failure/context loss recovery.

## Release

Separate blockout, visual and staging human review. Dependency/license audit, secret scan, dead-code review. Auth matrix N/A only while no backend/protected data exists. Tests do not replace Mark's approval.

## September 21 first-playable evidence

Environment: Mac mini, Apple M4, 16 GB RAM; macOS 25.6; Node 26.7.0, npm 11.19.0. Browser automation uses installed Chrome 153.0.8010.52 through Playwright 1.63.0, headless, against the production build on loopback port 5197.

- `npm test`: 15 tests pass. Exact reference downtime/capacity, transition boundaries, no automatic reconnection, explicit reallocation, backup resume/expiry, crew exclusivity, malformed/stale/unsupported commands, rejection immutability, replay, fractional/long-frame clock schedules, full-state hashes across render schedules, and 300 generated action attempts with capacity/replay invariants.
- `npm run build`: strict typecheck and production build pass. Current JS is approximately 587 kB minified / 149 kB gzip. Vite emits its default 500 kB chunk warning because Three.js is in the entry bundle; the warning threshold has not been weakened. Bundling/network-performance review is still needed before release.
- `npm run test:browser`: 14 tests pass. Both complete priority runs match the oracle through the real UI; invalid actions do not become history; read-only replay excludes future events and restores matching service state; explicit restart/cancel/Escape; pause/resume and synthetic visibility changes; a complete Tab/Enter-only restoration using native buttons; no external runtime requests; WebGL initialization failure and context-loss/recovery; storage unavailable.
- Viewports checked: 320×740, 390×844, 800×600 and 1440×900 with reduced motion. No page-level horizontal overflow. A failing desktop-control visibility assertion reproduced time controls extending to y=1014 at a 900 px viewport; the bounded desktop workspace and internally scrolling inspector fix it. Time controls now remain visible at the desktop target. Narrow screens intentionally use one scrolling page and a dismissible, bounded inspector body.
- Initial, restored and narrow-screen screenshots were inspected. Runtime geometry is intentionally simple and uses none of the pre-build image files. Windows/beacon distinguish backup, offline and grid states. Depot travel was corrected to go around the depot block; numeric travel durations remain unchanged.
- Keyboard automation limitation: native select arrow keys also failed on an isolated bare select in this macOS/headless Chrome environment. The full keyboard game test therefore uses the equivalent native buttons. Manual native-select, screen-reader, real-touch and real-device checks remain open.
- Preliminary runtime sample during active crew travel, 1440×900, DPR 1: 291 visible frames, p50 16.7 ms, p95 16.7 ms, longest 66.8 ms; renderer reports 382 draw calls and 6,388 triangles. This short headless sample is not a production performance claim. Diagnostics report rolling samples in the running UI.
- `npm audit`: zero known vulnerabilities. Direct package registry metadata, licenses, repositories, publication age and weekly download history were checked before installing; install scripts were disabled and transitive resolution used the September 14 cutoff. Source inspection found no runtime network calls, HTML string rendering, eval, storage APIs or embedded secrets. Strict unused-symbol checks pass; this is not a complete release security/license/dead-code audit.

Not implemented/not applicable here: imports, persisted saves, challenge URLs, branching/comparison UI, other incidents, upstream-loss incidents, sound, accounts or backend auth. Safari, Firefox, actual phone GPUs, assistive technology, exhaustive contrast testing and the full release gates remain unverified as of this date. Human review is the next gate, not more automatic implementation.

## September 24 cross-browser smoke evidence

Playwright 1.63.0 projects `webkit` and `firefox` (browser binaries installed via `npx playwright install webkit firefox`; no npm dependencies added) run the `@smoke` subset via `npm run test:cross`. Default `npm run test:browser` remains installed-Chrome only.

- `npm run test:cross`: **8/8 pass** (4 webkit, 4 firefox) — picker/Begin/live header, dispatch both crews and reconnect the clinic, WebGL-render-or-fallback, and keyboard selection/time.
- WebGL verified real, not the HTML fallback, in each engine by inspecting the live canvas context on the dev server: WebKit reports renderer "Apple GPU"; Firefox reports "Apple M1, or similar" (Apple Silicon hosts, headless).
- Smoke coverage is deliberately narrow: it proves the app boots, simulates, renders and takes keyboard input on each engine. It does not re-run the 43-test functional suite per engine; visual/performance parity beyond canvas presence is unchecked.

Still untested: real iOS Safari and real Android devices, assistive technology/screen readers, native select behavior, real touch input, exhaustive contrast checks, per-engine performance, and the full release audit. Human review remains the next gate.

## September 24 release evidence

Public build: https://fenner888.github.io/afterlight/ (GitHub Pages, deployed by `.github/workflows/pages.yml` after `npm test` and `npm run build`).

- `npm test`: **38/38** (domain, three storms' hand-calculated reference runs, replay, clock, traffic). `npm run build`: pass. `npm run test:browser`: **47/47** in installed Chrome. `npm run test:cross`: **8/8** (WebKit, Firefox). `npm audit`: 0 vulnerabilities.
- The full Chrome suite and the cross-engine smoke subset were also run against the deployed bytes (proxied to loopback): 47/47 and 8/8.
- Manual play-through of the public URL through the real UI (no debug handles): Storm 01 clinic-first and housing-first with fuel warning, clinic expiry, sunrise, replay scrub/return and two-run comparison; Storm 02 with Crew 2's 18:30 return; Storm 03 with the 03:00 swap (clinic 0h 00m). No console errors, page errors or failed requests. Load and first dispatch also checked at 390×844 and 820×1180 (touch emulation), and in Playwright WebKit and Firefox.
- Defects found by that play-through and fixed before release: post-sunrise banner and "Fully restored" quoted the current clock instead of the final reconnection; a needless restart confirmation when switching storms from a completed run; a sunrise exposure blow-out at 30×; a near-black distant shore in daylight (night fog colour); and a render hitch from disposing line materials on every reconnect/selection, which forced shader relinks.
- Known minor issues: numbered markers overlap on phone-width screens; the compass mark has low contrast in daylight.
- Still untested: real iOS/Android devices and GPUs, real touch input, screen readers, exhaustive contrast checks.
