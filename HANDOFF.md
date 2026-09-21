# ECLucky13 — HANDOFF

**Current version:** v1.30 (package 1.0.30)
**Date:** 2026-09-21
**Status:** Parallel sessions verified; reattach hardened; inspector tabs fixed. Supersedes v1.29.

## v1.30 parallel sessions + inspector fixes (this increment)

- **Parallel sessions, different workspaces: confirmed working.** Backend runs one
  task per session and serializes per workspace, but separate workspaces drain
  independently. Proven live on an isolated server with two sessions in two
  workspaces against a local model: both `generating` simultaneously (~90s
  overlap), the first finished while the second continued undisturbed, both
  answered correctly. Switching sessions/workspaces only detaches the live feed;
  nothing is ever cancelled by navigating. Background runs stay visible in Tasks.
- **Reattach on open hardened.** Opening a session now subscribes to the live
  feed only when its latest run is still active (`isTerminal` guard) — finished
  runs no longer replay tens of thousands of stored events for state the history
  already shows. Proven live: opened a session mid-run, statusbar showed
  `GENERATING · elapsed 6s` with reasoning streaming and Stop armed.
- **Inspector tabs fixed.** The Activity/Plan/Auto-prompts buttons were 44px
  bars wrapping 2+1 (`flex-wrap` + chunky `.btn`). Now one compact 33px
  underline-tab row (single line, ellipsis-safe labels), matching the existing
  tab pattern. Proven by measured bboxes (3 buttons, same y, h=33).
- **Inspector autoscroll fixed.** The autoprompt/activity panels had no scroll
  management (and activity had a nested independent scroller). All three tabs
  now share one scroll contract with the chat feed: follow new output while
  pinned to the bottom, pause on scroll-up. The nested activity scroller was
  removed so the section is the single scroller.
- Files: components/Ec12App.tsx (guard, tabs, scroll), app/globals.css (tab
  row). Scratch provers (ignored): `test-output/par-ui.mjs`,
  `E:/test-output/grade-harness/par-verify.mjs`.

## Verification evidence (v1.30)

- Live parallel proof: OVERLAP true, both terminal, both correct (see above).
- Live UI proof: tabs one row + reattach GENERATING + zero page errors.
- Full suite serial: **189/189**. Typecheck PASS, build PASS.
- NOTE: relaunch quickstart to serve v1.30 (auto-rebuilds).

## v1.29 burn forever (this increment)

- Per decision ("runs shouldn't be stopped by this, it can burn forever"):
  `agent.blockRecoveryAttempts` now defaults to **0 = unlimited recoveries**. A
  watchdog stall always hands the block info back to the model and continues;
  only Stop, an answer, or the iteration budget ends a run. Set it to N (>0) to
  restore the v1.28 bound (stop after N recoveries with explanation + memo).
- ProgressGuard is now exported for direct unit tests. The two old stop-at-once
  integration tests were rewritten to the new contract (guard fires recoveries,
  budget ends the run); the v1.27 blocked message + failure memo still serve the
  exhaustion path and any explicitly bounded runs.
- Files: shared/settings-schema.ts (default 0), agent/loop.ts (unbounded cap,
  exported guard), test/v128-recover.test.mjs (rewritten: never-stops,
  explicit bound, self-fix, default 0, guard units), test/lucky-workflows +
  test/v113-resilience (new-contract assertions).

## Verification evidence (v1.29)

- New/updated tests pass; full suite serial: **189/189**. Typecheck PASS, build PASS.
- NOTE: relaunch quickstart to serve v1.29 (auto-rebuilds).

## v1.28 recover, don't stop (this increment)

- Per decision ("models are smart enough to fix what blocks them"): when the
  watchdog fires, the run no longer stops. It gets a SYSTEM message with the
  stall pattern, the failing tool and its last error, plus a diagnose-first
  directive — then continues with a reset guard. Bounded by the new
  `agent.blockRecoveryAttempts` setting (default 2, 0 = block at once, max 10),
  so a truly hopeless loop still ends after N recoveries with the v1.27
  explanation + failure memo. Past observations are kept across the reset, so an
  immediately repeated identical call still counts as no progress.
- Iteration-budget exhaustion stays terminal (a real budget end, not a stall).
- Files: agent/loop.ts (ProgressGuard.reset, recovery branch), shared/
  settings-schema.ts (blockRecoveryAttempts), runs/manager.ts (plumbs the
  setting), test/v128-recover.test.mjs (3 tests: stuck run continues then
  blocks, self-fix completes, defaults/bounds).

## Verification evidence (v1.28)

- New tests: **3/3**. Full suite serial: **187/187**. Typecheck PASS, build PASS.
- NOTE: relaunch quickstart to serve v1.28 (auto-rebuilds).

## v1.27 unblocked (this increment)

- Symptom: remote-model sessions (e.g. `z-ai/glm-5.3-flash` in `E:\aiprojects\nf mem3`)
  re-ran failing shell commands until the watchdog blocked the run, ending with an
  empty reply ("did not record reply text") — felt like the session died. Typing
  "continue" repeated the same doomed commands into another block.
