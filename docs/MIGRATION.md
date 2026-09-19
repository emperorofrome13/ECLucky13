# EC12 — Migration (from EC11)

EC12 is a fork of EC11 in a separate folder; EC11 is left intact. No destructive Git operations were
used (this lineage has no Git).

## Settings

- EC11 stored `ec11.settings.v1` in `localStorage`. EC12 uses `ec12.settings.v1`.
- **Change detection does not fabricate data.** A one-time importer can read `ec11.settings.v1` and
  map the overlapping fields (provider, autoPrompt, contextTools, theme, recentModels, hiddenModels,
  hideVariants, workspace path); new fields take EC12 defaults:
  - `provider.modelSelection` = `auto`
  - `provider.firstTokenTimeoutMs` = 300000, `requestTimeoutMs` = 1800000
  - `agent.reviewBeforeApply` = false, `agent.autoAcceptChanges` = true, `agent.repeatedFailureLimit` = 3
  - `mode` = `code`
- The old key is preserved until the import is confirmed. Existing values are not silently replaced.

## Sessions and changes

- EC11 kept sessions and diffs in browser storage. EC12 moves sessions, runs, events, and change
  records **server-side** (`data/`).
- **Historical tool history cannot be fully reconstructed** from EC11's browser logs — EC12 does not
  attempt to guess missing tool results or before-images. Importing EC11 sessions is therefore
  limited to titles/transcript text; diffs and tool pairs start fresh.
- EC11's browser-side "before-images" (snapshots in a ref) are **not** trusted. All mutations in EC12
  go through the server change journal; do not carry a pending EC11 revert across the migration.

## APIs

- New transport: `POST /api/runs`, `GET /api/runs/[id]`, `GET /api/runs/[id]/events?after=`,
  `POST /api/runs/[id]/cancel`, `POST /api/runs/[id]/resume`, `POST /api/workspaces`,
  `POST /api/changes/[id]/(approve|reject|revert)`.
- `POST /api/chat` (EC11) still exists but is legacy and does **not** go through the new runtime.
  It remains only until the remaining UI panels are rewired; prefer the `/api/runs` flow.

## Recovery

- EC12 data lives under `data/`. To reset, stop the app and delete `data/` (loses sessions/events/
  change history; does not touch your code workspaces).
- EC11 remains runnable at `..\ec11`.
