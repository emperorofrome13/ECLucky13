# EC12 — Known limitations

Honest list of what is **not** finished in this increment. Unlisted EC11 features are either ported
or intentionally removed (see ARCHITECTURE).

## Runtime

- **Tool-created shell mutations are reconciled on a best-effort basis.** `shell_command` snapshots
  the workspace before/after and journals created/modified/deleted files (bounded: 3000 files,
  512 KB each, sensitive names skipped). Files outside those bounds, or changed by long-lived
  background processes after the command returns, are not captured — do not rely on revert for those.
- **Context compaction uses exact cl100k token counts** (bundled `js-tiktoken`), which is exact for
  OpenAI models and an approximation for others; always labeled as estimated.
- **`ask_user`** raises an event but the UI has no inline answer widget yet; it is surfaced as an
  error/notice.
- **Per-request pricing snapshots** are recorded implicitly (usage events) but the UI shows session
  totals; historical sessions are not re-priced by the current model's price.
- **Cancellation of a provider request mid-body** aborts the fetch/reader and the process tree; a
  provider that ignores the socket close may still be running server-side (LM Studio stops on
  disconnect in practice).

## Verification

- The boot check requires the project to expose an HTTP server via `start`/`dev`. Long builds
  (10+ min) may exceed the check timeout (900 s).
- The browser smoke check uses `playwright-core`; if no browser binary is installed the check is
  `unavailable` (not passed). Run `npx playwright install chromium` to enable it.
- Interactive behavior assertions (clicking through a UI) are not yet automated — only load + page
  errors.

## UI

- Explorer (`FileTree`), multi-tab editor (`CodeEditor`, CodeMirror bundled locally), terminal
  (`TerminalPanel`), and a full settings drawer with a searchable model picker are wired to the new
  policy. No command palette yet. The pre-change approve/revert 404 (manual `runId: 'manual'`
  changes) was fixed and verified live.
- Panels are resizable via drag handles (widths persist). Feeds virtualize offscreen rows with
  `content-visibility` and keep "show older" pagination plus a "Jump to latest" button. Dirty-buffer
  warning is a confirm on New session.
- The old EC11 components and `src/lib/*` runtime are deleted. Remaining EC11-era read/config
  routes (`models`, `model-info`, `prompts`, `skills`, `fs`, `fs/pick`) now carry the loopback
  auth guard; `/api/files/[id]` and `/api/exec` are rewritten workspace-scoped with journaling.
  Keep the app loopback-only (or set `EC12_TOKEN`).

## Store

- File-backed store, not SQLite: fine for a single local process, but not safe for multiple
  concurrent writer processes. Workspace mutations are serialized within one process.

## Model

- LM Studio idle-unloads; if it reports nothing loaded, EC12 requests the configured model and lets
  the server load it (it cannot "reuse" an unloaded model). `loading` deliberately does not count as
  ready.
