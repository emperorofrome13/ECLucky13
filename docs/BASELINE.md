# EC12 — Baseline (as found)

Recorded before any reliability changes, from the EC11 fork.

## Environment

- **App root:** `E:\aiprojects\coders\ec\ec12` (forked from `...\ec11`).
- **OS:** Windows 10, PowerShell / cmd.
- **Node:** v25.4.0 (npm scripts run via `node scripts/*.mjs`; PowerShell blocks `npm.ps1`, use `npm.cmd` or the scripts).
- **Package manager:** npm; lockfile `package-lock.json` present. `node_modules` copied from EC11 (259 MB) so no network install was required.
- **No Git** in this lineage — changes are tracked by backups, not commits.
- **Local model server:** LM Studio at `http://127.0.0.1:1234/v1` (OpenAI-compatible). Nothing was loaded at baseline time (LM Studio idle-unloads).

## Baseline failures and reproduction (from EC11 source review + this session)

| # | Finding | Repro | Required outcome |
|---|---|---|---|
| B1 | `next build` while `next dev` runs corrupts the shared `.next` → app renders unstyled, API routes 404 | run `npm run build` with a dev server up | build/start use `.next-build`; never touch dev's `.next` |
| B2 | Follow-up turns lose context — `/api/chat` uses only the latest user message | send two related messages | full structured history is sent |
| B3 | Stop does not reliably stop; abort listeners removed after headers; tools/verification get no signal | Stop during a long command | one cancellation chain run→provider→tool→process tree→verification |
| B4 | A text-only reply can end the run as "complete" without the verification gate | model replies with prose | completion requires a structured, verified terminal result |
| B5 | Verification is root-extension based; empty/unrecognized projects pass; `/health` 404 not retried on `/` | verify a Next/TS project | project-aware checks; zero checks = **unverified**; `/health`→`/` fallback |
| B6 | `String.replace(old,new)` interprets `$&`, `` $` ``, `$'` → corrupts code | edit a file containing `$&` | literal replacement; reject ambiguous matches |
| B7 | Unknown before-image treated as "new file" → revert can delete an existing file | edit an unread file, revert | server-side change journal; revert only deletes journal-proven creations |
| B8 | Review mode is fake — backend writes immediately regardless | enable review, edit | review stages changes; real workspace unchanged until approval |
| B9 | Loaded-model cache 5 min, `loading` counts as loaded, model substitution doesn't update context | switch models quickly | fresh loaded state; auto vs pinned; effective context applied |
| B10 | Stage failure / budget exhaustion still reach `done` | break a stage | failed required stage or exhausted budget cannot be success |
| B11 | `report_verdict` ignored; prose `PASS`/`COMPLETE` accepted | misleading prose | structured verdict is authoritative |
| B12 | File APIs accept arbitrary paths; no auth on privileged routes | call `/api/files` with any path | registered workspaces + canonical path policy + auth |

## Dependency status

- `next@14.2.28`, `react@18.2.0`, `react-dom@18.2.0` (runtime); `typescript@^5.5`, `playwright-core@^1.59`, `@types/*` (dev).
- No native modules; the persistent store is file-based (JSON/JSONL) to guarantee install reliability on Windows/Node. Decision recorded in `docs/ARCHITECTURE.md`.

## Recovery checkpoint

Because this project is not under Git, the pre-change tree is copied to `backup/` and the EC11 original remains intact at `..\ec11`. No destructive Git commands were used.