- The watchdog still blocks (cost control unchanged: same-signature limit 3, stall
  limit 20 turns). What changed is what happens at the block:
  1. **Blocked runs speak.** The loop now carries `blockedTool` + `lastError` on
     blocked/exhausted outcomes; the manager appends an actionable message to the
     reply (cause, failing tool, last error, concrete next steps) and streams it
     into chat. A blocked run can never end silent again.
  2. **Session failure memo.** A blocked run stores `{tool, reason, lastError}` on
     the session; the next run in that session gets it as a prominent system
     instruction ("do NOT repeat the same failing call unchanged: diagnose first,
     try a different approach, or ask the user"). Cleared on the next succeeded
     run; naturally scoped (new sessions start clean).
- Files: agent/loop.ts (LoopOutcome + lastFail tracking), runs/manager.ts
  (SessionRecord.failureMemo, buildBlockedMessage, buildFailureMemoText, wiring),
  test/v127-unblocked.test.mjs (5 tests, incl. a real stuck-provider loop run).

## Verification evidence (v1.27)

- New tests: **5/5** (`test/v127-unblocked.test.mjs`).
- Full suite serial: **184/184** (`--test-concurrency=1`; the v114 timing test
  flakes under parallel load, pre-existing).
- `npm.cmd run typecheck -- --incremental false`: PASS. `npm.cmd run build`: PASS.
- NOTE: relaunch quickstart to serve v1.27 (auto-rebuilds).

## v1.26 lucky theme (this increment)

- New `lucky` theme (Settings > Appearance > "lucky (craps + live odds)"): felt-green +
  gold palette, left rail with a decorative craps dice roller (local random, call names
  2-12, no wagers anywhere) and live prediction-market odds.
- Odds are public keyless APIs proxied server-side: `GET /api/markets`
  (`src/app/api/markets/route.ts`) merges Kalshi (`with_nested_markets`, `*_dollars`
  price fields) + Polymarket Gamma (JSON-encoded `outcomes`/`outcomePrices` arrays),
  90s server cache, 8s per-venue timeout, graceful degrade. Panel polls every 90s.
- Files: api/markets/route.ts (new), components/LuckyPanel.tsx (new),
  app/globals.css (`[data-theme="lucky"]` + rail/dice/odds styles), Ec12App.tsx (rail
  column + render when theme is lucky), SettingsDrawer.tsx (theme option).
  Scratch verifier: `test-output/lucky-verify.mjs` (ignored).

## Verification evidence (v1.26)

- `npm.cmd run typecheck -- --incremental false`: PASS.
- `npm.cmd test`: **179/179**.
- `npm.cmd run build`: PASS.
- Live isolated prod (3319): `/api/markets` → ok:true, 16 markets (8 Kalshi priced 8/8,
  8 Polymarket); browser run: rail present, 2 dice, 14 odds rows, `data-theme=lucky`,
  roll → "5 — Fever five", zero page errors. Screenshot:
  `C:/Users/emper/AppData/Local/Temp/opencode/lucky-theme.png`.
- NOTE: relaunch quickstart to serve v1.26 (auto-rebuilds).

## Desktop shell (v1.26, same app version)

- `desktop/` is an Electron shell in the opencode-desktop shape (native window +
  tray + server lifecycle, no system Node needed at runtime): first launch copies the
  app source to `%LOCALAPPDATA%\ECLucky13\app`, runs full `npm install` + `npm run build`
  in a progress window, then starts the server under Electron's Node
  (`ELECTRON_RUN_AS_NODE`) and opens the window. Tray: open, restart server, data
  folder, start-with-Windows, quit. Dice icon generated from the theme
  (`desktop/assets/`). `npm start` runs from source; `npm run package` builds the
  per-user NSIS installer.
- Two real bugs found by headless testing and fixed: build must run with
  `EC12_DIST_DIR=.next-build`, and the install must be full (Next resolves the `@/*`
  alias through TypeScript, so `--omit=dev` breaks the build). Setup log:
  `%APPDATA%\ECLucky13\desktop-shell.log`.
- Verified: shell boots the server (HTTP 200 on isolated 3399), window loads the app,
  no shell errors. `npm test`: **179/179** serial (one timing test flakes under
  parallel load; passes 10/10 alone and 179/179 with `--test-concurrency=1`).
- Published: https://github.com/emperorofrome13/ECLucky13 (master) + release v1.26
  with `ECLucky13-Setup-1.0.26.exe` (90MB, per-user NSIS). No secrets in the repo:
  tracked files scanned clean; `data/`, `backup/`, `test-output/`, `vendor/`,
  `workspace-test/`, `.env*` are gitignored.

## v1.25 warn-only budget (this increment)

- The v1.24 force-stop (warn at N, `blocked` at N+5) is removed: the turn budget now warns
  once (visible user message + non-fatal event) and the run always continues to its own
  conclusion. Nothing can cut a run off for token reasons anymore; the toggle, diet
  preset, budget setting and cache marks are unchanged.
- Files: agent/loop.ts (removed force-stop + grace constant, reworded notice), test/
  lucky-costsaver.test.mjs (budget test now proves 12 turns run past a budget of 4 with
  exactly one warning and no block). Backups under `backup/v118-perf/` (`*-v122.*`).

## Verification evidence (v1.25)

- `npm.cmd run typecheck -- --incremental false`: PASS.
- `npm.cmd test`: **179/179**.
- `npm.cmd run build`: PASS, Next 14.2.35.
- `node test/lucky-ui.mjs` (isolated dev 3314): **9/9**.
- **A/B toggle test** (isolated prod 3320, same micro-task, autoprompts off): OFF = 19 reqs,
  70.9k in (45.3k cached, 64%), 3.1k out · ON = 14 reqs, 45.1k in (33.8k cached, 75%),
  2.3k out. Both outputs verified correct by execution. Finding: OpenRouter auto-caches
  stable prefixes WITHOUT breakpoints (OFF still 64% cached), so the toggle's marginal
  cache gain looks like ~+11pts; the diet preset matters more at long-history scale.
  Evidence: `E:/test-output/grade-ab-2026-09-20/` (harness: `grade-harness/micro-task.md`).
- NOTE: relaunch quickstart to serve v1.25 (auto-rebuilds).

## v1.24 saver bundle (superseded above for budget behavior)

Cost-saver mode (Settings > Limits) now does three things when ON, on every provider
(only the cache marks stay remote-only):
- **Saver diet preset**: history diet switches to 2 recent-full / 200 chars / 100 call-chars
  via `historyDiet()` (`context-manager.ts`), overriding the knobs while on (documented
  in the toggle blurb). Applies to main + stage loops.
- **Soft turn budget**: new `provider.saverTurnBudget` (default 60, 0 = off, Settings >
  Limits). Main loop warns once at N (visible user message + non-fatal event), then
  finishes `blocked` with reason at N+5 so runs finalize and report instead of dying
  silently. Stages keep their existing caps.
- **Cache breakpoints** (v1.23, unchanged): remote-only hard rule kept.
- Files: agent/context-manager.ts (helper), agent/loop.ts (LoopDeps/StageRunDeps fields,
  diet call sites, budget logic), runs/manager.ts (plumbing), shared/settings-schema.ts,
  components/SettingsDrawer.tsx (budget input). Backups: `backup/v118-perf/*-v122.*`.

## Verification evidence (v1.24)

- `npm.cmd run typecheck -- --incremental false`: PASS.
- `npm.cmd test`: **179/179** (171 + 8 new: diet preset, budget warn/stop/off paths).
- `npm.cmd run build`: PASS. `node test/lucky-ui.mjs` (isolated dev): **9/9**.
- **Live P9 re-grade, saver ON, TRUE single pass** (autoprompts genuinely off this time):
  **10/10 functional, 65 requests, 0.67M in (462k cached, 69%) / 51k out (~$0.020 billed),
  463s, ended `blocked` via budget (warn 60, stop 65) with a complete verified app.**
  Median request 111→83 KB (args 72→14.3 KB condensed, reasoning 0 KB holds).
- Correction: the two earlier "no-stage" legs actually ran WITH stages (harness
  `VAR || default` env bug, now fixed) — their numbers are superseded; see grade report.
- NOTE: relaunch quickstart to serve v1.24 (auto-rebuilds).

## v1.23 cloud cost saver (superseded above for saver behavior)

New Settings > Limits toggle **Cloud cost saver** (default OFF, `provider.costSaver`):
- When ON on a remote provider: marks prompt-cache breakpoints (`cache_control: ephemeral`) on system + last-2 messages per request (mirrors opencode's applyCaching, which measured 95% cache reads on this exact path). Hard rule in code: never sent to local models even if toggled on; tolerant servers ignore unknown marks, and the blurb says to switch off if a provider rejects.
- Cache-aware ledger end-to-end: usage parser reads `prompt_tokens_details.cached_tokens` (fallback `cached_tokens`), `TokenUsage.cachedTokens` accumulates per request/session/archive, run chip shows `(cached N)` when present. Cost estimate formula unchanged (conservative; billed savings land on the provider invoice).
- Files: providers/openai-compatible.ts (flag + withCacheBreakpoints + allowed-guard + usage parse), runs/manager.ts (plumbing + ledger), shared/contracts.ts (optional field), shared/settings-schema.ts, components/SettingsDrawer.tsx (checkbox), components/Ec12App.tsx (ledger + chip). Backups under `backup/v118-perf/` (`*-v122.*`).
- Expected effect (not yet measured live): if EC's prefixes cache like opencode's did, billed input cost drops toward ~1/5; turn volume unchanged — this attacks price-per-token, not turns.

## Verification evidence (v1.23)

- `npm.cmd run typecheck -- --incremental false`: PASS.
- `npm.cmd test`: **176/176** (171 + 5 new `test/lucky-costsaver.test.mjs`: breakpoint placement/no-mutation/tiny-history, local never, usage parse incl. fallbacks, setting default/normalize). One full-suite run showed the known v114 timing flake under 100% machine CPU; isolated rerun 10/10 (that path untouched). Two existing `lucky-agent` usage-shape assertions updated for the additive `cachedTokens: 0`.
- `npm.cmd run build`: PASS, Next 14.2.35.
- `node test/lucky-ui.mjs` (isolated dev 3314): **9/9**. Toggle probe: renders OFF, flips ON, zero pageerrors.
- NOTE: relaunch quickstart to serve v1.23 (auto-rebuilds).

## v1.22 token diet, round 2 (superseded above for provider/cost)

- `summarizeOldToolCallArgs` (outgoing copy only, ids/types/names kept for pairing; JSON-aware per-arg summary) + `historyToolCallChars` setting (default 200, Settings > Tools) + batching instruction in `autoprompts/system.md` (loop already executes parallel calls; the model just never batched). Backups: `backup/v118-perf/*-v121.*` (copy back to revert).
- Live P9 re-grade (autoprompts OFF, same prompt/model): 203 requests, 4.42M in / $0.184, 10/10 functional, cancelled by harness cap. Median request 111→83 KB (args 72→14.3 KB condensed, reasoning 0 KB holds). BUT turns rose 178→203 (batching prompt: only 28 multi-tool turns, 14%) — net total −13% (5.10M→4.42M). Target "beat opencode" (1.21M) NOT met: remaining gap is turn count (203 vs 33) + 46 KB/req tool outputs + no compaction (excluded) + no cache benefit.
- Verification: typecheck PASS, 171/171 unit (4 new), build PASS, lucky-ui 9/9, new limit input renders (200, no pageerrors).
- NOTE: relaunch quickstart to serve v1.22 (auto-rebuilds).

## P9 3-way grade (superseded above for v1.22 numbers)

- **Task/model:** new fixed prompt `coder-benchmark/prompts/p9_bridge_webui.md` (single-file Bridge WebUI, 10 checks), model `deepseek/deepseek-v4-flash-0731` for all legs, isolated outputs under `E:/test-output/grade-p9-2026-09-19/`.
- **Result:** fork 75/80 ($0.0236, 896s) › upstream 1.18.31 74/80 ($0.0419, 634s) › ECLucky13 v1.21 64/80. Restaged EC with autoprompts OFF (toggle only): still 10/10 but 5.10M in / $0.212 / cap hit — pipeline was never the cost driver. All three 10/10 functional. Full report: `coder-benchmark/reports/P9_3WAY_2026-09-19.md`; leaderboard addendum added; raw evidence in the grade dir.
- **Harness lessons:** headless `opencode run` hangs on silent stdin (fix: `stdin:ignore` + `--auto`); 95–98% of opencode input was prompt-cache reads; real LM Studio serves `{models:[...]}` with `type`/`key` fields.
- **ECLucky13 upload ready:** secret audit clean (patterns + env/cred files; secrets only in excluded `data/`), `.gitignore` added, committed `30b1d72` (162 files, verified no data/backup/node_modules/.next/vendor/test-output leaks).
- **Fork upload ready:** 102-file local diff scanned clean (4MB added lines, no key patterns), untracked custom files reviewed (HANDOFF, quickstart, context-settings — no secrets), committed `cbc4bb571f` on `dev` (origin still points at sst/opencode; do NOT push there — push to the new repo).
- **gh 2.101.0 portable** at `E:/test-output/grade-bin/gh/bin/gh.exe`; `gh auth status` = not logged in. After login: create private repos `emperorofrome13/ECLucky13` + `emperorofrome13/opencode-fork` and push (commands drafted below).
- After push: delete nothing (repos keep full history); grade-bin tools (opencode.exe, gh) stay local-only.

## v1.21 Trillian chrome (superseded above for grading/push state)

Applied the supplied mockup direction (navy palette + cleaned structure + Trillian-skin chrome) as a pure presentation layer — no data/DOM-contract changes:
- Chamfered metallic panel frames (single-element gradient-border + clip-path technique, no wrapper divs so inline grid columns are untouched), floating header/composer, slanted title strips with grips on Workspace/Chat/Message panels, metal-gradient tab strips, chamfered buttons/chips/cards/inputs, square LED checkboxes, ▸/▾ collapsible markers, skinned scrollbars, starfield + nebula body backdrop, diamond avatar.
- Status strip goes red/amber (inset edge) when the run is non-idle/busy — the mockup's INTERRUPTED banner language.
- Metal palette (`--met-hi/mid/lo`, `--edge`) defined per theme (all 6), so amber/red/matrix/ice/mono re-skin automatically; chrome is theme-driven, not hardcoded navy (bubble/card gradients use accent/panel vars).
- Deliberately NOT built (mockup-only concepts): Resume/Dismiss run controls, checklist-structured replies, per-panel min/max window buttons (no fake controls — closes/hides use the existing real ones), green Trillian metal variant, 4-corner cuts.
- Files: `src/app/globals.css` (appended Trillian section), `src/components/Ec12App.tsx` (3 title bars + statusbar state class only). Backups: `backup/v121-trillian/`.

## Verification evidence (v1.21)

- `npm.cmd run typecheck -- --incremental false`: PASS. `npm.cmd run build`: PASS. `npm.cmd test`: **167/167**.
- `node test/lucky-ui.mjs` (isolated dev 3314): **9/9** after two real findings: (1) new vertical chrome pushed transcript cards below the fold at 800×700 where `content-visibility: auto` hid them from innerText — fixed by removing `.ev` content-visibility (chat DOM is small by construction; `.tool-card` keeps it); (2) gradient-only bubble/card backgrounds compute equal `background-color` — fixed with explicit fallback colors (also more theme-faithful). Screenshot: `test-output/lucky-ui-chat-restyle.png`.
- `node test/lucky-parity-ui.mjs`: **PARITY_UI_PASS**.
- NOTE: relaunch quickstart to serve v1.21 (auto-rebuilds).

## v1.20 reasoning-replay default (superseded above for visuals)

**#2 IMPLEMENTED.** `resolveReasoningReplay` (`context-manager.ts`) now resolves `auto`/legacy/unknown to `active-batch` for local AND remote; explicit `none`/`active-batch`/`tool-turns`/`full` still honored (Settings > Limits > Reasoning replay dropdown unchanged — one-click revert to `tool-turns`). `runs/manager.ts` uses the centralized resolver instead of its inline ternary (duplicate mapping removed). Basis: live probe (OpenRouter deepseek-v4.1-flash accepted tool history with zero replayed reasoning, HTTP 200, ~$0.00009). Expected effect on cloud workloads like the audited sessions: reasoning retained per request drops from ~179 KB (all tool turns) to one batch (~KBs). Files: context-manager.ts, manager.ts. Backups under `backup/v118-perf/` (v120 round files included there).

## Verification evidence (v1.20)

- `npm.cmd run typecheck -- --incremental false`: PASS.
- `npm.cmd test`: **167/167** (165 + 2 new resolver/default tests in `test/lucky-history-diet.test.mjs`: auto→active-batch both providers, explicit honored, latest-batch-only end-to-end). One full-suite run showed a single failure in `v114-cloud-mcp` timing assertion (500 polls < 1500ms) under parallel load; isolated rerun passes (1507ms incl. fixture setup) and the next full run is 167/167 — environmental flake, unrelated (that path untouched).
- `npm.cmd run build`: PASS, Next 14.2.35.
- `node test/lucky-ui.mjs` (isolated dev 3314): **9/9**.
- NOTE: relaunch quickstart to serve v1.20 (auto-rebuilds).

## v1.19 token diet (superseded above for replay policy)

**#1 IMPLEMENTED — summarize old tool outputs.** `summarizeOldToolOutputs` (`src/server/agent/context-manager.ts`): outgoing copy only — the most recent `historyToolFull` (default 5) tool messages stay complete, older ones keep the first `historyToolChars` (default 500) chars plus a pointer to run history. Durable conversation, event log and artifacts keep full outputs; condensed copies are registered so compaction-restore recovers originals. Wired through `prepareConversation` (main + stage loops) and exposed in Settings > Tools > advanced limits (auto-rendered, server-persisted, 0 = unlimited chars). Files: context-manager.ts, settings-schema.ts, SettingsDrawer.tsx, loop.ts. Backups under `backup/v118-perf/` (v119 round files included there).

**#2 probe (shipped in v1.20 above; not shipped at v1.19 time).** Live 2-call probe against the user's configured provider (OpenRouter `deepseek/deepseek-v4.1-flash`, key in-memory only, never logged, ~$0.00009): call 1 forced a tool round; call 2 replayed history the active-batch way (tool_calls, zero reasoning) → **HTTP 200 both, no 400**. Bonus findings: this model emitted no `reasoning_content` field on the trivial probe (18–22 internal reasoning tokens only — real coding turns in old logs DID carry it, so the model reasons more on hard tasks; the accept verdict covers the stripped shape either way), and OpenRouter prompt-cached 256 prefix tokens (full-history replay is cheaper than raw token counts suggest). Default `reasoningReplay: 'auto'` unchanged; no knob added, no code path altered. No app/data changes for the probe.

## Verification evidence (v1.19)

- `npm.cmd run typecheck -- --incremental false`: PASS.
- `npm.cmd test`: **165/165** (160 + 5 new `test/lucky-history-diet.test.mjs`: window/marker/no-mutation/zero-semantics/outgoing-vs-durable/compaction-restore).
- `npm.cmd run build`: PASS, Next 14.2.35.
- `node test/lucky-ui.mjs` (isolated dev 3314): **9/9**.
- New limit inputs verified rendering with defaults 5/500, zero page errors (Settings > Tools).
- Two old fixtures needed re-scaling, which itself proves the diet: `lucky-agent` (300→600) and `context-v109` (400→1600) tool-output sizes plus summary index 7→10 — post-diet estimates sit further under the compaction trigger, so the old sizes no longer compacted. No assertion logic changed.
- NOTE: relaunch quickstart to serve v1.19 (auto-rebuilds).

## v1.18 lag fixes (superseded above for context diet)

Diagnosed 6 lag sources with measurements (event-log bloat, replay storms, per-event re-renders, sync session saves, first-touch parses, RAM payloads) and fixed 4:

1. **Compact SSE replay** (`src/server/events.ts`, `src/app/api/runs/[id]/events/route.ts`): `?compact=1` merges consecutive same-stream deltas (49k events collapse to a handful, text exact, first eventId + last sequence kept) and strips embedded payloads to summaries. Clones only — shared memory-window objects never mutated. UI subscribes compact by default.
2. **Throttled UI renders** (`src/components/Ec12App.tsx`): streamed text buffered, flushed to React ≤4x/sec (250ms). Ordering preserved (buffer flushes before every structural event, on suspend, on unmount cleanup). Touch/keyboard unaffected.
3. **Slim request.started** (`src/server/agent/loop.ts`, new `src/server/request-payloads.ts`): event carries counts + byte size; full payload → sidecar `data/request-payloads/req_<uuid>.json` (never throws). Provider wire body UNCHANGED (verified by live suite).
4. **Debounced session saves** (`src/server/runs/manager.ts`): request-path saves coalesced to ≤1 per 2s per session, immediate on request.finished; usage rows were already durable in usage-archive files.
- New on-demand endpoint `GET /api/runs/[id]/requests/[key]` (sidecar first, old-log scan fallback, auth + ID validation, attachment disposition). Request rows download through it; 700KB data: URLs gone.
- Backups: `backup/v118-perf/`. No data migration; old 176MB logs untouched (compact replay neutralizes them).
- NOTE: relaunch quickstart to serve v1.18 (auto-rebuilds; running 3313 keeps old build until then).

## Verification evidence (v1.18)

- `npm.cmd run typecheck -- --incremental false`: PASS.
- `npm.cmd test`: **160/160** (155 + 5 new `test/lucky-perf.test.mjs`: coalesce exactness + no-mutation, strip shapes, 2402-event compact replay, sidecar round-trip + old-log fallback).
- `npm.cmd run build`: PASS, Next 14.2.35.
- `node test/lucky-ui.mjs` (isolated dev 3314): **9/9**.
- `node test/lucky-parity-ui.mjs` (isolated dev 3314): **PARITY_UI_PASS** after updating request-download assertions to the Activity rows + endpoint (href/filename/fetch-headers/content) and `acceptDownloads: true`. Finding: same-origin `route.fulfill` link downloads report `canceled` in Chromium (reproduced in isolation; data: URLs and cross-origin fulfill fine) — real browsers hit the live endpoint, whose headers are asserted. Flake note: one run failed at the Parallel-send (async workspace-switch vs fill race, pre-existing); passed on rerun, no code change.
- `node test/lucky-settings-live.mjs` (isolated dev 3314, fixture model/MCP): **SETTINGS_LIVE_PASS** (6/6) after bumping its stale v1.16 brand gate and making the background task text unique per run. Root-caused its Stop-button failure: the fixed text `BACKGROUND HOLD` matched a STALE cancelled card from a previous suite run in the shared data dir (plus 3s poll lag), so the test opened the wrong run and waited for Stop on a finished task; the "mystery cancel" was the suite's own finally-block cleanup. Unique task text + wait-for-exactly-one-card fixes it.
- Follow-ups (not done): per-event `appendFileSync`+statSync costs ~4.5ms on this machine (seen in unit-test timing) — batching appends would cut live-run overhead further; old monster logs could be collapsed, left as-is by choice.

## v1.17 chat restyle (this increment)

- Chat now reads as conversation: user turns are right-aligned accent-tinted bubbles (no "You" tag; position says it), assistant turns are left cards with avatar + name + outcome badge header. Copy/Retry/Edit&branch/Reuse actions moved to a hover/focus-reveal row (always visible on touch). Reasoning label shows live char count. Run details is a structured grid (Outcome/Model/Files/Checks/Stages/Remaining), not a markdown blob. Streaming card shows a pulsing status line (run detail / Generating… / Working…).
- Model requests moved out of the chat into Activity > Requests: one compact row per request (`#N · msgs · KB · seconds · tokens · status badge`), expandable to message/tool/maxTokens summary + Download payload. Full JSON never renders inline (also shrinks chat DOM). Rows correlate started/finished/usage by requestId, cap 200, reset each run.
- Files touched: `src/components/Ec12App.tsx`, `src/app/globals.css`, `src/app/layout.tsx` (title), `quickstart.bat`, `scripts/launch.mjs`, `package.json`, `test/lucky-ui.mjs` (mock request events + 2 new test blocks). Backups: `backup/v117-chat-restyle/`. No server/data-shape changes.
- NOTE: a running 3313 instance serves the old build until relaunched — quickstart auto-rebuilds (src newer than `.next-build/BUILD_ID`).

## Verification evidence

- `npm.cmd run typecheck -- --incremental false`: PASS (one `status: 'running' as const` fix needed).
- `npm.cmd test`: 155 passed, 0 failed.
- `npm.cmd run build`: PASS, Next 14.2.35.
- `node test/lucky-ui.mjs` vs isolated dev server on 3314 (production 3313 untouched): **9/9 PASS** (8 existing + new "Requests live in the Activity panel, not the chat"). Screenshot: `test-output/lucky-ui-chat-restyle.png` (bubbles, cards, request row with tokens + OK badge, v1.17 brand). Existing assertions kept green by retaining `.ev.user/.ev.assistant/.tag/.reasoning/.run-details` classes and flat DOM order.

## v1.16 delivered (backend notes still apply; UI superseded by v1.17 above)

**v1.16 status:** Requested parity increment implemented and verified, including pending-integration and unsupported-PDF claims.

## 2026-09-18 launcher fix (no version bump — launcher UX only)

- Symptom: double-clicking `quickstart.bat` "flashed and showed no page". Cause: a hidden stale production server (PIDs 48788/38944, running since 09-17) already held port 3313, so `scripts/launch.mjs` took the already-running branch, opened the browser signal, and exited instantly — window flashed shut.
- Fix: killed the stale processes, restarted fresh production server on 3313 (verified HTTP 200, `<title>ECLucky13 v1.16</title>`), and changed the already-running branch in `scripts/launch.mjs` to print "this window closes in 15 seconds" and wait 15s before exiting, so the message is readable. Backup: `backup/launch.mjs.pre-flashfix-20260918`. `node --check scripts/launch.mjs` clean; already-running path timed at 15.1s.
- If it happens again: port 3313 held by a hidden `node scripts\next.mjs start` means the app is already up — just open http://127.0.0.1:3313 in the browser.

- Attach files by chooser, drag/drop or paste; preview/remove/download. PNG/JPEG/GIF/WebP are sent as actual image_url content. UTF-8 text, PDF and DOCX contents are extracted into model messages. Original bytes retained. Limits editable under Settings > limits > Attachments, server-persisted, zero unlimited.
- Tasks panel: independent jobs, status, open and stop/cancel. Switching chats/workspaces does not stop jobs. Different workspaces run concurrently; same-workspace jobs queue FIFO to prevent conflicting writes. Queued configuration persists privately server-side.
- Edit & branch / retry create a new session from the snapshot BEFORE the selected turn, preserving the original conversation and attachment references.
- Settings > MCP servers: add/edit/delete/enable/test/discover custom stdio and Streamable HTTP servers. Server-side credential storage/redaction, namespaced tools, per-run configuration snapshot, configurable limits and cancellation.
- Agent edits auto-apply without approval gates even with inherited review settings. Journal, diffs, undo and conflict protection retained. Legacy journal approval endpoints still exist for compatibility, but new runs do not enter an approval state.
- Keyboard panel resizing, separate keyboard-operable tab close controls, workspace dialog focus, file loading/retry/error states, and frozen active pipeline controls. Settings changes apply to subsequent runs.
- Main-loop duplicate-success protection; stage/repair context refreshed from changed files and verification after each attempt. Session usage ledger rolls into durable archive instead of growing indefinitely in session JSON.
- Complete tool output retained before preview truncation, including shell/MCP output, with authenticated download links in main and stage activity. Shell read_full survives process-memory loss using disk metadata. Image binaries are not repeated in request-event copies.
- Original EC12 untouched; Settings-based pricing unchanged. Backups: backup/v116-before, backup/v116-output, backup/v116-ui-final, backup/attachments-extraction-before and per-test backups.

## Exact run and verification evidence

Run: double-click `E:\aiprojects\coders\ec\ECLucky13\quickstart.bat`; address http://127.0.0.1:3313. Development: `npm.cmd run dev`. Production: `npm.cmd run build` then `npm.cmd run start`.

- `npm.cmd run typecheck -- --incremental false`: PASS.
- `npm.cmd test`: 155 passed, 0 failed/skipped.
- `npm.cmd run build`: PASS, Next 14.2.35. PDF parser/worker and mammoth externalized in next.config.js after real production upload exposed a missing bundled worker.
- `node test/lucky-settings-live.mjs`: SETTINGS_LIVE_PASS; real app routes and Chromium, controlled local model/MCP fixtures, no mocked app APIs. Covers MCP create/test/edit/reload/delete; attachment limits save/reload; real text/PDF/DOCX/image uploads and provider body; output download; branch preserving attachments; background switch/reopen/stop. Evidence and screenshot: test-output/lucky-settings-live-QZGmRj/.
- `node test/lucky-parity-ui.mjs`: PARITY_UI_PASS, mocked APIs with real Chromium. Covers paste/drop, draft preservation, queue/parallel task navigation, edit/retry branching, loading/errors/keyboard, settings and artifact links. Mock download assertions check link/header/content; actual download is covered by the live suite.
- `node test/lucky-ui.mjs`: 8/8 passed, original UI regressions. Screenshots/results under test-output/.
- `$env:EC12_BASE='http://127.0.0.1:3313'; node test/e2e.mjs`: LIVE_E2E_PASS with the already-loaded LM Studio ornith-1.5-9b-mtp@q8_0. Memory retained; math.cjs edited automatically; npm test passed; review PASS attempt 1. Runs run_ddfyno9wmu630rn0, run_jn3k2bummu630tg8, run_bbqzejjfmu630vcl. Evidence: test-output/e2e-v104-1789682951786/.
- `$env:ECLucky13_NO_BROWSER='1'; cmd.exe /d /c quickstart.bat`: prints ECLucky13 Coder v1.16 and correctly recognizes the running app. Production runtime logs: test-output/v116-runtime.log and .err.
- No configured lint command exists; Next skips linting, not a lint pass.

## Limitations / next steps

- Git controls and broad larger-project/provider/zoom benchmarks were expressly excluded. No cloud hosting service or scheduled automations added; background tasks run while this app server remains alive.
- Images require a vision-capable provider/model. Wire format verified; image understanding by the currently loaded model was not evaluated. Scanned/image-only PDFs require OCR and give an explicit error; legacy .doc unsupported. PDF/DOCX downloads preserve originals.
- Branches require snapshots created by this version; older runs without one fail explicitly rather than include later conversation. Branching conversation does not roll back workspace files.
- Complete archives intentionally consume disk; no automatic history deletion. Legacy truncated output cannot be reconstructed. Known stored secrets are redacted, but arbitrary secrets pasted into conversation are not automatically recognizable.
- Terminal panel history still lasts only for the page lifetime; tool process output archives persist. Running inference is marked interrupted after server loss, rather than silently replayed; queued work has recovery.
- Full Codex parity outside the requested subset is not claimed. Future work should stay in this fork.

---

## Historical notes (superseded by v1.16 above)

## lucky-workflows backend round (2026-09-17, this increment — parent integration pending)

Scope honored: ONLY backend. Files touched: `src/server/attachments.ts` (new), `src/server/runs/manager.ts`, `src/server/agent/loop.ts`, `src/server/agent/context-manager.ts`, `src/server/events.ts`, `src/server/providers/openai-compatible.ts`, `src/server/tools/managed-shell.ts`, `src/server/tools/registry.ts`, `src/app/api/runs/route.ts`, `src/app/api/attachments/route.ts` (new), `src/app/api/attachments/[id]/route.ts` (new), `src/app/api/sessions/[id]/branch/route.ts` (new), `test/lucky-workflows.test.mjs` (new). UI, shared settings-schema, and registry tool lists untouched (only an additive `shell_process read_full` description).

- **Verified:** `npm.cmd run typecheck -- --incremental false` clean; full suite `node --import ./test/register.mjs --test test/*.test.mjs` = **144/144 pass** (was 135; +9 new). Focused: `node --import ./test/register.mjs --test test/lucky-workflows.test.mjs` = **9/9**. Production build NOT run this round per "no concurrent build" instruction; parent should build during integration.
- **Attachments:** `POST /api/attachments` (multipart `files`+`workspaceId`) → `{ok,attachments:[{id,name,mime,size,url}]}`; `GET /api/attachments` → settings `{maxFiles,maxFileBytes,maxTotalBytes,maxTextChars}` (zero=unlimited) + `supported`/`unsupported` lists; `PATCH /api/attachments` persists limits server-side (data/attachments/settings.json); `GET /api/attachments/[id]` serves original bytes (nosniff, no-store). Images (PNG/JPEG/GIF/WebP, magic-byte validated) ride real multimodal `image_url` messages (provider strips `images`/`attachmentIds` into OpenAI wire format). UTF-8 text files inline as `<attachment-content>` blocks. **PDF/DOCX are rejected with explicit errors** — extraction needs parent-installed deps (`pdf-parse`, `mammoth`); no deps added here. Run POST accepts `attachmentIds: string[]`; ids are workspace-scoped; per-image estimate 4096 tokens; limits enforced server-side.
- **Runs/queue:** runs no longer reject a busy workspace — different workspaces run in parallel (verified via overlapping provider requests), same workspace serializes FIFO via `drain()` (`queued` → executes when the previous finishes; waits on workspace terminal lock). Second active task on the same SESSION is rejected. Queued cancel works; queued runs survive server restart (input persisted under data/run-private, resumed on recovery by live owner PID). Queued config (incl. secrets) is server-only, never in responses. `record.task` is now the FULL task text (was 2000-char slice); `finalText` full.
- **Branch API:** `POST /api/sessions/{id}/branch` body `{runId, task?, retry?}` → `{ok, sessionId, task, attachmentIds}`. Branch context = conversation snapshot taken BEFORE the specified run (data/run-context) — verified: branch at run2 keeps run1's context, excludes run2; branch at run1 starts empty. Missing snapshot → explicit 400 (pre-snapshot runs cannot be branched). Parent sends returned `task` as the next run on the new session.
- **Approval gates removed:** review-before-apply no longer pauses runs (`reviewMode: false` everywhere; `awaitApproval` deleted; no `waiting_for_approval` transitions). Journal, revert, and conflict detection retained — Changes remains a revert log.
- **ProgressGuard main loop:** duplicate-success loop now wired in `runMainLoop` (was stage-only). Test proves identical successful observations block with "No progress: N consecutive turns produced no new observations" (`duplicateObservationLimit`), bounded turns.
- **Stage/repair freshness:** `runStageWithRepair` takes `refreshContext()` (rebuilds goal/changed-code/verification context from disk before EVERY attempt) and `afterAttempt()` (manager runs a full verification pass after each attempt). Verified: attempt 2 reads code written by attempt 1.
- **Full output access:** `shell_process` gained `action:"read_full"` returning the entire ring-buffer output + recorded change IDs; full request payloads now archived in `request.started` events; usage rows mirrored to data/usage-archive/<session>/<run>_<request>.json so the rolling 500-row session ledger never loses history.
- **Gaps for parent:** PDF/DOCX parsing (needs `pdf-parse`/`mammoth` install); UI wiring for attachments/branch/queued-cancel; version bump to v1.16 (UI+package together, UI files not mine); real-multimodal-model smoke not run (fixture-verified only); `npm run build` not run this round.

## Launch this copy

Double-click `quickstart.bat` in `E:\aiprojects\coders\ec\ECLucky13`.
Default address: http://127.0.0.1:3313. `npm.cmd run dev` and `npm.cmd run start` also default to 3313. Set `PORT` to override. The original EC12 project was not edited. Runtime data, caches, old indexes, and old generated workspaces were deliberately not imported. Browser settings/session keys use `eclucky13.*`. Backend `.ec12` prompt override paths and `EC12_*` environment variables remain for compatibility.

Settings-based input/output pricing is intentionally retained, as requested.

## Final independently verified evidence

- `npm.cmd run typecheck -- --incremental false`: passed.
- `npm.cmd test`: **135 passed, 0 failed, 0 skipped**. Includes real installed Ponytail, CodeGraph index/query/refresh on an isolated fixture, RTK execution, cancellation, path/journal safeguards, request accounting and stage-change events.
- `npm.cmd run build`: passed on **Next 14.2.35**. The copied node_modules initially contained 14.2.28 despite the manifest; `npm.cmd install --include=dev --no-audit --no-fund` synchronized installed dependencies.
- No lint command/configured linter was found. Next reports `Skipping linting`; this is not a lint pass.
- `quickstart.bat`: installs/checks dependencies, builds when needed, starts loopback port3313. `test-output/lucky-quickstart.log` records `ECLucky13 v1.15 ready: HTTP 200`.
- `node test/lucky-ui.mjs`: **8/8 passed**, no page errors, against production port3313 with explicitly mocked API fixtures. Tests cover prompt bounds/drafts/save failures, focus, model picker, role rendering, answer-before-summary, outcome class, resize/125% zoom, file keyboard navigation and terminal retention. Screenshots: `test-output/lucky-ui-prompts-1280x800.png`, `lucky-ui-prompts-800x700.png`, `lucky-ui-workbench-1100-zoom125.png`.
- `node test/lucky-approval-live.mjs`: **APPROVAL_API_PASS**, run `run_7jek26g2mu5wmuxi`, **two approvals** (main write and review-stage write), final `succeeded`, review PASS. Uses actual HTTP routes and a controlled local provider fixture. Files remain unchanged until approval. This test caught absent stage change events, which were fixed and regression-tested.
- `$env:EC12_BASE='http://127.0.0.1:3313'; node test/e2e.mjs`: **LIVE_E2E_PASS** with actual LM Studio `qwen/qwen3.5-9b`: remembers citron across messages, reads and minimally repairs a planted subtraction bug, executes npm test, then completes review with report_verdict on attempt1. Runs `run_gxrrplydmu5wmv0u`, `run_bs85gertmu5wmw6i`, `run_kh5jixj9mu5wmx2k`. Evidence: `test-output/e2e-v104-1789672225347`.
- Final server log: `test-output/lucky-final-runtime.log`; stderr `test-output/lucky-final-runtime.err`.

## Delivered core workflows

Session history/search/pin/rename/delete/undo, Ask/Plan/Code, workspace picker, file tree/editor, file mentions, Markdown replies with copy actions, reusable prompts, Stop, streamed activity, separate review/reasoning content, command palette, selectable diffs/revert/review approval, editable prompts with protected drafts, configurable pipeline/limits/reasoning replay, manual terminal, context/token reporting, honest integration statuses and CodeGraph Index/Refresh.

Final parent fixes after reviewing subagent output: corrected launcher identity/port/installed dependencies; replaced stale Prompt Studio VERDICT text; added actual user role classes; moved run details after the answer into an outcome-aware disclosure; fixed original-goal and per-stage changed-file handoff; emitted stage lifecycle and change events with scope; gated stage mutations for approval; wired UI bulk approval before resume and continuation after individual approvals; workspace-aware integration discovery. Subagent claims below about these features were premature until these final changes.

## Remaining work — do not claim full parity

- Images/general attachment upload and multimodal provider messages are not implemented. File mentions insert paths/instructions, not attachments.
- No dedicated Git diff/commit/branch/worktree or PR interface, background cloud task management, scheduled automations, or parallel-agent task UI. Terminal access is not equivalent to dedicated Codex UI parity.
- Native tool-call and text fallback paths are tested; no LM Studio SDK third routing layer was added.
- Full escalating-difficulty benchmark (3–6 builds), multiple-cloud-provider matrix, 200% zoom, full keyboard-only walkthrough and screenshot of a real streamed model session are not completed. Current browser tests are fixture-based; real-model tests use API.
- Main-loop duplicateObservationLimit is exposed but the new ProgressGuard is currently only exercised in stage execution; finish main-loop wiring and test it before claiming comprehensive nonprogress protection.
- Reasoning replay `auto` still uses local/remote defaults, not a maintained model-capability catalog. Manual policies exist. No measured cloud billing/savings claim.
- Stage handoff now refreshes changed-file lists between stages but verification snapshots are refreshed at final verification, not after every repair attempt. Further bounded handoff optimization remains.
- Some UI accessibility refinements remain (resizer keyboard control, workspace-modal focus, nested tab-close button), pipeline configuration can still change during an active run, and editor loading props need complete parent wiring.
- Bulk-approval browser verification completed: `$env:BROWSER_APPROVAL='1'; node test/lucky-approval-live.mjs` clicked Inspector, then Approve all & verify at both main and stage gates. Each approve/resume returned HTTP200; run `run_lo81m1hemu5wtotn` succeeded with review PASS. Earlier browser timeouts were caused by the test leaving the inspector closed. Pending approval could be made more discoverable without opening the inspector.
- Session request-ledger growth, multi-writer event sequencing, repeated usage-frame normalization, complete full-output artifact retention and every hardcoded preview/continuation limit still require focused follow-up. Do not interpret the passing suite as exhaustive audit closure.
- Terminal history persists across panel toggles only, not full reload. Active approval continuation cannot survive app restart; it reports interrupted/unresumable rather than silently executing.
- Preserve Settings-based pricing. Original old-version notes below are historical, not the current launch instructions.

## Next action

Close the explicit remaining audit items, then implement attachment and Git/worktree workflows with capability-based UI and end-to-end tests. Use the current fork rather than making another copy. Backups are under `backup/lucky-*`; final parent backups under `backup/lucky-final`.

---

## Historical implementation notes (may contain superseded claims)

## lucky-integrations completion round (2026-09-17, this increment)

Finished/verified the prior integration agent's left-behind work: `test/lucky-integrations.test.mjs` (grown 8 → 14 tests, all passing) plus the mcp-stdio/codegraph/context7/registry/prompt-files code it exercises. Backup of every pre-edit file: `backup/lucky-integrations/resume-20260917-095158/` (prior agents' backups untouched).

- `node --import ./test/register.mjs --test test/lucky-integrations.test.mjs`: **14/14** — MCP drain/protocol/cancel/deadline-kill, real installed Ponytail, read_file paging + long-line continuation, search paging/unreadable roots, web_search honesty, **real CodeGraph Settings flow on an isolated fixture (index → cross-bundle ready via globalThis → query luckyAdd → refresh → query luckyMultiply → stop with zero child leak)**, zero/unlimited output limits (read/shell/search/todo), real RTK test + executed rewritten command on a local fixture, Context7 discovered-schema negotiation with the resolver `query` argument (live: /vercel/next.js docs returned, no cloud inference), skill read confinement, MCP deadline PID exit assertion.
- `npm test`: **131/131**. `npm run typecheck -- --incremental false`: clean. `npm run build`: passes.
- Live production server (:3212): codegraph `index` → ok "Files indexed: 1"; `test` → ok:true; edit + `refresh` → ok:true; `test` → ok:true; `stop` → 0 codegraph children; full tree killed afterwards, 0 leftover node processes.

### Fixes
- `codegraph-mcp.ts`: Settings/API `action: 'index'` alias accepted; shared persistent manager (globalThis) verified across route bundles.
- `context-tools` route: caller-supplied context-tool limits normalized and honored (mcp/codegraph timeouts, tool gates — limits are real, not fake settings); codegraph `test` is a transport probe; RTK test verifies a genuine `rtk rewrite "git status"` rewrite.
- RTK 0.49.0 exits 3 on successful rewrites ("No hook installed" stderr) despite its help text; registry + route validate output shape instead of exit code, so shell_command rewriting actually fires.
- `SettingsDrawer`: Test/Index/Refresh send configured `contextTools` limits with each request.
- Zero = unlimited now honored for readFileMaxChars/toolOutputMaxChars/shellOutputMaxChars/searchOutputMaxChars (previously 0 fell back to defaults).
- `search_files` on a single-file root no longer drops the filename (empty relative path broke matches).
- `prompt-files.ts` (surgical, per scope): listSkills skips symlinked-out skills; readSkill resolves root+dir+target realpaths, rejects absolute/ADS/escape paths; in-skill reads unchanged.
- `runs/manager.ts`: finished the compile-field mismatch — `awaitApproval(): Promise<boolean>` (TS1345) and `stageOutputContinuationLimit` dep name (TS2561).
- `mcp-stdio.ts`: deadline close awaits taskkill completion (silent-child PID verified gone; no liveness leak).
- `install-mcp.mjs`: cwd-independent root; honest Ponytail check (entry+hooks+deps); Ponytail installs by cloning its repo into vendor + npm install (the `github:` spec path failed).

### Limitations
- CodeGraph "No relevant code found" surfaces as ok:false from the vendor tool itself; only the Settings test action treats it as a transport pass.
- Context7 by library name can be ambiguous (Next.js → 5 candidate ids); passing an exact `libraryId` is the supported path.
- RTK detection is output-shape based; a future RTK that changes its output format needs the regex revisited.
- All live verification used isolated fixtures under `test-output/lucky-integrations/`; no user workspace, no cloud inference.

## lucky-ui main-app round (2026-09-17, previous increment)

Scope honored: ONLY `src/components/Ec12App.tsx` + new `src/components/MessageContent.tsx` (one forced exception: `src/app/layout.tsx` title 1.16→1.15, pre-backed-up, to make the UI contract test `test/lucky-ui.mjs` green — that test asserts `ECLucky13 v1.15`). Pre-edit backups: `backup/lucky-ui/` (Ec12App.tsx, layout.tsx, manager.ts.pre-luckyui — manager never edited by this round). No new dependencies. No new comments added.

### Implemented (Ec12App.tsx + MessageContent.tsx)

- Brand ECLucky13 v1.15 (brand chip + empty state). localStorage fully namespaced `eclucky13.settings.v1` / `eclucky13.panels.v1` / `eclucky13.session`; the silent EC11 auto-migration block was REMOVED (old keys are never read or written; Settings drawer's explicit "Import from EC11" button remains the only migration path).
- Header dedup: removed duplicate Files / Sessions / New session / Stop buttons (sidebar tabs + composer own these). Header now has Terminal, Inspector, Commands · Ctrl+K, Settings.
- Hideable right inspector: `aside.agent-col.compact-inspector` gets `inspector-hidden` when closed; the right drag-handle only renders while open; grid is `minmax(0,1fr)` and only adds the right column when open.
- New `MessageContent.tsx`: dependency-free minimal Markdown (headings, ordered/unordered lists, blockquote, fenced code with Copy code, inline code/bold/emphasis, safe http/mailto links only). `Copy reply` button on live assistant + history replies; history rows got a `Reuse prompt` button that appends the prior prompt into the composer (non-destructive).
- Run summary renders AFTER the answer with correct outcome, now through MessageContent, class `run-summary`, includes verification exit codes.
- Per-stage isolation: events carry `data.phase`/`data.stageId`; stage-scoped `assistant.delta`/`reasoning.delta` go to per-`stageId:attempt` buffers shown in the Auto-prompts tab (`.stage-card`), never into the main answer.
- Agent questions render inline in the feed (`.agent-question`) with option buttons and an answer flow bound to the current runId; stale answers are rejected.
- Race fixes: every incoming event must match the current runId+sessionId; SSE handler ignores events from a closed source; history loads carry a request token + session check (no cross-session clobber); `newSession()`/`openSavedSession` return/propagate bool and refuse while running/saving (all callers incl. workspace switch respect it); editor save snapshots content+revision before the fetch and only clears `dirty` if the buffer didn't change meanwhile; workspace/session switch bumps a file epoch so late saves can't land; send() suspends the old run first (generation bump closes old ES, clears runId, bumps history token) before resetting state; the run poller is bound to its runId + generation and skips ticks whose fetch was started before newer events arrived.
- History uses the new paging API (`GET /api/runs?sessionId&limit=20&before=`): "Load older messages" appears only when `nextBefore` is present; errors surface instead of dying silently.
- Selected change drives its diff: clicking a row selects it and fetches the FULL change record (`/api/changes/[id]`, real before/after via shared lineDiff) instead of "first pending"; loading/missing/error states are explicit.
- Verification rows show status badge + name + bounded output preview (`.tool-card`).
- Ctrl+K palette with real actions: New session, Sessions, Files, Settings, Terminal, Show/Hide inspector; Enter runs first match, Escape closes, IME-safe via `nativeEvent.isComposing`/keyCode 229.
- Ctrl+Enter sends (also IME-safe); Enter still sends, Shift+Enter newline; `.composer-meta` strip documents this.
- `@file` mention popover: real FileTree; picking a file inserts its relative path plus an explicit "read this file first" instruction into the composer. Honest hint: images are not supported.
- Usage/cost honesty: chip shows "Run usage / cost: unknown" until a run actually reports `usage` (zero is never fabricated); "partial" tag when `request.finished` reports `usageStatus: unknown`; formula unchanged (input/output per-1M from settings). Plan tab shows context-scope (main vs stage) and unknown-state text.
- No fabricated defaults: model chip, context meter, and session indicator all render unknown/empty states instead of inventing values.

### Verified

- `npx tsc --noEmit`: clean (remaining manager.ts errors were fixed by the concurrent pipeline agent mid-round).
- Dev server + Playwright (real chromium): `BASE_URL=http://127.0.0.1:3000 node --test test/lucky-ui.mjs` → **8/8 PASS** (owned contract test by the layout round).
- Extra probe (added then deleted): Ctrl+K palette actions all fire, @file tree renders, inspector open/close toggles grid columns + aria-expanded + CSS-hidden class correctly (9/9), page title v1.15, zero pageerrors.
- Production `npm run build`: succeeded (all routes compiled).
- `node --import ./test/register.mjs --test test/session-delete.test.mjs test/run-progress.test.mjs`: 8/8 PASS.

### Gaps / coordination notes

- Palette `listitem` buttons are unstyled `<button>`s; the CSS colleague's `.command-palette` exists but a list-item style would polish it (functional inline fallback in place).
- Title/Settings-header/SettingsDrawer already read v1.15; package.json `version` is still 1.0.14 (not this round's file).
- A full live-model run (LM Studio) was not driven this round; streaming/stage behavior is covered by the mocked-API contract test plus server tests only.

## lucky-layout UI round (2026-09-17, previous increment)

Scope: ONLY `src/app/globals.css`, `src/app/layout.tsx`, `src/components/{FileTree,ModelPicker,TerminalPanel,CodeEditor}.tsx`, new `test/lucky-ui.mjs`. Main UI (`Ec12App.tsx`, `MessageContent.tsx`, `SettingsDrawer.tsx`) and Settings belong to other agents; where their in-progress DOM differed from the spec, this round adapted owned CSS/test rather than editing their files. Backups of every pre-edit owned file: `backup/lucky-layout/` (plus `backup/lucky-manager/manager.ts` snapshot taken during diagnosis, never edited).

### What changed

- **globals.css (owned)**: Prompt Studio split is a real grid `260px minmax(0,1fr)` (was `flex-direction: row !important` on a column flex parent); `.prompt-edit` gets `min-height:0` + own scroll, editor min-height 520px removed, `.prompt-edit-head` wraps with shrink-safe selects/buttons, hint/label rows shrink-0; mobile (≤900px) collapses to single column with `.prompt-source-select` visible and list hidden; `.settings-nav` wraps with 36px buttons; drawer head/foot flex-shrink 0, close-notice scrolls; inspector-hidden column collapse via `:has()` (desktop widths) + `display:none` fallback; `.ev[class="ev"]` bare user rows get 16px (main UI does not yet emit `.ev.user`); role labels 14px; reasoning non-italic 14px full-contrast; `.run-details` AND `.run-summary` outcome classes (good/bad/warn left borders); Markdown `.message-content` styles incl. fenced `pre` block scroll + copy buttons; `.composer-meta`; ModelPicker list/search styles; FileTree `.tree-row` as real buttons (36px min-height, 14px); terminal text 14px; `:focus-visible` outlines; `prefers-reduced-motion`; dvh app height; 800/1100 media-query `minmax(0,…)` overflow guards; 540px stacking.
- **layout.tsx (owned)**: metadata title `ECLucky13 v1.15` (was EC12 Coder v1.14).
- **FileTree.tsx (owned)**: rows are real `<button>`s with `aria-expanded` (folders), `aria-current` (active file), ArrowLeft/Right expand/collapse, aria-labels "Folder X"/"Open file X", Enter/Space work.
- **ModelPicker.tsx (owned)**: separate search input inside the dropdown (no longer mutates the selected model via `onType`); Browse button toggles with `aria-expanded`; row pick and hide are separate buttons (click, not mousedown-preventDefault) with aria-pressed/aria-labels; visual selection index clamps to filtered list and normalizes across grouped display; Escape returns focus to Browse; blur closes; scopes open on Enter/Space (were mousedown-only, unreachable by keyboard).
- **TerminalPanel.tsx (owned, rewritten)**: dead "Agent output" tab removed; per-workspace module-level state keeps manual output/command history persistent across panel unmount/remount (until page reload); no fake cancel — busy state explicitly says "closing does not cancel"; HTTP-status + `commandOk` vs `ok` distinction surfaced; reconciliation message surfaced; human-readable connection-failure text.
- **CodeEditor.tsx (owned)**: loading state (`Loading {path}…`) when value is `undefined`; error state with Retry; Save disabled (and a no-op) when uninitialized/loading/error; readOnly + `key={path}` so switching files can't show a stale buffer; font 14px.
- **test/lucky-ui.mjs (new)**: playwright-core + Edge path fallback (`EDGE_PATH` env override), `BASE_URL` default `http://127.0.0.1:3313`, refuses to run unless the parent's server responds, mocks ALL `/api/*` (models/integrations/sessions/runs/events/prompts/files/exec), `assert`-based, writes screenshots + `lucky-ui-results.json` into `test-output/`. 8 checks: prompt editor visible at 1280x800 and 800x700 (grid 260px, own scroll, header/footer not clipped, no overflow), prompt draft retention across save-pending + source/tab switches + failed save (mocked), settings focus trap + Escape restore, ModelPicker search-vs-selection separation + grouped keyboard order + scope/hide via keyboard, transcript role font sizes (16px body, 14px tags), duplicate-replay guard, fenced-code scroll + copy buttons, non-italic reasoning, outcome class, workbench 800/1100 no-overflow + inspector hide + 125% zoom, FileTree keyboard open + terminal persistence across unmount + no Agent-output tab, zero pageerrors + zero unmocked API hits + title ECLucky13 v1.15.
- **tsconfig.json**: removed the `.next-lucky-ui/types` include that my temporary dev server made Next.js auto-add (temp dist dir deleted; file restored to prior content).

### Verified (evidence)

- `node --check test/lucky-ui.mjs` — clean.
- `tsc --noEmit` — **clean** (the two mid-session errors in `src/server/runs/manager.ts` came from the concurrently-editing pipeline agent and were fixed by them before my final pass; I never edited that file).
- `node test/lucky-ui.mjs` — **8/8 PASS** (final run) against an isolated dev server on 127.0.0.1:3313 started only because the parent's server was not up (logged in `test-output/lucky-ui-server.log`); server stopped and port freed after the run. Screenshots: `test-output/lucky-ui-prompts-1280x800.png`, `lucky-ui-prompts-800x700.png`, `lucky-ui-workbench-1100-zoom125.png`, `lucky-ui-workbench-800-zoom125.png`, `lucky-ui-files-terminal.png`, plus per-failure shots from earlier iterations.

### Gaps (owned by other agents)

- Main UI (`Ec12App.tsx`): user turns render `class="ev"` with no `user` class (CSS now compensates for font-size only); outcome row uses `run-summary` not `run-details` (CSS styles both); "you" tag is lowercase vs 14px uppercase labels elsewhere — visual only, no assertion depends on it.
- Prompt Studio save-scope select and header wrap rely on SettingsDrawer markup already present; no further changes needed there this round.
- Manual terminal output persistence is per-page-lifetime (module-level Map); a full page reload intentionally clears it — flagged in the panel's own intro line.

## lucky-safety hardening (2026-09-17)

Implemented the audited defects in this copy only (`ECLucky13`). Backups of every pre-edit file: `backup/lucky-safety/`. New regression file: `test/lucky-safety.test.mjs` (18 tests, all passing). Focused run: 18/18. Full `npm test`: **125 tests, 124 passed, 1 failed** — the one failure (`regression2.test.mjs` "prompt override chain") is caused by `autoprompts/review.md` being updated to the v1.14 `report_verdict` protocol by another agent while the legacy assertion still greps for `VERDICT:`; both files are outside this increment's ownership. `npm run typecheck`: one remaining error in `src/app/api/integrations/route.ts:45`, a file another agent was editing mid-session (changed since this increment's backup) — not owned here.

### What changed (all in owned scope)

- **store.ts**: `validPersistentId`/`assertPersistentId`; `dataDir` now validates every component, rejects traversal, verifies no component is a symlink escaping the data root, and hard-validates session/run/change/staging ids; `readJson` distinguishes missing (fallback) from corrupt (throws) so a corrupt registry is never silently replaced.
- **path-policy.ts**: `realpathNearest` no longer swallows failures on existing targets; a symlinked target resolving outside the workspace now throws (previously the catch swallowed its own confinement throw). `resolveInWorkspace` fails closed.
- **change-journal.ts** (rewritten around the same public API): overlay reads validate the relative path before any staging access; staged deletes are honest tombstones (`exists:false`) via a marker file, not empty-file fakes; approval is oldest-first per path, refuses when disk no longer matches the staged before-image, persists `applying`→`applied` write-ahead, cleans staging, and marks later pendings on the same path `conflict` only when their before-image no longer matches disk; rejecting a change invalidates dependents (`invalidatedChangeIds` returned); `revertChange` refuses to revert-delete a create without journal proof and refuses when disk ≠ after-image; recovery (`recoverUnfinished`) recomputes the after-hash, applies only when disk still matches the before-image, and marks `conflict` instead of clobbering newer content; `listChanges` deduplicates the per-session index (index appended once per change); snapshots track `incomplete` files (oversized/binary/symlink/uncaptured) and a `complete` flag, and `reconcileShellChanges` never reports creates/deletes for files invisible to either snapshot (modifications without a before-image are recorded non-revertible); new `withWorkspaceLock` serializes snapshot/execute/reconcile sequences per workspace.
- **verification/execute.ts**: truthful outcomes — any failed/cancelled check (optional included) ⇒ `failed`; a required check that is not `passed` (unavailable) and no passing check ⇒ `unverified`; `verified` only with at least one passed check and zero failures. Boot checks get child `error`/early-exit handling (spawn errors become `failed` with evidence, never a crash or a hang), bounded output, and guaranteed tree-kill in `finally` (awaited `taskkill`, fallback `process.kill`); boot results no longer claim success after an aborted or exited child.
- **auth.ts**: strict loopback Host allowlist (localhost/127.0.0.1/[::1]; `0.0.0.0` rejected), Origin must be an exact origin match of the loopback target (foreign localhost apps no longer trusted), `sec-fetch-site: cross-site` rejected when Origin is absent, IPv6 bracket parsing fixed. Normal UI (same-origin, no Origin header) is unaffected.
- **secrets.ts**: `resolveApiKey` verifies the stored credential's URL origin+path matches the request before returning it, so a stored key cannot be replayed against a different endpoint via a keyRef.
- **API routes**: `runs` POST validates session IDs, rejects a session belonging to another workspace (409) or a workspace with a locked terminal (409); `runs` GET supports stable cursor paging (`limit`, `before=runId`, returns `hasMore`+`nextBefore`); `sessions` PATCH/DELETE and `compact` validate IDs/numbers; `migrate` derives deterministic valid IDs from EC11 session ids (never path material); `files/[id]` PUT guards against locked workspaces/active runs and the tree recursion now emits workspace-relative paths at every depth (previously nested files returned bare names that failed to open); `changes/[id]/approve` returns 409 on conflict and serializes with the workspace; `changes/[id]/reject` guards active runs; `changes/[id]/revert` refuses during active runs; `exec` runs snapshot→execute→reconcile under the workspace lock, distinguishes `commandOk` from `ok`, reports `reconciliation {ok, complete, skipped, error}` instead of silently swallowing failures, and refuses to run while an agent run is active; `models`/`model-info` resolve server-stored credentials (keys never appear in responses).
- **scripts/launch.mjs**: dependency install now tracks a stamp + package.json/lockfile times + missing packages (`--include=dev`), and the rebuild check covers `scripts/`, `package.json`, lockfile, `next.config.js`, `tsconfig.json`. **setup-browser.mjs** launches `playwright-core/cli.js` via node (the declared dependency ships no `.bin/playwright`), no shell, `error` handler. **install-mcp.mjs** spawns npm through `cmd.exe /d /s /c` on Windows and reports spawn errors. **start-3620.bat** now goes through `scripts/next.mjs` (loopback bind, PORT=3620) instead of binding Next on all interfaces.

### Verified

- `node --import ./test/register.mjs --test test/lucky-safety.test.mjs`: 18/18 (IDs/dataDir, junction escape, overlay validation, tombstones+cleanup, approve conflict, reject dependents, oldest-first ordering, snapshot honesty + non-revertible unknowns, index dedupe, verification truthfulness incl. boot spawn-failure, auth matrix, files tree depth, runs paging + cross-workspace 409, recovery before/after semantics, terminal API, credential resolution without key leakage, incomplete-snapshot safety, lock serialization).
- `npm test`: 124/125 (sole failure attributed above, outside owned scope). `npm run typecheck -- --incremental false`: only the foreign integrations error. `node --check` on all edited scripts: clean.
- All test work is fixture-isolated (`test-output/lucky-safety-*`, `os.tmpdir()`), no real workspace or host paths touched, no exploit reproduction, no servers launched.

### Gaps / not done in this increment

- UI consumption of the new runs paging (`before`/`limit`/`hasMore`/`nextBefore`) is not wired — the transcript UI files are owned by another agent; the API primitive is live and backward-compatible (old callers get the old shape plus additive fields).
- Attachments/file-mention support was not implemented (would require agent-loop and UI changes outside this increment's ownership; not "obvious" without cross-domain edits).
- The typecheck error in `integrations/route.ts` and the stale `regression2` prompt assertion belong to concurrently-edited files; both need their owners.

## v1.14 (unchanged below)
**Date:** 2026-09-16
**Purpose:** reliability rebuild per the Astra implementation contract — make every action, file
change, failure, and success **trustworthy**.

## Exact run command

- Dev: `npm run dev`  → http://localhost:3000 (uses `.next`)
- Build: `npm run build` → outputs to `.next-build` (never touches a running dev `.next`)
- Prod: `npm run start` → serves from `.next-build`
- Checks: `npm run typecheck`, `npm test`, `npm run doctor`
- No env vars required. (Optional: `EC12_TOKEN=<secret>` to require a bearer token; `PORT=3211` to change port.)

- One-click: `quickstart.bat` (installs dependencies, builds when needed, starts production on port 3000, and opens the browser). Set `PORT` before launching to use another port.

## v1.14 cloud token diet, MCP handshake fixes, stall-source elimination (2026-09-16)

This round answered a direct question: is the run-resilience/token-diet work from v1.13 actually
sound, is EC12 still token-hungry on cloud providers, and do the MCP integrations actually work.
Findings below are backed by test/v114-cloud-mcp.test.mjs and by driving both MCP clients against a
real `@modelcontextprotocol/sdk` server during verification (not simulated).

### Cloud was still token-hungry — the v1.13 diet was local-only

`retainCompletedReasoning: !isLocal(baseUrl)` meant every remote request replayed **all** reasoning
from every turn — the same 423,607-character problem v1.09/v1.13 fixed for local models, just never
applied to cloud. The comment justifying this cited DeepSeek's requirement to replay
`reasoning_content`, but DeepSeek's actual rule is narrower: reasoning is required only on assistant
turns that carried `tool_calls`; plain-text turns are ignored by DeepSeek and unknown to every other
OpenAI-compatible API, so replaying them is pure cost with no compatibility benefit.

- New `ReasoningReplay` policy (`context-manager.ts`): `'active-batch'` (local default — only the
  latest tool-call batch keeps reasoning), `'tool-turns'` (remote default — reasoning kept only on
  assistant turns with `tool_calls`), `'full'` (compatibility escape hatch). The legacy boolean is
  still accepted so no other call site needed to change shape.
- Durable session history is never touched by this — only the outgoing request is pruned.
- Regression test measures the diet cutting a synthetic 240k-character-reasoning request to under a
  quarter of full replay.

### Remote output budget could exceed what the provider accepts

With `autoModelLimits` on and no catalogue-declared `max_completion_tokens`, `maxOut` fell back to
the full context window, so a 200k-context cloud model received `max_tokens: ~190000` — rejected
outright (HTTP 400) by most hosted APIs, and unbounded/unbudgeted where accepted. `defaultMaxOutput()`
now caps the fallback at 32,768 for remote providers; local is unchanged (a local server can
genuinely generate up to its loaded context). A catalogue-declared limit is never clamped down —
only the *fallback* changed.

### Both MCP integrations were non-functional, and no MCP was ever shipped

Verified empirically: installed the official `@modelcontextprotocol/sdk` (a dependency EC12 never
had), wrote minimal stub servers with it, and pointed EC12's clients at them.

- **Ponytail failed outright.** The client only read `message.result.structuredContent.instructions`.
  The official SDK returns a standard `content: [{type:'text', text}]` array; a correctly installed
  server reported `"Ponytail MCP returned no instructions."` — exactly what the pre-existing test 3
  was catching, which HANDOFF had been describing as an environmental failure.
- **CodeGraph sent the wrong notification name.** `initialized` instead of the spec's
  `notifications/initialized`. The bundled SDK server happened to tolerate it; a strict server would
  not have.
- **Context7 called a tool that doesn't exist.** It called `query-docs`; the published Context7
  server exposes `resolve-library-id` and `get-library-docs` (library argument
  `context7CompatibleLibraryID`). Every docs fetch was failing.
- **Neither vendor server ships with the project.** There is no `vendor/` directory in this
  repository, and `ponytail: true` is the default setting — so out of the box the model was handed a
  tool schema for a server that cannot answer, burned a turn discovering that, and fed the no-progress
  watchdog.
- **Neither client had a call timeout.** A server that starts but never answers hung the tool call —
  and the run — indefinitely.

Fixes:

- New shared `src/server/mcp-stdio.ts`: one spec-correct stdio JSON-RPC client (correct
  `notifications/initialized`, `content`-array and `structuredContent` result parsing, a bounded
  60s default timeout) used by both Ponytail and CodeGraph instead of two divergent copies.
- `src/server/context7.ts` rewritten: discovers actual tool names via `tools/list` and caches them
  per endpoint, tries `get-library-docs` then `query-docs` in that order, sends
  `MCP-Protocol-Version`, and bounds its stale-session retry to one attempt (it could previously
  recurse without limit).
- `RunManager` now checks `ponytailMcpInstalled()` / `codegraphMcpInstalled()` before building the
  tool schema for a run: an enabled-but-absent MCP is dropped from the schema with a one-line notice
  instead of being offered and failing. `/api/integrations` and Settings > Tools now report each
  MCP's real install state, matching how RTK's "not installed" state already worked.
- New `scripts/install-mcp.mjs` (`npm run install:mcp [ponytail|codegraph]`) installs both vendor
  servers under `vendor/`, which remains outside version control (CodeGraph's bundle is
  platform-specific; Ponytail is pulled from its own repository).
- Re-verified against the real SDK server after the fix: both Ponytail and CodeGraph now complete
  the full `initialize → notifications/initialized → tools/call` handshake and return usable text.

### Two stall sources that were never in the agent loop

Diagnosis: v1.13's stall fixes were all inside `runMainLoop`. Two causes live entirely outside it,
in code that runs on the same single thread that drives the loop and serves the event stream — so
either one reads to the user exactly like a stopped run, with `maxIterations: 0` making no
difference because the loop was never the thing that stopped.

- **`eventStore.history()` re-read and re-parsed the entire per-run JSONL file on every call.** The
  SSE route (`/api/runs/[id]/events`) polls this ~6.7 times/second per connected client. On a run
  with substantial shell logs or diffs, that's tens of MB/sec of disk IO and JSON parsing in the
  agent's own process. `EventStore` is rewritten to keep a bounded in-memory window (last 2,000
  events) per run plus a byte offset into the file, so a poll against an idle run costs a length
  comparison instead of a full re-read; only a request for events older than the memory window falls
  back to a full read. `history()` also now picks up external writers (other route bundles,
  restarts) via a tail read from the last known offset instead of a full rescan.
- **`countTokens` is quadratic in the length of a single whitespace-free run.** Measured on the
  verification machine: 20,000 identical characters took ~18 seconds to encode, and cost grows with
  the square of run length. Token counting runs synchronously on every message of every turn (main
  loop, stages, auto-compaction), so one degenerate string — a `======` build-log rule, a padded
  file, a corrupted blob — could block the whole server for minutes while emitting zero events. Fixed
  by sampling: runs at or under 1,000 characters (essentially all real content — prose, source, JSON,
  base64 all break on shorter boundaries) are still encoded exactly; a longer unbroken run is sampled
  at its head and the ratio scaled, verified within ~5% of exact on synthetic degenerate input and
  unchanged for everything else. A regression test asserts the count for 120,000 degenerate
  characters completes in under 2 seconds (was ~18s for a sixth that size).

### Also fixed while verifying

- Bumped the pinned `next` dependency from `14.2.28` to `14.2.35`. `14.2.28` carries the
  Next.js/React Server Components DoS and source-code-exposure issues disclosed 2025-12-11
  (CVE-2025-55183, CVE-2025-55184, and the follow-up complete fix CVE-2025-67779); `14.2.35` is the
  patched release in the same 14.x line — a same-minor version bump, not a framework upgrade. (The
  separate critical RCE, CVE-2025-66478/CVE-2025-55182, affects Next.js 15.x/16.x and 14.3.0-canary
  builds; 14.2.x stable was never in its affected range.) Re-verified typecheck, full test suite, and
  production build against the patched version after the bump.
- `executeTool` capped only successful output; a failing tool's error text (a stack trace, a
  megabyte of stderr) was replayed to the model uncapped. Now capped at 4,000 characters like
  successful output already was.
- `session.usageEvents` grew without bound for the life of a session. Capped to the most recent 500
  requests (a rolling window); `session.usage` keeps the lifetime totals, which were never bounded by
  this.
- `search_files` threw and aborted the entire search on the first unreadable file or directory
  (permissions, a vanished temp file, a device node); it now skips the entry and continues.
- `runStage`'s text-mode tool-call fallback called `JSON.parse` unguarded; a malformed text tool call
  could throw out of the stage and fail the whole run instead of being reported as an invalid call.
- Removed the dead legacy regex-based `codeGraph()` index from `tools/registry.ts`, superseded by the
  official CodeGraph MCP since v1.08 and no longer called from anywhere.
- `runPowerShell` hardcoded `powershell.exe` and could not spawn on non-Windows, which is why 5 of
  the "environmental" test failures existed at all — they had never actually run. `resolveShell()`
  keeps Windows PowerShell exactly as before and uses `pwsh` (or the POSIX shell) elsewhere, so the
  managed-shell tests (process yield/poll, Stop, tail-capping, journal reconciliation of shell-created
  files, process-tree kill) are meaningful on every platform, not asserted-to-fail outside Windows.
- The global Skills test asserted that the machine running the suite happened to have
  `~/.codex/skills` populated, so it failed on any clean checkout. `skillsRoots()` now also reads
  `EC12_SKILLS_DIR` (a `path.delimiter`-joined list of extra roots), which is useful in its own right
  for a custom skills location and makes discovery testable without depending on the host machine.
- `/api/integrations`'s RTK probe used `where rtk` unconditionally, which does not exist outside
  Windows; now branches on `process.platform`.

### Verification

- `npx tsc --noEmit`: clean.
- `npm run build`: passed, all routes.
- `npm test`: **97 tests, 96 passed, 0 failed, 1 skipped** (Ponytail's live-MCP test skips with an
  explicit reason when `vendor/` is absent, rather than being asserted to fail). Previously 85 tests,
  78 passed, 7 failed with 6 of those attributed to "environment boundary" — one of the six (Ponytail)
  was an actual defect, not an environment issue, and is now covered by a passing/skippable test
  instead.
- New `test/v114-cloud-mcp.test.mjs` (10 tests): remote reasoning replay policy, the token-diet size
  reduction, degenerate-input token-counting bound, durable history untouched by pruning, the remote
  output-budget cap, failed-tool-output capping, incremental event-log reads, MCP `content`-array
  parsing, an MCP call timing out instead of hanging, and `search_files` surviving an unreadable file.
- Live check: built and started the production server, confirmed `EC12 Coder v1.14` served at
  `http://127.0.0.1:3000` (HTTP 200), and confirmed `/api/integrations` and
  `/api/context-tools` report `ponytail`/`codegraph` as not installed with the
  `npm run install:mcp` remediation — the honest state for a fresh checkout with no vendor servers
  present.
- Vendor MCP servers are intentionally not included in this package (CodeGraph ships a
  platform-specific native bundle; Ponytail is pulled from its own repository). Run
  `npm run install:mcp` after unpacking to install both; until then, their tools are correctly
  withheld from the model instead of offered and failing.

### Known limits carried forward

- The token-count sampling estimate is exact for ordinary content and within ~5% for degenerate
  input; it is still an estimate, not the provider's own tokenizer. Actual counts still arrive from
  provider-reported usage, as before.
- `EventStore`'s in-memory window is 2,000 events per active run; a request for events far outside
  that window still does one full file read, same as v1.13 did for every request.
- This round did not re-verify a live model against a hosted cloud provider (OpenAI/Anthropic/etc.)
  end-to-end; the token-diet and output-budget fixes are verified at the request-construction level
  with deterministic tests, not against a live billed API call.

## v1.13 run resilience + token diet (2026-09-17)

Diagnosis of "runs keep stopping": the loop had multiple hard-stop paths where a single
recoverable hiccup ended the whole run. All are now bounded in-place recoveries:

- **Output-limit cut-offs no longer kill the run.** `finishReason: 'length'` with a complete tool
  call now executes that call and continues; with text-only output the turn continues from where
  the model stopped (bounded at 4 continuations, then an actionable error naming the output limit).
- **Malformed tool calls no longer block the run.** Incomplete/invalid tool-call JSON is fed back to
  the model with the exact parse problem; it re-emits the call (bounded at 3 recoveries).
- **Retryable provider errors re-request the turn.** Empty responses, streams that end before
  completion, and transient HTTP/network errors re-request the SAME turn (nothing was committed, so
  re-requesting cannot duplicate work), bounded by the new `agent.turnRecoveryAttempts` (default 3).
  Auth/validation errors still fail immediately. One corrupted SSE frame is now skipped instead of
  killing the stream (a stream with nothing usable still fails).
- **No-progress watchdog (new `agent.noProgressTurnLimit`, default 20, 0 = off).** Blocks only after
  N CONSECUTIVE turns where EVERY tool call failed — the meandering case that dodges the
  existing repeated-failure guard by producing a different error message each time. Any successful
  tool call resets the counter. **Unlimited iterations (maxIterations 0) are intentional and
  unchanged**: productive runs can iterate forever; only pure failure loops are stopped.
- **SSE heartbeat.** `/api/runs/[id]/events` now emits `: ping` every 15 s. Long silent phases
  (builds, local inference) previously sent zero bytes and could be dropped by browsers/proxies,
  making a healthy run LOOK stopped in the UI.
- **Stage hardening.** Review stages now continue in place after an output-limit cut-off (bounded),
  re-request after retryable stream errors, and report their token usage through the same pricing
  path as the main loop; stage usage now counts toward the session meter (accounting fix).

Diagnosis of "token heavy": three compounding costs are now bounded without changing behavior:

- **Reasoning replay of completed tool batches is pruned (local models).** Within the active user
  turn, `reasoning_content` is kept only on the LATEST assistant tool-call batch; completed batches
  drop it. Previously reasoning compounded every iteration of a long coding turn (the v1.09
  diagnosis measured 423,607 replayed reasoning characters). Durable history and event logs keep
  everything; remote providers still get full reasoning replay.
- **Tool outputs are capped before entering history.** `shell_command`/`shell_process` replay is
  tail-capped to 8,000 characters (build errors live at the end; the full log stays in Artifacts
  and the event log). `read_file` returns head 20,000 + tail 4,000 with a middle marker (was a
  60,000-character head). `search_files` lines cap at 300 characters and the whole result at
  16,000 with paging guidance. codegraph/context7/ponytail/skills cap at 12,000; web_search 6,000.
- **Loop scheduling hardening:** the main and stage loops yield a macrotask slot every turn.
  With an instant provider the loop could spin purely on microtasks and starve timers — abort
  callbacks (Stop) would never fire. Verified by a regression test.

New settings (Server → Limits → advanced; defaults apply without UI changes):
`turnRecoveryAttempts` (3), `noProgressTurnLimit` (20). `maxIterations` remains 0/unlimited.

New regression tests: `test/v113-resilience.test.mjs` — 13 deterministic tests with a scripted
provider: cut-off with complete tool call, cut-off continuation, malformed-call recovery,
empty-response retry, non-retryable auth failure, watchdog blocks varied-failure loops, watchdog
reset by success (and off when 0), reasoning pruning, read/search caps, shell tail cap, stage
cut-off continuation, stage usage reporting, SSE frame tolerance.

Verification: `npx tsc --noEmit` clean; `npm run build` passed (all routes); suite 85 tests,
79 passed with the 6 pre-existing environment-boundary failures (Windows PowerShell process-tree
tests, Ponytail vendor MCP, machine skills dir) failing identically on unmodified v1.12 in the
same Linux verification environment. Version v1.13 across UI/launcher/package/quickstart.

## v1.12 run reliability (2026-09-16)

- Diagnosed real stalls: foreground `quickstart.bat` waited 95 minutes and `npm run dev` waited 63 minutes until cancellation. Shell commands now yield a process ID, keep running without an execution timeout, and can be polled/stopped through `shell_process`. A running process is explicitly not a passed check.
- Latest run `run_8tz24mw4mu3p0v7y` stopped producing events inside `search_files` in a workspace containing several custom Python environments. Search previously traversed synchronously, blocking HTTP/Stop handling. It now uses asynchronous filesystem operations, checks cancellation, and excludes Python environments by pyvenv.cfg plus standard dependency/cache directories.
- Removed run-recovery side effects from module construction: importing route modules during a build must not mark live runs interrupted. Recovery now runs on actual runtime access, and records include owner PID so recovery skips living owners. This build-side effect was observed during isolated verification of the initial v1.12 changes.
- Stop reports request failures in the UI; cancellation is idempotent, applies while awaiting approval, survives async errors, and cannot be overwritten by a later generating/success state. UI reconciles state with the server every 3 seconds, exposing lost connections. Local model inference still has no execution/idle timeout; the new UI HTTP deadlines only report connectivity failures.
- Provider SSE `[DONE]` ends the response even when the provider leaves the connection open; usage frames before DONE remain counted.
- Version v1.12 throughout UI/launcher/package. Backups: `backup/v1.12-run-progress`. Production build and typecheck passed. Server restarted on http://127.0.0.1:3000; `verify-v112-launch.log` records v1.12 HTTP 200.
- New regression tests cover managed processes, real Windows cancellation, loop continuation/polling, never-closing SSE, search cancellation/environment exclusion, import safety and cancellation state races. Browser verification `node --import ./test/register.mjs test/live-v112-stop.mjs` clicked Send then Stop against a controlled streaming provider: cancelled, provider socket closed, zero page errors. Screenshot: `test-output/v112-stop-verified.png`.
- Full regression suite: **72/72 passed** (`test-output/v112-suite-final.log`).
- Full suite initially found an obsolete local-catalog-cache assertion from before dynamic local model switching. Updated it to check remote caching and fresh local catalogs with a deterministic provider fixture (no live LM dependency).
- LM Studio was reachable at final verification but discovery reported no loaded model. No new real-model coding completion is claimed for this update; browser/protocol tests used a controlled provider and process tests executed real PowerShell commands.
- Limitations: process handles are memory-only and do not survive an EC12 restart. Other existing synchronous file/journal tools are unchanged. Store remains single-writer; this does not add a multi-server coordinator. Interrupted user tasks are preserved, not automatically replayed.
- Run: `quickstart.bat` (or `npm run start` after build). Next: retry the interrupted task with a loaded model; inspect the explicit tool/error state if another stall occurs.

## v1.11 session deletion (2026-09-15)

- Added Delete beside Pin/Rename on every session, with inline Delete chat / Cancel confirmation and Undo delete for the most recently deleted chat in the current page.
- Server soft-deletes via persisted `deletedAt`, hides deleted sessions from lists/search, and supports restoration through PATCH. Transcript, runs, change history and project files remain intact. Undo restores pin/title/history. A stale browser cannot start another run on a deleted session (409).
- Server rejects deletion of a running session; UI disables Delete during runs. Deleting the selected idle chat opens a fresh session. Unsaved editor changes must be saved/reverted first.
- Version v1.11 across UI/package/metadata/launcher. Backups: `backup/v1.11-session-delete`.
- `npm run build` passed including type validation. `node --import ./test/register.mjs --test test/session-delete.test.mjs`: 2 passed; covers hidden/preserved data, deleted-ID reuse, undo, active-run guard, invalid/missing IDs.
- Live UI: selected test-only `ses_v109_verification`, confirmed Delete, observed empty search results and New session. API list excluded it; disk still held its two history messages plus deletedAt. Undo restored title/pin/transcript; selected it again. Test chat left restored.
- `quickstart.bat` output: EC12 v1.11 ready: HTTP 200 http://127.0.0.1:3000. Log: `verify-v111-launch.log`. Screenshot: `test-output/v111-session-delete.png`.
- Current Undo control is page-local for the last deletion; deleted records remain on disk, but there is no Trash browser or permanent purge control in this change.

## v1.10 changes and verification (2026-09-15)

- Corrected the previously delivered Sessions drawer into a persistent left sidebar, open by default, with Sessions / Files tabs. Search, rename, pin/unpin, new session, selected-chat highlight and same/new-session explanation are directly visible. Selecting a chat leaves the sidebar open.
- Fixed the header clipping: the wrapping toolbar inherited a 46px flex basis. It now sizes to its actual rows. Model/session chips are bounded so long names cannot force controls out of view.
- Removed the narrow-window rule that hid the entire left sidebar. At 800px panels stack and scroll; at the normal 1284px viewport they remain side by side. Viewport override was reset after testing.
- Session search ignores stale asynchronous responses; lists load when workspace/search changes. Confirmed discarding unsaved buffers on session switch now actually clears those buffers.
- UI/package/metadata/launcher bumped to v1.10. Backups: `backup/v1.10-visible-sessions`.
- `npm run typecheck` and `npm run build`: passed. `quickstart.bat` started v1.10 on port 3000; `verify-v110-launch.log` records readiness.
- Live UI verification: searched EC12_READY, renamed test-only session to `EC12_READY sidebar verification`, pinned it, cleared search and confirmed it stays first, selected its saved chat, reloaded and confirmed title/pin persisted, then returned to the UI_READY test chat. Verified the same-session indicator and restored transcript.
- Screenshots inspected at 800x900 and the original viewport. Saved normal-width proof: `test-output/v110-sessions.png`. No model/provider code changed in this round.

## v1.09 changes and diagnosis (2026-09-15)

- Diagnosed actual failed run `run_pxoj2450mu32p2y1`: EC12 estimated 152,211 input tokens, but FreeToken reported 261,744 input + 399 output = 262,143 / 262,144. The session held 423,607 characters of assistant reasoning which were replayed but not counted. The v1.08 note attributing this failure to output reservation was incomplete; the actual evidence identifies omitted reasoning as the main discrepancy.
- Local requests now exclude completed user-turn reasoning, retaining reasoning within the active tool sequence. Saved history/event logs remain available. Remote requests keep reasoning for provider compatibility (DeepSeek requires replay with tools). All transmitted reasoning is counted.
- Provider usage updates the visible context meter and calibrates subsequent estimates per session/provider/model. The meter labels estimated vs provider-reported counts. Main and autoprompt stages share the same request/compaction budget path.
- Automatic compaction can split long coding turns at completed tool batches, retaining protocol pairs and the current request. Recent observations get summary space even when a previous summary is full. Under context pressure, retaining four recent turns is best-effort; fewer complete tool batches may fit. Summaries remain extractive, not LLM-generated, and full detail is in event history.
- Oversized tool results are trimmed to the available request budget, including the latest result if needed. Truncation is marked; original tool output remains in history/events. No local inference timeout was added.
- Manual compaction is read by the next run instead of being overwritten by the RunManager cache. Manual compaction is rejected during an active workspace run; its meter updates immediately. Auto-compaction saves session state when emitted.
- Agent sidebar now has independent Activity, Plan & context, and Auto-prompts tabs. Auto-prompts controls and stage results occupy their own scrolling panel.
- Local catalogs are fresh (remote catalogs remain cached). FreeToken/vLLM single-model endpoints use `/v1/models` as the active model when no native loaded-state API exists. LM Studio native instance context remains authoritative. UI refreshes automatically every ten seconds and server resolves afresh before each task. Auto follows the server; explicit Pinned selection is respected. Changing provider preset selects Auto.
- Bumped UI/package/metadata/quickstart to v1.09. Backups: `backup/v1.09-context-model-panels`.

### v1.09 verification

- `node --import ./test/register.mjs --test test/context-v109.test.mjs test/local-v104.test.mjs`: **16 passed, 0 failed**. Covers local/remote reasoning replay, counting, long-tool-turn compaction, large latest tool output, repeated summaries, LM Studio instance changes, FreeToken model switches, cancellation and unlimited local inference time.
- `node --import ./test/register.mjs --test --test-name-pattern "compaction|pinned model|follow-up turns" test/regression.test.mjs`: **4 passed, 0 failed**.
- Production build passed; launcher reports `EC12 v1.09 ready: HTTP 200 http://127.0.0.1:3000`.
- Real FreeToken run `run_vzund8wcmu36fgeb`, configured `deliberately-stale-model`, resolved `Ornith-1.5-35B-A3B-NVFP4`, succeeded with `EC12_READY`.
- UI click-through: all three tabs separate; FreeToken preset immediately shows its loaded model; manually entered `stale-test-model` automatically replaced without clearing. Real Ask prompt returned `UI_READY`; meter updated to provider usage 3,395 / 262,144. Screenshot inspected.
- Read-only replay of a copy of the problem session removed all 423,607 completed-reasoning characters from the outgoing request; estimated request was 148,932 tokens before full project/system schemas. User session was not modified by this replay.
- Final-build restart and follow-up verified: runs `run_fvc0l2jhmu36g6ok` and `run_quk6gat8mu3bcbzt` use the same session `ses_5rglxh35mu36g0a1`; the follow-up recalled `UI_READY` after restart. Both messages remain visible. Final meter: 3,383 / 262,144 (provider reported). Screenshots: `test-output/v109-context-continuity.png`, `test-output/v109-autoprompts.png`. Final launcher log: `verify-v109-final.log` (HTTP 200).
- LM Studio was reachable but had no loaded model; its switching path was verified with native-response fixtures, not an actual GPU model swap. FreeToken live generation was tested. Full Windows process-tree suite was not rerun.

### Next checks / known limits

- Actual counts appear after the provider reports usage; preflight counts are still estimates and model tokenizers may differ. A single huge user/system instruction can still exceed the model window. Provider-side generation caps remain real and surface as errors.
- Do not claim SOTA parity from this fix: this round fixes the reported UI, model-switching and context accounting defects.
- Run using `quickstart.bat`; production is port 3000. Verification output: `verify-v109-launch.log`. Test-only session `ses_v109_verification` uses workspace-test.

## v1.08 changes

- Replaced the old local regex-based `code_graph` tool with the official `@colbymchenry/codegraph` MCP integration, installed under `vendor/codegraph`. EC12 now calls CodeGraph's real `codegraph_explore` MCP tool through stdio, using CodeGraph's bundled Windows runtime and the project `.codegraph` semantic index.
- Added a real searchable Session sidebar. Sessions persist per workspace and can be opened, renamed, pinned, and searched. The top bar now states `Same session · …` or `New session` so a reply cannot silently look like a new chat.
- Added a full-width Prompt Studio tab in Settings. Prompt sources are listed at left and the editable prompt uses a readable 15px editor with room for the full prompt, app/workspace save scope, and no cramped activity-panel layout.
- Added durable automatic compaction: enabled by default at 80% of the loaded model context and retaining four complete recent turns. It preserves the original task, active plan, project/system instructions, and earlier tool calls/results in a bounded, model-context-aware summary. The visible meter uses `used / context tokens · auto-compact at 80%`; `Compact now` reports the exact saved-summary result.
- Corrected local context budgeting. The request planner used to reserve 20% of the model context for output before computing room for history and tools, which caused premature context-limit failures. It now keeps only a small protocol reserve and adapts output to the actual remaining room. Automatic compaction counts system instructions and tool schemas before sending the request.
- Excluded `vendor`, CodeGraph data, test output, and build artifacts from TypeScript project scanning. This prevents the embedded CodeGraph runtime from causing slow production builds.
- Bumped the UI, metadata, package, launcher, and readiness text to v1.08.

## v1.08 verification (2026-09-15)

- `npm run typecheck`: passed.
- Focused regression tests passed, including durable compaction preservation, tool-pair safety, CodeGraph schema gating, and official Ponytail MCP invocation.
- `npm run build`: passed. The route table includes `/api/sessions` and `/api/sessions/[id]/compact`.
- `quickstart.bat` started the production app and reported `EC12 v1.08 ready: HTTP 200 http://127.0.0.1:3000`; live `/api/sessions` returned `{ ok: true }` for the EC12 workspace.
- Live CodeGraph API test: `/api/context-tools` returned `{ ok: true, status: "ready" }` and real CodeGraph MCP exploration output for the EC12 graph.
- UI click-through at `http://127.0.0.1:3211`: v1.08 rendered; the Sessions drawer showed search, pin, rename, and saved chats; Prompt Studio loaded the full prompt editor; Limits showed auto-compaction on, 80%, and four recent turns; the live history indicator showed `4,898 / 60,928 tokens · auto-compact at 80%` and a `Compact now` button.

## v1.07 changes

- Replaced EC12's copied Ponytail prompt with the official `DietrichGebert/ponytail` stdio MCP server, installed at `vendor/ponytail/ponytail-mcp` with its declared dependencies.
- Added the gated read-only `ponytail_instructions` tool. When Ponytail is enabled the model receives that tool schema, and the server enforces the same switch before launching the MCP process.
- EC12 now performs the standard MCP `initialize` handshake, sends `notifications/initialized`, calls `ponytail_instructions`, and returns the MCP's structured `mode` and `instructions` response. It supports Ponytail `lite`, `full`, and `ultra` modes.
- Settings now labels the integration “Ponytail MCP.” Its Test button calls the actual MCP tool, not a fabricated prompt-loaded success message.
- Version shown in the UI, metadata, launcher, package files, and launch readiness checks is v1.07.

## v1.07 verification (2026-09-15)

- Verified the official server directly over stdio: `initialize` → `notifications/initialized` → `tools/call ponytail_instructions` returned mode `full` and 5,229 instruction characters.
- `npm run typecheck`: passed.
- Focused context-tool suite: 6/6 passed, including the new test that launches the official MCP and asserts its returned rules contain `YAGNI`.
- `npm run build`: passed.
- Live production check on port 3211: `/api/context-tools` returned `{ ok: true, status: "ready" }` with `Ponytail MCP (full)` and the official `YAGNI` rules.
- UI click-through: EC12 v1.07 → Settings → Tools shows “Ponytail MCP”; its Test button visibly returned the official full MCP response.
- The temporary verification server on port 3211 was stopped after the check.

## v1.06 changes

- Follow-up sends no longer make the completed reply disappear. The previous turn is promoted into the visible transcript before the streaming buffer is cleared.
- Server history now loads all recent runs for the session; rendering suppresses only the active run to avoid duplication.
- Earlier user/assistant turns are always visible inline instead of hidden inside a collapsed “Previous replies” section.
- The session ID returned by the server is explicitly retained if the server ever normalizes or creates it.
- The empty welcome panel no longer appears under a real message while a follow-up is generating.
- Version shown in the UI, metadata, launcher, and package files is v1.06.

## v1.06 verification (2026-09-14)

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Targeted automated checks: 15/15 passed (`test/context-tools.test.mjs` + `test/local-v104.test.mjs`).
- Live LM Studio continuity test with `ornith-1.5-9b-mtp@q8_0`: sent a tool-backed first message, then asked a follow-up. The first turn remained visible during generation and the model answered `171, 23` from the retained conversation.
- API records prove both runs used the same session ID `ses_d7y8zp6cmu1y78jq`.
- Reload test: both user/assistant turns restored in order with no missing text and no duplicate active run.

## RTK installation (2026-09-15)

- Installed the official Rust Token Killer directly from `https://github.com/rtk-ai/rtk` with Cargo. The crates.io package named `rtk` was briefly installed first, identified as the unrelated Rust Type Kit because it lacks `rtk gain`/`rtk rewrite`, then removed before the correct binary was installed.
- Verified: `rtk --version` reports `rtk 0.49.0`; `rtk gain` initializes its local tracking database; `rtk rewrite "git status"` returns `rtk git status`.
- Verified EC12 integration live: `/api/integrations` reports `rtk: true` and `/api/context-tools` returns `{ ok: true, status: "ready", output: "rtk 0.49.0" }`.
- The temporary EC12 verification server on port 3211 was stopped after the check.

## v1.05 changes

- Context tool switches now control the exact tool schemas sent to the model. Disabled tools are absent from both main runs and autoprompt stages.
- The execution layer independently enforces the same switches, so a disabled optional tool cannot be invoked by a fabricated/manual tool call.
- Settings → Tools now has a real Test button for every integration and displays the actual response or a plain-English failure.
- RTK uses its supported `rtk rewrite <command>` contract and fails open to the original command. RTK is not installed on this machine, so its checkbox is disabled and the UI shows the exact Winget install command.
- Context7 works with public access, stores optional API keys through the server credential store, and keeps sessions separate per credential. A stale MCP session reinitializes once.
- CodeGraph now implements `refs` in addition to stats/symbol/file.
- Global Skills now discovers `~/.codex/skills` and nested `.system` skills as well as `~/.agents/skills` and `~/.claude/skills`, with duplicate names removed.
- Version shown in the UI, metadata, launcher, and package files is v1.05.

## v1.05 verification (2026-09-14)

- `npm run typecheck`: passed.
- `npm run build`: passed; `/api/context-tools` is present in the production route table.
- Targeted automated checks: 15/15 passed (`test/context-tools.test.mjs` + `test/local-v104.test.mjs`). They cover schema gating, execution gating, CodeGraph references, Codex Skills discovery, LM Studio SSE/JSON replies, cancellation, dynamic token budgets, and no local inference timeout.
- Live API tests: Ponytail ready; CodeGraph indexed 171 files / 3,664 symbols; Global Skills found 23 readable skills; Web Search returned five current results; Context7 returned current Next.js route-handler docs; RTK returned `unavailable` with its install command.
- Live LM Studio run with `ornith-1.5-9b-mtp@q8_0`: the model called `code_graph` and `list_skills` (2/2 tool calls) and displayed `Code file count: 171 | Skill count: 23` in Chat.
- UI click-through: v1.05 rendered, workspace opened, all six Context Tools rows and Test buttons were accessible, live result text appeared, and RTK was visibly disabled because it is absent.
- The complete `npm test` command reaches the Windows process-tree cancellation cases, whose `taskkill /T` cannot finish in the restricted Codex shell. Those test-owned processes were stopped; no assertion failed before that environment boundary. The changed suites were then run directly and completed cleanly.

## v1.04 changes

- LM Studio streaming now uses a cancellation-aware HTTP transport, accepts both SSE and JSON responses, handles trailing/incomplete frames, and surfaces empty/error responses instead of claiming success.
- Local coding mode has no provider, inference, shell, or verification timeout; Stop remains the explicit cancellation control. Remote timeout fields remain available for remote providers.
- Loaded model metadata is read from LM Studio `/api/v1/models`, with loaded context and output budget applied automatically. Manual context/output controls remain available through Settings.
- Context budgeting includes tool schemas and preserves the current task while compacting older tool output. Follow-up turns retain the original request and structured tool history.
- Native text tool-call fallback, `search_files`, `attempt_completion`, plan updates, interactive questions, reconnect-after-refresh, and shared server state were added for coding-agent parity.
- Version shown in the UI and document metadata is v1.04.

## What was implemented (this increment)

**Server-owned runtime (the core fix)**
- `src/server/runs/manager.ts` + `state-machine.ts`: persisted run states with enforced transitions.
  Cancellation cannot become success; a failed required check/stage cannot become success; an exhausted
  iteration budget becomes `blocked`, never success. One run per workspace (serialized). Idempotent
  create by `clientRequestId`. Unfinished runs are marked `interrupted` on server restart (no replay).
- `src/server/events.ts`: append-only per-run event log, **persist-before-publish**, replay after a
  sequence number. `src/app/api/runs/*` exposes create/status/events/cancel/resume.
- `src/server/store.ts`: file-backed store (atomic JSON + JSONL), no native deps.

**Provider & cancelation**
- `src/server/providers/openai-compatible.ts`: real streaming; chunk-safe SSE (split frames, split
  UTF-8, CRLF); tool-call fragments assembled by index with stable ids; separate connect / first-token /
  stream-idle / total timeouts cleaned up in `finally`; bounded abortable retries that never append to
  partial output; **only assembled, validated tool args execute**.
- `src/server/tools/process.ts`: one process service for tools/terminal/verification — streaming,
  artifact capture, exit code + termination reason, **process-tree kill** (`taskkill /T`).

**Conversation & context**
- `src/server/agent/context-manager.ts`: durable structured turns (incl. tool call/result pairs); safe
  compaction that never orphans a tool result and always keeps the latest exchange; a request budget
  that reserves for the output and fails visibly if it cannot fit.

**Filesystem (transactional + reversible)**
- `src/server/workspace/change-journal.ts`: every mutation journaled with before/after + hashes;
  **literal** replacement (never interprets `$&`, `` $` ``, `$'`); rejects ambiguous matches; optimistic
  concurrency (`before_hash`); **revert by changeId** with conflict detection; reverting a create only
  deletes a journal-proven file. **Review mode** stages to `data/staging/<runId>/` — the real workspace
  is unchanged until approval.
- `src/server/workspace/path-policy.ts`: registered workspaces + canonical path confinement (rejects
  absolute/UNC/ADS/`..` and **junction/symlink escapes** via nearest-existing-parent realpath).

**Verification & pipeline**
- `src/server/verification/*`: discovers checks from manifests (typecheck/test/lint/build/boot/browser);
  **zero applicable checks ⇒ `unverified`** (never "passed"); missing browser ⇒ `unavailable`; boot uses
  the app's own start command and probes **`/health` then `/`**; re-verifies after review stages.
- `src/server/agent/loop.ts`: streaming loop with **modes** (Ask/Plan/Code) enforced in the tool layer
  (ask/plan are read-only); progress tracking; **repeated-failure blocking** (no forced edits / no
  infinite loops); usage accounting. Stages use **authoritative structured `report_verdict`** and a
  failed stage blocks success.

**Security**
- `src/server/security/auth.ts`: loopback Host/Origin policy (blocks DNS rebinding) + optional token.

**UI**
- `src/components/Ec12App.tsx` talks to `/api/runs` + events: persistent run status bar, activity cards
  with durations, change diffs with approve/reject/revert, verification results, stage results,
  tokens ↑/↓ + estimated cost, mode selector, Stop, New Session, native workspace picker.

**Docs:** `docs/BASELINE.md`, `ARCHITECTURE.md`, `SECURITY.md`, `MIGRATION.md`, `VERIFICATION.md`,
`KNOWN_LIMITATIONS.md`.
**Second increment (contract gaps 3–10, no model server needed)**
- **Exact tokenizer:** `js-tiktoken` (cl100k, bundled) drives the context budget, labeled with its
  estimator; byte/4 remains only as an unreachable fallback.
- **Bounded stage repair:** `runStageWithRepair` re-runs a failed stage (default 1 extra attempt)
  with the failure in context; `maxRepair: 0` disables.
- **Baseline vs regression:** deterministic checks run before mutation; final failures are split into
  pre-existing baseline vs new regressions in the run summary (optional checks excluded).
- **Browser presence assertions** (title or visible text; empty page fails) + `scripts/setup-browser.mjs`
  (`npm run setup:browser`).
- **Secrets:** `/api/credentials` stores keys server-side; the UI never persists `apiKey` in the
  browser; API keys removed from URL query strings.
- **Resizable panels** (drag handles, persisted) + feed virtualization via `content-visibility`.
- **EC11 importer:** `POST /api/migrate` maps settings + transcript text (repeatable, preserves the
  old keys, never fabricates tool history); Settings → about → "Import EC11".
- **Audit decision (recorded):** `npm audit` flags Next 14.2.28 advisories; upgrading means Next 16
  (breaking), so we deliberately stay — mitigated by loopback-only bind, auth guards, no image
  optimization/middleware/server-actions, and never exposing the port. See `docs/SECURITY.md`.

## Evidence (verified 2026-09-12, live server :3211)

- `tsc --noEmit`: clean. `next build`: clean (20 API routes + page). Legacy removal verified:
  no `src/lib/*` runtime, no competing components, zero `@/lib/` imports in `src/`.
- Tests **41/41 pass** (15 reliability + 16 regression + 10 second-increment): literal edits, ambiguity rejection,
  stale-hash conflicts, revert-by-id + conflict + create-only deletion, review staging, traversal /
  ADS / junction rejection, state-machine terminal guards, event replay, zero-checks ⇒ unverified,
  `/health`→`/` boot fallback, tool-arg assembly, split-frame/UTF-8 SSE, follow-up history,
  ask/plan read-only, structured-verdict authority, compaction safety, nested-TS detection,
  browser-missing ⇒ unavailable, process + **process-tree** kill, session scoping, shell
  reconciliation + revert, journal restart-recovery, interrupted-run marking, pinned-model guard,
  replay dedupe, **exact cl100k token counts**, **bounded stage repair (fail→pass recovery, 0 disables)**,
  **baseline/pre-existing vs regression split**, **browser presence assertions**, catalog cache identity,
  per-request usage forwarding, **single leading system message**, **SSE error surfacing**,
  **prompt-override chain**, **report_verdict stage-only**.
- `npm run doctor`: 8 checks, 0 failing.
- **Bug found and fixed live:** editor-saved changes (`runId: 'manual'`) returned 404 from
  approve/revert ("Unknown run"). Approve/revert now resolve the workspace from the change record
  itself; verified: `revert -> ok=True` and the journal-proven file was deleted.
- **UI verified live** (`test/ui-check.mjs`, screenshot `ec12-ui.png`): brand EC12 v1.04, status
  IDLE, Ask/Plan/Code modes, composer, settings tabs (server/limits/tools/about), searchable
  model picker, 2 drag handles, EC11 importer button, zero page errors.
- **API verified live:** page 200; workspace register; file tree; journaled save (changeId);
  revert; `/api/models` (88 local models); all legacy read/config routes carry the loopback
  Host/Origin auth guard; `/api/exec` is workspace-scoped (`workspaceId`) and reconciles.
- **Live paths verified without a model** (`test/live-paths.mjs`): terminal exec + journal
  reconciliation, editor stale-save ⇒ 409, two failing runs stay session-isolated by run/session
  id, reconnect replay with no duplicate sequences, server restart marks the injected run
  `interrupted`, EC11 migrate applies + is repeatable.
- **LM Studio failure diagnosed and fixed live:** requests were dying because (1) we sent several
  `system` messages and this model's Jinja template raises `System message must be at the beginning`
  (returned as HTTP-200 SSE `{"error":…}`, which we silently skipped), and (2) SSE error payloads
  were never surfaced. Fixes: exactly **one** leading system message everywhere (main loop, stages);
  **SSE error payloads yield error events immediately**; `report_verdict` removed from the main-loop
  tool list (stage-only); blocked/failed runs now carry full summaries with `filesChanged`.
  Verified with the real loaded model: streaming reasoning → `write_file` → journaled
  `dbg-ok.txt` (+1/−0) → budget-exhaustion correctly reported `blocked` with
  `filesChanged: ["dbg-ok.txt"]` instead of an empty success.
- **Session reply history (replies can no longer vanish):** every run record now stores its `task`
  and truncated `finalText`; `GET /api/runs?sessionId=` returns a session's runs; the UI shows a
  "Previous replies" history that survives reloads and later sends. Verified live: a run's streamed
  reply ("Hello! How can I help?") is present on its record and listed by the endpoint.
- **Replies pane restored + wait feedback:** the center column now has its own Chat/file tab bar
  (replies always visible under Chat); the confusing right-column Agent/Editor view-switch is gone.
  New `provider.status` events drive a ticking elapsed counter, a "waiting for first token Ns"
  indicator, and a "model very slow — GPU may be busy" warning after 60 s of silence.

## What is NOT done (see docs/KNOWN_LIMITATIONS.md)

- **Live-model scenarios deferred (GPU busy):** the 6 requested end-to-end scenario runs
  (repair bug, multi-file feature, follow-up, failed-verification recovery, long-command stop,
  refresh-reconnect) plus their screenshots. Prior session proved the pattern works
  (`test/smoke.mjs`: loaded-model override, journaled `write_file`, repeat-failure block,
  cancel → `cancelled`).
- **`test/e2e.mjs` missing** — `npm run test:e2e` has no file yet (live paths are covered by
  `test/live-paths.mjs` instead).
- No Ask/Plan answer widget (`ask_user` surfaces as an event).
- File store is single-writer; `data/` holds credentials — keep the app loopback-only or set
  `EC12_TOKEN`.

## Recovery

- Stop the app and delete `data/` to reset sessions/runs/changes (does not touch code workspaces).
- EC11 remains intact at `..\ec11`.
- If a dev server looks unstyled or routes 404 after a build, the `.next` was shared with a build —
  EC12 prevents this by building to `.next-build`; restart the dev server.
