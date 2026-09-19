# EC12 — Security

## What EC12 enforces

- **Loopback only.** `/api/*` mutation routes reject any `Host` or `Origin` that is not
  `localhost` / `127.0.0.1` / `[::1]` / `0.0.0.0` (`src/server/security/auth.ts`). This blocks DNS
  rebinding and remote access by default.
- **Optional bearer token.** Set `EC12_TOKEN=<secret>` and every request must send
  `Authorization: Bearer <secret>`. Off by default for a purely local app.
- **Workspace registration.** File operations use a **registered workspace id** and a
  **workspace-relative path**, resolved by `resolveInWorkspace`:
  - rejects absolute paths, drive-relative paths, UNC, `..` escapes, and alternate data streams;
  - compares the **realpath of the nearest existing parent** against the workspace realpath, so a
    symlink/junction pointing outside the workspace is rejected (tested).
- **Review staging.** In review mode the agent writes to `data/staging/<runId>/`, not the workspace;
  the real workspace is unchanged until approval. This is an overlay, **not** an OS sandbox.
- **Secrets.** API keys are sent by the client and used server-side for provider calls. They are not
  written into the event log. `.gitignore` should exclude `data/` (which holds sessions/keys context)
  and `workspaces/`.

## Honest limits (no sandbox)

- **Arbitrary shell execution runs with the user's OS privileges.** `shell_command` and verification
  use `src/server/tools/process.ts`; there is no container/VM isolation. A regex blocklist is **not**
  a sandbox and is not claimed as one.
- Commands can modify files outside the workspace using their own privileges; the change journal
  tracks agent tool edits and editor saves, not everything a shell command does.
- Auto-applying file edits is **not** authorization for destructive shell operations.
- Project instructions / `AGENTS.md` / skills **cannot** override application permissions — the tool
  layer enforces mode permissions regardless of prompt text.

## Recommended hardening

- Keep the default loopback bind; do not expose port 3000 to a network.
- Set `EC12_TOKEN` before any non-loopback use.
- Run destructive workflows (installs, migrations) in a disposable workspace or VM.
