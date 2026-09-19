# EC12 — Architecture

## Goals

Make every displayed action, file change, failure, and success **trustworthy**. Correctness and
cancelation beat decoration.

## Layers

```
src/shared/         contracts.ts (run states, events, changes, results), stage-definitions.ts,
                    settings-schema.ts (untrusted partial -> validated settings)
src/server/
  store.ts          file-backed JSON / atomic writes / JSONL journals (no native deps)
  events.ts         append-only per-run event log; persist-before-publish; replay after sequence
  runs/state-machine.ts   allowed run-state transitions (terminal states are terminal)
  runs/manager.ts   owns run lifecycle OUTSIDE the HTTP request; idempotent create; cancel;
                    serializes one active run per workspace; verifies before success
  agent/loop.ts     streaming agent loop + review stages; authoritative structured verdicts
  agent/context-manager.ts  durable structured turns; safe compaction (no orphaned tool results)
  providers/openai-compatible.ts  real streaming SSE, timeouts, retries, cancellation
  providers/model-discovery.ts    hostname adapters; cached catalog; fresh loaded state; effective model
  tools/process.ts  one process service: streaming, artifacts, process-tree kill
  tools/registry.ts tools + schema + MODE PERMISSIONS (ask/plan read-only)
  workspace/path-policy.ts   workspace registry + canonical path confinement (junction/symlink aware)
  workspace/change-journal.ts  literal edits, optimistic concurrency, review staging, revert-by-id
  verification/discover.ts + execute.ts  project-aware checks; unverified semantics
  security/auth.ts  loopback Host/Origin policy + optional bearer token
src/app/api/...     thin HTTP: /runs, /runs/[id], /runs/[id]/events, /runs/[id]/cancel|resume,
                    /workspaces, /changes/[id]/(approve|reject|revert); legacy models/prompts/skills/fs
src/components/Ec12App.tsx  UI wired to runs + events (status bar, activity, changes, verification)
```

## Run lifecycle

`queued → preparing → generating → (executing_tool | compacting) → verifying → reviewing →
succeeded | failed | cancelled | blocked | unverified | interrupted`. Enforced by
`assertTransition`. A cancelled run can never become succeeded; a failed required check or stage can
never become succeeded; an exhausted iteration budget becomes `blocked`, never success.

The manager runs each task with `void this.execute(...)` so the run is owned by the server, not the
HTTP response. Clients subscribe to `/api/runs/[id]/events` and can reconnect with `?after=<seq>`.

## Event contract

Every event is `{ version:1, eventId, sequence, timestamp, sessionId, runId, type, data }`, appended
to `data/runs/<id>.events.jsonl` **before** being published to subscribers. Clients deduplicate by
`eventId` and track `sequence`. Tool events carry `toolCallId`; change events carry `changeId`;
verification events carry `checkId`.

## Persistence choice

A **file-backed store** (atomic JSON + JSONL) replaces SQLite. Rationale: zero native dependencies →
reliable install on the target Windows/Node environment, and sufficient for a single-process local
app. See `docs/KNOWN_LIMITATIONS.md` for the trade-offs.

## Deliberate removals from EC11

- Keyword-based forced edits and "stop investigating, edit now" nudges → replaced by progress tracking
  and repeated-failure blocking.
- "Every request must change files" → **Ask / Plan / Code** modes; read-only modes cannot mutate.
- "No checks means PASS" → no applicable checks means **UNVERIFIED**.
- "Max output equals context" → output is clamped to the remaining context budget.

## Still to do (see KNOWN_LIMITATIONS)

Resizable panels + full editor (CodeMirror/Monaco), shell-created-file reconciliation, per-request
pricing snapshots in the UI, and a few remaining legacy routes still using the old EC11 transport.
