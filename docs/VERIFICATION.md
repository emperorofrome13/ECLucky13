# EC12 — Verification

Verification is **project-aware** and **executed**. It can never report "verified" without running at
least one applicable check.

## Discovery (`src/server/verification/discover.ts`)

Given a workspace it inspects manifests:

- `package.json` scripts → `typecheck` (or `tsc --noEmit` when a `tsconfig.json` exists), `test`,
  `lint`, `build`, and a **boot** check from `start`/`dev`.
- Static `.html` files → a **browser** smoke check.
- Python signals (`pyproject.toml`, `requirements.txt`, `pytest.ini`) with a `tests/` folder → `pytest`.

Checks carry `command`, `args`, `cwd`, and a `required` flag. The package manager is inferred from the
lockfile; on Windows `.cmd` shims are launched through `cmd.exe`.

## Execution (`src/server/verification/execute.ts`)

Each check runs through the shared process service (streaming, artifact capture, process-tree kill).
The browser check launches a real Chromium via `playwright-core` **only if a browser binary exists**;
otherwise the status is `unavailable` (never "passed"). The boot check starts the app on a free port
and polls **`/health` and then `/`** (a missing `/health` is not a failure), then kills the process
tree.

Statuses: `passed | failed | skipped | unavailable | cancelled`.

## Outcome rules

- **A required check failing** → `failed` (blocks success).
- **Zero executed applicable checks** → `unverified` (blocks "succeeded").
- **All executed checks pass** → `verified`.
- The result records a **workspace revision** (hash of sizes/mtimes) so it is tied to the filesystem
  state. After a review stage edits files, verification is **re-run** on the final revision.

## How to run

```text
npm run doctor        # environment + deps + LM Studio port + browser availability
npm run typecheck     # tsc --noEmit
npm test              # deterministic regression suite (no live model)
npm run build         # production build into .next-build (never touches a running dev .next)
npm run test:e2e      # (placeholder) orchestrates a live-model smoke run; see LIVE SMOKE
```

## Live smoke (manual, uses your local model)

1. Start LM Studio and load a model (EC12 auto-selects the loaded model when mode = Auto).
2. `npm run dev`, open the app, choose a workspace, pick Code mode, run a small task.
3. Observe: streaming output, tool cards with durations, change diffs, verification checks, and a
   **run summary**. A run that changes files but executes no checks reports **unverified**, not
   success.
4. Press Stop mid-run: the state must become `cancelled` (never `succeeded`) and the command's
   process tree is terminated.

## Regression suite coverage

`test/reliability.test.mjs` (14 tests) covers: literal editing of `$&`/`` $` ``/`$'`/CRLF, ambiguous
replacement rejection, stale-hash conflicts, revert-by-id + conflict + create-only deletion, review
staging, path traversal/ADS/junction rejection, state-machine terminal guards, event replay, zero
checks ⇒ unverified, `/health`→`/` boot fallback, tool-arg assembly across chunks, and split-frame
SSE parsing.
