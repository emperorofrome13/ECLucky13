# EC11 Coder — Full Source & Build/Problem History (single-file upload for Astra)

> **What this file is:** everything needed to understand, continue, or rebuild the EC11 Coder
> in one place. It contains a project overview, the full version history, **every real problem
> that came up and how it was fixed**, the architecture map, and the **complete source of all
> important files**. Astra has no access to the original machine/files, so this is self-contained.
>
> **How to read it:** Sections 1–5 are context. Section 6 is the known-issues list. From the
> `===== FILE:` marker onward, each block is one source file (path in the header, then a fenced
> code block). To rebuild, recreate the files at those paths and run `npm install` + `npm run dev`.

---

## 1. What EC11 is

A **local-first AI coding agent with a real IDE-style UI and an autoprompt pipeline**.
The agent writes real files, runs an executed-verification gate, then runs configurable
autoprompt stages (Review → Completeness → Senior Review → Run/Fix) that each wait for the
previous and see the files it changed. Everything is streamed to the UI.

- **Stack:** Next.js 14.2.28 (App Router) + React 18 + TypeScript. No database; UI state in
  `localStorage`, files on disk.
- **Backend:** Node route handlers under `src/app/api/*`; the agent loop is in `src/lib/agent.ts`.
- **Model backend:** any OpenAI-compatible server. Default **LM Studio** `http://127.0.0.1:1234/v1`.
  Presets also for FreeToken Desktop (1919), Unsloth Desktop (8000), OpenRouter, MagicAI, and Custom.
- **Design language:** FUI — near-black, one neon accent, thin strokes, monospace, 6 themes.

### Run
- Double-click `quickstart.bat` (installs deps, `next dev -p 3000`, opens browser).
- Manual: `npm install` then `npx next dev -p 3000`.
- **Build vs dev (important, see Problem 9):** build with `$env:EC11_DIST_DIR='.next-build'; npx next build`
  so a production build never clobbers the `.next` a running `next dev` is using.

---

## 2. Version history (what changed, in order)

- **v1.00** — bare chat shell: a working-dir text box, a message box, Send. Backend already had the
  agent loop, tools, verification, and stages, but the UI exposed almost none of it.
- **v1.01** — control UI: topbar, sessions sidebar, streaming log, **Autoprompt pipeline panel with
  per-stage toggles + live status**, Settings drawer exposing **every limit**, Stop, themes.
- **v1.02** — IDE parity: activity rail, **file explorer**, **multi-tab editor**, **Changes/diff with
  Accept/Reject**, **terminal**, **command palette**, plan/context meter.
- **v1.03** — tokens ↑/↓ + **cost estimate with editable pricing**; **provider presets**; context-tool
  toggles **RTK / Ponytail / Context7 / CodeGraph / Web Search**.
- **v1.04** — EC11's own editable **AGENTS.md**; **autoprompts are editable `.md` files**; **global
  skills** access (`list_skills` / `read_skill`).
- **v1.05** — visible **workspace picker** (topbar chip + first in Settings); **max output defaults to
  context window**; **iteration caps default to 0 = no limit**.
- **v1.06** — **maxTokens/context window are dynamic** — detected from the selected model.
- **v1.07** — **native Windows folder picker** (modern `IFileOpenDialog`); toned-down workspace chip.
- **v1.08** — **auto-apply agent changes by default** (no more Accept-every-change queue).
- **v1.09** — client-side **use the model that's actually loaded** for local providers.
- **v1.10** — **server-side loaded-model resolution** at run time (authoritative).
- **v1.11** — **searchable model picker** + **rich catalog** (context + pricing per model in one call).
- **v1.12** — picker **scopes** (Recent/Loaded/All) + **vendor filter** + **keyboard nav**.
- **v1.13** — **group by vendor**, **hide models**, **hide variant checkpoints** (`@q4`, `@q8`…).

---

## 3. The problems (and exact fixes)

These are the real issues encountered in this build, in the order they bit. Astra should treat
these as hard-won requirements.

1. **"Terrible UI, no controls, no autoprompt system."**
   The backend was fine but invisible. Fix: build a full UI and surface *everything* — settings,
   stages, tools, verification. Rule: **nothing runs silently and nothing is hardcoded.**

2. **No visible way to set the workspace.** It was buried in Settings. Fix: a `workspace:` chip in
   the topbar that opens a picker directly, plus Working folder moved to the **top** of Settings.

3. **New session hidden.** Fix: a `+ New session` button in the topbar.

4. **Chat input stuck at the far right.** Fix: a **full-width composer bar across the bottom**.

5. **No token/cost tracking.** Fix: provider reads `usage` from the server; the agent emits `usage`
   events; topbar shows `tokens ↑input ↓output · cost`; Plan tab breaks it down; **pricing is
   editable** (input/1M, output/1M, currency) and auto-fills from OpenRouter's pricing.

6. **Couldn't use multiple/custom backends.** Fix: **provider presets** (LM Studio, FreeToken,
   Unsloth, OpenRouter, MagicAI, Custom) — any OpenAI-compatible URL + key; the model list loads
   from whatever server is set.

7. **No EC11 AGENTS.md; autoprompts not editable; no access to global skills.** Fix:
   - `AGENTS.md` at the app root (loaded at runtime; the target project's AGENTS.md also loads and wins).
   - Autoprompts externalized to `autoprompts/*.md` (`system.md` + 4 stages), loaded per request;
     per-project override at `<workspace>/.ec11/autoprompts/*.md`; editable from the UI.
   - Global skills: index of `~/.agents/skills` and `~/.claude/skills` injected; `list_skills` +
     `read_skill` tools (allowlisted to the skill folders).

8. **Schema/UX of the autoprompt toggles.** Stage selection must be one source of truth shared by
   the UI and the pipeline. (Carried over from previous builds in this lineage.)

9. **App rendered unstyled on :3000; `/api/models` 404'd on the running dev server.**
   **Root cause: `next build` was run while the user's `next dev` was running — they share `.next`,
   so the build corrupted the dev server's route/asset manifests.**
   Fix: stop dev servers, delete `.next`, restart dev. **Prevention:** `next.config.js` honors
   `EC11_DIST_DIR`; always build to `.next-build`. **Never build while dev is running.**

10. **Native Windows folder browse was the wrong (old tree) dialog.** Fix: use the modern
    **`IFileOpenDialog` + `FOS_PICKFOLDERS`** via PowerShell/C# COM (address bar, folder list,
    `Select Folder`). The dialog opened behind the browser, so it is raised with
    `SetForegroundWindow`/`SetWindowPos(HWND_TOPMOST)` by title.

11. **"Do I have to accept every change?"** Changes were always written to disk; the review queue
    just looked mandatory. Fix: **Apply agent changes automatically ON by default** — no Accept
    step, no nagging badge; Changes panel becomes a log with a **revert** button. Turning the
    setting off restores the Accept/Reject queue.

12. **It kept loading a model instead of using the loaded one.** Fix (two layers):
    - **Server-side resolution** in `/api/chat` before each run: if the provider is local and a
      different model is loaded, use the loaded one and log it.
    - Detect loaded models: **LM Studio** native `/api/v0/models` (`state === 'loaded'` **or** a
      present `loaded_context_length`), **Ollama** `/api/ps`, single-model servers.
    - **Caveat:** LM Studio idle-unloads; if it reports nothing loaded, EC11 must request the
      configured model and LM Studio loads it. Keep the model loaded in LM Studio for reuse.

13. **Huge model lists (OpenRouter 445) unusable; context not detected.** Fix:
    - `/api/models` returns a **rich catalog** `{ctx, maxOut, inPrice, outPrice}` built from the same
      responses (OpenRouter `context_length` + `top_provider.max_completion_tokens` + `pricing`;
      LM Studio `max_context_length`/`loaded_context_length`; vLLM `max_model_len`). Cached 5 min.
    - **Selecting a model applies its context/max/pricing instantly** — no second request.
    - `/api/model-info` reads the same cached catalog (removes the slow duplicate fetch/timeouts).

14. **Selecting a model is hard with hundreds of options.** Fix: **searchable picker** with scopes
    **Recent / Loaded / All / Hidden**, a **vendor filter** (60 vendors on OpenRouter), **grouping by
    vendor** with sticky headers, **keyboard nav** (↑/↓/Enter/Esc), a live count, and capped results.
    Plus **hide a model** and **hide variant checkpoints (`@q4`, `@q8`, `@bf16`…)**.

15. **Fixed maxTokens/context window.** Fix: dynamic defaults (max output = context window) and
    per-model detection applied automatically.

16. **Fixed iteration caps.** Fix: `maxIterations` and `maxIterationsPerStage` default to **0 = no
    limit**; the agent runs until done or Stop.

---

## 4. Architecture map

```
src/app/
  layout.tsx, page.tsx, globals.css        # shell + FUI theme
  api/chat/route.ts                        # SSE stream; resolves loaded model; runs the agent
  api/models/route.ts                      # model list + loaded[] + catalog{} (cached)
  api/model-info/route.ts                  # context/max for one model (reads the catalog)
  api/files/route.ts                       # tree / read / write / delete (Explorer, Editor, Changes)
  api/fs/route.ts                          # folder browser + create folder (in-app picker)
  api/fs/pick/route.ts                     # native Windows folder dialog (IFileOpenDialog)
  api/exec/route.ts                        # run a PowerShell command (terminal)
  api/prompts/route.ts                     # read/write system+stage .md and AGENTS.md
  api/skills/route.ts                      # list/read global skills
src/lib/
  agent.ts        # main loop: think→act→observe, verification done-gate, nudges, doom-loop guard
  provider.ts     # OpenAI-compatible client: retries, token clamp, usage
  tools.ts        # file/shell/todo/syntax tools + web_search/context7_docs/code_graph/skills
  stages.ts       # autoprompt stages + fail-closed verdict parser
  verify.ts       # executed verification (browser smoke test, syntax, server boot)
  prompts.ts      # loads system/stage md, AGENTS.md, skills index
  contexttools.ts # prompt addenda for RTK/Ponytail/Context7/CodeGraph/Search
  localserver.ts  # IS local? loaded models + rich model catalog (cached)
  diff.ts         # LCS line diff
  settings.ts     # all settings types/defaults/migration + provider presets
src/components/   # CoderApp (shell) + AgentPanel, ChatLog, AutoPromptPanel, ChangesPanel,
                  # EditorPane, FileExplorer, TerminalPanel, SettingsPanel, PromptsDrawer,
                  # WorkspacePicker, CommandPalette
```

**Data flow:** UI `send()` → `POST /api/chat` (SSE) → `runAgent` → `Provider.complete` +
`Tools.execute` → events streamed back (`content`, `reasoning`, `tool_call`, `tool_result`,
`system`, `usage`, `auto_prompt_stage`, `done`). The UI persists events per session and tracks
file changes (snapshot-at-read → diff current → apply/revert).

---

## 5. Hard rules / decisions to preserve

- **Everything is a setting.** No magic numbers in provider/agent code. Defaults tuned for slow local models.
- **No silent failures.** Every stage, tool call, error, and model choice is visible in the UI/log.
- **Stages run in order**, each waits for the previous, each sees the files changed so far.
- **One source of truth** for stage selection (settings shared by UI and pipeline).
- **Local-first.** Cloud is optional. The loaded model on a local server should be used automatically.
- **Dynamic model sizes.** Never hardcode context/max; detect from the server; apply on model pick.
- **Auto-apply changes by default**, with a revert log. Review-queue is opt-in.
- **Editable prompts.** `AGENTS.md` and `autoprompts/*.md` are user-editable files loaded at runtime.
- **Never `next build` while `next dev` runs.** Build to `EC11_DIST_DIR` (`.next-build`).
- **Verify by running.** Every change in this project was validated with a real build + a real model
  run and screenshots — not "should work".

---

## 6. Known issues / next steps

- **LM Studio idle-unload:** if it unloads, EC11 can't reuse it (it will request the configured model
  and LM Studio loads it). Keep the model loaded in LM Studio to avoid repeated loads.
- **Context7** is best-effort MCP over streamable HTTP; failures return a clear error.
- **Web search** scrapes DuckDuckGo HTML; may be challenged.
- **CodeGraph** is a lightweight local symbol/import index, not a full AST/tree-sitter graph.
- **RTK** only prefixes commands whose first tool is recognized and only if `rtk` is on PATH.
- **Skills are read-only** in the UI (they live in shared global folders).
- **Sessions/changes** persist in `localStorage` only (no DB). **Terminal** is PowerShell-only.
- **Cost** uses a single input/output price pair (auto-filled from OpenRouter when available).

---

## 7. Full source

Every file below is complete and is exactly what runs.

===== FILE: package.json =====

```json
{
  "name": "ec11",
  "version": "1.1.3",
  "private": true,
  "description": "EC11 - local-first AI coding agent with executed verification (built from benchmark findings)",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "14.2.28",
    "react": "18.2.0",
    "react-dom": "18.2.0"
  },
  "devDependencies": {
    "playwright-core": "^1.59.1",
    "typescript": "^5.5.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0"
  }
}
```

===== FILE: next.config.js =====

```text
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  serverRuntimeConfig: { projectDir: __dirname },
  // Build into a separate dir when EC11_DIST_DIR is set, so a production build
  // never clobbers the .next that a running `next dev` is using.
  distDir: process.env.EC11_DIST_DIR || '.next',
};
module.exports = nextConfig;
```

===== FILE: tsconfig.json =====

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": [
      "dom",
      "dom.iterable",
      "ES2022"
    ],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": [
        "./src/*"
      ]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next-build/types/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "backup"
  ]
}
```

===== FILE: AGENTS.md =====

```md
# AGENTS.md — EC11 Coder

Instructions for the EC11 coding agent. Edit this file to change how the agent behaves.
Loaded at runtime (no rebuild needed). A target project's own `AGENTS.md` is loaded too and takes priority for that project.

## Role
You are EC11, a senior coding agent running locally. You write COMPLETE, WORKING code — no stubs, no placeholders, no "rest of implementation here".

## Workflow
1. Understand the task and read the files it touches before changing anything.
2. Plan with the `todo` tool when the task has more than one step.
3. Make the change with the smallest correct diff. Prefer `edit_file` on existing files; use `write_file` for new files.
4. Verify: syntax-check, then actually RUN the deliverable.
5. Only then call `attempt_completion` with evidence. The harness re-runs your deliverable before accepting.

## Code rules
- All file paths are relative to the project working directory.
- Match the existing code's style, libraries and patterns. Do not introduce a new dependency if the standard library or an already-installed package solves it.
- Fix the root cause, not the symptom: grep every caller of the function you touch and fix the shared function once.
- No unrequested abstractions, no boilerplate nobody asked for, no dead code.
- Preserve the user's intended behavior. Do not invent product limitations.

## Deliverables
- Web app: a single self-contained `.html`, or a `server.js` that serves a `public/` folder.
- Install the dependencies you declare so the app can actually start.
- Never commit secrets. Do not print API keys or tokens.

## Environment
- Windows, PowerShell. `shell_command` runs one command at a time (no `&&`/`||`).
- Tool set: read_file, write_file, edit_file, list_files, shell_command, todo, syntax_check, attempt_completion, report_verdict (plus optional web_search, context7_docs, code_graph, list_skills, read_skill when enabled).

## Skills
When a task matches a global skill, use `list_skills` to find it and `read_skill` to load its SKILL.md, then follow it.
```

===== FILE: quickstart.bat =====

```bat
@echo off
REM ============================================================
REM  EC11 Coder v1.01 - one-click launcher
REM  Installs deps if missing, starts the dev server, opens browser.
REM ============================================================
setlocal
cd /d "%~dp0"
set PORT=3000

echo.
echo  ============================================
echo   EC11 Coder v1.13
echo   Local-first AI coding agent
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  echo         Install Node.js 18+ from https://nodejs.org then run this again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/2] Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed. Check your internet connection.
    pause
    exit /b 1
  )
) else (
  echo [1/2] Dependencies already installed.
)

echo [2/2] Starting EC11 on http://localhost:%PORT%
echo       (Keep this window open. Close it to stop the app.)
echo.
start "" "http://localhost:%PORT%"
call npx next dev -p %PORT%

echo.
echo [ERROR] EC11 stopped. If this was unexpected, read the messages above.
pause
endlocal
```

===== FILE: start-3620.bat =====

```bat
@echo off
REM Headless start of EC11 on port 3620 (no browser). Used for scripted runs.
cd /d "%~dp0"
start "ec11-dev-3620" /min node.exe node_modules\next\dist\bin\next dev -p 3620
exit /b 0
```

===== FILE: autoprompts/README.md =====

```md
# EC11 Autoprompts

Editable prompt files. EC11 reads these at runtime — change them and the next run uses the new text (no rebuild needed).

- `system.md` — the main agent system prompt.
- `review.md` — the Review stage.
- `completeness.md` — the Completeness stage.
- `senior_review.md` — the Senior Review stage.
- `run_fix.md` — the Run / Fix stage.

## Overrides
- Edit the files here for a global change.
- For a single project, put overrides in `<working-folder>/.ec11/autoprompts/<name>.md` — those win over these.

## Editing
Use the Prompts panel in the UI (rail → prompts), or edit the `.md` files directly.
Keep the `VERDICT: PASS or FAIL` / `SUMMARY: ...` instruction lines in stage prompts — the pipeline parses them to decide pass/fail.
```

===== FILE: autoprompts/system.md =====

```md
You are EC11, a senior coding agent running inside a local-first harness.
You write COMPLETE, WORKING applications. You do not leave placeholders or stubs.
Tools: read_file, write_file, edit_file, list_files, shell_command (PowerShell, one command at a time), todo, syntax_check, attempt_completion.
Rules:
- All file paths are relative to the project working directory.
- Before declaring done, use attempt_completion. The harness will then RUN your deliverable.
- If the deliverable is a web app, build it as a single self-contained .html or with server.js that serves a public/ folder.
- Install dependencies you declare (npm install) so the app can actually start.
- Do not invent product limitations. Preserve the user's intended behavior.
```

===== FILE: autoprompts/review.md =====

```md
You are running the REVIEW autoprompt stage. Act like the user just asked: "double-check your work for bugs and fix anything real."
Work directly in the workspace with the available tools (read_file, edit_file, write_file, shell_command, syntax_check). Find and fix real bugs: syntax errors, wrong imports, null access, broken logic.
Do not just list problems - fix them, then verify with syntax_check.
After finishing, reply with EXACTLY these two lines and nothing else:
VERDICT: PASS or FAIL
SUMMARY: one concise sentence.
```

===== FILE: autoprompts/completeness.md =====

```md
You are running the COMPLETENESS autoprompt stage. Verify the ORIGINAL user request and its required deliverable list against what actually exists in the workspace.
Use read_file and list_files to diff required files/behaviors from the original task against the real tree. If a required deliverable is missing or a stated behavior does not work, FIX it.
After finishing, reply with EXACTLY these two lines and nothing else:
VERDICT: PASS or FAIL
SUMMARY: one concise sentence.
```

===== FILE: autoprompts/senior_review.md =====

```md
You are running the SENIOR REVIEW autoprompt stage. Perform a senior-level architecture and integration review of the workspace deliverable.
Check boundaries, error handling, security (XSS, path traversal, injection), and whether it will survive real use. Fix issues that are actionable now; make the smallest safe fix.
After finishing, reply with EXACTLY these two lines and nothing else:
VERDICT: PASS or FAIL
SUMMARY: one concise sentence.
```

===== FILE: autoprompts/run_fix.md =====

```md
You are running the RUN-FIX autoprompt stage. Actually RUN the deliverable, read the real output/errors, and fix what fails until it runs clean.
Start it exactly as a user would (for a web app: start the static server / node server.js; for a script: execute it). Capture errors from stdout/stderr, fix the root cause with edit_file, and re-run to confirm. Do not stop at the first error.
After finishing, reply with EXACTLY these two lines and nothing else:
VERDICT: PASS or FAIL
SUMMARY: one concise sentence.
```

===== FILE: src/app/layout.tsx =====

```ts
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'EC11 Coder v1.13', description: 'Local-first AI coding agent with autoprompt pipeline and executed verification' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

===== FILE: src/app/page.tsx =====

```ts
'use client';
import CoderApp from '@/components/CoderApp';

export default function Home() {
  return <CoderApp />;
}
```

===== FILE: src/app/globals.css =====

```css
:root {
  --bg: #05070c;
  --bg-grad: radial-gradient(1200px 700px at 15% -10%, #0a1424 0%, transparent 60%);
  --panel: #080c14;
  --panel-2: #0b111c;
  --line: #16202f;
  --line-bright: #22384f;
  --text: #d7e2f0;
  --dim: #6b8099;
  --faint: #3d4f66;
  --accent: #3ea6ff;
  --accent-soft: rgba(62, 166, 255, 0.12);
  --accent-glow: rgba(62, 166, 255, 0.45);
  --good: #37d67a;
  --warn: #ffb020;
  --bad: #ff4d5e;
  --mono: "JetBrains Mono", "Cascadia Mono", "Consolas", "SFMono-Regular", ui-monospace, monospace;
}

[data-theme="amber"] { --bg:#0b0905; --bg-grad: radial-gradient(1200px 700px at 15% -10%, #241704 0%, transparent 60%); --panel:#100c06; --panel-2:#15100a; --line:#2b2010; --line-bright:#4a3714; --text:#f2e4cc; --dim:#9a8055; --faint:#5c4a2a; --accent:#ffb020; --accent-soft:rgba(255,176,32,0.12); --accent-glow:rgba(255,176,32,0.45); --good:#ffd166; --warn:#ff8c1a; --bad:#ff4d5e; }
[data-theme="red"] { --bg:#0c0507; --bg-grad: radial-gradient(1200px 700px at 15% -10%, #2a0810 0%, transparent 60%); --panel:#130709; --panel-2:#180a0d; --line:#331016; --line-bright:#5c1b24; --text:#f6dde1; --dim:#a86570; --faint:#6b3a42; --accent:#ff4d5e; --accent-soft:rgba(255,77,94,0.12); --accent-glow:rgba(255,77,94,0.5); --good:#37d67a; --warn:#ffb020; --bad:#ff2d42; }
[data-theme="matrix"] { --bg:#03080a; --bg-grad: radial-gradient(1200px 700px at 15% -10%, #06180f 0%, transparent 60%); --panel:#05100c; --panel-2:#07140f; --line:#0e2a1d; --line-bright:#155c38; --text:#c6f2d9; --dim:#5f9c7b; --faint:#37624c; --accent:#2bff88; --accent-soft:rgba(43,255,136,0.12); --accent-glow:rgba(43,255,136,0.45); --good:#2bff88; --warn:#ffd166; --bad:#ff4d5e; }
[data-theme="ice"] { --bg:#f4f7fb; --bg-grad: radial-gradient(1200px 700px at 15% -10%, #dbe8f7 0%, transparent 60%); --panel:#ffffff; --panel-2:#eef3f9; --line:#d3deea; --line-bright:#a9c0d6; --text:#12202f; --dim:#5c7086; --faint:#93a6b8; --accent:#0b74d1; --accent-soft:rgba(11,116,209,0.1); --accent-glow:rgba(11,116,209,0.4); --good:#1a9e57; --warn:#c47d00; --bad:#d03050; }
[data-theme="mono"] { --bg:#0a0a0a; --bg-grad: radial-gradient(1200px 700px at 15% -10%, #171717 0%, transparent 60%); --panel:#101010; --panel-2:#141414; --line:#242424; --line-bright:#3a3a3a; --text:#e6e6e6; --dim:#8f8f8f; --faint:#5a5a5a; --accent:#e6e6e6; --accent-soft:rgba(230,230,230,0.1); --accent-glow:rgba(230,230,230,0.3); --good:#bfbfbf; --warn:#d0d0d0; --bad:#ff5a5a; }

* { box-sizing: border-box; }
html, body {
  margin: 0; height: 100%;
  background: var(--bg); background-image: var(--bg-grad); background-attachment: fixed;
  color: var(--text); font-family: var(--mono); font-size: 14px; -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font-family: inherit; font-size: 13px; color: var(--text); }
button { cursor: pointer; }
input, select, textarea { background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 7px 9px; outline: none; width: 100%; }
input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); display: block; margin-bottom: 4px; }

.btn { background: transparent; border: 1px solid var(--line-bright); border-radius: 3px; color: var(--text); padding: 8px 14px; letter-spacing: 0.03em; transition: border-color .15s, background .15s, color .15s; }
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.primary { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.btn.primary:hover { background: var(--accent); color: var(--bg); }
.btn.danger { border-color: var(--bad); color: var(--bad); }
.btn.danger:hover { background: var(--bad); color: var(--bg); }
.btn.good { border-color: var(--good); color: var(--good); }
.btn.good:hover { background: var(--good); color: var(--bg); }
.btn.sm { padding: 5px 9px; font-size: 12px; }
.btn.ghost { border-color: transparent; color: var(--dim); }
.btn.ghost:hover { color: var(--accent); border-color: var(--line); }

/* ---------- shell ---------- */
.app { display: flex; flex-direction: column; height: 100vh; }
.topbar { display: flex; align-items: center; gap: 10px; padding: 0 14px; height: 46px; flex: 0 0 46px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg, var(--panel-2), transparent); }
.topbar .brand { font-weight: 700; letter-spacing: 0.14em; color: var(--accent); text-shadow: 0 0 12px var(--accent-glow); }
.topbar .brand small { color: var(--faint); letter-spacing: 0.05em; font-weight: 400; }
.topbar .spacer { flex: 1; }
.chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: 11px; color: var(--dim); white-space: nowrap; }
.chip.click { cursor: pointer; }
.chip.click:hover { border-color: var(--accent); color: var(--accent); }
.ws-chip { max-width: 280px; overflow: hidden; text-overflow: ellipsis; border-color: transparent; color: var(--dim); }
.ws-chip:hover { border-color: var(--line-bright); color: var(--text); }
.ws-chip.unset { color: var(--dim); }
.ws-chip .folder-ico { opacity: 0.75; }

/* full-width bottom composer */
.composer-bar {
  display: flex; align-items: flex-end; gap: 10px;
  border-top: 1px solid var(--line-bright);
  padding: 10px 16px;
  background: linear-gradient(0deg, var(--panel-2), var(--panel));
  flex: 0 0 auto;
}
.composer-bar textarea { resize: vertical; min-height: 46px; max-height: 180px; padding: 10px 12px; font-size: 13.5px; }
.composer-bar .btn { min-width: 92px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
.dot.on { background: var(--good); box-shadow: 0 0 8px var(--good); }
.dot.busy { background: var(--warn); box-shadow: 0 0 8px var(--warn); animation: pulse 1s infinite; }
.dot.err { background: var(--bad); box-shadow: 0 0 8px var(--bad); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }

.workbench { flex: 1; display: grid; grid-template-columns: 48px 262px 1fr 400px; min-height: 0; }
.workbench.rail-hidden { grid-template-columns: 0 0 1fr 400px; }
.workbench.agent-hidden { grid-template-columns: 48px 262px 1fr 0; }

/* rail */
.rail { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0; border-right: 1px solid var(--line); overflow: hidden; }
.rail-btn { width: 46px; height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: 0; border-left: 2px solid transparent; background: transparent; color: var(--dim); font-size: 9px; letter-spacing: 0.04em; }
.rail-btn:hover { color: var(--text); background: var(--panel-2); }
.rail-btn.active { color: var(--accent); border-left-color: var(--accent); background: var(--accent-soft); }
.rail-btn .ico { font-size: 15px; line-height: 1; }
.rail-spacer { flex: 1; }

/* left panel */
.leftpanel { border-right: 1px solid var(--line); display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); border-bottom: 1px solid var(--line); background: var(--panel); flex: 0 0 auto; }
.panel-scroll { flex: 1; overflow: auto; min-height: 0; }
.hint { font-size: 11px; color: var(--dim); line-height: 1.45; }
.side-section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--faint); display: flex; align-items: center; justify-content: space-between; }

/* file tree */
.tree { padding: 4px 0; font-size: 12.5px; min-width: max-content; }
.tree-row { display: flex; align-items: center; gap: 5px; padding: 3px 8px 3px 0; cursor: pointer; white-space: nowrap; color: var(--dim); }
.tree-row:hover { background: var(--panel-2); color: var(--text); }
.tree-row.active { background: var(--accent-soft); color: var(--accent); }
.tree-row .ic { width: 14px; text-align: center; color: var(--faint); flex: 0 0 14px; }
.tree-row.dir .ic { color: var(--accent); }
.tree-children { }

/* tabs + editor */
.main-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.tabs { display: flex; align-items: stretch; border-bottom: 1px solid var(--line); background: var(--panel-2); overflow-x: auto; min-height: 36px; flex: 0 0 auto; }
.tab { display: flex; align-items: center; gap: 8px; padding: 0 12px; font-size: 12px; color: var(--dim); border: 0; border-right: 1px solid var(--line); background: transparent; white-space: nowrap; box-shadow: inset 0 2px 0 transparent; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--text); background: var(--panel); box-shadow: inset 0 2px 0 var(--accent); }
.tab .tab-close { opacity: 0.5; font-size: 11px; }
.tab .tab-close:hover { opacity: 1; color: var(--bad); }
.tab .mod { color: var(--warn); }
.tab-spacer { flex: 1; }
.tab-actions { display: flex; align-items: center; gap: 6px; padding: 0 8px; }

.editor { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.editor-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--line); flex: 0 0 auto; }
.editor-bar .path { font-size: 11px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.code-area { flex: 1; display: flex; overflow: auto; min-height: 0; background: var(--bg); }
.code-gutter { user-select: none; text-align: right; color: var(--faint); padding: 10px 8px; border-right: 1px solid var(--line); font-size: 12.5px; line-height: 1.55; min-width: 46px; white-space: pre; }
.code-edit { flex: 1; border: 0; border-radius: 0; padding: 10px 14px; line-height: 1.55; font-size: 12.5px; background: transparent; resize: none; min-width: 0; min-height: 100%; white-space: pre; overflow-wrap: normal; overflow-x: auto; tab-size: 2; }
.code-edit:focus { box-shadow: none; border: 0; }
.code-view { padding: 10px 14px; white-space: pre; font-size: 12.5px; line-height: 1.55; min-width: max-content; }

/* diff */
.diff { font-size: 12.5px; line-height: 1.55; min-width: max-content; padding: 6px 0; }
.diff-line { display: flex; white-space: pre; }
.diff-line .ln { width: 46px; text-align: right; padding-right: 8px; color: var(--faint); user-select: none; flex: 0 0 46px; }
.diff-line .sg { width: 16px; text-align: center; user-select: none; flex: 0 0 16px; }
.diff-line.add { background: rgba(55,214,122,0.10); }
.diff-line.add .sg { color: var(--good); }
.diff-line.del { background: rgba(255,77,94,0.10); }
.diff-line.del .sg { color: var(--bad); }
.diff-line.ctx { color: var(--dim); }
.diff-stat { font-size: 11px; color: var(--dim); }
.diff-stat .a { color: var(--good); }
.diff-stat .d { color: var(--bad); }

/* agent column */
.agent-col { border-left: 1px solid var(--line); display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.agent-scroll { flex: 1; overflow: auto; min-height: 0; padding: 12px; }
.agent-head-tabs { display: flex; border-bottom: 1px solid var(--line); flex: 0 0 auto; }
.agent-head-tabs button { flex: 1; border: 0; background: transparent; color: var(--faint); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; padding: 9px 6px; border-bottom: 2px solid transparent; }
.agent-head-tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
.log { display: flex; flex-direction: column; gap: 9px; }
.ev { border-left: 2px solid var(--line-bright); padding: 5px 10px; white-space: pre-wrap; word-break: break-word; line-height: 1.5; font-size: 12.5px; }
.ev.user { border-left-color: var(--accent); }
.ev.assistant { border-left-color: var(--line-bright); }
.ev.reasoning { border-left-color: var(--faint); color: var(--dim); font-size: 12px; font-style: italic; max-height: 180px; overflow: auto; }
.ev.system { border-left-color: var(--warn); color: var(--warn); font-size: 12px; }
.ev.error { border-left-color: var(--bad); color: var(--bad); }
.ev.done { border-left-color: var(--good); color: var(--good); }
.ev .tag { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--faint); display: block; margin-bottom: 2px; }
.ev.tool { border-left-color: var(--accent); background: var(--panel-2); font-size: 12px; cursor: pointer; }
.ev.tool.err { border-left-color: var(--bad); }
.ev pre { margin: 4px 0 0; font-size: 11.5px; color: var(--dim); max-height: 200px; overflow: auto; white-space: pre-wrap; }

/* composer */
.composer { border-top: 1px solid var(--line); padding: 10px 12px; display: flex; gap: 8px; align-items: flex-end; background: var(--panel); flex: 0 0 auto; }
.composer textarea { resize: vertical; min-height: 44px; max-height: 180px; padding: 9px; }
.composer .actions { display: flex; flex-direction: column; gap: 6px; }

/* autoprompt strip inside agent panel */
.autoprompt { display: flex; flex-direction: column; gap: 8px; }
.stage { border: 1px solid var(--line); border-left: 2px solid var(--line-bright); padding: 8px 9px; border-radius: 2px; }
.stage.running { border-left-color: var(--warn); background: rgba(255,176,32,0.05); }
.stage.pass { border-left-color: var(--good); }
.stage.fail { border-left-color: var(--bad); }
.stage.skipped { opacity: 0.45; }
.stage .stage-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.stage .stage-name { font-size: 12px; letter-spacing: 0.04em; }
.stage .stage-sum { color: var(--dim); font-size: 11px; margin-top: 4px; line-height: 1.4; }
.badge { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--line-bright); color: var(--dim); white-space: nowrap; }
.badge.pass { color: var(--good); border-color: var(--good); }
.badge.fail { color: var(--bad); border-color: var(--bad); }
.badge.running { color: var(--warn); border-color: var(--warn); }
.badge.add { color: var(--good); border-color: var(--good); }
.badge.del { color: var(--bad); border-color: var(--bad); }

/* context meter */
.meter { height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; }
.meter > i { display: block; height: 100%; background: var(--accent); transition: width .3s; }
.meter.warn > i { background: var(--warn); }
.meter.bad > i { background: var(--bad); }
.stat-row { display: flex; justify-content: space-between; font-size: 11px; color: var(--dim); }

/* todo / plan */
.todo-item { display: flex; gap: 8px; padding: 5px 10px; font-size: 12.5px; color: var(--dim); border-left: 2px solid transparent; }
.todo-item .box { color: var(--faint); }
.todo-item.done { color: var(--good); }
.todo-item.done .box { color: var(--good); }

/* changes */
.change-file { padding: 8px 10px; font-size: 12.5px; cursor: pointer; border-left: 2px solid transparent; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.change-file:hover { background: var(--panel-2); }
.change-file.active { border-left-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.change-file .cname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.change-actions { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); }

/* bottom panel (terminal / output) */
.bottom { border-top: 1px solid var(--line); display: flex; flex-direction: column; height: 240px; min-height: 120px; flex: 0 0 auto; background: var(--bg); }
.bottom-head { display: flex; align-items: center; gap: 2px; border-bottom: 1px solid var(--line); background: var(--panel); flex: 0 0 auto; }
.bottom-tab { padding: 7px 12px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); background: transparent; border: 0; border-bottom: 2px solid transparent; }
.bottom-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.bottom-head .spacer { flex: 1; }
.term-out { flex: 1; overflow: auto; padding: 10px 12px; font-size: 12px; white-space: pre-wrap; word-break: break-word; color: var(--dim); }
.term-out .cmd { color: var(--accent); }
.term-out .err { color: var(--bad); }
.term-out .ok { color: var(--good); }
.term-in { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--line); align-items: center; }
.term-in .prompt { color: var(--accent); font-size: 12px; }
.term-in input { background: transparent; border: 0; border-radius: 0; padding: 0; }

/* empty states */
.empty { color: var(--dim); margin: auto; text-align: center; max-width: 460px; line-height: 1.7; padding: 32px; }
.empty h2 { color: var(--accent); font-size: 15px; letter-spacing: 0.08em; font-weight: 600; }
.empty kbd { border: 1px solid var(--line-bright); border-bottom-width: 2px; border-radius: 3px; padding: 1px 6px; font-size: 11px; color: var(--text); }

/* command palette */
.palette-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 60; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; }
.palette { width: 560px; max-width: 92vw; background: var(--panel); border: 1px solid var(--line-bright); border-radius: 6px; box-shadow: 0 24px 70px rgba(0,0,0,0.6); overflow: hidden; }
.palette input { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 14px 16px; font-size: 14px; }
.palette input:focus { box-shadow: none; }
.palette-list { max-height: 340px; overflow: auto; }
.palette-item { padding: 9px 16px; font-size: 13px; color: var(--dim); cursor: pointer; display: flex; justify-content: space-between; gap: 12px; }
.palette-item .sub { color: var(--faint); font-size: 11px; }
.palette-item.sel, .palette-item:hover { background: var(--accent-soft); color: var(--accent); }

/* settings drawer */
.drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 70; }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 470px; max-width: 94vw; background: var(--panel); border-left: 1px solid var(--line-bright); z-index: 71; display: flex; flex-direction: column; box-shadow: -20px 0 60px rgba(0,0,0,0.5); }
.drawer.wide { width: 820px; }
.drawer.workspace { width: 540px; }

/* prompts & skills split view */
.prompts-split { flex-direction: row !important; gap: 0 !important; padding: 0 !important; overflow: hidden; flex: 1; min-height: 0; }
.prompt-list { width: 280px; flex: 0 0 280px; border-right: 1px solid var(--line); overflow-y: auto; }
.prompt-item { padding: 9px 12px; border-bottom: 1px solid var(--line); cursor: pointer; font-size: 12.5px; }
.prompt-item:hover { background: var(--panel-2); }
.prompt-item.active { background: var(--accent-soft); color: var(--accent); }
.prompt-item .badge { font-size: 9px; padding: 0 5px; }
.prompt-edit { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.prompt-edit-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.prompt-edit-head .spacer { flex: 1; }
.prompt-textarea { flex: 1; border: 0; border-radius: 0; resize: none; font-size: 12.5px; line-height: 1.55; padding: 12px; min-height: 0; background: var(--bg); }
.prompt-textarea:focus { box-shadow: none; }
.drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.drawer-head .title { letter-spacing: 0.12em; text-transform: uppercase; font-size: 12px; color: var(--accent); }
.drawer-body { overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 18px; }
.drawer-foot { border-top: 1px solid var(--line); padding: 12px 16px; display: flex; gap: 8px; justify-content: flex-end; }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.field { margin-bottom: 10px; }
.field .hint { font-size: 10px; color: var(--faint); margin-top: 3px; }
fieldset { border: 1px solid var(--line); border-radius: 3px; padding: 12px; margin: 0; }
legend { font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--faint); padding: 0 6px; }
.stage-toggle { display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--line); padding: 9px; margin-bottom: 6px; cursor: pointer; }
.stage-toggle:hover { border-color: var(--line-bright); }
.stage-toggle input { width: auto; margin-top: 2px; accent-color: var(--accent); }
.stage-toggle .st-name { font-size: 12px; }
.stage-toggle .st-blurb { font-size: 11px; color: var(--dim); margin-top: 2px; line-height: 1.4; }
.folder-browser { border: 1px solid var(--line); border-radius: 3px; margin-top: 6px; max-height: 200px; overflow-y: auto; }
.folder-row { padding: 6px 9px; font-size: 12px; color: var(--dim); cursor: pointer; }
.folder-row:hover { background: var(--panel-2); color: var(--accent); }
.folder-path { font-size: 11px; color: var(--faint); word-break: break-all; padding: 6px 9px; border-bottom: 1px solid var(--line); }

/* searchable model picker */
.model-picker { position: relative; }
.model-picker > div > input { flex: 1; }
.model-list { position: absolute; z-index: 8; left: 0; right: 0; top: 100%; margin-top: 4px; max-height: 320px; overflow-y: auto; background: var(--panel-2); border: 1px solid var(--line-bright); border-radius: 4px; box-shadow: 0 12px 32px rgba(0,0,0,0.55); }
.model-controls { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--panel-2); z-index: 2; }
.model-scopes { display: flex; gap: 4px; }
.model-scopes .scope { border: 1px solid var(--line-bright); background: transparent; color: var(--dim); font-size: 11px; padding: 3px 9px; border-radius: 999px; }
.model-scopes .scope:hover { color: var(--text); }
.model-scopes .scope.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.model-scopes .scope:disabled { opacity: 0.35; cursor: not-allowed; }
.model-controls select { width: auto; flex: 1; padding: 4px 6px; font-size: 11.5px; }
.model-count { color: var(--faint); font-size: 11px; min-width: 34px; text-align: right; }
.model-options { padding: 6px 10px; border-bottom: 1px solid var(--line); position: sticky; top: 34px; background: var(--panel-2); z-index: 1; }
.variant-toggle { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--dim); text-transform: none; letter-spacing: 0; margin: 0; cursor: pointer; }
.variant-toggle input { width: auto; accent-color: var(--accent); }
.model-group { position: sticky; top: 64px; background: var(--panel); color: var(--faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; padding: 5px 10px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; z-index: 1; }
.model-hide { border: 0; background: transparent; color: var(--faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 0 2px; cursor: pointer; }
.model-hide:hover { color: var(--bad); }
.model-row.hi { background: var(--panel); box-shadow: inset 2px 0 0 var(--accent); }
.model-row { display: flex; justify-content: space-between; gap: 10px; padding: 7px 10px; font-size: 12.5px; cursor: pointer; border-bottom: 1px solid var(--line); }
.model-row:last-child { border-bottom: 0; }
.model-row:hover, .model-row.active { background: var(--accent-soft); }
.model-row.muted { color: var(--dim); cursor: default; }
.model-id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-meta { display: flex; gap: 8px; align-items: center; color: var(--dim); font-size: 11px; white-space: nowrap; }

::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--line-bright); border-radius: 4px; }
::-webkit-scrollbar-track { background: transparent; }
```

===== FILE: src/app/api/chat/route.ts =====

```ts
import { Provider } from '@/lib/provider';
import { runAgent } from '@/lib/agent';
import { getModelCatalog, resolveModel, isLocalUrl } from '@/lib/localserver';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

const num = (v: unknown, d: number) => {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : d;
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const task = String(body.messages?.find?.((m: any) => m.role === 'user')?.content || body.task || '');
  const workingDir = String(body.workingDirectory || body.cwd || path.join(process.cwd(), 'workspace'));
  fs.mkdirSync(workingDir, { recursive: true });

  const p = body.provider || {};
  const baseUrl = String(p.baseUrl || body.baseUrl || process.env.EC11_BASE_URL || 'http://127.0.0.1:1234/v1');
  const apiKey = String(p.apiKey || body.apiKey || process.env.EC11_API_KEY || '');
  const model = String(p.model || body.model || process.env.EC11_MODEL || '');

  const a = body.agent || {};
  const autoPrompt = body.autoPrompt || {};
  const stagesEnabled = autoPrompt.enabled !== false;
  const stages: string[] | undefined = Array.isArray(autoPrompt.stages) ? autoPrompt.stages : undefined;
  const ct = body.contextTools || {};
  const contextTools = {
    rtk: !!ct.rtk,
    ponytail: !!ct.ponytail,
    context7: !!ct.context7,
    codegraph: !!ct.codegraph,
    search: !!ct.search,
    skills: ct.skills !== false,
    context7ApiKey: String(ct.context7ApiKey || process.env.CONTEXT7_API_KEY || ''),
  };

  const encoder = new TextEncoder();
  const signal = req.signal;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => { try { controller.enqueue(encoder.encode(sse(e))); } catch {} };
      try {
        // Resolve the model server-side so a local provider always uses what's loaded.
        let effectiveModel = model;
        try {
          const cat = await getModelCatalog(baseUrl, apiKey);
          const loaded = cat.loaded;
          const r = resolveModel(baseUrl, model, loaded);
          effectiveModel = r.model;
          if (loaded.length) send({ type: 'system', content: `Model server loaded: ${loaded.join(', ')} — using ${effectiveModel}.` });
          else if (isLocalUrl(baseUrl)) send({ type: 'system', content: `No model reported as loaded on ${baseUrl}; requesting "${effectiveModel}" (server will load it).` });
        } catch { /* keep configured model */ }

        const provider = new Provider({
          baseUrl, model: effectiveModel, apiKey,
          maxTokens: num(p.maxTokens, 65536),
          temperature: typeof p.temperature === 'number' ? p.temperature : (p.temperature === undefined ? 0.7 : Number(p.temperature)),
          contextWindow: num(p.contextWindow, 65536),
          connectTimeoutMs: num(p.connectTimeoutMs, 60000),
          completionTimeoutMs: num(p.completionTimeoutMs, 600000),
          streamIdleTimeoutMs: num(p.streamIdleTimeoutMs, 300000),
          retries: num(p.retries, 3),
          signal,
        });
        const result = await runAgent({
          provider, workspace: workingDir, task,
          stagesEnabled, stages,
          maxIterations: num(a.maxIterations, parseInt(process.env.EC11_MAX_ITER || '0', 10)),
          stageMaxIterations: num(a.stageMaxIterations, parseInt(process.env.EC11_STAGE_MAX_ITER || '0', 10)),
          contextTools,
          signal,
          onEvent: send,
        });
        send({ type: 'auto_prompt_summary', stages: result.stageResults.length, results: result.stageResults });
        send({ type: 'done', finalContent: result.content, stageResults: result.stageResults });
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (signal.aborted) send({ type: 'system', content: 'Stopped by user.' });
        else send({ type: 'error', error: msg });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
```

===== FILE: src/app/api/models/route.ts =====

```ts
import { getModelCatalog } from '@/lib/localserver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function respond(baseUrl: string, apiKey: string) {
  try {
    const c = await getModelCatalog(baseUrl, apiKey);
    return Response.json({ ok: true, models: c.models, loaded: c.loaded, catalog: c.catalog, source: c.source });
  } catch (e: any) {
    return Response.json({ ok: false, models: [], loaded: [], catalog: {}, error: String(e?.message || e) }, { status: 200 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = url.searchParams.get('baseUrl') || process.env.EC11_BASE_URL || 'http://127.0.0.1:1234/v1';
  const apiKey = url.searchParams.get('apiKey') || process.env.EC11_API_KEY || '';
  return respond(baseUrl, apiKey);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const baseUrl = String(body.baseUrl || process.env.EC11_BASE_URL || 'http://127.0.0.1:1234/v1');
  const apiKey = String(body.apiKey || process.env.EC11_API_KEY || '');
  return respond(baseUrl, apiKey);
}
```

===== FILE: src/app/api/model-info/route.ts =====

```ts
import { getModelCatalog } from '@/lib/localserver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const baseUrl = String(body.baseUrl || process.env.EC11_BASE_URL || 'http://127.0.0.1:1234/v1');
  const apiKey = String(body.apiKey || process.env.EC11_API_KEY || '');
  const model = String(body.model || '');
  if (!model) return Response.json({ ok: false, error: 'no model given' });

  try {
    const c = await getModelCatalog(baseUrl, apiKey);
    const meta = c.catalog[model];
    if (meta && meta.ctx) {
      return Response.json({ ok: true, model, contextWindow: meta.ctx, maxTokens: meta.maxOut || meta.ctx, source: c.source });
    }
    return Response.json({ ok: false, model, error: 'This server does not report context size for the model. Set it manually.' });
  } catch (e: any) {
    return Response.json({ ok: false, model, error: String(e?.message || e) });
  }
}
```

===== FILE: src/app/api/files/route.ts =====

```ts
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv', '.cache']);

interface TreeNode { name: string; path: string; type: 'dir' | 'file'; children?: TreeNode[] }

function buildTree(dir: string, depth: number, maxDepth: number): TreeNode[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env' && e.name !== '.gitignore') continue;
    if (IGNORE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path: full, type: 'dir', children: depth < maxDepth ? buildTree(full, depth + 1, maxDepth) : [] });
    } else {
      nodes.push({ name: e.name, path: full, type: 'file' });
    }
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return nodes;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get('path') || process.cwd();
  const abs = path.resolve(target);
  const isTree = url.searchParams.get('tree') === '1' || url.searchParams.get('tree') === 'true';
  try {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      if (isTree) {
        const maxDepth = Math.min(Math.max(parseInt(url.searchParams.get('depth') || '4', 10), 1), 8);
        return Response.json({ ok: true, type: 'tree', path: abs, tree: buildTree(abs, 0, maxDepth) });
      }
      const entries = fs.readdirSync(abs, { withFileTypes: true }).map((e) => ({
        name: e.name, path: path.join(abs, e.name), type: e.isDirectory() ? 'dir' : 'file',
      }));
      return Response.json({ ok: true, type: 'dir', path: abs, entries });
    }
    const size = stat.size;
    if (size > 2 * 1024 * 1024) return Response.json({ ok: false, error: `File too large to open (${Math.round(size / 1024)} KB).` });
    const buf = fs.readFileSync(abs);
    const binary = buf.includes(0);
    if (binary) return Response.json({ ok: false, error: 'Binary file cannot be displayed.' });
    return Response.json({ ok: true, type: 'file', path: abs, content: buf.toString('utf8'), mtime: stat.mtimeMs, size });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const target = String(body.path || '');
  if (!target) return Response.json({ ok: false, error: 'path required' }, { status: 400 });
  const abs = path.resolve(target);
  try {
    const existed = fs.existsSync(abs);
    const before = existed ? fs.readFileSync(abs, 'utf8') : null;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(body.content ?? ''), 'utf8');
    return Response.json({ ok: true, path: abs, created: !existed, before });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get('path') || '';
  if (!target) return Response.json({ ok: false, error: 'path required' }, { status: 400 });
  const abs = path.resolve(target);
  try {
    if (!fs.existsSync(abs)) return Response.json({ ok: false, error: 'not found' });
    fs.rmSync(abs, { force: true });
    return Response.json({ ok: true, path: abs });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}
```

===== FILE: src/app/api/fs/route.ts =====

```ts
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Directory browser + creator for the working-folder picker.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = url.searchParams.get('path');
  const target = requested && requested.trim() ? requested : process.cwd();
  const abs = path.resolve(target);
  try {
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => e.name).sort((a, b) => a.localeCompare(b));
    const files = entries.filter((e) => e.isFile()).map((e) => e.name).slice(0, 100);
    const parent = path.dirname(abs);
    return Response.json({ ok: true, path: abs, parent: parent === abs ? null : parent, dirs, files, drives: listDrives() });
  } catch (e: any) {
    return Response.json({ ok: false, path: abs, error: String(e?.message || e), drives: listDrives() }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parent = String(body.parent || process.cwd());
  const name = String(body.name || '').trim();
  if (!name || /[\\/:*?"<>|]/.test(name)) {
    return Response.json({ ok: false, error: 'Invalid folder name.' });
  }
  const target = path.join(parent, name);
  try {
    fs.mkdirSync(target, { recursive: true });
    return Response.json({ ok: true, path: target });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) });
  }
}

function listDrives(): string[] {
  const drives: string[] = [];
  for (let i = 65; i <= 90; i++) {
    const d = String.fromCharCode(i) + ':\\';
    try { if (fs.existsSync(d)) drives.push(d); } catch { /* ignore */ }
  }
  return drives;
}
```

===== FILE: src/app/api/fs/pick/route.ts =====

```ts
import { execFile } from 'child_process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Native Windows folder picker, modern style (IFileOpenDialog + FOS_PICKFOLDERS).
// Runs on the same machine as the server (localhost), so it shows on the user's desktop.
// `autocloseMs` is for automated testing (force-closes the dialog).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const initial = String(body.initial || '');
  const autocloseMs = Math.min(Math.max(parseInt(body.autocloseMs || '0', 10) || 0, 0), 60000);
  const esc = (s: string) => s.replace(/'/g, "''");

  const cs = `
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileDialog {
  [PreserveSig] int Show(IntPtr parent);
  void SetFileTypes(int cFileTypes, IntPtr rgFilterSpec);
  void SetFileTypeIndex(int iFileTypeIndex);
  void GetFileTypeIndex(out int piFileTypeIndex);
  void Advise(IntPtr pfde, out int pdwCookie);
  void Unadvise(int dwCookie);
  void SetOptions(uint fos);
  void GetOptions(out uint pfos);
  void SetDefaultFolder(IShellItem psi);
  void SetFolder(IShellItem psi);
  void GetFolder(out IShellItem ppsi);
  void GetCurrentSelection(out IShellItem ppsi);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
  void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
  void GetResult(out IShellItem ppsi);
  void AddPlace(IShellItem psi, int fdap);
  void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
  void Close([MarshalAs(UnmanagedType.Error)] int hr);
  void SetClientGuid(ref Guid guid);
  void ClearClientData();
  void SetFilter(IntPtr pFilter);
}

[ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
  void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
  void GetParent(out IShellItem ppsi);
  void GetDisplayName(uint sigdnName, out IntPtr ppszName);
  void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
  void Compare(IShellItem psi, uint hint, out int piOrder);
}

[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
class FileOpenDialog { }

public class Ec11Picker {
  const uint FOS_PICKFOLDERS = 0x00000020;
  const uint FOS_FORCEFILESYSTEM = 0x00000040;
  const uint FOS_PATHMUSTEXIST = 0x00000800;
  const uint SIGDN_FILESYSPATH = 0x80058000;

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

  static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

  static void ForceForeground(string title) {
    for (int i = 0; i < 150; i++) {
      IntPtr h = FindWindow("#32770", title);
      if (h == IntPtr.Zero) h = FindWindow(null, title);
      if (h != IntPtr.Zero) {
        ShowWindow(h, 5);
        SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
        SetForegroundWindow(h);
        return;
      }
      System.Threading.Thread.Sleep(100);
    }
  }

  public static string Show(string title, string initial) {
    IFileDialog dlg = (IFileDialog)(new FileOpenDialog());
    dlg.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    if (!string.IsNullOrEmpty(title)) dlg.SetTitle(title);
    dlg.SetOkButtonLabel("Select Folder");
    if (!string.IsNullOrEmpty(initial)) {
      try {
        Guid iid = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");
        IShellItem start;
        SHCreateItemFromParsingName(initial, IntPtr.Zero, ref iid, out start);
        if (start != null) dlg.SetFolder(start);
      } catch { }
    }
    var fg = new System.Threading.Thread(() => ForceForeground(title));
    fg.IsBackground = true;
    fg.Start();
    int hr = dlg.Show(IntPtr.Zero);
    if (hr != 0) return null;
    IShellItem item;
    dlg.GetResult(out item);
    IntPtr psz;
    item.GetDisplayName(SIGDN_FILESYSPATH, out psz);
    string path = Marshal.PtrToStringUni(psz);
    Marshal.FreeCoTaskMem(psz);
    return path;
  }
}
`;

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$src = @\'\n' + cs + '\n\'@',
    'Add-Type -TypeDefinition $src -Language CSharp | Out-Null',
    `$p = [Ec11Picker]::Show('Choose the working folder for EC11', '${esc(initial)}')`,
    'if ($p) { [Console]::Out.Write($p) }',
  ].join('\n');

  const b64 = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise<Response>((resolve) => {
    let autoTimer: NodeJS.Timeout | null = null;
    const child = execFile('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', b64], { timeout: 300000, windowsHide: true }, (err: any, stdout: string, stderr: string) => {
      if (autoTimer) clearTimeout(autoTimer);
      const out = String(stdout || '').trim();
      if (out) return resolve(Response.json({ ok: true, path: out }));
      const msg = String(stderr || err?.message || '').trim().slice(0, 200);
      resolve(Response.json({ ok: false, cancelled: true, error: msg || 'No folder selected.' }));
    });
    if (autocloseMs > 0) autoTimer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, autocloseMs);
  });
}
```

===== FILE: src/app/api/exec/route.ts =====

```ts
import { exec } from 'child_process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BLOCKED = [/rm -rf \//i, /format [a-z]:/i, /del \/f \/s/i, /shutdown/i, /rd \/s \/q/i, /:\(\)\s*\{/, /fork bomb/i];

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const command = String(body.command || '').trim();
  const cwd = String(body.cwd || process.cwd());
  const timeoutMs = Math.min(Math.max(parseInt(body.timeoutMs || '120000', 10), 1000), 600000);
  if (!command) return Response.json({ ok: false, output: '', error: 'command required' }, { status: 400 });
  for (const b of BLOCKED) if (b.test(command)) return Response.json({ ok: false, output: '', error: 'command blocked by safety filter' });
  const started = Date.now();
  const shellCmd = /^powershell\b/i.test(command) ? command : `powershell -NoProfile -Command ${JSON.stringify(command)}`;
  return new Promise<Response>((resolve) => {
    exec(shellCmd, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err: any, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').replace(/\s+$/, '');
      resolve(Response.json({
        ok: !err,
        code: err?.code ?? 0,
        output: output.substring(0, 100000),
        durationMs: Date.now() - started,
      }));
    });
  });
}
```

===== FILE: src/app/api/prompts/route.ts =====

```ts
import * as fs from 'fs';
import * as path from 'path';
import { PROMPT_FILES, appAutopromptDir, workspaceAutopromptDir, readPrompt, promptSource, loadAgentsDocs, appRoot } from '@/lib/prompts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LABELS: Record<string, string> = {
  system: 'system.md — main agent system prompt',
  review: 'review.md — Review stage',
  completeness: 'completeness.md — Completeness stage',
  senior_review: 'senior_review.md — Senior Review stage',
  run_fix: 'run_fix.md — Run / Fix stage',
  'AGENTS.md': 'AGENTS.md — EC11 app conventions (applies to every run)',
  'PROJECT_AGENTS.md': 'AGENTS.md — target project conventions (this workspace)',
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace') || undefined;
  const files: Array<{ name: string; label: string; content: string; source: string; writable: boolean }> = PROMPT_FILES.map((name) => ({
    name,
    label: LABELS[name] || name,
    content: readPrompt(name, workspace),
    source: promptSource(name, workspace),
    writable: true,
  }));
  const agents = loadAgentsDocs(workspace);
  files.push({ name: 'AGENTS.md', label: LABELS['AGENTS.md'], content: agents.app, source: 'app', writable: true });
  if (workspace) {
    files.push({ name: 'PROJECT_AGENTS.md', label: LABELS['PROJECT_AGENTS.md'], content: agents.project, source: agents.project ? 'workspace' : 'builtin', writable: true });
  }
  return Response.json({
    ok: true,
    appDir: appAutopromptDir(),
    appRoot: appRoot(),
    files,
  });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '');
  const content = String(body.content ?? '');
  const scope = String(body.scope || 'app');
  const workspace = body.workspace ? String(body.workspace) : undefined;

  let file: string;
  if (name === 'AGENTS.md') {
    file = path.join(appRoot(), 'AGENTS.md');
  } else if (name === 'PROJECT_AGENTS.md') {
    if (!workspace) return Response.json({ ok: false, error: 'workspace is required for PROJECT_AGENTS.md' }, { status: 400 });
    file = path.join(workspace, 'AGENTS.md');
  } else if ((PROMPT_FILES as readonly string[]).includes(name)) {
    let dir = appAutopromptDir();
    if (scope === 'workspace') {
      const wsDir = workspaceAutopromptDir(workspace);
      if (!wsDir) return Response.json({ ok: false, error: 'workspace is required for scope=workspace' }, { status: 400 });
      dir = wsDir;
    }
    file = path.join(dir, name + '.md');
  } else {
    return Response.json({ ok: false, error: `Unknown prompt "${name}".` }, { status: 400 });
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return Response.json({ ok: true, file, scope });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}
```

===== FILE: src/app/api/skills/route.ts =====

```ts
import { listSkills, readSkill, skillsRoots } from '@/lib/prompts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get('name');
  if (name) {
    const file = url.searchParams.get('file') || 'SKILL.md';
    const r = readSkill(name, file);
    if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: 200 });
    return Response.json({ ok: true, skill: r.skill, file: r.file, content: r.content });
  }
  return Response.json({
    ok: true,
    roots: skillsRoots(),
    skills: listSkills().map((s) => ({ name: s.name, description: s.description, dir: s.dir, skillFile: s.skillFile })),
  });
}
```

===== FILE: src/lib/agent.ts =====

```ts
// EC11 main agent loop: think -> act -> observe, with executed-verification done-gate.
import { Provider, type ChatMsg } from './provider';
import { Tools, toolsFor, type ContextToolConfig } from './tools';
import { verifyDeliverable } from './verify';
import { runPipeline, type StageResult } from './stages';
import { contextToolPrompts } from './contexttools';
import { loadSystemPrompt, buildAgentsBlock, buildSkillsIndex } from './prompts';

export async function runAgent(opts: {
  provider: Provider;
  workspace: string;
  task: string;
  stagesEnabled?: boolean;
  stages?: string[];
  maxIterations?: number;
  stageMaxIterations?: number;
  contextTools?: ContextToolConfig;
  signal?: AbortSignal;
  onEvent: (e: any) => void;
}): Promise<{ content: string; stageResults: StageResult[] }> {
  const { provider, workspace, task, onEvent } = opts;
  const tools = new Tools(workspace, { rtk: opts.contextTools?.rtk, context7ApiKey: opts.contextTools?.context7ApiKey });
  const activeTools = toolsFor(opts.contextTools);
  const editTask = /debug|fix|bug|crash|error|refactor|edit|modify|update|patch|broken|repair/i.test(task);
  const systemPrompt = loadSystemPrompt(workspace)
    + buildAgentsBlock(workspace)
    + (opts.contextTools?.skills ? buildSkillsIndex() : '')
    + contextToolPrompts(opts.contextTools)
    + (editTask
      ? `\n\nTHIS IS AN EDIT/DEBUG TASK ON AN EXISTING PROJECT. You MUST modify the existing files with edit_file — read the file first, then replace the exact text. Do NOT create a new file to work around a bug, and do NOT just describe the fix; apply it, then call attempt_completion with evidence.`
      : '');
  const messages: ChatMsg[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ];
  let finalContent = '';
  const cfgMax = opts.maxIterations ?? parseInt(process.env.EC11_MAX_ITER || '0', 10);
  const maxIter = cfgMax && cfgMax > 0 ? cfgMax : Infinity;
  let iter = 0;
  let completed = false;
  let emptyStreak = 0;   // consecutive reasoning-only / empty turns
  let actNudges = 0;     // bounded "you explained but did not act" nudges
  let madeEdit = false;  // did the model actually change a file?
  let toolCallsSinceEdit = 0;
  let editGateNudges = 0; // bounded "you've done lots of tool calls, now EDIT" nudges
  const recentCalls: string[] = [];

  while (iter < maxIter && !completed) {
    if (opts.signal?.aborted) { onEvent({ type: 'system', content: 'Stopped by user.' }); return { content: finalContent, stageResults: [] }; }
    const result = await provider.complete(messages, { tools: activeTools as unknown as undefined[] });
    finalContent = result.content;
    if (result.usage && (result.usage.promptTokens || result.usage.completionTokens)) onEvent({ type: 'usage', usage: result.usage });
    if (result.reasoning) onEvent({ type: 'reasoning', content: result.reasoning });
    onEvent({ type: 'content', content: result.content });
    if (result.toolCalls.length === 0) {
      const reply = (result.content || '').trim();
      const truncated = result.finishReason === 'length';
      // Empty / reasoning-only / cut-off turn: never treat this as "done".
      if ((reply.length === 0 || truncated) && emptyStreak < 3) {
        emptyStreak++;
        onEvent({ type: 'system', content: `Empty/thinking turn (${emptyStreak}/3) — nudging the model to continue and act.` });
        messages.push({ role: 'user', content: 'SYSTEM: Your previous turn produced no tool call and no visible answer' + (truncated ? ' (it was cut off by the token limit)' : '') + '. Do not stop. Continue the task now — inspect files with read_file and apply the change with edit_file/write_file, or call attempt_completion if the task is genuinely finished.' });
        iter++;
        continue;
      }
      // The model answered with text but never used a tool. Nudge it (bounded) to actually DO the task.
      if (reply.length > 0 && actNudges < 2) {
        actNudges++;
        const msg = (editTask && !madeEdit)
          ? 'SYSTEM: You replied with text but have not changed any file. This is an edit/debug task — open the file with read_file and apply the fix with edit_file now. Do not just describe the fix. Then call attempt_completion.'
          : 'SYSTEM: You replied with text but did not modify any files. If this task requires changing code, do it now with edit_file/write_file, then call attempt_completion. If you are truly finished, call attempt_completion.';
        onEvent({ type: 'system', content: 'Model replied without acting — pushing it to apply the change.' });
        messages.push({ role: 'user', content: msg });
        iter++;
        continue;
      }
      completed = true;
      break;
    }
    emptyStreak = 0;
    messages.push({
      role: 'assistant', content: result.content || null,
      reasoning_content: result.reasoning || undefined,
      tool_calls: result.toolCalls.map((tc) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })),
    });
    let attempted = false;
    for (const tc of result.toolCalls) {
      onEvent({ type: 'tool_call', toolCall: { name: tc.name, arguments: JSON.stringify(tc.arguments) } });
      const tr = await tools.execute(tc.name, tc.arguments);
      onEvent({ type: 'tool_result', toolCall: { name: tc.name, success: tr.success, result: tr.output } });
      if ((tc.name === 'edit_file' || tc.name === 'write_file') && tr.success) madeEdit = true;
      if (tc.name === 'attempt_completion') attempted = true;
      toolCallsSinceEdit++;
      messages.push({ role: 'tool', tool_call_id: tc.id, content: tr.success ? tr.output : 'ERROR: ' + tr.error });
    }
    // Executed-verification done-gate: when the model asks to complete, RUN the deliverable.
    if (attempted) {
      onEvent({ type: 'system', content: 'EC11 verifying deliverable before accepting completion...' });
      const v = await verifyDeliverable(workspace);
      onEvent({ type: 'system', content: 'VERIFICATION: ' + (v.ok ? 'PASS' : 'FAIL') + '\n' + v.evidence });
      if (v.ok) {
        completed = true;
      } else {
        messages.push({ role: 'user', content: `AUTOMATED VERIFICATION FAILED. Fix the deliverable and call attempt_completion again. Evidence:\n${v.evidence}` });
      }
    }
    // Doom-loop guard: 3 identical consecutive tool calls -> force a different action.
    const sig = result.toolCalls.map((tc) => tc.name + ':' + JSON.stringify(tc.arguments)).join('|');
    recentCalls.push(sig);
    if (recentCalls.length > 3) recentCalls.shift();
    if (recentCalls.length === 3 && recentCalls.every((s) => s === sig)) {
      recentCalls.length = 0;
      onEvent({ type: 'system', content: 'Doom-loop detected (same action repeated) — forcing an edit.' });
      messages.push({ role: 'user', content: 'SYSTEM: You have repeated the same action three times with no progress. Stop exploring. Open the target file with read_file and apply the fix with edit_file now, or call attempt_completion if the task is genuinely finished.' });
    }
    if (madeEdit) toolCallsSinceEdit = 0;
    // No-progress gate: too many tool calls with no file change -> force the edit.
    if (!madeEdit && toolCallsSinceEdit >= 12 && editGateNudges < 3) {
      editGateNudges++;
      toolCallsSinceEdit = 0;
      onEvent({ type: 'system', content: `No file change after many tool calls — forcing an edit (nudge ${editGateNudges}/3).` });
      messages.push({ role: 'user', content: 'SYSTEM: You have used many tool calls without modifying any file. STOP investigating and make the change now: open the target file with read_file, then use edit_file to apply the fix, then call attempt_completion. Do not describe the fix — apply it.' });
    }
    iter++;
  }

  // Autoprompt stages (review + completeness + senior_review). Each stage waits for the previous.
  let stageResults: StageResult[] = [];
  const stageList = opts.stages ?? ['review', 'completeness', 'senior_review'];
  if (opts.stagesEnabled !== false && stageList.length) {
    onEvent({ type: 'auto_prompt_pipeline_start', stages: stageList });
    stageResults = await runPipeline({
      provider, tools, workspace, task, onEvent,
      stages: stageList,
      maxIterations: opts.stageMaxIterations,
      contextTools: opts.contextTools,
      signal: opts.signal,
    });
  }

  return { content: finalContent, stageResults };
}
```

===== FILE: src/lib/provider.ts =====

```ts
// EC11 provider layer: OpenAI-compatible client (Freetoken / LM Studio / any local server).
// Key decisions from the benchmark: reasoning_content as a first-class event, high max_tokens
// floor, per-request token clamp vs the model's context, model-scaling timeouts, retries.
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

export interface TokenUsage { promptTokens: number; completionTokens: number; totalTokens: number }

export interface ChatMsg { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; name?: string; tool_call_id?: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>; reasoning_content?: string }

export interface ProviderOpts {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  contextWindow?: number;
  connectTimeoutMs?: number;
  completionTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

export interface StreamEvent {
  type: 'content' | 'reasoning_content' | 'tool_call_delta' | 'tool_call_end' | 'done' | 'error';
  content?: string;
  name?: string;
  arguments?: string;
  toolCallId?: string;
  error?: string;
  finishReason?: string;
}

const DEFAULT_BASE = 'http://127.0.0.1:1234/v1';

export class Provider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private maxTokens: number;
  private temperature: number;
  private contextWindow: number;
  private connectTimeoutMs: number;
  private completionTimeoutMs: number;
  private streamIdleTimeoutMs: number;
  private retries: number;
  private signal?: AbortSignal;

  constructor(opts: ProviderOpts = {}) {
    this.baseUrl = (opts.baseUrl || process.env.EC11_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
    this.model = opts.model || process.env.EC11_MODEL || '';
    this.apiKey = opts.apiKey || process.env.EC11_API_KEY || '';
    this.maxTokens = opts.maxTokens ?? parseInt(process.env.EC11_MAX_TOKENS || '30000', 10);
    this.temperature = opts.temperature ?? 0.7;
    this.contextWindow = opts.contextWindow ?? parseInt(process.env.EC11_CONTEXT_WINDOW || '65536', 10);
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 60000;
    this.completionTimeoutMs = opts.completionTimeoutMs ?? 600000;
    this.streamIdleTimeoutMs = opts.streamIdleTimeoutMs ?? 300000;
    this.retries = opts.retries ?? 3;
    this.signal = opts.signal;
  }

  private aborted(): boolean { return !!this.signal?.aborted; }

  // List models exposed by the OpenAI-compatible server (LM Studio: GET /models).
  async listModels(): Promise<string[]> {
    try {
      const res = await this.fetchWithTimeout('/models', { method: 'GET', headers: this.headers() }, this.connectTimeoutMs);
      if (!res.ok) return [];
      const data: any = await res.json();
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return arr.map((m: any) => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
    } catch { return []; }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    // OpenRouter convention: identify the app (optional but recommended)
    if (/openrouter/i.test(this.baseUrl)) {
      h['HTTP-Referer'] = 'http://localhost:3000';
      h['X-Title'] = 'EC11';
    }
    return h;
  }

  // Clamp requested max_tokens to the model context minus an 8% reserve and a reasoning buffer.
  clampMaxTokens(requested: number, currentMessagesLen: number): number {
    const reserve = Math.floor(this.contextWindow * 0.08);
    const reasoningBuffer = 4000;
    const available = Math.max(512, this.contextWindow - currentMessagesLen - reserve - reasoningBuffer);
    return Math.floor(Math.min(requested, available));
  }

  private async fetchWithTimeout(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const onAbort = () => ctl.abort();
    this.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
      this.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async rawChat(messages: ChatMsg[], maxTokens: number, tools?: unknown[]): Promise<any> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: maxTokens,
      stream: false,
    };
    if (tools && (tools as any[]).length) {
      // OpenAI-compatible tools need the {type:"function", function:{...}} envelope.
      body.tools = (tools as any[]).map((t) => (t.function ? t : { type: 'function', function: t }));
    }
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (this.aborted()) throw new Error('Aborted by user');
      try {
        const res = await this.fetchWithTimeout('/chat/completions', {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
        }, this.completionTimeoutMs);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`Provider HTTP ${res.status}: ${txt.substring(0, 300)}`);
        }
        return await res.json();
      } catch (e: any) {
        lastErr = e;
        const msg = String(e.message || e);
        const retryable = /fetch failed|econnrefused|econnreset|429|overloaded|timeout|abort/i.test(msg);
        if (this.aborted()) break;
        if (!retryable || attempt === this.retries) break;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    throw lastErr || new Error('Provider request failed');
  }

  // Non-streaming completion with tool calls.
  async complete(messages: ChatMsg[], opts: { maxTokens?: number; tools?: unknown[] } = {}): Promise<{ content: string; reasoning: string; toolCalls: Array<{ id: string; name: string; arguments: any }>; finishReason?: string; usage: TokenUsage }> {
    const requested = opts.maxTokens || this.maxTokens;
    const clamped = this.clampMaxTokens(requested, JSON.stringify(messages).length / 4);
    const data = await this.rawChat(messages, clamped, opts.tools);
    const msg = data?.choices?.[0]?.message || {};
    const content = typeof msg.content === 'string' ? msg.content : '';
    const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content
      : (typeof msg.reasoning === 'string' ? msg.reasoning : '');
    const toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.map((tc: any) => {
          let args: any = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = { __raw: tc.function?.arguments }; }
          return { id: tc.id, name: tc.function?.name || '', arguments: args };
        })
      : [];
    const u = data?.usage || {};
    const promptTokens = Number(u.prompt_tokens || 0);
    const completionTokens = Number(u.completion_tokens || 0);
    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: Number(u.total_tokens || (promptTokens + completionTokens)),
    };
    return { content, reasoning, toolCalls, finishReason: data?.choices?.[0]?.finish_reason, usage };
  }

  // Streaming completion (SSE). Yields content + reasoning + tool-call deltas.
  async *stream(messages: ChatMsg[], opts: { maxTokens?: number; tools?: unknown[] } = {}): AsyncGenerator<StreamEvent> {
    const requested = opts.maxTokens || this.maxTokens;
    const clamped = this.clampMaxTokens(requested, JSON.stringify(messages).length / 4);
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: clamped,
      stream: true,
    };
    if (opts.tools && (opts.tools as any[]).length) {
      body.tools = (opts.tools as any[]).map((t) => (t.function ? t : { type: 'function', function: t }));
    }
    const res = await this.fetchWithTimeout('/chat/completions', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    }, this.connectTimeoutMs);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Provider HTTP ${res.status}: ${txt.substring(0, 300)}`);
    }
    if (!res.body) throw new Error('No response body');
    const reader = (res.body as NodeReadableStream).getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let lastData = Date.now();
    const idleTimer = setInterval(() => {
      if (Date.now() - lastData > this.streamIdleTimeoutMs) {
        // Can't abort the reader here cleanly; mark error via a thrown flag.
      }
    }, 5000);
    const pending = new Map<string, { name: string; args: string }>();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lastData = Date.now();
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          const payload = s.slice(5).trim();
          if (payload === '[DONE]') continue;
          let ev: any;
          try { ev = JSON.parse(payload); } catch { continue; }
          const delta = ev?.choices?.[0]?.delta || {};
          const reasoningDelta = delta.reasoning_content
            || delta.reasoning
            || (typeof delta.reasoning_details === 'string' ? delta.reasoning_details : '');
          if (reasoningDelta) yield { type: 'reasoning_content', content: reasoningDelta };
          if (typeof delta.content === 'string' && delta.content.length) yield { type: 'content', content: delta.content };
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const cur = pending.get(String(idx)) || { name: '', args: '' };
              if (tc.function?.name) cur.name += tc.function.name;
              if (tc.function?.arguments) cur.args += tc.function.arguments;
              pending.set(String(idx), cur);
              if (tc.id) { yield { type: 'tool_call_delta', toolCallId: tc.id, name: cur.name, arguments: cur.args }; }
              else { yield { type: 'tool_call_delta', name: cur.name, arguments: cur.args }; }
            }
          }
          const fr = ev?.choices?.[0]?.finish_reason;
          if (fr) yield { type: 'done', finishReason: fr };
        }
      }
      clearInterval(idleTimer);
      // Flush completed tool calls (accumulated by index, matching the c2-lineage fix).
      for (const [, tc] of pending) {
        if (tc.name) yield { type: 'tool_call_end', name: tc.name, arguments: tc.args };
      }
    } catch (e: any) {
      clearInterval(idleTimer);
      yield { type: 'error', error: String(e.message || e) };
    }
  }
}
```

===== FILE: src/lib/tools.ts =====

```ts
// EC11 tool registry: file ops, shell (PowerShell-first), todo, syntax verify, completion gates.
// Safety: workspace-relative paths, blocklist for destructive commands, timeouts.
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { listSkills, readSkill } from './prompts';

export interface ToolResult { success: boolean; output: string; error?: string }

export const TOOLS: Array<{ name: string; description: string; parameters: Record<string, any> }> = [
  { name: 'read_file', description: 'Read a file (relative to workspace).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write a file (relative to workspace).', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'Edit an existing file by replacing an exact string. You MUST read the file first. old_string must match exactly (whitespace included) and be unique unless replace_all is true. Prefer this over write_file for existing files.', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'list_files', description: 'List files in a directory (relative to workspace).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [] } },
  { name: 'shell_command', description: 'Run a command in the workspace (PowerShell-first; no && or ||).', parameters: { type: 'object', properties: { command: { type: 'string' }, timeout_ms: { type: 'number' } }, required: ['command'] } },
  { name: 'todo', description: 'Plan remaining work. Pass an array of steps.', parameters: { type: 'object', properties: { steps: { type: 'array', items: { type: 'string' } } }, required: [] } },
  { name: 'syntax_check', description: 'Check a written file for syntax (node --check for JS incl. inline scripts of HTML; py_compile for Python).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'attempt_completion', description: 'Declare the task complete. The harness verifies the deliverable before accepting.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
  { name: 'report_verdict', description: 'Report a stage verdict: PASS or FAIL.', parameters: { type: 'object', properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, summary: { type: 'string' } }, required: ['verdict', 'summary'] } },
  { name: 'web_search', description: 'Search the web for current information (docs, errors, versions). Use when the answer is not in the workspace or your training data.', parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number' } }, required: ['query'] } },
  { name: 'context7_docs', description: 'Fetch up-to-date, version-specific library documentation via Context7. Pass libraryName (e.g. "next.js") or a known libraryId (e.g. "/vercel/next.js") plus your question.', parameters: { type: 'object', properties: { libraryName: { type: 'string' }, libraryId: { type: 'string' }, query: { type: 'string' } }, required: ['query'] } },
  { name: 'code_graph', description: 'Query the local code graph (symbols, imports, files) instead of grepping blindly. action: stats | symbol | file | refs.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['stats', 'symbol', 'file', 'refs'] }, query: { type: 'string' }, path: { type: 'string' } }, required: [] } },
  { name: 'list_skills', description: 'List the global skills installed on this system (name + description). Use when a task might match an existing skill.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'read_skill', description: 'Read a global skill by name (default SKILL.md) and follow it. Can also read extra files inside that skill folder via the file argument.', parameters: { type: 'object', properties: { name: { type: 'string' }, file: { type: 'string' } }, required: ['name'] } },
];

export interface ContextToolConfig {
  rtk: boolean;
  ponytail: boolean;
  context7: boolean;
  codegraph: boolean;
  search: boolean;
  skills: boolean;
  context7ApiKey: string;
}

// Only expose the extra tools that are actually switched on.
export function toolsFor(ctx?: Partial<ContextToolConfig>): typeof TOOLS {
  return TOOLS.filter((t) => {
    if (t.name === 'web_search') return !!ctx?.search;
    if (t.name === 'context7_docs') return !!ctx?.context7;
    if (t.name === 'code_graph') return !!ctx?.codegraph;
    if (t.name === 'list_skills' || t.name === 'read_skill') return !!ctx?.skills;
    return true;
  });
}

const BLOCKED = [/rm -rf /i, /format c:/i, /del \/f \/s/i, /shutdown/i, /rd \/s \/q/i, /:\(\)/, /fork bomb/i];

export class Tools {
  private workspace: string;
  private readFiles = new Set<string>();
  private wroteFiles = new Set<string>();
  private rtk = false;
  private context7ApiKey = '';
  private rtkChecked = false;
  private rtkOk = false;
  private mcpSessionId: string | undefined;
  private graphCache: { ts: number; files: number; symbols: Array<{ name: string; file: string; line: number; kind: string }>; imports: Array<{ file: string; module: string }> } | null = null;
  constructor(workspace: string, opts?: { rtk?: boolean; context7ApiKey?: string }) {
    this.workspace = workspace;
    this.rtk = !!opts?.rtk;
    this.context7ApiKey = opts?.context7ApiKey || '';
  }

  private key(f: string): string { return path.resolve(f).toLowerCase(); }
  // Accept several argument spellings so the model's tool call always binds.
  private arg(args: any, ...names: string[]): any {
    for (const n of names) if (args && args[n] !== undefined && args[n] !== null) return args[n];
    return undefined;
  }

  resolve(p: string): string {
    const norm = p.replace(/\\/g, '/').replace(/^\.\//, '');
    const abs = path.isAbsolute(p) ? p : path.join(this.workspace, norm);
    const rel = path.relative(this.workspace, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path escapes workspace: ' + p);
    return abs;
  }

  async execute(name: string, args: any): Promise<ToolResult> {
    try {
      switch (name) {
        case 'read_file': {
          const p = this.arg(args, 'file_path', 'path');
          const f = this.resolve(p || '');
          if (!fs.existsSync(f)) return { success: false, output: '', error: 'file not found: ' + p };
          this.readFiles.add(this.key(f));
          return { success: true, output: fs.readFileSync(f, 'utf8') };
        }
        case 'write_file': {
          const p = this.arg(args, 'file_path', 'path');
          const f = this.resolve(p || '');
          const content = String(this.arg(args, 'content', 'text') ?? '');
          if (fs.existsSync(f) && !this.arg(args, 'overwrite')) {
            const old = fs.readFileSync(f, 'utf8');
            const oldLines = old.split('\n').length;
            const newLines = content.split('\n').length;
            if (oldLines > 20 && newLines > oldLines * 1.5) {
              return { success: false, output: '', error: `Refusing to overwrite ${p} wholesale: existing file is ${oldLines} lines but new content is ${newLines}. Use edit_file to change the specific text, or pass overwrite:true if a full rewrite is intended.` };
            }
          }
          fs.mkdirSync(path.dirname(f), { recursive: true });
          fs.writeFileSync(f, content, 'utf8');
          this.wroteFiles.add(this.key(f));
          return { success: true, output: `wrote ${f} (${content.length} bytes)` };
        }
        case 'edit_file': {
          const p = this.arg(args, 'file_path', 'path');
          const f = this.resolve(p || '');
          if (!fs.existsSync(f)) return { success: false, output: '', error: `file not found: ${p}. Use list_files / read_file first.` };
          if (!this.readFiles.has(this.key(f)) && !this.wroteFiles.has(this.key(f))) {
            return { success: false, output: '', error: `You must read ${p} with read_file before editing it.` };
          }
          const oldStr = String(this.arg(args, 'old_string', 'old_text', 'oldString', 'old_str') ?? '');
          const newStr = String(this.arg(args, 'new_string', 'new_text', 'newString', 'new_str') ?? '');
          if (!oldStr) return { success: false, output: '', error: 'edit_file requires old_string (the exact text to replace).' };
          const content = fs.readFileSync(f, 'utf8');
          const applied = this.applyReplace(content, oldStr, newStr, !!this.arg(args, 'replace_all'));
          if (!applied.ok) return { success: false, output: '', error: applied.error };
          const before = content;
          fs.writeFileSync(f, applied.content, 'utf8');
          let diag = '';
          try {
            const sc = await this.syntaxCheck(p || '');
            if (!sc.success) {
              fs.writeFileSync(f, before, 'utf8');
              return { success: false, output: '', error: `Edit broke the syntax of ${p}; reverted to the previous version.\n` + (sc.error || sc.output) };
            }
            diag = '\n[syntax] ok';
          } catch { /* ignore */ }
          return { success: true, output: `edited ${p}${diag}` };
        }
        case 'list_files': {
          const d = this.resolve(args.path || '.');
          if (!fs.existsSync(d)) return { success: true, output: '(empty)' };
          const items = fs.readdirSync(d, { withFileTypes: true }).map((e) => e.isDirectory() ? e.name + '/' : e.name);
          return { success: true, output: items.slice(0, 200).join('\n') };
        }
        case 'shell_command': {
          const cmd = String(args.command || '');
          for (const b of BLOCKED) if (b.test(cmd)) return { success: false, output: '', error: 'blocked command pattern' };
          if (cmd.includes('&&') || cmd.includes('||')) return { success: false, output: '', error: 'chained commands not allowed; run one command at a time' };
          const timeoutMs = Math.min(Math.max(parseInt(args.timeout_ms || '120000', 10), 10000), 600000);
          const out = await this.runShell(cmd, timeoutMs);
          return out;
        }
        case 'todo': {
          const steps = Array.isArray(args.steps) ? args.steps.join('\n') : String(args.steps || '');
          return { success: true, output: 'TODO:\n' + steps };
        }
        case 'syntax_check': return this.syntaxCheck(args.path || '');
        case 'attempt_completion': return { success: true, output: 'COMPLETION REQUESTED: ' + String(args.summary || '') };
        case 'report_verdict': return { success: true, output: `VERDICT: ${String(args.verdict || 'FAIL')} - ${String(args.summary || '')}` };
        case 'web_search': return this.webSearch(String(this.arg(args, 'query', 'q') || ''), parseInt(this.arg(args, 'max_results') || '5', 10));
        case 'context7_docs': return this.context7Docs({ libraryName: this.arg(args, 'libraryName', 'library_name'), libraryId: this.arg(args, 'libraryId', 'library_id'), query: this.arg(args, 'query') });
        case 'code_graph': return this.codeGraph({ action: String(this.arg(args, 'action') || 'stats'), query: String(this.arg(args, 'query') || ''), path: String(this.arg(args, 'path', 'file') || '') });
        case 'list_skills': {
          const skills = listSkills();
          if (!skills.length) return { success: true, output: 'No global skills found (~/.agents/skills, ~/.claude/skills).' };
          return { success: true, output: skills.map((s) => `- ${s.name}: ${s.description || '(no description)'}`).join('\n') };
        }
        case 'read_skill': {
          const name = String(this.arg(args, 'name', 'skill') || '');
          const file = String(this.arg(args, 'file', 'path') || 'SKILL.md');
          const r = readSkill(name, file);
          if (!r.ok) return { success: false, output: '', error: r.error || 'skill read failed' };
          return { success: true, output: `# SKILL: ${r.skill} (${r.file})\n\n${r.content}` };
        }
        default: return { success: false, output: '', error: 'unknown tool ' + name };
      }
    } catch (e: any) {
      return { success: false, output: '', error: String(e.message || e) };
    }
  }

  // ---- Context tools ----

  private async webSearch(query: string, maxResults: number): Promise<ToolResult> {
    if (!query.trim()) return { success: false, output: '', error: 'web_search requires a query.' };
    const max = Math.min(Math.max(maxResults || 5, 1), 10);
    try {
      const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' },
      });
      const html = await res.text();
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippets: string[] = [];
      let sm: RegExpExecArray | null;
      while ((sm = snipRe.exec(html))) snippets.push(stripTags(sm[1]));
      let m: RegExpExecArray | null;
      let i = 0;
      while ((m = linkRe.exec(html)) && results.length < max) {
        let url = decodeURIComponent(m[1]);
        const u = url.match(/[?&]uddg=([^&]+)/);
        if (u) url = decodeURIComponent(u[1]);
        results.push({ title: stripTags(m[2]), url, snippet: snippets[i] || '' });
        i++;
      }
      if (!results.length) return { success: true, output: 'No results parsed (search engine may have blocked the request). Query: ' + query };
      const out = results.map((r, n) => `${n + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
      return { success: true, output: out.substring(0, 8000) };
    } catch (e: any) {
      return { success: false, output: '', error: 'web_search failed: ' + String(e?.message || e) };
    }
  }

  private async mcpCall(tool: string, args: any): Promise<string> {
    const ENDPOINT = 'https://mcp.context7.com/mcp';
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.context7ApiKey) baseHeaders['Authorization'] = `Bearer ${this.context7ApiKey}`;
    const post = (body: any, sid?: string) =>
      fetch(ENDPOINT, { method: 'POST', headers: { ...baseHeaders, ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
    if (!this.mcpSessionId) {
      const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ec11', version: '1.0' } } });
      this.mcpSessionId = init.headers.get('mcp-session-id') || undefined;
      await init.text().catch(() => '');
      if (this.mcpSessionId) {
        await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, this.mcpSessionId).then((r) => r.text()).catch(() => '');
      }
    }
    const res = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } }, this.mcpSessionId);
    const raw = await res.text();
    const parsed = parseMcpResult(raw);
    if (!parsed && !res.ok) throw new Error(`Context7 HTTP ${res.status}: ${raw.slice(0, 200)}`);
    if (!parsed) throw new Error('Context7 returned no parseable content.');
    return parsed;
  }

  private async context7Docs(args: { libraryName?: string; libraryId?: string; query?: string }): Promise<ToolResult> {
    try {
      let lib = args.libraryId ? String(args.libraryId) : '';
      const query = String(args.query || '');
      if (!lib && args.libraryName) {
        const text = await this.mcpCall('resolve-library-id', { query: query || String(args.libraryName), libraryName: String(args.libraryName) });
        const m = text.match(/\/[\w.\-]+\/[\w.\-]+/);
        lib = m ? m[0] : '';
        if (!lib) return { success: true, output: 'Context7 library lookup (no id parsed):\n' + text.substring(0, 2000) };
      }
      if (!lib) return { success: false, output: '', error: 'context7_docs needs libraryName or libraryId.' };
      const text = await this.mcpCall('query-docs', { libraryId: lib, query });
      return { success: true, output: `Context7 docs for ${lib}:\n` + text.substring(0, 12000) };
    } catch (e: any) {
      return { success: false, output: '', error: 'Context7 failed: ' + String(e?.message || e) };
    }
  }

  private buildGraph() {
    if (this.graphCache && Date.now() - this.graphCache.ts < 20000) return this.graphCache;
    const symbols: Array<{ name: string; file: string; line: number; kind: string }> = [];
    const imports: Array<{ file: string; module: string }> = [];
    let files = 0;
    const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.ps1', '.go', '.rs', '.java', '.rb', '.c', '.cpp', '.h', '.hpp', '.cs', '.php']);
    const skip = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv', '.cache', 'target', 'out']);
    const walk = (dir: string, depth: number) => {
      if (depth > 8 || files > 3000) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (files > 3000) return;
        if (e.name.startsWith('.') || skip.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full, depth + 1); continue; }
        if (!exts.has(path.extname(e.name).toLowerCase())) continue;
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        if (stat.size > 400 * 1024) continue;
        let content: string;
        try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
        if (content.includes('\0')) continue;
        files++;
        const rel = path.relative(this.workspace, full).replace(/\\/g, '/');
        const lines = content.split('\n');
        const addSymbol = (name: string, line: number, kind: string) => { if (name && symbols.length < 20000) symbols.push({ name, file: rel, line, kind }); };
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          let m: RegExpMatchArray | null;
          if ((m = l.match(/(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/))) addSymbol(m[1], i + 1, 'function');
          if ((m = l.match(/(?:^|\s)(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/))) addSymbol(m[1], i + 1, 'class');
          if ((m = l.match(/(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function|\w+\s*=>)/))) addSymbol(m[1], i + 1, 'const');
          if ((m = l.match(/(?:^|\s)(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/))) addSymbol(m[1], i + 1, 'type');
          if ((m = l.match(/^\s*def\s+(\w+)/))) addSymbol(m[1], i + 1, 'def');
          if ((m = l.match(/^\s*class\s+([A-Za-z_]\w*)/))) addSymbol(m[1], i + 1, 'class');
          if ((m = l.match(/^\s*(?:export\s+)?import\s+.*?from\s+['"]([^'"]+)['"]/)) || (m = l.match(/require\(\s*['"]([^'"]+)['"]\s*\)/)) || (m = l.match(/^\s*from\s+(\S+)\s+import/))) imports.push({ file: rel, module: m[1] });
        }
      }
    };
    walk(this.workspace, 0);
    this.graphCache = { ts: Date.now(), files, symbols, imports };
    return this.graphCache;
  }

  private codeGraph(args: { action: string; query: string; path: string }): ToolResult {
    try {
      const g = this.buildGraph();
      const action = (args.action || 'stats').toLowerCase();
      if (action === 'stats') {
        const byKind: Record<string, number> = {};
        for (const s of g.symbols) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
        return { success: true, output: `Code graph: ${g.files} files, ${g.symbols.length} symbols, ${g.imports.length} imports.\nSymbol kinds: ${JSON.stringify(byKind)}` };
      }
      if (action === 'symbol') {
        const q = args.query.toLowerCase();
        const hits = g.symbols.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 60);
        return { success: true, output: hits.length ? hits.map((s) => `${s.file}:${s.line}  ${s.kind} ${s.name}`).join('\n') : `No symbol matching "${args.query}".` };
      }
      if (action === 'file') {
        const q = (args.path || args.query).toLowerCase();
        const syms = g.symbols.filter((s) => s.file.toLowerCase().includes(q));
        const imps = g.imports.filter((s) => s.file.toLowerCase().includes(q));
        return { success: true, output: `File match "${q}":\n` + syms.map((s) => `  ${s.line}: ${s.kind} ${s.name}`).join('\n') + `\nImports:\n` + imps.map((s) => '  ' + s.module).join('\n') };
      }
      if (action === 'refs') {
        const q = args.query.toLowerCase();
        const filesHit = new Set(g.symbols.filter((s) => s.name.toLowerCase() === q).map((s) => s.file));
        return { success: true, output: `"${args.query}" defined in ${filesHit.size} file(s):\n` + [...filesHit].join('\n') };
      }
      return { success: false, output: '', error: 'code_graph action must be stats | symbol | file | refs.' };
    } catch (e: any) {
      return { success: false, output: '', error: 'code_graph failed: ' + String(e?.message || e) };
    }
  }

  private rtkAvailable(): boolean {
    if (this.rtkChecked) return this.rtkOk;
    this.rtkChecked = true;
    try {
      const { execSync } = require('child_process');
      execSync('where rtk', { stdio: 'ignore', timeout: 5000 });
      this.rtkOk = true;
    } catch { this.rtkOk = false; }
    return this.rtkOk;
  }

  private static readonly RTK_TOOLS = new Set(['git', 'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'tree', 'diff', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'bunx', 'cargo', 'go', 'pytest', 'python', 'pip', 'uv', 'docker', 'kubectl', 'oc', 'gh', 'ruff', 'tsc', 'deno', 'mvn', 'mvnd', 'sbt', 'aws', 'pulumi', 'prisma', 'bundle', 'rake', 'rspec', 'jest', 'vitest', 'playwright', 'prettier', 'next', 'json', 'deps', 'env', 'log', 'sqlfluff', 'golangci-lint', 'rubocop']);

  private runShell(cmd: string, timeoutMs: number): Promise<ToolResult> {
    let effective = cmd;
    if (this.rtk && this.rtkAvailable()) {
      const first = cmd.trim().split(/\s+/)[0].toLowerCase();
      if (Tools.RTK_TOOLS.has(first)) effective = 'rtk ' + cmd;
    }
    return new Promise((resolve) => {
      const ps = effective.toLowerCase().includes('powershell') ? effective : `powershell -NoProfile -Command "${effective.replace(/"/g, '\"')}"`;
      exec(ps, { cwd: this.workspace, timeout: timeoutMs, windowsHide: true, env: { ...process.env, RTK_TELEMETRY_DISABLED: '1' } }, (err, stdout, stderr) => {
        const text = [stdout, stderr].join('\n').trim();
        if (err && !text) return resolve({ success: false, output: '', error: String(err.message) });
        resolve({ success: !err, output: text.substring(0, 20000) });
      });
    });
  }

  // Exact match first; then indentation/whitespace-tolerant line matching; then actionable errors.
  private applyReplace(content: string, oldStr: string, newStr: string, replaceAll: boolean): { ok: boolean; content: string; error?: string } {
    const occurrences = oldStr ? content.split(oldStr).length - 1 : 0;
    if (occurrences > 1 && !replaceAll) {
      return { ok: false, content, error: `Found ${occurrences} matches for old_string. Add more surrounding context to make it unique, or set replace_all:true.` };
    }
    if (occurrences >= 1) {
      return { ok: true, content: replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr) };
    }
    const win = this.findLineWindow(content, oldStr);
    if (win) return { ok: true, content: content.slice(0, win.start) + newStr + content.slice(win.end) };
    const oTrim = oldStr.trim();
    if (oTrim && content.includes(oTrim)) return { ok: true, content: content.replace(oTrim, newStr) };
    const first = (oldStr.trim().split('\n')[0] || '').trim();
    const lines = content.split('\n');
    let near = -1;
    for (let i = 0; i < lines.length; i++) { if (first && lines[i].includes(first.slice(0, Math.min(24, first.length)))) { near = i; break; } }
    return {
      ok: false, content,
      error: `Could not find old_string in the file. It must match exactly, including whitespace and indentation. ` +
        (near >= 0 ? `The closest line is ${near + 1}: "${lines[near].trim().slice(0, 100)}". ` : '') +
        `Read the file again with read_file and copy the exact text you want to replace.`,
    };
  }

  // Match a run of lines ignoring leading/trailing whitespace; return original char offsets.
  private findLineWindow(content: string, oldStr: string): { start: number; end: number } | null {
    const cLines = content.split('\n');
    const raw = oldStr.replace(/\r\n/g, '\n').split('\n');
    while (raw.length && raw[0].trim() === '') raw.shift();
    while (raw.length && raw[raw.length - 1].trim() === '') raw.pop();
    const oLines = raw.map((l) => l.trim());
    if (!oLines.length) return null;
    const starts: number[] = [];
    let pos = 0;
    for (const l of cLines) { starts.push(pos); pos += l.length + 1; }
    for (let i = 0; i + oLines.length <= cLines.length; i++) {
      let ok = true;
      for (let j = 0; j < oLines.length; j++) { if (cLines[i + j].trim() !== oLines[j]) { ok = false; break; } }
      if (ok) {
        const start = starts[i];
        const end = starts[i + oLines.length - 1] + cLines[i + oLines.length - 1].length;
        return { start, end };
      }
    }
    return null;
  }

  // node --check on JS files; extract inline <script> blocks from HTML and check each; py_compile for Python.
  async syntaxCheck(p: string): Promise<ToolResult> {
    const f = this.resolve(p);
    if (!fs.existsSync(f)) return { success: false, output: '', error: 'file not found: ' + p };
    const ext = path.extname(f).toLowerCase();
    if (ext === '.html') {
      const html = fs.readFileSync(f, 'utf8');
      const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
      for (const s of scripts) {
        const tmp = path.join(this.workspace, '.ec11-tmp-check.js');
        fs.writeFileSync(tmp, s, 'utf8');
        const r = this.nodeCheck(tmp);
        fs.rmSync(tmp, { force: true });
        if (!r.success) return r;
      }
      return { success: true, output: 'html inline scripts ok (' + scripts.length + ')' };
    }
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.jsx') return this.nodeCheck(f);
    if (ext === '.ps1' || ext === '.psm1') {
      const tmp = path.join(this.workspace, '.ec11-ps-check.ps1');
      const script = "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('" + f.replace(/'/g, "''") + "',[ref]$null,[ref]$e); if ($e) { $e | ForEach-Object { $_.Message }; exit 1 } else { Write-Output 'syntax ok' }";
      fs.writeFileSync(tmp, script, 'utf8');
      const r = await this.runShell(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, 30000);
      fs.rmSync(tmp, { force: true });
      return r;
    }
    if (ext === '.py') {
      const r = this.runShell(`python -m py_compile "${f.replace(/"/g, '`"')}"`, 30000);
      return r;
    }
    return { success: true, output: 'no syntax check for ' + ext };
  }

  private nodeCheck(f: string): ToolResult {
    try {
      execSyncSafe(f);
      return { success: true, output: 'syntax ok: ' + path.basename(f) };
    } catch (e: any) {
      return { success: false, output: '', error: 'SyntaxError: ' + String(e.message || e).split('\n').slice(0, 5).join('\n') };
    }
  }
}

function execSyncSafe(f: string): void {
  const { execSync } = require('child_process');
  execSync(`node --check "${f.replace(/"/g, '\\"')}"`, { timeout: 20000 });
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull the text payload out of an MCP tools/call response (JSON or SSE framing).
function parseMcpResult(raw: string): string | null {
  const candidates: any[] = [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { candidates.push(JSON.parse(trimmed)); } catch { /* ignore */ }
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try { candidates.push(JSON.parse(payload)); } catch { /* ignore */ }
  }
  for (const c of candidates) {
    const result = c?.result ?? c?.structuredContent;
    if (!result) continue;
    if (Array.isArray(result.content)) {
      const text = result.content.filter((x: any) => x?.type === 'text' && typeof x.text === 'string').map((x: any) => x.text).join('\n');
      if (text.trim()) return text;
    }
    if (typeof result === 'string') return result;
  }
  return null;
}
```

===== FILE: src/lib/stages.ts =====

```ts
// EC11 autoprompt stages: review, completeness, senior_review (1 round each, max 1 fix pass).
// Verdicts fail-closed: explicit VERDICT line wins; any failing keyword beats a stray PASS;
// no keywords => NEEDS_WORK (not PASS).
import { Provider, type ChatMsg } from './provider';
import { Tools, toolsFor, type ContextToolConfig } from './tools';
import { verifyDeliverable } from './verify';
import { contextToolPrompts } from './contexttools';
import { loadStagePrompt, buildAgentsBlock, buildSkillsIndex } from './prompts';

export interface StageResult { stage: string; passed: boolean; summary: string }

const FAIL_KEYWORDS = /NEEDS_WORK|BLOCKER|CRITICAL|FAIL|INCOMPLETE|broken|crash|syntax error/i;

export function parseVerdict(output: string): { passed: boolean; summary: string } {
  const explicit = output.match(/VERDICT:\s*(PASS|FAIL|FIXED)/i);
  if (explicit) {
    const v = explicit[1].toUpperCase();
    return { passed: v === 'PASS' || v === 'FIXED', summary: (output.match(/SUMMARY:\s*(.+)/i)?.[1] || output).trim().substring(0, 300) };
  }
  // fail-closed: any failing keyword beats a stray PASS
  if (FAIL_KEYWORDS.test(output)) return { passed: false, summary: output.replace(/\s+/g, ' ').substring(0, 300) };
  if (/PASS|COMPLETE/i.test(output)) return { passed: true, summary: output.replace(/\s+/g, ' ').substring(0, 300) };
  return { passed: false, summary: 'No explicit verdict; treated as NEEDS_WORK. ' + output.replace(/\s+/g, ' ').substring(0, 300) };
}

export async function runStage(stage: string, provider: Provider, tools: Tools, workspace: string, task: string, fileList: string[], previousSummaries: string[], verifyEvidence: string, onEvent: (e: any) => void, maxIterations = 60, signal?: AbortSignal, contextTools?: ContextToolConfig): Promise<StageResult> {
  const activeTools = toolsFor(contextTools);
  const sysPrompt = `You are EC11, a senior coding agent. The original user task was:\n"""${task}"""\n\nFiles currently in the workspace:\n${fileList.join('\n') || '(empty)'}\n\nPrevious stage summaries:\n${previousSummaries.join('\n') || '(none)'}\n\nAUTOMATED VERIFICATION EVIDENCE (from real executed checks):\n${verifyEvidence || '(verification not run yet)'}`
    + buildAgentsBlock(workspace)
    + (contextTools?.skills ? buildSkillsIndex() : '')
    + contextToolPrompts(contextTools);

  const messages: ChatMsg[] = [
    { role: 'system', content: sysPrompt },
    { role: 'user', content: loadStagePrompt(stage, workspace) },
  ];

  const summaryParts: string[] = [];
  let loopCount = 0;
  const MAX_ITER = maxIterations && maxIterations > 0 ? maxIterations : Infinity;
  while (loopCount < MAX_ITER) {
    if (signal?.aborted) break;
    const result = await provider.complete(messages, { tools: activeTools as unknown as undefined[] });
    summaryParts.push(result.content);
    if (result.usage && (result.usage.promptTokens || result.usage.completionTokens)) onEvent({ type: 'usage', usage: result.usage });
    if (result.reasoning) onEvent({ type: 'reasoning', content: result.reasoning });
    if (result.toolCalls.length === 0) break;
    messages.push({ role: 'assistant', content: result.content || null, reasoning_content: result.reasoning || undefined, tool_calls: result.toolCalls.map((tc) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })) });
    for (const tc of result.toolCalls) {
      onEvent({ type: 'tool_call', toolCall: { name: tc.name, arguments: JSON.stringify(tc.arguments) } });
      const tr = await tools.execute(tc.name, tc.arguments);
      onEvent({ type: 'tool_result', toolCall: { name: tc.name, success: tr.success, result: tr.output } });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: tr.success ? tr.output : 'ERROR: ' + tr.error });
    }
    loopCount++;
  }
  const combined = summaryParts.join('\n');
  const verdict = parseVerdict(combined);
  return { stage, passed: verdict.passed, summary: verdict.summary };
}

export async function runPipeline(opts: {
  provider: Provider;
  tools: Tools;
  workspace: string;
  task: string;
  stages?: string[];
  maxIterations?: number;
  contextTools?: ContextToolConfig;
  signal?: AbortSignal;
  onEvent: (e: any) => void;
}): Promise<StageResult[]> {
  const stages = opts.stages || ['review', 'completeness', 'senior_review'];
  const results: StageResult[] = [];
  const summaries: string[] = [];
  const fileList = () => {
    try { return require('fs').readdirSync(opts.workspace).filter((f: string) => !f.startsWith('.')).slice(0, 200); } catch { return []; }
  };
  let verifyEvidence = '';
  for (const stage of stages) {
    if (opts.signal?.aborted) break;
    opts.onEvent({ type: 'auto_prompt_stage_start', stage });
    try {
      const v = await verifyDeliverable(opts.workspace);
      verifyEvidence = v.evidence;
      const r = await runStage(stage, opts.provider, opts.tools, opts.workspace, opts.task, fileList(), summaries, verifyEvidence, opts.onEvent, opts.maxIterations, opts.signal, opts.contextTools);
      results.push(r);
      summaries.push(`${stage}: ${r.passed ? 'PASS' : 'FAIL'} - ${r.summary}`);
      opts.onEvent({ type: 'auto_prompt_stage', stageResult: { stage, passed: r.passed, summary: r.summary } });
    } catch (e: any) {
      const r = { stage, passed: false, summary: 'Stage error: ' + String(e.message || e) };
      results.push(r);
      summaries.push(`${stage}: FAIL - ${r.summary}`);
      opts.onEvent({ type: 'auto_prompt_stage', stageResult: r });
    }
  }
  return results;
}
```

===== FILE: src/lib/verify.ts =====

```ts
// EC11 executed-verification gate: browser smoke test + CLI run check.
// This is the single highest-value addition from the benchmark: actually RUN the deliverable.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface VerifyResult { ok: boolean; evidence: string }

export async function verifyDeliverable(workspace: string): Promise<VerifyResult> {
  const files = fs.existsSync(workspace) ? fs.readdirSync(workspace) : [];
  const hasHtml = files.some((f) => f.endsWith('.html'));
  const hasJs = files.some((f) => /\.(js|mjs|cjs)$/.test(f));
  const hasPy = files.some((f) => f.endsWith('.py'));
  const hasPs = files.some((f) => f.endsWith('.ps1') || f.endsWith('.psm1'));

  const evidence: string[] = [];
  let allOk = true;

  // 1) Browser smoke test for any .html deliverable
  if (hasHtml) {
    for (const f of files.filter((x) => x.endsWith('.html'))) {
      const r = await browserSmoke(path.join(workspace, f));
      evidence.push(`[browser] ${f}: ${r.ok ? 'OK' : 'FAIL'} - ${r.evidence}`);
      if (!r.ok) allOk = false;
    }
  }

  // 2) node --check all JS
  if (hasJs) {
    for (const f of files.filter((x) => /\.(js|mjs|cjs)$/.test(x))) {
      const r = await run(`node --check "${path.join(workspace, f).replace(/"/g, '\\"')}"`, workspace, 20000);
      evidence.push(`[syntax] ${f}: ${r.code === 0 ? 'OK' : 'FAIL'}${r.code !== 0 ? ' ' + r.err.trim().split('\n')[0] : ''}`);
      if (r.code !== 0) allOk = false;
    }
  }

  // 3) Python compile check
  if (hasPy) {
    for (const f of files.filter((x) => x.endsWith('.py'))) {
      const r = await run(`python -m py_compile "${path.join(workspace, f).replace(/"/g, '`"')}"`, workspace, 30000);
      evidence.push(`[py] ${f}: ${r.code === 0 ? 'OK' : 'FAIL'}${r.code !== 0 ? ' ' + r.err.trim().split('\n')[0] : ''}`);
      if (r.code !== 0) allOk = false;
    }
  }

  // 4) PowerShell parse check (WPF apps are .ps1; a broken one must fail the gate)
  if (hasPs) {
    for (const f of files.filter((x) => x.endsWith('.ps1') || x.endsWith('.psm1'))) {
      const abs = path.join(workspace, f).replace(/'/g, "''");
      const tmp = path.join(workspace, '.ec11-verify-ps.ps1');
      fs.writeFileSync(tmp, "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('" + abs + "',[ref]$null,[ref]$e); if ($e) { $e | ForEach-Object { $_.Message }; exit 1 } else { Write-Output 'syntax ok' }", 'utf8');
      const r = await run(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, workspace, 30000);
      fs.rmSync(tmp, { force: true });
      evidence.push(`[ps] ${f}: ${r.code === 0 ? 'OK' : 'FAIL'}${r.code !== 0 ? ' ' + (r.out + r.err).trim().split('\n')[0] : ''}`);
      if (r.code !== 0) allOk = false;
    }
  }

  // 5) If there's a server.js / server.py, try booting it briefly and hitting /health or /
  const server = files.find((f) => /^server\.(js|mjs|py)$/.test(f));
  if (server) {
    const port = 19400 + Math.floor(Math.random() * 500);
    const r = await bootAndProbe(path.join(workspace, server), workspace, port);
    evidence.push(`[boot] ${server}: ${r.ok ? 'OK' : 'FAIL'} - ${r.evidence}`);
    if (!r.ok) allOk = false;
  }

  return { ok: allOk, evidence: evidence.join('\n') };
}

function run(cmd: string, cwd: string, timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    try {
      const { exec } = require('child_process');
      exec(cmd, { cwd, timeout: timeoutMs, windowsHide: true }, (e: any, stdout: string, stderr: string) => {
        resolve({ code: e ? e.code ?? 1 : 0, out: String(stdout || ''), err: String(stderr || '') + (e ? '\n' + String(e.message) : '') });
      });
    } catch (e: any) { resolve({ code: 1, out: '', err: String(e.message) }); }
  });
}

async function browserSmoke(file: string): Promise<{ ok: boolean; evidence: string }> {
  let pw: any = null;
  try {
    const { createRequire } = require('node:module');
    const req = createRequire(require('node:path').join(process.cwd(), 'noop.js'));
    pw = req('playwright-core');
  } catch {
    return { ok: true, evidence: 'playwright-core not available; browser check skipped' };
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, evidence: 'browser check timed out (10s)' }), 20000);
    try {
      (async () => {
        const browser = await pw.chromium.launch({ headless: true });
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e: any) => errors.push(String(e).substring(0, 150)));
        page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text().substring(0, 150)); });
        await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 15000 }).catch((e: any) => errors.push(String(e.message).substring(0, 150)));
        await new Promise((r) => setTimeout(r, 800));
        await browser.close();
        clearTimeout(timer);
        resolve({ ok: errors.length === 0, evidence: errors.length ? errors.join(' | ') : 'loads clean, 0 page errors' });
      })().catch((e: any) => { clearTimeout(timer); resolve({ ok: false, evidence: 'browser error: ' + String(e.message).substring(0, 120) }); });
    } catch (e: any) { clearTimeout(timer); resolve({ ok: true, evidence: 'browser check unavailable' }); }
  });
}

async function bootAndProbe(serverFile: string, cwd: string, port: number): Promise<{ ok: boolean; evidence: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env, PORT: String(port) };
    const isPy = serverFile.endsWith('.py');
    const child = spawn(isPy ? 'python' : 'node', [serverFile], { cwd, env, windowsHide: true });
    let out = '';
    child.stdout?.on('data', (d) => { out += String(d); });
    child.stderr?.on('data', (d) => { out += String(d); });
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, evidence: 'server did not respond in 15s: ' + out.trim().split('\n').slice(-2).join(' ') }); }, 20000);
    const probe = async () => {
      for (let i = 0; i < 12; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`);
          clearTimeout(timer); child.kill();
          return resolve({ ok: res.ok, evidence: `HTTP ${res.status} /health ok` });
        } catch {
          try {
            const res2 = await fetch(`http://127.0.0.1:${port}/`);
            clearTimeout(timer); child.kill();
            return resolve({ ok: res2.ok, evidence: `HTTP ${res2.status} / ok (${(await res2.text()).length} bytes)` });
          } catch { /* not up yet */ }
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      clearTimeout(timer); child.kill();
      resolve({ ok: false, evidence: 'no response on :' + port + ' - ' + out.trim().split('\n').slice(-2).join(' ') });
    };
    child.on('exit', (code) => { clearTimeout(timer); if (code !== null && code !== 0) resolve({ ok: false, evidence: 'server exited code ' + code + ': ' + out.trim().split('\n').slice(-2).join(' ') }); });
    setTimeout(probe, 2500);
  });
}
```

===== FILE: src/lib/prompts.ts =====

```ts
// Prompt/instruction loading: editable system + stage prompts (md files), AGENTS.md, and global skills.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const STAGE_IDS = ['review', 'completeness', 'senior_review', 'run_fix'] as const;
export type StageId = typeof STAGE_IDS[number];

export const PROMPT_FILES = ['system', ...STAGE_IDS] as const;

export const DEFAULT_SYSTEM_PROMPT = `You are EC11, a senior coding agent running inside a local-first harness.
You write COMPLETE, WORKING applications. You do not leave placeholders or stubs.
Tools: read_file, write_file, edit_file, list_files, shell_command (PowerShell, one command at a time), todo, syntax_check, attempt_completion.
Rules:
- All file paths are relative to the project working directory.
- Before declaring done, use attempt_completion. The harness will then RUN your deliverable.
- If the deliverable is a web app, build it as a single self-contained .html or with server.js that serves a public/ folder.
- Install dependencies you declare (npm install) so the app can actually start.
- Do not invent product limitations. Preserve the user's intended behavior.`;

export const DEFAULT_STAGE_PROMPTS: Record<string, string> = {
  review: `You are running the REVIEW autoprompt stage. Act like the user just asked: "double-check your work for bugs and fix anything real."
Work directly in the workspace with the available tools (read_file, edit_file, write_file, shell_command, syntax_check). Find and fix real bugs: syntax errors, wrong imports, null access, broken logic.
Do not just list problems - fix them, then verify with syntax_check.
After finishing, reply with EXACTLY these two lines and nothing else:
VERDICT: PASS or FAIL
SUMMARY: one concise sentence.`,
  completeness: `You are running the COMPLETENESS autoprompt stage. Verify the ORIGINAL user request and its required deliverable list against what actually exists in the workspace.
Use read_file and list_files to diff required files/behaviors from the original task against the real tree. If a required deliverable is missing or a stated behavior does not work, FIX it.
After finishing, reply with EXACTLY these two lines and nothing else:
VERDICT: PASS or FAIL
SUMMARY: one concise sentence.`,
  senior_review: `You are running the SENIOR REVIEW autoprompt stage. Perform a senior-level architecture and integration review of the workspace deliverable.
Check boundaries, error handling, security (XSS, path traversal, injection), and whether it will survive real use. Fix issues that are actionable now; make the smallest safe fix.
After finishing, reply with EXACTLY these two lines and nothing else:
VERDICT: PASS or FAIL
SUMMARY: one concise sentence.`,
  run_fix: `You are running the RUN-FIX autoprompt stage. Actually RUN the deliverable, read the real output/errors, and fix what fails until it runs clean.
Start it exactly as a user would (for a web app: start the static server / node server.js; for a script: execute it). Capture errors from stdout/stderr, fix the root cause with edit_file, and re-run to confirm. Do not stop at the first error.
After finishing, reply with EXACTLY these two lines and nothing else:
VERDICT: PASS or FAIL
SUMMARY: one concise sentence.`,
};

export function appRoot(): string {
  return process.cwd();
}

export function appAutopromptDir(): string {
  return path.join(appRoot(), 'autoprompts');
}

export function workspaceAutopromptDir(workspace?: string): string | null {
  return workspace ? path.join(workspace, '.ec11', 'autoprompts') : null;
}

function readSafe(file: string): string | null {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

export function promptSource(name: string, workspace?: string): 'workspace' | 'app' | 'builtin' {
  const wsDir = workspaceAutopromptDir(workspace);
  if (wsDir && fs.existsSync(path.join(wsDir, name + '.md'))) return 'workspace';
  if (fs.existsSync(path.join(appAutopromptDir(), name + '.md'))) return 'app';
  return 'builtin';
}

export function readPrompt(name: string, workspace?: string): string {
  const wsDir = workspaceAutopromptDir(workspace);
  if (wsDir) {
    const c = readSafe(path.join(wsDir, name + '.md'));
    if (c !== null) return c;
  }
  const c = readSafe(path.join(appAutopromptDir(), name + '.md'));
  if (c !== null) return c;
  if (name === 'system') return DEFAULT_SYSTEM_PROMPT;
  return DEFAULT_STAGE_PROMPTS[name] || '';
}

export function loadSystemPrompt(workspace?: string): string {
  return readPrompt('system', workspace).trim();
}

export function loadStagePrompt(stage: string, workspace?: string): string {
  return readPrompt(stage, workspace).trim() || DEFAULT_STAGE_PROMPTS[stage] || 'Review the workspace deliverable against the task and fix real issues.';
}

// AGENTS.md: the target project's conventions plus EC11's own.
export function loadAgentsDocs(workspace?: string): { project: string; app: string } {
  const project = workspace ? (readSafe(path.join(workspace, 'AGENTS.md')) || '') : '';
  const app = readSafe(path.join(appRoot(), 'AGENTS.md')) || '';
  return { project: project.trim(), app: app.trim() };
}

export function buildAgentsBlock(workspace?: string): string {
  const { project, app } = loadAgentsDocs(workspace);
  let out = '';
  if (project) out += `\n\n=== PROJECT AGENTS.md (${workspace}\\AGENTS.md — highest priority) ===\n${project}`;
  if (app && app !== project) out += `\n\n=== EC11 AGENTS.md (app conventions) ===\n${app}`;
  return out;
}

// ---- global skills ----
export interface SkillInfo { name: string; description: string; dir: string; root: string; skillFile: string }

export function skillsRoots(): string[] {
  const home = os.homedir();
  const roots = [path.join(home, '.agents', 'skills'), path.join(home, '.claude', 'skills')];
  return roots.filter((r) => { try { return fs.statSync(r).isDirectory(); } catch { return false; } });
}

export function listSkills(): SkillInfo[] {
  const out: SkillInfo[] = [];
  for (const root of skillsRoots()) {
    let dirs: fs.Dirent[];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(root, d.name);
      const skillFile = path.join(dir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = readSafe(skillFile) || '';
      const fmName = content.match(/^---[\s\S]*?\bname:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
      const fmDesc = content.match(/^---[\s\S]*?\bdescription:\s*([\s\S]*?)(?:\n[a-zA-Z_]+:|\n---)/m)?.[1]?.trim().replace(/\s+/g, ' ').replace(/^["']|["']$/g, '');
      const desc = fmDesc || content.split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---'))?.trim() || '';
      out.push({ name: fmName || d.name, description: desc.slice(0, 400), dir, root, skillFile });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function findSkill(name: string): SkillInfo | null {
  const n = name.trim().toLowerCase();
  return listSkills().find((s) => s.name.toLowerCase() === n || path.basename(s.dir).toLowerCase() === n) || null;
}

export function readSkill(name: string, file = 'SKILL.md'): { ok: boolean; skill?: string; file?: string; content?: string; error?: string } {
  const s = findSkill(name);
  if (!s) return { ok: false, error: `No skill named "${name}". Use list_skills to see available skills.` };
  const target = path.resolve(s.dir, file || 'SKILL.md');
  const rel = path.relative(s.dir, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, error: 'Path escapes the skill directory.' };
  const content = readSafe(target);
  if (content === null) return { ok: false, error: `File not found in skill "${name}": ${file}` };
  return { ok: true, skill: s.name, file: path.relative(s.dir, target).replace(/\\/g, '/'), content };
}

export function buildSkillsIndex(): string {
  const skills = listSkills();
  if (!skills.length) return '';
  const lines = skills.map((s) => `- ${s.name}: ${s.description || '(no description)'}`);
  return `\n\n=== GLOBAL SKILLS (available on this system) ===\nCall read_skill with a skill name to load its full SKILL.md and follow it. Skills may reference extra files; read_skill can read any file inside the skill folder.\n${lines.join('\n')}`;
}
```

===== FILE: src/lib/contexttools.ts =====

```ts
// Context tools: prompt addenda for RTK, Ponytail, Context7, CodeGraph, Web Search.
// Ponytail ruleset from github.com/DietrichGebert/ponytail (lazy senior dev mode).
import type { ContextToolConfig } from './tools';

export const PONYTAIL_PROMPT = `PONYTAIL MODE (lazy senior dev). Lazy means efficient, not careless. The best code is the code never written.
Before writing any code, stop at the first rung that holds:
1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper/util/pattern already here.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.
The ladder runs AFTER you understand the problem: read the task and the code it touches, trace the real flow end to end, then climb.
Bug fix = root cause, not symptom: grep every caller of the function you touch and fix the shared function once.
Rules: no unrequested abstractions; no new dependency if avoidable; no boilerplate nobody asked for; deletion over addition; boring over clever; fewest files; shortest working diff wins.
Mark deliberate simplifications with a "ponytail:" comment naming the ceiling and upgrade path.
Not lazy about: understanding the problem, input validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything explicitly requested. Non-trivial logic leaves ONE runnable check behind.`;

export function contextToolPrompts(ctx?: Partial<ContextToolConfig>): string {
  if (!ctx) return '';
  const parts: string[] = [];
  if (ctx.ponytail) parts.push(PONYTAIL_PROMPT);
  if (ctx.rtk) parts.push('RTK is ON: shell_command output is compressed through the rtk CLI before you see it. If output looks summarized, use the recall hint or re-run a narrower command.');
  if (ctx.context7) parts.push('CONTEXT7 is ON: before using an external library or API, call context7_docs with the library name and your question to get current, version-specific docs. Do not guess APIs from memory.');
  if (ctx.codegraph) parts.push('CODEGRAPH is ON: call code_graph (actions: stats, symbol, file, refs) to locate symbols, imports and call sites instead of grepping blindly.');
  if (ctx.search) parts.push('WEB SEARCH is ON: call web_search for current information (versions, error messages, recent changes) that may be newer than your training data.');
  if (!parts.length) return '';
  return '\n\n=== ENABLED CONTEXT TOOLS ===\n' + parts.join('\n\n');
}
```

===== FILE: src/lib/localserver.ts =====

```ts
// Detect which model a local provider is actually serving, and build a rich model catalog.
export function isLocalUrl(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal/i.test(baseUrl);
}

export interface ModelMeta { ctx?: number; maxOut?: number; inPrice?: number; outPrice?: number; desc?: string }
export interface CatalogResult { models: string[]; loaded: string[]; catalog: Record<string, ModelMeta>; source: string }

async function getJson(url: string, apiKey: string, timeoutMs = 12000): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function num(v: any): number | undefined { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined; }

const cache = new Map<string, { ts: number; data: CatalogResult }>();
const TTL = 5 * 60 * 1000;

export async function getModelCatalog(baseUrl: string, apiKey: string): Promise<CatalogResult> {
  const key = baseUrl.replace(/\/$/, '') + '|' + (apiKey ? 'k' : '');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  let origin = '';
  try { origin = new URL(baseUrl).origin; } catch { /* ignore */ }
  const root = baseUrl.replace(/\/$/, '');
  const models: string[] = [];
  const catalog: Record<string, ModelMeta> = {};
  const loaded: string[] = [];
  let source = 'openai-compatible';

  // 1) OpenAI-compatible /models — OpenRouter (context_length, top_provider, pricing), vLLM (max_model_len), etc.
  const list = await getJson(`${root}/models`, apiKey);
  const arr = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : [];
  for (const e of arr) {
    const id = typeof e === 'string' ? e : e?.id;
    if (!id) continue;
    models.push(id);
    if (typeof e === 'object' && e) {
      const ctx = num(e.context_length) || num(e.max_model_len) || num(e.max_context_length) || num(e.max_position_embeddings);
      const maxOut = num(e.top_provider?.max_completion_tokens) || num(e.max_completion_tokens) || num(e.max_output_tokens);
      const inPrice = num(e.pricing?.prompt) !== undefined ? Number(e.pricing.prompt) * 1_000_000 : undefined;
      const outPrice = num(e.pricing?.completion) !== undefined ? Number(e.pricing.completion) * 1_000_000 : undefined;
      if (ctx || maxOut || inPrice || outPrice || e.name) catalog[id] = { ctx, maxOut, inPrice, outPrice, desc: e.name };
      if (/openrouter/i.test(baseUrl)) source = 'openrouter';
    }
  }

  // 2) LM Studio native /api/v0/models — context lengths + loaded state
  if (origin) {
    const native = await getJson(`${origin}/api/v0/models`, apiKey);
    if (Array.isArray(native?.data)) {
      source = 'lmstudio';
      for (const m of native.data) {
        if (!m?.id) continue;
        const id = String(m.id);
        if (!models.includes(id)) models.push(id);
        const ctx = num(m.loaded_context_length) || num(m.max_context_length) || num(m.context_length);
        const meta = catalog[id] || {};
        if (ctx && !meta.ctx) meta.ctx = ctx;
        catalog[id] = meta;
        if (m.state === 'loaded' || m.state === 'loading' || (typeof m.loaded_context_length === 'number' && m.loaded_context_length > 0)) loaded.push(id);
      }
    }
    // 3) Ollama running models
    const ps = await getJson(`${origin}/api/ps`, apiKey);
    if (Array.isArray(ps?.models)) for (const m of ps.models) { const id = m?.name || m?.model; if (id) { loaded.push(String(id)); if (!models.includes(String(id))) models.push(String(id)); } }
  }

  if (!loaded.length && models.length === 1) loaded.push(models[0]);

  const data: CatalogResult = { models, loaded: [...new Set(loaded)], catalog, source };
  cache.set(key, { ts: Date.now(), data });
  return data;
}

export function resolveModel(baseUrl: string, requested: string, loaded: string[]): { model: string; overridden: boolean } {
  if (!isLocalUrl(baseUrl) || !loaded.length) return { model: requested, overridden: false };
  if (requested && loaded.includes(requested)) return { model: requested, overridden: false };
  return { model: loaded[0], overridden: true };
}
```

===== FILE: src/lib/diff.ts =====

```ts
export interface DiffLine { type: 'add' | 'del' | 'ctx'; text: string; aNo: number | null; bNo: number | null }

export function lineDiff(a: string, b: string): DiffLine[] {
  const A = a.length ? a.replace(/\r\n/g, '\n').split('\n') : [];
  const B = b.length ? b.replace(/\r\n/g, '\n').split('\n') : [];
  if (A.length * B.length > 4_000_000) return prefixFallback(A, B);
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ type: 'ctx', text: A[i], aNo: i + 1, bNo: j + 1 }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: A[i], aNo: i + 1, bNo: null }); i++; }
    else { out.push({ type: 'add', text: B[j], aNo: null, bNo: j + 1 }); j++; }
  }
  while (i < A.length) { out.push({ type: 'del', text: A[i], aNo: i + 1, bNo: null }); i++; }
  while (j < B.length) { out.push({ type: 'add', text: B[j], aNo: null, bNo: j + 1 }); j++; }
  return out;
}

function prefixFallback(A: string[], B: string[]): DiffLine[] {
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let s = 0;
  while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
  const out: DiffLine[] = [];
  for (let i = 0; i < p; i++) out.push({ type: 'ctx', text: A[i], aNo: i + 1, bNo: i + 1 });
  for (let i = p; i < A.length - s; i++) out.push({ type: 'del', text: A[i], aNo: i + 1, bNo: null });
  for (let j = p; j < B.length - s; j++) out.push({ type: 'add', text: B[j], aNo: null, bNo: j + 1 });
  for (let i = A.length - s; i < A.length; i++) out.push({ type: 'ctx', text: A[i], aNo: i + 1, bNo: B.length - s + (i - (A.length - s)) + 1 });
  return out;
}

export function diffStat(lines: DiffLine[]): { add: number; del: number } {
  let add = 0, del = 0;
  for (const l of lines) { if (l.type === 'add') add++; else if (l.type === 'del') del++; }
  return { add, del };
}

export function languageOf(p: string): string {
  const ext = (p.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', ps1: 'powershell', psm1: 'powershell', html: 'html', htm: 'html', css: 'css', scss: 'scss',
    json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'toml', sql: 'sql', rs: 'rust', go: 'go',
    c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', java: 'java', rb: 'ruby', sh: 'shell', bat: 'batch', cmd: 'batch', xml: 'xml',
  };
  return map[ext] || 'plaintext';
}
```

===== FILE: src/lib/settings.ts =====

```ts
'use client';

export interface ProviderSettings {
  preset: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  contextWindow: number;
  connectTimeoutMs: number;
  completionTimeoutMs: number;
  streamIdleTimeoutMs: number;
  retries: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  currency: string;
}

export interface AgentSettings {
  maxIterations: number;
  stageMaxIterations: number;
  autoAcceptChanges: boolean;
}

export interface AutoPromptSettings {
  enabled: boolean;
  stages: string[];
}

export interface ContextToolSettings {
  rtk: boolean;
  ponytail: boolean;
  context7: boolean;
  codegraph: boolean;
  search: boolean;
  skills: boolean;
  context7ApiKey: string;
}

export interface AppSettings {
  provider: ProviderSettings;
  agent: AgentSettings;
  autoPrompt: AutoPromptSettings;
  contextTools: ContextToolSettings;
  workingDirectory: string;
  theme: string;
  recentModels: string[];
  hiddenModels: string[];
  hideVariants: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelMeta { ctx?: number; maxOut?: number; inPrice?: number; outPrice?: number; desc?: string }

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  keyHint: string;
  local: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', keyHint: 'not needed locally', local: true },
  { id: 'freetoken', label: 'FreeToken Desktop', baseUrl: 'http://127.0.0.1:1919/v1', keyHint: 'not needed locally', local: true },
  { id: 'unsloth', label: 'Unsloth Desktop', baseUrl: 'http://127.0.0.1:8000/v1', keyHint: 'not needed locally', local: true },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-... from openrouter.ai/keys', local: false },
  { id: 'magica', label: 'MagicAI (magica.ai)', baseUrl: 'https://api.magica.ai/v1', keyHint: 'API key from magica.ai', local: false },
  { id: 'custom', label: 'Custom / other (any OpenAI-compatible URL)', baseUrl: '', keyHint: 'paste the base URL, e.g. .../v1', local: false },
];

export const STAGE_DEFS: Array<{ id: string; label: string; blurb: string }> = [
  { id: 'review', label: 'Review', blurb: 'Double-check the work for real bugs and fix them.' },
  { id: 'completeness', label: 'Completeness', blurb: 'Diff the original request against what actually exists; fill gaps.' },
  { id: 'senior_review', label: 'Senior Review', blurb: 'Architecture, boundaries, security, real-use survival.' },
  { id: 'run_fix', label: 'Run / Fix', blurb: 'Actually run the deliverable, read errors, fix until it runs clean.' },
];

export const CONTEXT_TOOL_DEFS: Array<{ id: keyof ContextToolSettings; label: string; blurb: string }> = [
  { id: 'rtk', label: 'RTK (Rust Token Killer)', blurb: 'Route shell commands through the rtk CLI so output is compressed before it hits the context. Needs rtk installed; falls back to plain if missing.' },
  { id: 'ponytail', label: 'Ponytail', blurb: 'Inject the lazy-senior-dev ladder: reuse, stdlib, native, one line — write the least code that works.' },
  { id: 'context7', label: 'Context7', blurb: 'Upstash docs MCP: fetch up-to-date, version-specific library docs before coding. Optional API key raises rate limits.' },
  { id: 'codegraph', label: 'CodeGraph', blurb: 'Index the workspace into a symbol/import/call graph so the agent can query structure instead of grepping blindly.' },
  { id: 'search', label: 'Web Search', blurb: 'Give the agent a web_search tool for current information beyond its training data.' },
  { id: 'skills', label: 'Global Skills', blurb: 'Expose the skills in ~/.agents/skills and ~/.claude/skills: the agent sees an index and can load any skill with read_skill.' },
];

export const THEMES: Array<{ id: string; label: string }> = [
  { id: 'neon', label: 'Neon Blue' },
  { id: 'amber', label: 'Amber' },
  { id: 'red', label: 'Red Alert' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'ice', label: 'Ice' },
  { id: 'mono', label: 'Mono' },
];

export const DEFAULT_SETTINGS: AppSettings = {
  provider: {
    preset: 'lmstudio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKey: '',
    model: 'qwen/qwen3.5-9b',
    maxTokens: 65536,
    temperature: 0.7,
    contextWindow: 65536,
    connectTimeoutMs: 60000,
    completionTimeoutMs: 600000,
    streamIdleTimeoutMs: 300000,
    retries: 3,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    currency: '$',
  },
  agent: {
    maxIterations: 0,
    stageMaxIterations: 0,
    autoAcceptChanges: true,
  },
  autoPrompt: {
    enabled: true,
    stages: ['review', 'completeness', 'senior_review'],
  },
  contextTools: {
    rtk: false,
    ponytail: true,
    context7: false,
    codegraph: false,
    search: false,
    skills: true,
    context7ApiKey: '',
  },
  workingDirectory: '',
  theme: 'neon',
  recentModels: [],
  hiddenModels: [],
  hideVariants: false,
};

const KEY = 'ec11.settings.v1';

function merge(base: AppSettings, saved: any): AppSettings {
  if (!saved || typeof saved !== 'object') return base;
  const provider = { ...base.provider, ...(saved.provider || {}) };
  const agent = { ...base.agent, ...(saved.agent || {}) };
  // Migrate old untouched defaults to the new ones (max output = context window, no iteration caps).
  if (saved.provider && saved.provider.maxTokens === 30000 && saved.provider.contextWindow === 65536) provider.maxTokens = base.provider.maxTokens;
  if (saved.agent && saved.agent.maxIterations === 200) agent.maxIterations = base.agent.maxIterations;
  if (saved.agent && saved.agent.stageMaxIterations === 60) agent.stageMaxIterations = base.agent.stageMaxIterations;
  return {
    provider,
    agent,
    autoPrompt: {
      enabled: saved.autoPrompt?.enabled ?? base.autoPrompt.enabled,
      stages: Array.isArray(saved.autoPrompt?.stages) ? saved.autoPrompt.stages : base.autoPrompt.stages,
    },
    contextTools: { ...base.contextTools, ...(saved.contextTools || {}) },
    workingDirectory: typeof saved.workingDirectory === 'string' ? saved.workingDirectory : base.workingDirectory,
    theme: typeof saved.theme === 'string' ? saved.theme : base.theme,
    recentModels: Array.isArray(saved.recentModels) ? saved.recentModels : base.recentModels,
    hiddenModels: Array.isArray(saved.hiddenModels) ? saved.hiddenModels : base.hiddenModels,
    hideVariants: typeof saved.hideVariants === 'boolean' ? saved.hideVariants : base.hideVariants,
  };
}

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return merge(DEFAULT_SETTINGS, raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  events: LogEvent[];
  usage: TokenUsage;
}

export type StageStatus = 'idle' | 'running' | 'pass' | 'fail' | 'skipped';

export interface StageState {
  stage: string;
  status: StageStatus;
  summary?: string;
}

export interface LogEvent {
  id: string;
  kind: 'user' | 'assistant' | 'reasoning' | 'tool_call' | 'tool_result' | 'system' | 'error' | 'done' | 'usage';
  content: string;
  name?: string;
  success?: boolean;
  ts: number;
  usage?: TokenUsage;
}

const SKEY = 'ec11.sessions.v1';

export function loadSessions(): Session[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(SKEY) || window.localStorage.getItem(SKEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((s: any) => ({ ...s, usage: s.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }));
  } catch { return []; }
}

export function saveSessions(sessions: Session[]): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(SKEY, JSON.stringify(sessions.slice(0, 50))); } catch { /* ignore */ }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function emptyUsage(): TokenUsage { return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }; }

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + (b.promptTokens || 0),
    completionTokens: a.completionTokens + (b.completionTokens || 0),
    totalTokens: a.totalTokens + (b.totalTokens || 0),
  };
}

export function costOf(u: TokenUsage, p: ProviderSettings): number {
  return (u.promptTokens / 1_000_000) * (p.inputCostPer1M || 0) + (u.completionTokens / 1_000_000) * (p.outputCostPer1M || 0);
}

export interface FileNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: FileNode[];
}

export interface Change {
  path: string;
  before: string | null;
  after: string;
  tool: 'write_file' | 'edit_file' | 'delete';
  status: 'pending' | 'accepted' | 'rejected';
  ts: number;
}

export interface TodoItem { text: string; done: boolean }

export interface TerminalLine { kind: 'cmd' | 'out' | 'err' | 'meta'; text: string }
```

===== FILE: src/components/CoderApp.tsx =====

```ts
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppSettings, DEFAULT_SETTINGS, loadSettings, saveSettings, loadSessions, saveSessions,
  Session, LogEvent, StageState, Change, TodoItem, newId, emptyUsage, addUsage, costOf, ModelMeta,
} from '@/lib/settings';
import SettingsPanel from './SettingsPanel';
import FileExplorer from './FileExplorer';
import ChangesPanel from './ChangesPanel';
import EditorPane, { MainView } from './EditorPane';
import AgentPanel from './AgentPanel';
import TerminalPanel from './TerminalPanel';
import CommandPalette, { Command } from './CommandPalette';
import PromptsDrawer from './PromptsDrawer';
import WorkspacePicker from './WorkspacePicker';

export const APP_VERSION = '1.13';

function freshSession(): Session {
  return { id: newId(), title: 'New session', createdAt: Date.now(), events: [], usage: emptyUsage() };
}
function emptyStages(list: string[]): Record<string, StageState> {
  const o: Record<string, StageState> = {};
  for (const s of list) o[s] = { stage: s, status: 'idle' };
  return o;
}
function safeParse(s: any): any { try { return typeof s === 'string' ? JSON.parse(s) : (s || {}); } catch { return {}; } }
function toolPath(args: any): string { return String(args?.file_path || args?.path || ''); }
function baseName(p: string) { return p.split(/[\\/]/).pop() || p; }

export default function CoderApp() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadedModels, setLoadedModels] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Record<string, ModelMeta>>({});
  const [modelsBusy, setModelsBusy] = useState(false);
  const [online, setOnline] = useState<'unknown' | 'on' | 'off'>('unknown');
  const [stageStates, setStageStates] = useState<Record<string, StageState>>({});

  const [leftMode, setLeftMode] = useState<'explorer' | 'changes' | 'sessions'>('explorer');
  const [leftOpen, setLeftOpen] = useState(true);
  const [agentOpen, setAgentOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [view, setView] = useState<MainView>({ kind: 'empty' });
  const [contents, setContents] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [changes, setChanges] = useState<Change[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [input, setInput] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const hydrated = useRef(false);
  const snapshotsRef = useRef<Map<string, string | null>>(new Map());
  const pendingToolRef = useRef<{ name: string; path: string; args: any } | null>(null);
  const contentsRef = useRef<Record<string, string>>({});
  const dirtyRef = useRef<Record<string, boolean>>({});
  const autoAcceptRef = useRef(true);
  const probeKeyRef = useRef('');
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { contentsRef.current = contents; }, [contents]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { autoAcceptRef.current = settings.agent.autoAcceptChanges; }, [settings.agent.autoAcceptChanges]);

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    const saved = loadSessions();
    const list = saved.length ? saved : [freshSession()];
    setSessions(list);
    setActiveId(list[0].id);
    setStageStates(emptyStages(s.autoPrompt.stages));
    hydrated.current = true;
    probe(s.provider.baseUrl, s.provider.apiKey, s.provider.model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (hydrated.current) saveSettings(settings); }, [settings]);
  useEffect(() => { if (hydrated.current) saveSessions(sessions); }, [sessions]);
  useEffect(() => { if (hydrated.current) document.documentElement.setAttribute('data-theme', settings.theme); }, [settings.theme]);

  const active = useMemo(() => sessions.find((s) => s.id === activeId), [sessions, activeId]);
  const events = active?.events || [];

  const probe = useCallback(async (baseUrl: string, apiKey: string, currentModel: string) => {
    probeKeyRef.current = baseUrl + '|' + apiKey;
    try {
      const res = await fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl, apiKey }) });
      const data = await res.json();
      const list: string[] = Array.isArray(data.models) ? data.models : [];
      const loaded: string[] = Array.isArray(data.loaded) ? data.loaded : [];
      const cat: Record<string, ModelMeta> = data.catalog && typeof data.catalog === 'object' ? data.catalog : {};
      setModels(list);
      setLoadedModels(loaded);
      setCatalog(cat);
      setOnline(data.ok ? 'on' : 'off');

      const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(baseUrl);
      let effective = currentModel;
      if (isLocal && loaded.length && !loaded.includes(currentModel)) effective = loaded[0];

      let info: any = {};
      const meta = effective ? cat[effective] : undefined;
      if (meta && meta.ctx) info = { ok: true, contextWindow: meta.ctx, maxTokens: meta.maxOut || meta.ctx };
      else if (effective) {
        try {
          const ir = await fetch('/api/model-info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl, apiKey, model: effective }) });
          info = await ir.json();
        } catch { info = {}; }
      }
      setSettings((s) => {
        const nextModel = effective || s.provider.model;
        const nextCtx = info.ok ? info.contextWindow : s.provider.contextWindow;
        const nextMax = info.ok ? info.maxTokens : s.provider.maxTokens;
        const nextIn = meta && meta.inPrice !== undefined ? meta.inPrice : s.provider.inputCostPer1M;
        const nextOut = meta && meta.outPrice !== undefined ? meta.outPrice : s.provider.outputCostPer1M;
        if (nextModel === s.provider.model && nextCtx === s.provider.contextWindow && nextMax === s.provider.maxTokens && nextIn === s.provider.inputCostPer1M && nextOut === s.provider.outputCostPer1M) return s;
        return { ...s, provider: { ...s.provider, model: nextModel, contextWindow: nextCtx, maxTokens: nextMax, inputCostPer1M: nextIn, outputCostPer1M: nextOut } };
      });
    } catch { setOnline('off'); }
  }, []);

  // Re-probe only when the server URL or key actually changes (not on the startup run).
  useEffect(() => {
    if (!hydrated.current) return;
    const key = settings.provider.baseUrl + '|' + settings.provider.apiKey;
    if (key === probeKeyRef.current) return;
    probe(settings.provider.baseUrl, settings.provider.apiKey, settings.provider.model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.provider.baseUrl, settings.provider.apiKey]);

  const refreshModels = async () => { setModelsBusy(true); await probe(settings.provider.baseUrl, settings.provider.apiKey, settings.provider.model); setModelsBusy(false); };

  // Keep the served/loaded model in view: re-check every 30s and when the window regains focus.
  useEffect(() => {
    const tick = () => { const s = settingsRef.current; probe(s.provider.baseUrl, s.provider.apiKey, s.provider.model); };
    const t = setInterval(tick, 30000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [probe]);

  const updateEvents = useCallback((sessionId: string, fn: (evs: LogEvent[]) => LogEvent[]) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, events: fn(s.events) } : s)));
  }, []);
  const pushEvent = useCallback((sessionId: string, ev: Omit<LogEvent, 'id' | 'ts'>) =>
    updateEvents(sessionId, (evs) => [...evs, { ...ev, id: newId(), ts: Date.now() }]), [updateEvents]);
  const appendToLast = useCallback((sessionId: string, kind: 'assistant' | 'reasoning', chunk: string) =>
    updateEvents(sessionId, (evs) => {
      const copy = evs.slice();
      const last = copy[copy.length - 1];
      if (last && last.kind === kind) copy[copy.length - 1] = { ...last, content: last.content + chunk };
      else copy.push({ id: newId(), kind, content: chunk, ts: Date.now() });
      return copy;
    }), [updateEvents]);

  const addSessionUsage = useCallback((sessionId: string, u: any) => {
    if (!u) return;
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, usage: addUsage(s.usage || emptyUsage(), u) } : s)));
  }, []);

  // ---- file / change helpers ----
  const resolvePath = useCallback((p: string) => {
    if (!p) return p;
    if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')) return p;
    const wd = (settings.workingDirectory || '').replace(/[\\/]+$/, '');
    return wd ? wd + '\\' + p.replace(/^[\\/]+/, '') : p;
  }, [settings.workingDirectory]);

  const fetchFile = async (path: string) => {
    try {
      const r = await fetch('/api/files?path=' + encodeURIComponent(path));
      const d = await r.json();
      return d.ok ? (d.content as string) : null;
    } catch { return null; }
  };

  const recordChange = useCallback(async (path: string, tool: Change['tool']) => {
    const after = await fetchFile(path);
    if (after === null) return;
    const known = snapshotsRef.current.has(path);
    const before = known ? snapshotsRef.current.get(path)! : null;
    const status: Change['status'] = autoAcceptRef.current ? 'accepted' : 'pending';
    setChanges((prev) => [...prev.filter((c) => !(c.path === path && c.status === 'pending')), { path, before, after, tool, status, ts: Date.now() }]);
    setRefreshKey((k) => k + 1);
    if (contentsRef.current[path] !== undefined && !dirtyRef.current[path]) {
      setContents((c) => ({ ...c, [path]: after }));
    }
  }, []);

  const openFile = useCallback(async (path: string) => {
    const existing = contentsRef.current[path];
    if (existing === undefined) {
      const c = await fetchFile(path);
      if (c === null) return;
      setContents((prev) => ({ ...prev, [path]: c }));
      if (!snapshotsRef.current.has(path)) snapshotsRef.current.set(path, c);
    }
    setOpenPaths((p) => (p.includes(path) ? p : [...p, path]));
    setView({ kind: 'file', path });
  }, []);

  const closeTab = (path: string) => {
    setOpenPaths((prev) => {
      const next = prev.filter((p) => p !== path);
      if (view.kind === 'file' && view.path === path) setView(next.length ? { kind: 'file', path: next[next.length - 1] } : { kind: 'empty' });
      return next;
    });
  };

  const saveFile = async (path: string) => {
    const content = contentsRef.current[path] ?? '';
    try {
      await fetch('/api/files', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) });
      setDirty((d) => ({ ...d, [path]: false }));
      setRefreshKey((k) => k + 1);
    } catch { /* ignore */ }
  };

  const revertFile = async (path: string) => {
    const c = await fetchFile(path);
    if (c !== null) { setContents((prev) => ({ ...prev, [path]: c })); setDirty((d) => ({ ...d, [path]: false })); }
  };

  const acceptChange = (path: string) => setChanges((prev) => prev.map((c) => (c.path === path && c.status === 'pending' ? { ...c, status: 'accepted' } : c)));
  const rejectChange = async (path: string) => {
    const c = changes.find((x) => x.path === path && x.status === 'pending') || [...changes].reverse().find((x) => x.path === path && x.status === 'accepted');
    if (!c) return;
    if (c.before === null) await fetch('/api/files?path=' + encodeURIComponent(path), { method: 'DELETE' });
    else await fetch('/api/files', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: c.before }) });
    setChanges((prev) => prev.map((x) => (x.ts === c.ts && x.path === path ? { ...x, status: 'rejected' } : x)));
    setContents((prev) => (prev[path] !== undefined ? { ...prev, [path]: c.before ?? '' } : prev));
    setDirty((d) => ({ ...d, [path]: false }));
    setRefreshKey((k) => k + 1);
    if (view.kind === 'diff' && view.path === path) setView({ kind: 'empty' });
  };
  const acceptAll = () => setChanges((prev) => prev.map((c) => (c.status === 'pending' ? { ...c, status: 'accepted' } : c)));
  const rejectAll = async () => { for (const c of changes.filter((x) => x.status === 'pending')) await rejectChange(c.path); };

  const toggleStage = (id: string) => {
    const has = settings.autoPrompt.stages.includes(id);
    const stages = has ? settings.autoPrompt.stages.filter((s) => s !== id) : [...settings.autoPrompt.stages, id];
    setSettings({ ...settings, autoPrompt: { ...settings.autoPrompt, stages } });
  };

  const stop = () => abortRef.current?.abort();

  // ---- send ----
  const send = async (task: string) => {
    if (!task || busy || !active) return;
    const sessionId = active.id;
    setBusy(true);
    setStageStates(emptyStages(settings.autoPrompt.stages));
    pushEvent(sessionId, { kind: 'user', content: task });
    setSessions((prev) => prev.map((s) => (s.id === sessionId && s.title === 'New session' ? { ...s, title: task.slice(0, 48) } : s)));

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: task }],
          workingDirectory: settings.workingDirectory || undefined,
          provider: settings.provider, agent: settings.agent, autoPrompt: settings.autoPrompt,
          contextTools: settings.contextTools,
        }),
        signal: controller.signal,
      });
      if (!res.body) throw new Error('no response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev: any;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          switch (ev.type) {
            case 'content': appendToLast(sessionId, 'assistant', ev.content || ''); break;
            case 'reasoning': appendToLast(sessionId, 'reasoning', ev.content || ''); break;
            case 'usage': addSessionUsage(sessionId, ev.usage); break;
            case 'tool_call': {
              const name = ev.toolCall?.name;
              const args = safeParse(ev.toolCall?.arguments);
              pendingToolRef.current = { name, path: resolvePath(toolPath(args)), args };
              pushEvent(sessionId, { kind: 'tool_call', name, content: ev.toolCall?.arguments || '' });
              break;
            }
            case 'tool_result': {
              const name = ev.toolCall?.name;
              const ok = !!ev.toolCall?.success;
              pushEvent(sessionId, { kind: 'tool_result', name, success: ok, content: ev.toolCall?.result || '' });
              const p = pendingToolRef.current;
              if (ok && p && p.name === name && p.path) {
                if (name === 'read_file' && !snapshotsRef.current.has(p.path)) snapshotsRef.current.set(p.path, ev.toolCall?.result ?? '');
                if (name === 'write_file' || name === 'edit_file') recordChange(p.path, name);
              }
              pendingToolRef.current = null;
              break;
            }
            case 'system': pushEvent(sessionId, { kind: 'system', content: ev.content || '' }); break;
            case 'error': pushEvent(sessionId, { kind: 'error', content: ev.error || 'unknown error' }); break;
            case 'auto_prompt_pipeline_start':
              pushEvent(sessionId, { kind: 'system', content: 'Autoprompt pipeline starting: ' + (ev.stages || []).join(' -> ') });
              setStageStates((prev) => { const next = { ...prev }; for (const s of ev.stages || []) next[s] = { stage: s, status: 'idle' }; return next; });
              break;
            case 'auto_prompt_stage_start':
              setStageStates((prev) => ({ ...prev, [ev.stage]: { stage: ev.stage, status: 'running' } }));
              pushEvent(sessionId, { kind: 'system', content: 'Stage started: ' + ev.stage });
              break;
            case 'auto_prompt_stage': {
              const sr = ev.stageResult || {};
              setStageStates((prev) => ({ ...prev, [sr.stage]: { stage: sr.stage, status: sr.passed ? 'pass' : 'fail', summary: sr.summary } }));
              pushEvent(sessionId, { kind: sr.passed ? 'done' : 'error', content: `Stage ${sr.stage}: ${sr.passed ? 'PASS' : 'FAIL'} — ${sr.summary || ''}` });
              break;
            }
            case 'auto_prompt_summary': pushEvent(sessionId, { kind: 'system', content: 'Autoprompt pipeline finished (' + (ev.stages ?? 0) + ' stage(s)).' }); break;
            case 'done': pushEvent(sessionId, { kind: 'done', content: 'Task complete.' }); break;
          }
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') pushEvent(sessionId, { kind: 'system', content: 'Stopped by user.' });
      else pushEvent(sessionId, { kind: 'error', content: String(e?.message || e) });
    } finally {
      abortRef.current = null;
      setBusy(false);
      setRefreshKey((k) => k + 1);
    }
  };

  // ---- derived ----
  const todos: TodoItem[] = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'tool_call' && e.name === 'todo') {
        const a = safeParse(e.content);
        if (Array.isArray(a.steps)) return a.steps.map((s: string) => ({ text: String(s), done: false }));
      }
    }
    return [];
  }, [events]);

  const agentOutputs = useMemo(() => {
    const out: Array<{ cmd: string; out: string; ok: boolean }> = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.kind === 'tool_call' && e.name === 'shell_command') {
        const a = safeParse(e.content);
        for (let j = i + 1; j < events.length; j++) {
          if (events[j].kind === 'tool_result' && events[j].name === 'shell_command') {
            out.push({ cmd: String(a.command || ''), out: events[j].content, ok: !!events[j].success });
            break;
          }
        }
      }
    }
    return out;
  }, [events]);

  const context = useMemo(() => {
    let chars = 0, tools = 0;
    for (const e of events) { chars += (e.content || '').length; if (e.kind === 'tool_call') tools++; }
    const stages = Object.values(stageStates).filter((s) => s.status === 'pass' || s.status === 'fail').length;
    return { used: Math.round(chars / 4), total: settings.provider.contextWindow || 1, events: events.length, tools, stages };
  }, [events, stageStates, settings.provider.contextWindow]);

  const newSession = () => { const s = freshSession(); setSessions((prev) => [s, ...prev]); setActiveId(s.id); setStageStates(emptyStages(settings.autoPrompt.stages)); setChanges([]); };
  const deleteSession = (id: string) => setSessions((prev) => { const next = prev.filter((s) => s.id !== id); const list = next.length ? next : [freshSession()]; if (id === activeId) setActiveId(list[0].id); return list; });
  const switchSession = (id: string) => { setActiveId(id); setStageStates(emptyStages(settings.autoPrompt.stages)); setLeftMode('explorer'); };

  const commands: Command[] = [
    { id: 'settings', label: 'Open Settings', sub: 'Ctrl+,', run: () => setSettingsOpen(true) },
    { id: 'explorer', label: 'Show File Explorer', run: () => { setLeftMode('explorer'); setLeftOpen(true); } },
    { id: 'changes', label: 'Show Changes', run: () => { setLeftMode('changes'); setLeftOpen(true); } },
    { id: 'sessions', label: 'Show Sessions', run: () => { setLeftMode('sessions'); setLeftOpen(true); } },
    { id: 'terminal', label: 'Toggle Terminal', sub: 'Ctrl+`', run: () => setBottomOpen((v) => !v) },
    { id: 'agent', label: 'Toggle Agent Panel', run: () => setAgentOpen((v) => !v) },
    { id: 'new-session', label: 'New Session', run: newSession },
    { id: 'workspace', label: 'Choose Working Folder', run: () => setWorkspaceOpen(true) },
    { id: 'prompts', label: 'Edit Prompts / AGENTS.md / Skills', run: () => setPromptsOpen(true) },
    { id: 'refresh', label: 'Refresh Files', run: () => setRefreshKey((k) => k + 1) },
    ...['neon', 'amber', 'red', 'matrix', 'ice', 'mono'].map((t) => ({ id: 'theme-' + t, label: 'Theme: ' + t, run: () => setSettings({ ...settings, theme: t }) })),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((v) => !v); }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setLeftOpen((v) => !v); }
      else if (mod && e.key === '`') { e.preventDefault(); setBottomOpen((v) => !v); }
      else if (mod && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      else if (e.key === 'Escape') { setPaletteOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pendingChanges = changes.filter((c) => c.status === 'pending');
  const dotClass = online === 'on' ? 'on' : online === 'off' ? 'err' : '';
  const ctxPct = Math.min(100, Math.round((context.used / context.total) * 100));
  const cols = `48px ${leftOpen ? 262 : 0}px 1fr ${agentOpen ? 400 : 0}px`;
  const usage = active?.usage || emptyUsage();
  const cost = costOf(usage, settings.provider);
  const costStr = `${settings.provider.currency}${cost.toFixed(4)}`;
  const wsName = settings.workingDirectory ? (settings.workingDirectory.split(/[\\/]/).filter(Boolean).pop() || settings.workingDirectory) : 'Set workspace';

  const submit = () => { const t = input.trim(); if (!t || busy) return; setInput(''); send(t); };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">EC11<small> v{APP_VERSION}</small></span>
        <button className={'chip click ws-chip' + (settings.workingDirectory ? '' : ' unset')} onClick={() => setWorkspaceOpen(true)} title={settings.workingDirectory || 'No workspace set — click to choose a folder'}>
          <span className="folder-ico">&#128193;</span>{settings.workingDirectory ? wsName : 'Set workspace'}
        </button>
        <button className="btn sm" onClick={newSession} title="Start a new session">+ New session</button>
        <span className="chip"><span className={'dot ' + dotClass} />{online === 'on' ? 'online' : online === 'off' ? 'offline' : '...'}</span>
        <span className="chip click" onClick={() => setSettingsOpen(true)} title="Change model">{settings.provider.model || 'no model'}</span>
        <span className="chip" title={`Input ${usage.promptTokens.toLocaleString()} tokens up / output ${usage.completionTokens.toLocaleString()} tokens down`}>
          tokens &#8593;{usage.promptTokens.toLocaleString()} &#8595;{usage.completionTokens.toLocaleString()} · {costStr}
        </span>
        <span className="chip" title="estimated context usage">
          <span className="meter" style={{ width: 50 }}><i style={{ width: ctxPct + '%' }} /></span>
          ~{ctxPct}%
        </span>
        <span className="spacer" />
        {pendingChanges.length > 0 && <span className="chip click" onClick={() => { setLeftMode('changes'); setLeftOpen(true); }} style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}>{pendingChanges.length} change(s)</span>}
        {busy && <button className="btn danger sm" onClick={stop}>Stop</button>}
        <button className="btn ghost sm" onClick={() => setPaletteOpen(true)}>Ctrl+K</button>
        <button className="btn sm" onClick={() => setSettingsOpen(true)}>Settings</button>
      </header>

      <div className="workbench" style={{ gridTemplateColumns: cols }}>
        <nav className="rail">
          <button className={'rail-btn' + (leftOpen && leftMode === 'explorer' ? ' active' : '')} onClick={() => { setLeftMode('explorer'); setLeftOpen(leftMode === 'explorer' ? !leftOpen : true); }} title="Explorer (Ctrl+B)"><span className="ico">▤</span>files</button>
          <button className={'rail-btn' + (leftOpen && leftMode === 'changes' ? ' active' : '')} onClick={() => { setLeftMode('changes'); setLeftOpen(leftMode === 'changes' ? !leftOpen : true); }} title="Changes"><span className="ico">±</span>diffs{changes.length ? ' ' + changes.length : ''}</button>
          <button className={'rail-btn' + (leftOpen && leftMode === 'sessions' ? ' active' : '')} onClick={() => { setLeftMode('sessions'); setLeftOpen(leftMode === 'sessions' ? !leftOpen : true); }} title="Sessions"><span className="ico">≡</span>sessions</button>
          <button className={'rail-btn' + (bottomOpen ? ' active' : '')} onClick={() => setBottomOpen((v) => !v)} title="Terminal (Ctrl+`)"><span className="ico">&gt;_</span>term</button>
          <div className="rail-spacer" />
          <button className={'rail-btn' + (promptsOpen ? ' active' : '')} onClick={() => setPromptsOpen(true)} title="Edit prompts, AGENTS.md, and view skills"><span className="ico">&#9998;</span>prompts</button>
          <button className="rail-btn" onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl+K)"><span className="ico">⌘</span>cmd</button>
          <button className={'rail-btn' + (agentOpen ? ' active' : '')} onClick={() => setAgentOpen((v) => !v)} title="Toggle agent panel"><span className="ico">◈</span>agent</button>
        </nav>

        {leftOpen && (
          <aside className="leftpanel">
            {leftMode === 'explorer' && (
              <FileExplorer root={settings.workingDirectory} refreshKey={refreshKey} activePath={view.path || ''} onOpen={openFile} onRefresh={() => setRefreshKey((k) => k + 1)} />
            )}
            {leftMode === 'changes' && (
              <ChangesPanel changes={changes} activePath={view.kind === 'diff' ? view.path || '' : ''} onOpen={(p) => setView({ kind: 'diff', path: p })} onAccept={acceptChange} onReject={rejectChange} onAcceptAll={acceptAll} onRejectAll={rejectAll} />
            )}
            {leftMode === 'sessions' && (
              <>
                <div className="panel-head"><span>Sessions</span><button className="btn ghost sm" onClick={newSession}>+ new</button></div>
                <div className="panel-scroll">
                  {sessions.map((s) => (
                    <div className={'change-file' + (s.id === activeId ? ' active' : '')} key={s.id} onClick={() => switchSession(s.id)} title={s.title}>
                      <span className="cname">{s.title}</span>
                      <span onClick={(e) => e.stopPropagation()}><button className="btn ghost sm" onClick={() => deleteSession(s.id)}>x</button></span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
        )}

        <div className="main-col">
          <EditorPane
            openPaths={openPaths}
            view={view}
            contents={contents}
            dirty={dirty}
            changes={changes}
            onSelectTab={(p) => setView({ kind: 'file', path: p })}
            onCloseTab={closeTab}
            onChange={(p, c) => { setContents((prev) => ({ ...prev, [p]: c })); setDirty((d) => ({ ...d, [p]: true })); }}
            onSave={saveFile}
            onRevert={revertFile}
            onAccept={acceptChange}
            onReject={rejectChange}
            onOpenFile={openFile}
          />
          {bottomOpen && <TerminalPanel cwd={settings.workingDirectory || ''} agentOutputs={agentOutputs} onClose={() => setBottomOpen(false)} />}
        </div>

        {agentOpen && (
          <AgentPanel
            events={events}
            busy={busy}
            stageStates={stageStates}
            autoPrompt={settings.autoPrompt}
            todos={todos}
            context={context}
            usage={usage}
            currency={settings.provider.currency}
            cost={cost}
            onToggleEnabled={(v) => setSettings({ ...settings, autoPrompt: { ...settings.autoPrompt, enabled: v } })}
            onToggleStage={toggleStage}
          />
        )}
      </div>

      <div className="composer-bar">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Ask EC11 to build or change something. Enter to send, Shift+Enter for a new line."
        />
        {busy
          ? <button className="btn danger" onClick={stop}>Stop</button>
          : <button className="btn primary" onClick={submit} disabled={!input.trim()}>Send</button>}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      {promptsOpen && <PromptsDrawer workspace={settings.workingDirectory} onClose={() => setPromptsOpen(false)} />}
      {workspaceOpen && <WorkspacePicker current={settings.workingDirectory} onPick={(p) => setSettings({ ...settings, workingDirectory: p })} onClose={() => setWorkspaceOpen(false)} />}
      {settingsOpen && (
        <SettingsPanel settings={settings} models={models} loaded={loadedModels} catalog={catalog} modelsBusy={modelsBusy} onChange={setSettings} onRefreshModels={refreshModels} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
```

===== FILE: src/components/AgentPanel.tsx =====

```ts
'use client';
import { useState } from 'react';
import { AutoPromptSettings, LogEvent, StageState, TodoItem, TokenUsage } from '@/lib/settings';
import ChatLog from './ChatLog';
import AutoPromptPanel from './AutoPromptPanel';

interface Props {
  events: LogEvent[];
  busy: boolean;
  stageStates: Record<string, StageState>;
  autoPrompt: AutoPromptSettings;
  todos: TodoItem[];
  context: { used: number; total: number; events: number; tools: number; stages: number };
  usage: TokenUsage;
  currency: string;
  cost: number;
  onToggleEnabled: (v: boolean) => void;
  onToggleStage: (id: string) => void;
}

export default function AgentPanel({ events, busy, stageStates, autoPrompt, todos, context, usage, currency, cost, onToggleEnabled, onToggleStage }: Props) {
  const [tab, setTab] = useState<'chat' | 'plan' | 'pipeline'>('chat');

  const pct = context.total > 0 ? Math.min(100, Math.round((context.used / context.total) * 100)) : 0;
  const meterClass = 'meter' + (pct > 85 ? ' bad' : pct > 60 ? ' warn' : '');

  return (
    <div className="agent-col">
      <div className="agent-head-tabs">
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Agent</button>
        <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>Plan</button>
        <button className={tab === 'pipeline' ? 'active' : ''} onClick={() => setTab('pipeline')}>Pipeline</button>
      </div>

      <div className="agent-scroll">
        {tab === 'chat' && <ChatLog events={events} busy={busy} />}
        {tab === 'plan' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div className="side-section-title" style={{ marginBottom: 6 }}><span>Tokens processed</span><span>{currency}{cost.toFixed(4)}</span></div>
              <div className="stat-row"><span>Input (&#8593; prompt)</span><span>{usage.promptTokens.toLocaleString()}</span></div>
              <div className="stat-row"><span>Output (&#8595; completion)</span><span>{usage.completionTokens.toLocaleString()}</span></div>
              <div className="stat-row" style={{ color: 'var(--text)' }}><span>Total</span><span>{usage.totalTokens.toLocaleString()}</span></div>
              <div className="stat-row"><span>Estimated cost</span><span>{currency}{cost.toFixed(4)}</span></div>
            </div>
            <div>
              <div className="side-section-title" style={{ marginBottom: 6 }}><span>Context window</span><span>{pct}%</span></div>
              <div className={meterClass}><i style={{ width: pct + '%' }} /></div>
              <div className="stat-row" style={{ marginTop: 6 }}><span>~{context.used.toLocaleString()} / {context.total.toLocaleString()} tokens</span><span>{context.events} events</span></div>
            </div>
            <div className="stat-row"><span>Tool calls</span><span>{context.tools}</span></div>
            <div className="stat-row"><span>Autoprompt stages run</span><span>{context.stages}</span></div>
            <div>
              <div className="side-section-title" style={{ marginBottom: 6 }}><span>Plan / todos</span></div>
              {!todos.length && <div className="hint">The agent's plan appears here when it uses the todo tool.</div>}
              {todos.map((t, i) => (
                <div className={'todo-item' + (t.done ? ' done' : '')} key={i}>
                  <span className="box">{t.done ? '[x]' : '[ ]'}</span>
                  <span>{t.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'pipeline' && (
          <AutoPromptPanel autoPrompt={autoPrompt} stageStates={stageStates} busy={busy} onToggleEnabled={onToggleEnabled} onToggleStage={onToggleStage} />
        )}
      </div>
    </div>
  );
}
```

===== FILE: src/components/ChatLog.tsx =====

```ts
'use client';
import { LogEvent } from '@/lib/settings';
import { useEffect, useRef } from 'react';

interface Props {
  events: LogEvent[];
  busy: boolean;
}

function EventView({ ev }: { ev: LogEvent }) {
  if (ev.kind === 'tool_call') {
    return (
      <div className="ev tool">
        <span className="tag">tool call</span>
        {ev.name}
        <pre>{ev.content}</pre>
      </div>
    );
  }
  if (ev.kind === 'tool_result') {
    return (
      <div className={'ev tool' + (ev.success ? '' : ' err')}>
        <span className="tag">{ev.success ? 'tool result' : 'tool error'}</span>
        {ev.name}
        <pre>{ev.content}</pre>
      </div>
    );
  }
  const labels: Record<string, string> = {
    user: 'you',
    assistant: 'ec11',
    reasoning: 'reasoning',
    system: 'system',
    error: 'error',
    done: 'done',
  };
  return (
    <div className={'ev ' + ev.kind}>
      <span className="tag">{labels[ev.kind] || ev.kind}</span>
      {ev.content}
    </div>
  );
}

export default function ChatLog({ events, busy }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [events.length, busy]);

  return (
    <div className="log" ref={ref}>
      {!events.length && (
        <div className="empty">
          <h2>EC11 // LOCAL CODING AGENT</h2>
          <p>Describe the app to build. EC11 writes real files, runs an executed-verification gate, then runs your autoprompt stages and shows each result here.</p>
          <p style={{ fontSize: 12 }}>Set your model and working folder in Settings, then send a task.</p>
        </div>
      )}
      {events.map((ev) => <EventView ev={ev} key={ev.id} />)}
      {busy && <div className="ev system"><span className="tag">status</span>working...</div>}
    </div>
  );
}
```

===== FILE: src/components/AutoPromptPanel.tsx =====

```ts
'use client';
import { AutoPromptSettings, STAGE_DEFS, StageState } from '@/lib/settings';

interface Props {
  autoPrompt: AutoPromptSettings;
  stageStates: Record<string, StageState>;
  busy: boolean;
  onToggleEnabled: (v: boolean) => void;
  onToggleStage: (id: string) => void;
}

function badge(active: boolean, status: string) {
  if (!active) return <span className="badge skipped">off</span>;
  if (status === 'running') return <span className="badge running">running</span>;
  if (status === 'pass') return <span className="badge pass">pass</span>;
  if (status === 'fail') return <span className="badge fail">fail</span>;
  return <span className="badge">ready</span>;
}

export default function AutoPromptPanel({ autoPrompt, stageStates, busy, onToggleEnabled, onToggleStage }: Props) {
  return (
    <aside className="autoprompt">
      <div className="side-section-title">
        <span>Autoprompt pipeline</span>
        <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'none', letterSpacing: 0 }}>
          <input type="checkbox" checked={autoPrompt.enabled} onChange={(e) => onToggleEnabled(e.target.checked)} style={{ width: 'auto', accentColor: 'var(--accent)' }} />
          on
        </label>
      </div>
      <div className="hint">Stages run in order after the main task. Each one waits for the previous and sees the files it changed. Toggle any stage here or in Settings.</div>
      {STAGE_DEFS.map((s) => {
        const active = autoPrompt.stages.includes(s.id);
        const st = stageStates[s.id] || { stage: s.id, status: 'idle' as const };
        return (
          <div className={'stage ' + (active ? (st.status === 'idle' ? '' : st.status) : 'skipped')} key={s.id}>
            <div className="stage-head">
              <label style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none', letterSpacing: 0, color: 'inherit', cursor: 'pointer' }}>
                <input type="checkbox" checked={active} onChange={() => onToggleStage(s.id)} style={{ width: 'auto', accentColor: 'var(--accent)' }} />
                <span className="stage-name">{s.label}</span>
              </label>
              {badge(active, st.status)}
            </div>
            {st.summary && <div className="stage-sum">{st.summary}</div>}
          </div>
        );
      })}
      {!autoPrompt.enabled && <div className="hint" style={{ color: 'var(--warn)' }}>Pipeline is off — the agent will only do the main task.</div>}
      {busy && autoPrompt.enabled && <div className="hint">Pipeline will start after the main task completes.</div>}
    </aside>
  );
}
```

===== FILE: src/components/ChangesPanel.tsx =====

```ts
'use client';
import { Change } from '@/lib/settings';
import { diffStat, lineDiff } from '@/lib/diff';

interface Props {
  changes: Change[];
  activePath: string;
  onOpen: (p: string) => void;
  onAccept: (p: string) => void;
  onReject: (p: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

function baseName(p: string) { return p.split(/[\\/]/).pop() || p; }

export default function ChangesPanel({ changes, activePath, onOpen, onAccept, onReject, onAcceptAll, onRejectAll }: Props) {
  const pending = changes.filter((c) => c.status === 'pending');
  const applied = changes.filter((c) => c.status === 'accepted').slice().reverse();

  const Row = ({ c, mode }: { c: Change; mode: 'pending' | 'applied' }) => {
    const st = diffStat(lineDiff(c.before ?? '', c.after));
    const isNew = c.before === null;
    return (
      <div className={'change-file' + (activePath === c.path ? ' active' : '')} onClick={() => onOpen(c.path)} title={c.path}>
        <span className="cname">
          {baseName(c.path)}
          <div className="hint" style={{ marginTop: 2 }}>
            {isNew ? 'new file' : c.tool} &nbsp; <span className="a">+{st.add}</span> <span className="d">-{st.del}</span>
            {mode === 'applied' && <span className="badge pass" style={{ marginLeft: 6 }}>applied</span>}
          </div>
        </span>
        <span style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          {mode === 'pending' ? (
            <>
              <button className="btn good sm" onClick={() => onAccept(c.path)} title="Accept">ok</button>
              <button className="btn danger sm" onClick={() => onReject(c.path)} title="Reject (restore the previous version)">no</button>
            </>
          ) : (
            <button className="btn danger sm" onClick={() => onReject(c.path)} title="Revert this file to its original content">revert</button>
          )}
        </span>
      </div>
    );
  };

  return (
    <>
      <div className="panel-head">
        <span>Changes</span>
        <span className="diff-stat">{applied.length} applied{pending.length ? ` · ${pending.length} pending` : ''}</span>
      </div>
      {pending.length > 0 && (
        <div className="change-actions">
          <button className="btn good sm" onClick={onAcceptAll}>Accept all</button>
          <button className="btn danger sm" onClick={onRejectAll}>Reject all</button>
        </div>
      )}
      <div className="panel-scroll">
        {!changes.length && <div className="hint" style={{ padding: 10 }}>No changes yet. When the agent writes or edits files, each change shows up here — already applied, with the diff and a revert button.</div>}
        {pending.map((c) => <Row c={c} mode="pending" key={'p' + c.path} />)}
        {pending.length > 0 && applied.length > 0 && <div className="side-section-title" style={{ padding: '8px 10px' }}><span>Applied earlier</span></div>}
        {applied.map((c) => <Row c={c} mode="applied" key={'a' + c.path + c.ts} />)}
      </div>
    </>
  );
}
```

===== FILE: src/components/EditorPane.tsx =====

```ts
'use client';
import { useMemo } from 'react';
import { Change } from '@/lib/settings';
import { diffStat, languageOf, lineDiff } from '@/lib/diff';

export interface MainView { kind: 'empty' | 'file' | 'diff'; path?: string }

interface Props {
  openPaths: string[];
  view: MainView;
  contents: Record<string, string>;
  dirty: Record<string, boolean>;
  changes: Change[];
  onSelectTab: (p: string) => void;
  onCloseTab: (p: string) => void;
  onChange: (p: string, c: string) => void;
  onSave: (p: string) => void;
  onRevert: (p: string) => void;
  onAccept: (p: string) => void;
  onReject: (p: string) => void;
  onOpenFile: (p: string) => void;
}

const LINE = 19.5;

function baseName(p: string) { return p.split(/[\\/]/).pop() || p; }

export default function EditorPane(props: Props) {
  const { openPaths, view, contents, dirty, changes, onSelectTab, onCloseTab, onChange, onSave, onRevert, onAccept, onReject, onOpenFile } = props;

  const activeChange = view.kind === 'diff' && view.path ? changes.find((c) => c.path === view.path && c.status === 'pending') : undefined;
  const diffLines = useMemo(() => {
    if (!activeChange) return [];
    return lineDiff(activeChange.before ?? '', activeChange.after);
  }, [activeChange]);
  const stat = diffStat(diffLines);
  const content = view.path ? contents[view.path] ?? '' : '';
  const lineCount = Math.max(1, content.split('\n').length);

  return (
    <div className="main-col">
      <div className="tabs">
        {openPaths.map((p) => (
          <button key={p} className={'tab' + (view.kind !== 'diff' && view.path === p ? ' active' : '')} onClick={() => onSelectTab(p)} title={p}>
            {dirty[p] && <span className="mod">*</span>}
            <span>{baseName(p)}</span>
            <span className="tab-close" onClick={(e) => { e.stopPropagation(); onCloseTab(p); }}>x</span>
          </button>
        ))}
        {view.kind === 'diff' && view.path && (
          <button className="tab active">DIFF: {baseName(view.path)}</button>
        )}
        <div className="tab-spacer" />
        {view.kind === 'file' && view.path && (
          <div className="tab-actions">
            {dirty[view.path] && <span className="diff-stat">unsaved</span>}
            <button className="btn ghost sm" onClick={() => onRevert(view.path!)} disabled={!dirty[view.path]}>Revert</button>
            <button className="btn primary sm" onClick={() => onSave(view.path!)} disabled={!dirty[view.path]}>Save</button>
          </div>
        )}
      </div>

      {view.kind === 'empty' && (
        <div className="empty" style={{ marginTop: '10vh' }}>
          <h2>EC11 // WORKSPACE</h2>
          <p>Pick a file in the Explorer to view or edit it. Files the agent writes appear in <b>Changes</b> with an accept/reject diff.</p>
          <p style={{ fontSize: 12 }}><kbd>Ctrl</kbd>+<kbd>K</kbd> command palette &nbsp; <kbd>Ctrl</kbd>+<kbd>`</kbd> terminal &nbsp; <kbd>Ctrl</kbd>+<kbd>B</kbd> explorer</p>
        </div>
      )}

      {view.kind === 'file' && view.path && (
        <div className="editor">
          <div className="editor-bar">
            <span className="path">{view.path} &nbsp;·&nbsp; {languageOf(view.path)} &nbsp;·&nbsp; {lineCount} lines</span>
            <button className="btn ghost sm" onClick={() => onCloseTab(view.path!)}>Close</button>
          </div>
          <div className="code-area">
            <div className="code-gutter" style={{ lineHeight: LINE + 'px' }}>
              {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
            </div>
            <textarea
              className="code-edit"
              style={{ lineHeight: LINE + 'px', height: Math.max(320, lineCount * LINE + 24) + 'px' }}
              value={content}
              spellCheck={false}
              onChange={(e) => onChange(view.path!, e.target.value)}
              onKeyDown={(e) => { if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(view.path!); } }}
            />
          </div>
        </div>
      )}

      {view.kind === 'diff' && view.path && (
        <div className="editor">
          <div className="editor-bar">
            <span className="path">{activeChange ? (activeChange.before === null ? 'new file' : 'modified') : 'no pending change'} &nbsp;·&nbsp; {view.path}</span>
            <span className="diff-stat"><span className="a">+{stat.add}</span> <span className="d">-{stat.del}</span></span>
            {activeChange && (
              <>
                <button className="btn good sm" onClick={() => onAccept(view.path!)}>Accept</button>
                <button className="btn danger sm" onClick={() => onReject(view.path!)}>Reject</button>
              </>
            )}
            {!activeChange && <button className="btn ghost sm" onClick={() => onOpenFile(view.path!)}>Open file</button>}
          </div>
          <div className="code-area">
            <div className="diff" style={{ lineHeight: LINE + 'px' }}>
              {diffLines.length === 0 && <div className="diff-line ctx"><span className="ln" /><span className="sg" />No differences.</div>}
              {diffLines.map((l, i) => (
                <div className={'diff-line ' + l.type} key={i}>
                  <span className="ln">{l.aNo ?? l.bNo ?? ''}</span>
                  <span className="sg">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

===== FILE: src/components/FileExplorer.tsx =====

```ts
'use client';
import { useCallback, useEffect, useState } from 'react';
import { FileNode } from '@/lib/settings';

interface Props {
  root: string;
  refreshKey: number;
  activePath: string;
  onOpen: (path: string) => void;
  onRefresh: () => void;
}

export default function FileExplorer({ root, refreshKey, activePath, onOpen, onRefresh }: Props) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!root) { setTree([]); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/files?tree=1&depth=6&path=' + encodeURIComponent(root));
      const data = await res.json();
      if (data.ok) setTree(data.tree || []);
      else setError(data.error || 'Could not read folder.');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally { setLoading(false); }
  }, [root]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const toggle = (p: string) => setExpanded((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const renderNodes = (nodes: FileNode[], depth: number) =>
    nodes.map((n) => {
      const isOpen = expanded.has(n.path);
      return (
        <div key={n.path}>
          <div
            className={'tree-row ' + n.type + (activePath === n.path ? ' active' : '')}
            style={{ paddingLeft: 8 + depth * 13 }}
            onClick={() => (n.type === 'dir' ? toggle(n.path) : onOpen(n.path))}
            title={n.path}
          >
            <span className="ic">{n.type === 'dir' ? (isOpen ? '-' : '+') : ''}</span>
            <span>{n.name}{n.type === 'dir' ? '/' : ''}</span>
          </div>
          {n.type === 'dir' && isOpen && n.children && <div className="tree-children">{renderNodes(n.children, depth + 1)}</div>}
        </div>
      );
    });

  return (
    <>
      <div className="panel-head">
        <span>Explorer</span>
        <button className="btn ghost sm" onClick={() => { onRefresh(); load(); }} title="Refresh">refresh</button>
      </div>
      <div className="panel-scroll">
        {!root && <div className="hint" style={{ padding: 10 }}>No working folder set. Click the <b>workspace</b> button in the top bar to pick one.</div>}
        {root && loading && <div className="hint" style={{ padding: 10 }}>Loading folder...</div>}
        {root && !loading && error && <div className="hint" style={{ padding: 10, color: 'var(--bad)' }}>{error}</div>}
        {root && !loading && !error && !tree.length && <div className="hint" style={{ padding: 10 }}>Folder is empty.</div>}
        {root && !loading && <div className="tree">{renderNodes(tree, 0)}</div>}
      </div>
      {root && <div className="hint" style={{ padding: '8px 10px', borderTop: '1px solid var(--line)', wordBreak: 'break-all' }}>{root}</div>}
    </>
  );
}
```

===== FILE: src/components/TerminalPanel.tsx =====

```ts
'use client';
import { useRef, useState, type KeyboardEvent } from 'react';
import { TerminalLine } from '@/lib/settings';

interface Props {
  cwd: string;
  agentOutputs: Array<{ cmd: string; out: string; ok: boolean }>;
  onClose: () => void;
}

export default function TerminalPanel({ cwd, agentOutputs, onClose }: Props) {
  const [tab, setTab] = useState<'terminal' | 'output'>('terminal');
  const [lines, setLines] = useState<TerminalLine[]>([{ kind: 'meta', text: 'EC11 terminal. Commands run with PowerShell in the working folder.' }]);
  const [cmd, setCmd] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);

  const push = (l: TerminalLine) => setLines((prev) => [...prev, l]);
  const scroll = () => setTimeout(() => outRef.current?.scrollTo({ top: outRef.current.scrollHeight }), 30);

  const run = async () => {
    const command = cmd.trim();
    if (!command || busy) return;
    setCmd('');
    setHistory((h) => [command, ...h]);
    setHistIdx(-1);
    push({ kind: 'cmd', text: '$ ' + command });
    scroll();
    setBusy(true);
    try {
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, cwd }),
      });
      const data = await res.json();
      if (data.output) push({ kind: data.ok ? 'out' : 'err', text: data.output });
      push({ kind: 'meta', text: (data.ok ? 'exit 0' : 'exit ' + (data.code ?? 1)) + '  (' + data.durationMs + ' ms)' });
    } catch (e: any) {
      push({ kind: 'err', text: String(e?.message || e) });
    } finally { setBusy(false); scroll(); }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const i = Math.min(histIdx + 1, history.length - 1); if (i >= 0) { setHistIdx(i); setCmd(history[i]); } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); const i = histIdx - 1; setHistIdx(i); setCmd(i >= 0 ? history[i] : ''); }
  };

  return (
    <div className="bottom">
      <div className="bottom-head">
        <button className={'bottom-tab' + (tab === 'terminal' ? ' active' : '')} onClick={() => setTab('terminal')}>Terminal</button>
        <button className={'bottom-tab' + (tab === 'output' ? ' active' : '')} onClick={() => setTab('output')}>Agent output ({agentOutputs.length})</button>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={onClose}>close</button>
      </div>
      {tab === 'terminal' ? (
        <>
          <div className="term-out" ref={outRef}>
            {lines.map((l, i) => <div key={i} className={l.kind === 'cmd' ? 'cmd' : l.kind === 'err' ? 'err' : l.kind === 'meta' ? '' : 'ok'}>{l.text}</div>)}
          </div>
          <div className="term-in">
            <span className="prompt">$</span>
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={onKey} placeholder={busy ? 'running...' : 'type a command and press Enter'} disabled={busy} />
          </div>
        </>
      ) : (
        <div className="term-out">
          {!agentOutputs.length && <div className="hint">No shell commands run by the agent yet.</div>}
          {agentOutputs.map((o, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div className="cmd">$ {o.cmd}</div>
              <div className={o.ok ? 'ok' : 'err'}>{o.out || '(no output)'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

===== FILE: src/components/SettingsPanel.tsx =====

```ts
'use client';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AppSettings, STAGE_DEFS, THEMES, ProviderSettings, PROVIDER_PRESETS, CONTEXT_TOOL_DEFS, ModelMeta } from '@/lib/settings';

interface Props {
  settings: AppSettings;
  models: string[];
  loaded: string[];
  catalog: Record<string, ModelMeta>;
  modelsBusy: boolean;
  onChange: (s: AppSettings) => void;
  onRefreshModels: () => void;
  onClose: () => void;
}

const NUM_FIELDS: Array<{ key: keyof ProviderSettings; label: string; hint: string; step?: number }> = [
  { key: 'maxTokens', label: 'Max output tokens', hint: 'Auto-filled from the model; keep ≤ context window.' },
  { key: 'contextWindow', label: 'Model context window', hint: 'Auto-detected when you pick a model.' },
  { key: 'temperature', label: 'Temperature', hint: '0 = deterministic, 1 = creative.', step: 0.1 },
  { key: 'retries', label: 'Provider retries', hint: 'Retry attempts on transient failures.' },
  { key: 'connectTimeoutMs', label: 'Connect timeout (ms)', hint: 'Time allowed to open the connection.' },
  { key: 'completionTimeoutMs', label: 'Completion timeout (ms)', hint: 'Long for slow local models.' },
  { key: 'streamIdleTimeoutMs', label: 'Stream idle timeout (ms)', hint: 'Abort if no token arrives for this long.' },
];

export default function SettingsPanel({ settings, models, loaded, catalog, modelsBusy, onChange, onRefreshModels, onClose }: Props) {
  const [folderPath, setFolderPath] = useState(settings.workingDirectory || 'E:\\aiprojects');
  const [folder, setFolder] = useState<{ path: string; parent: string | null; dirs: string[]; drives: string[]; error?: string } | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [modelInfo, setModelInfo] = useState('');
  const [detecting, setDetecting] = useState(false);

  const loadFolder = async (p: string) => {
    try {
      const res = await fetch('/api/fs?path=' + encodeURIComponent(p));
      const data = await res.json();
      setFolder(data);
      setFolderPath(data.path || p);
    } catch {
      setFolder({ path: p, parent: null, dirs: [], drives: [], error: 'Could not read folder.' });
    }
  };

  useEffect(() => { loadFolder(settings.workingDirectory || 'E:\\aiprojects'); /* eslint-disable-next-line */ }, []);

  const detectModel = async () => {
    const model = settings.provider.model;
    if (!model) return;
    setDetecting(true);
    setModelInfo('Detecting context size...');
    try {
      const res = await fetch('/api/model-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: settings.provider.baseUrl, apiKey: settings.provider.apiKey, model }),
      });
      const d = await res.json();
      if (d.ok) {
        onChange({ ...settings, provider: { ...settings.provider, contextWindow: d.contextWindow, maxTokens: d.maxTokens } });
        setModelInfo(`Auto (${d.source}) — context ${Number(d.contextWindow).toLocaleString()} tokens, max output ${Number(d.maxTokens).toLocaleString()}`);
      } else {
        setModelInfo(d.error || 'Server did not report a context size. Set it manually.');
      }
    } catch (e: any) {
      setModelInfo('Detect failed: ' + String(e?.message || e));
    } finally { setDetecting(false); }
  };

  // Keep context window + max output in sync with the selected model.
  useEffect(() => {
    if (!settings.provider.model) return;
    const t = setTimeout(() => { detectModel(); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.provider.model, settings.provider.baseUrl, settings.provider.apiKey]);

  const setProvider = (key: keyof ProviderSettings, value: any) =>
    onChange({ ...settings, provider: { ...settings.provider, [key]: value } });

  const toggleStage = (id: string) => {
    const has = settings.autoPrompt.stages.includes(id);
    const stages = has ? settings.autoPrompt.stages.filter((s) => s !== id) : [...settings.autoPrompt.stages, id];
    onChange({ ...settings, autoPrompt: { ...settings.autoPrompt, stages } });
  };

  const createFolder = async () => {
    const res = await fetch('/api/fs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: folderPath, name: newFolder }),
    });
    const data = await res.json();
    if (data.ok) { setNewFolder(''); loadFolder(data.path); onChange({ ...settings, workingDirectory: data.path }); }
  };

  const [browsing, setBrowsing] = useState(false);
  const browseNative = async () => {
    setBrowsing(true);
    try {
      const res = await fetch('/api/fs/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initial: settings.workingDirectory || folderPath }) });
      const data = await res.json();
      if (data.ok && data.path) { onChange({ ...settings, workingDirectory: data.path }); loadFolder(data.path); }
    } finally { setBrowsing(false); }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="Settings">
        <div className="drawer-head">
          <span className="title">Settings</span>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">

          <fieldset>
            <legend>Working folder (workspace)</legend>
            <div className="field">
              <label>Folder the coder writes into</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={settings.workingDirectory || folderPath} onChange={(e) => onChange({ ...settings, workingDirectory: e.target.value })} />
                <button className="btn sm" onClick={browseNative} disabled={browsing} style={{ whiteSpace: 'nowrap' }}>{browsing ? '...' : 'Browse (Windows)'}</button>
              </div>
              <div className="hint">The agent only reads/writes inside this folder. This is the first thing to set.</div>
            </div>
            <div className="folder-browser">
              <div className="folder-path">{folder?.path || folderPath}{folder?.error ? '  - ' + folder.error : ''}</div>
              {folder?.parent && <div className="folder-row" onClick={() => loadFolder(folder.parent!)}>.. (up)</div>}
              {folder?.drives?.map((d) => <div className="folder-row" key={d} onClick={() => loadFolder(d)}>{d}</div>)}
              {folder?.dirs?.map((d) => <div className="folder-row" key={d} onClick={() => loadFolder((folder.path + '\\' + d).replace(/\\\\/g, '\\'))}>[DIR] {d}</div>)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="new folder name" />
              <button className="btn sm" onClick={createFolder} disabled={!newFolder.trim()}>Create</button>
            </div>
            <button className="btn primary sm" style={{ marginTop: 8 }} onClick={() => onChange({ ...settings, workingDirectory: folderPath })}>Use this folder</button>
          </fieldset>

          <fieldset>
            <legend>Model server</legend>
            <div className="field">
              <label>Backend preset</label>
              <select
                value={settings.provider.preset}
                onChange={(e) => {
                  const p = PROVIDER_PRESETS.find((x) => x.id === e.target.value);
                  onChange({ ...settings, provider: { ...settings.provider, preset: e.target.value, baseUrl: p && p.baseUrl ? p.baseUrl : settings.provider.baseUrl } });
                }}
              >
                {PROVIDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}{p.local ? ' (local)' : ''}</option>)}
              </select>
              <div className="hint">{PROVIDER_PRESETS.find((p) => p.id === settings.provider.preset)?.keyHint || 'OpenAI-compatible endpoint.'}</div>
            </div>
            <div className="field">
              <label>Base URL</label>
              <input value={settings.provider.baseUrl} onChange={(e) => setProvider('baseUrl', e.target.value)} placeholder="http://127.0.0.1:1234/v1" />
              <div className="hint">Any OpenAI-compatible endpoint works — local or cloud.</div>
            </div>
            <div className="field">
              <label>Model</label>
              <ModelPicker
                value={settings.provider.model}
                models={models}
                loaded={loaded}
                catalog={catalog}
                recent={settings.recentModels}
                hidden={settings.hiddenModels}
                hideVariants={settings.hideVariants}
                busy={modelsBusy}
                detecting={detecting}
                onType={(v) => setProvider('model', v)}
                onRefresh={onRefreshModels}
                onDetect={detectModel}
                onToggleVariants={() => onChange({ ...settings, hideVariants: !settings.hideVariants })}
                onHide={(m) => {
                  const hidden = settings.hiddenModels.includes(m)
                    ? settings.hiddenModels.filter((x) => x !== m)
                    : [...settings.hiddenModels, m];
                  onChange({ ...settings, hiddenModels: hidden });
                }}
                onPick={(m, meta) => {
                  const next: ProviderSettings = { ...settings.provider, model: m };
                  if (meta?.ctx) { next.contextWindow = meta.ctx; next.maxTokens = meta.maxOut || meta.ctx; }
                  if (meta?.inPrice !== undefined) next.inputCostPer1M = meta.inPrice;
                  if (meta?.outPrice !== undefined) next.outputCostPer1M = meta.outPrice;
                  const recent = [m, ...settings.recentModels.filter((x) => x !== m)].slice(0, 12);
                  onChange({ ...settings, provider: next, recentModels: recent });
                  setModelInfo(meta?.ctx ? `Set from catalog — context ${meta.ctx.toLocaleString()}, max output ${(meta.maxOut || meta.ctx).toLocaleString()}` : '');
                }}
              />
              <div className="hint">
                {loaded.length ? 'Loaded on the server: ' + loaded.join(', ')
                  : models.length ? models.length + ' models' : 'Click Load to fetch the server model list'}
              </div>
              {modelInfo && <div className="hint" style={{ color: 'var(--accent)' }}>{modelInfo}</div>}
            </div>
            <div className="field">
              <label>API key (optional)</label>
              <input type="password" value={settings.provider.apiKey} onChange={(e) => setProvider('apiKey', e.target.value)} placeholder="not needed for local models" />
            </div>
          </fieldset>

          <fieldset>
            <legend>Limits (nothing hardcoded)</legend>
            <div className="field-grid">
              {NUM_FIELDS.map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input type="number" step={f.step ?? 1} value={String(settings.provider[f.key])} onChange={(e) => setProvider(f.key, e.target.value === '' ? 0 : Number(e.target.value))} />
                  <div className="hint">{f.hint}</div>
                </div>
              ))}
            </div>
            <div className="field-grid">
              <div className="field">
                <label>Max agent iterations</label>
                <input type="number" value={settings.agent.maxIterations} onChange={(e) => onChange({ ...settings, agent: { ...settings.agent, maxIterations: Number(e.target.value) } })} />
                <div className="hint">0 = no limit (default). Runs until the task completes or you press Stop.</div>
              </div>
              <div className="field">
                <label>Max iterations per stage</label>
                <input type="number" value={settings.agent.stageMaxIterations} onChange={(e) => onChange({ ...settings, agent: { ...settings.agent, stageMaxIterations: Number(e.target.value) } })} />
                <div className="hint">0 = no limit (default). Tool cycles allowed inside each autoprompt stage.</div>
              </div>
            </div>
            <label className="stage-toggle" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={settings.agent.autoAcceptChanges} onChange={(e) => onChange({ ...settings, agent: { ...settings.agent, autoAcceptChanges: e.target.checked } })} />
              <span>
                <span className="st-name">Apply agent changes automatically</span>
                <span className="st-blurb">On (default): the agent's edits go straight to disk, no review queue. Off: every change waits for Accept/Reject in the Changes panel.</span>
              </span>
            </label>
          </fieldset>

          <fieldset>
            <legend>Cost estimate</legend>
            <div className="field-grid">
              <div className="field">
                <label>Input price / 1M tokens</label>
                <input type="number" step="0.01" value={String(settings.provider.inputCostPer1M)} onChange={(e) => setProvider('inputCostPer1M', Number(e.target.value))} />
                <div className="hint">Price for prompt tokens.</div>
              </div>
              <div className="field">
                <label>Output price / 1M tokens</label>
                <input type="number" step="0.01" value={String(settings.provider.outputCostPer1M)} onChange={(e) => setProvider('outputCostPer1M', Number(e.target.value))} />
                <div className="hint">Price for completion tokens.</div>
              </div>
              <div className="field">
                <label>Currency symbol</label>
                <input value={settings.provider.currency} onChange={(e) => setProvider('currency', e.target.value)} maxLength={4} />
                <div className="hint">e.g. $, €, £.</div>
              </div>
            </div>
            <div className="hint">Set to 0 for local/free models. Cost shown in the topbar and Plan tab as price × tokens.</div>
          </fieldset>

          <fieldset>
            <legend>Autoprompt pipeline</legend>
            <label className="stage-toggle" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={settings.autoPrompt.enabled} onChange={(e) => onChange({ ...settings, autoPrompt: { ...settings.autoPrompt, enabled: e.target.checked } })} />
              <span>
                <span className="st-name">Run autoprompt pipeline after the main task</span>
                <span className="st-blurb">Runs the stages below in order. Each stage waits for the previous one and sees the files it changed.</span>
              </span>
            </label>
            {STAGE_DEFS.map((s) => (
              <label className="stage-toggle" key={s.id}>
                <input type="checkbox" checked={settings.autoPrompt.stages.includes(s.id)} onChange={() => toggleStage(s.id)} />
                <span>
                  <span className="st-name">{s.label}</span>
                  <span className="st-blurb">{s.blurb}</span>
                </span>
              </label>
            ))}
            <div className="hint" style={{ marginTop: 6 }}>{settings.autoPrompt.stages.length} of {STAGE_DEFS.length} stages selected.</div>
          </fieldset>

          <fieldset>
            <legend>Context tools</legend>
            {CONTEXT_TOOL_DEFS.map((t) => (
              <label className="stage-toggle" key={t.id}>
                <input
                  type="checkbox"
                  checked={!!settings.contextTools[t.id]}
                  onChange={(e) => onChange({ ...settings, contextTools: { ...settings.contextTools, [t.id]: e.target.checked } })}
                />
                <span>
                  <span className="st-name">{t.label}</span>
                  <span className="st-blurb">{t.blurb}</span>
                </span>
              </label>
            ))}
            <div className="field" style={{ marginTop: 8 }}>
              <label>Context7 API key (optional)</label>
              <input type="password" value={settings.contextTools.context7ApiKey} onChange={(e) => onChange({ ...settings, contextTools: { ...settings.contextTools, context7ApiKey: e.target.value } })} placeholder="from context7.com/dashboard — raises rate limits" />
            </div>
          </fieldset>

          <fieldset>
            <legend>Appearance</legend>
            <div className="field">
              <label>Theme</label>
              <select value={settings.theme} onChange={(e) => onChange({ ...settings, theme: e.target.value })}>
                {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          </fieldset>

        </div>
        <div className="drawer-foot">
          <span className="hint" style={{ marginRight: 'auto', alignSelf: 'center' }}>Settings save automatically.</span>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  );
}

function fmtCtx(n?: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return (n % 1_000_000 === 0 ? n / 1_000_000 : (n / 1_000_000).toFixed(1)) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

function ModelPicker(props: {
  value: string;
  models: string[];
  loaded: string[];
  catalog: Record<string, ModelMeta>;
  recent: string[];
  hidden: string[];
  hideVariants: boolean;
  busy: boolean;
  detecting: boolean;
  onType: (v: string) => void;
  onPick: (m: string, meta?: ModelMeta) => void;
  onRefresh: () => void;
  onDetect: () => void;
  onHide: (m: string) => void;
  onToggleVariants: () => void;
}) {
  const { value, models, loaded, catalog, recent, hidden, hideVariants, busy, detecting, onType, onPick, onRefresh, onDetect, onHide, onToggleVariants } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'recent' | 'loaded' | 'all' | 'hidden'>('all');
  const [vendor, setVendor] = useState('any');
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(''); setVendor('any'); setHi(0);
    setScope(recent.length ? 'recent' : loaded.length ? 'loaded' : 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-idx="' + hi + '"]') as HTMLElement | null;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const owners = useMemo(() => {
    const count: Record<string, number> = {};
    for (const m of models) { if (hidden.includes(m)) continue; const o = m.includes('/') ? m.split('/')[0] : '(local)'; count[o] = (count[o] || 0) + 1; }
    return Object.entries(count).sort((a, b) => b[1] - a[1]);
  }, [models, hidden]);

  const q = query.trim().toLowerCase();
  const ownerOf = (m: string) => (m.includes('/') ? m.split('/')[0] : '(local)');
  const filtered = models.filter((m) => {
    if (scope === 'hidden') {
      if (!hidden.includes(m)) return false;
    } else {
      if (hidden.includes(m)) return false;
      if (hideVariants && m.includes('@') && m !== value) return false;
      if (scope === 'recent' && !recent.includes(m)) return false;
      if (scope === 'loaded' && !loaded.includes(m)) return false;
    }
    if (vendor !== 'any' && ownerOf(m) !== vendor) return false;
    if (q && !m.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => {
    const la = loaded.includes(a) ? 0 : 1, lb = loaded.includes(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    const ra = recent.indexOf(a) === -1 ? 999 : recent.indexOf(a);
    const rb = recent.indexOf(b) === -1 ? 999 : recent.indexOf(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  const shown = filtered.slice(0, 300);
  const grouped = scope === 'all' && vendor === 'any' && !q && filtered.length > 24;
  const groups: Array<{ owner: string; ids: string[] }> = [];
  if (grouped) {
    const map = new Map<string, string[]>();
    for (const m of shown) { const o = ownerOf(m); if (!map.has(o)) map.set(o, []); map.get(o)!.push(m); }
    for (const [owner, ids] of map) groups.push({ owner, ids });
  }
  const idxOf = new Map(shown.map((m, i) => [m, i]));

  const pick = (m: string) => { onPick(m, catalog[m]); setOpen(false); };

  const RowView = (m: string, i: number) => {
    const meta = catalog[m];
    const isHidden = hidden.includes(m);
    return (
      <div data-idx={i} className={'model-row' + (i === hi ? ' hi' : '') + (m === value ? ' active' : '')} key={m} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(m); }}>
        <span className="model-id">{m}</span>
        <span className="model-meta">
          {loaded.includes(m) && <span className="badge pass">loaded</span>}
          {meta?.ctx ? <span>{fmtCtx(meta.ctx)} ctx</span> : null}
          <button className="model-hide" title={isHidden ? 'Unhide' : 'Hide this model'} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onHide(m); }}>{isHidden ? 'unhide' : 'hide'}</button>
        </span>
      </div>
    );
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) pick(shown[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className="model-picker" ref={wrapRef}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={value}
          onChange={(e) => { onType(e.target.value); setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="search models..."
        />
        <button className="btn sm" onClick={onRefresh} disabled={busy}>{busy ? '...' : 'Load'}</button>
        <button className="btn sm" onClick={onDetect} disabled={detecting} title="Detect context window and max output from the server">{detecting ? '...' : 'Detect'}</button>
      </div>
      {open && (
        <div className="model-list" ref={listRef}>
          <div className="model-controls">
            <div className="model-scopes">
              <button className={'scope' + (scope === 'recent' ? ' active' : '')} onMouseDown={(e) => { e.preventDefault(); setScope('recent'); setHi(0); }} disabled={!recent.length} title="Recently used">recent</button>
              <button className={'scope' + (scope === 'loaded' ? ' active' : '')} onMouseDown={(e) => { e.preventDefault(); setScope('loaded'); setHi(0); }} disabled={!loaded.length} title="Loaded on the server">loaded</button>
              <button className={'scope' + (scope === 'all' ? ' active' : '')} onMouseDown={(e) => { e.preventDefault(); setScope('all'); setHi(0); }}>all</button>
              <button className={'scope' + (scope === 'hidden' ? ' active' : '')} onMouseDown={(e) => { e.preventDefault(); setScope('hidden'); setHi(0); }} disabled={!hidden.length} title="Hidden models">hidden{hidden.length ? ' ' + hidden.length : ''}</button>
            </div>
            <select value={vendor} onChange={(e) => { setVendor(e.target.value); setHi(0); }} onMouseDown={(e) => e.stopPropagation()} title="Vendor">
              <option value="any">all vendors</option>
              {owners.map(([o, c]) => <option key={o} value={o}>{o} ({c})</option>)}
            </select>
            <span className="model-count">{filtered.length}</span>
          </div>
          <div className="model-options">
            <label className="variant-toggle" onMouseDown={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={hideVariants} onChange={onToggleVariants} /> hide variant checkpoints (@q4, @q8, @bf16…)
            </label>
          </div>
          {!shown.length && <div className="model-row muted">{scope === 'hidden' ? 'No hidden models.' : 'No matching model.'}</div>}
          {grouped
            ? groups.map((g) => (<div key={g.owner}><div className="model-group">{g.owner}<span>{g.ids.length}</span></div>{g.ids.map((m) => RowView(m, idxOf.get(m) ?? 0))}</div>))
            : shown.map((m, i) => RowView(m, i))}
          {filtered.length > shown.length && <div className="model-row muted">{filtered.length - shown.length} more — refine your search</div>}
        </div>
      )}
    </div>
  );
}
```

===== FILE: src/components/PromptsDrawer.tsx =====

```ts
'use client';
import { useEffect, useState } from 'react';

interface PromptFile { name: string; label: string; content: string; source: string; writable: boolean }
interface SkillInfo { name: string; description: string; dir: string }

interface Props {
  workspace: string;
  onClose: () => void;
}

export default function PromptsDrawer({ workspace, onClose }: Props) {
  const [tab, setTab] = useState<'prompts' | 'skills'>('prompts');
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer wide" role="dialog" aria-label="Prompts and skills">
        <div className="drawer-head">
          <span className="title">Prompts &amp; Skills</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={'btn sm' + (tab === 'prompts' ? ' primary' : ' ghost')} onClick={() => setTab('prompts')}>Prompts</button>
            <button className={'btn sm' + (tab === 'skills' ? ' primary' : ' ghost')} onClick={() => setTab('skills')}>Skills</button>
            <button className="btn ghost sm" onClick={onClose}>Close</button>
          </div>
        </div>
        {tab === 'prompts' ? <PromptsTab workspace={workspace} /> : <SkillsTab />}
      </div>
    </>
  );
}

function PromptsTab({ workspace }: { workspace: string }) {
  const [files, setFiles] = useState<PromptFile[]>([]);
  const [sel, setSel] = useState('system');
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<'app' | 'workspace'>('app');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/prompts?workspace=' + encodeURIComponent(workspace || ''));
      const data = await res.json();
      if (data.ok) {
        setFiles(data.files);
        const f = data.files.find((x: PromptFile) => x.name === sel) || data.files[0];
        setSel(f.name);
        setDraft(f.content);
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [workspace]);

  const pick = (name: string) => {
    const f = files.find((x) => x.name === name);
    setSel(name);
    setDraft(f?.content || '');
    setStatus('');
    setScope(name === 'AGENTS.md' || name === 'PROJECT_AGENTS.md' ? 'app' : 'app');
  };

  const save = async () => {
    setStatus('Saving...');
    const isAgents = sel === 'AGENTS.md' || sel === 'PROJECT_AGENTS.md';
    const res = await fetch('/api/prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sel, content: draft, scope: isAgents ? 'app' : scope, workspace }),
    });
    const data = await res.json();
    if (data.ok) { setStatus('Saved ' + (data.file || '')); load(); }
    else setStatus('Error: ' + (data.error || 'save failed'));
  };

  const current = files.find((f) => f.name === sel);
  const isStage = !['AGENTS.md', 'PROJECT_AGENTS.md'].includes(sel);

  return (
    <div className="drawer-body prompts-split">
      <div className="prompt-list">
        {loading && <div className="hint" style={{ padding: 10 }}>Loading...</div>}
        {files.map((f) => (
          <div className={'prompt-item' + (f.name === sel ? ' active' : '')} key={f.name} onClick={() => pick(f.name)} title={f.label}>
            <div>{f.label.split(' — ')[0]}</div>
            <div className="hint">{f.label.split(' — ')[1]} <span className="badge">{f.source}</span></div>
          </div>
        ))}
      </div>
      <div className="prompt-edit">
        <div className="prompt-edit-head">
          <span className="hint">{current?.label}</span>
          <span className="spacer" />
          {isStage && (
            <select value={scope} onChange={(e) => setScope(e.target.value as any)} style={{ width: 170 }} title="Where to save">
              <option value="app">Save to EC11 (all projects)</option>
              <option value="workspace">Save to this workspace (.ec11)</option>
            </select>
          )}
          <button className="btn primary sm" onClick={save}>Save</button>
        </div>
        <textarea className="prompt-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
        <div className="hint" style={{ padding: '6px 4px' }}>
          {status} {isStage && scope === 'app' ? 'Stage prompts override the built-in text; workspace scope wins for this project.' : ''}
        </div>
      </div>
    </div>
  );
}

function SkillsTab() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [sel, setSel] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/skills');
        const data = await res.json();
        setSkills(data.skills || []);
        setRoots(data.roots || []);
      } finally { setLoading(false); }
    })();
  }, []);

  const open = async (name: string) => {
    setSel(name);
    setContent('Loading...');
    const res = await fetch('/api/skills?name=' + encodeURIComponent(name));
    const data = await res.json();
    setContent(data.ok ? data.content : 'Error: ' + (data.error || 'read failed'));
  };

  return (
    <div className="drawer-body prompts-split">
      <div className="prompt-list">
        {loading && <div className="hint" style={{ padding: 10 }}>Loading...</div>}
        {!loading && !skills.length && <div className="hint" style={{ padding: 10 }}>No skills found in {roots.join(', ') || 'the skills folders'}.</div>}
        {skills.map((s) => (
          <div className={'prompt-item' + (s.name === sel ? ' active' : '')} key={s.name} onClick={() => open(s.name)} title={s.dir}>
            <div>{s.name}</div>
            <div className="hint">{s.description}</div>
          </div>
        ))}
      </div>
      <div className="prompt-edit">
        <div className="prompt-edit-head">
          <span className="hint">{sel ? sel + '/SKILL.md' : 'Pick a skill to read its SKILL.md'}</span>
          <span className="spacer" />
          <span className="hint">read-only — edit on disk</span>
        </div>
        <textarea className="prompt-textarea" value={content} readOnly spellCheck={false} placeholder="Select a skill on the left." />
      </div>
    </div>
  );
}
```

===== FILE: src/components/WorkspacePicker.tsx =====

```ts
'use client';
import { useEffect, useState } from 'react';

interface Props {
  current: string;
  onPick: (path: string) => void;
  onClose: () => void;
}

export default function WorkspacePicker({ current, onPick, onClose }: Props) {
  const [folderPath, setFolderPath] = useState(current || 'E:\\aiprojects');
  const [folder, setFolder] = useState<{ path: string; parent: string | null; dirs: string[]; drives: string[]; error?: string } | null>(null);
  const [newFolder, setNewFolder] = useState('');

  const loadFolder = async (p: string) => {
    try {
      const res = await fetch('/api/fs?path=' + encodeURIComponent(p));
      const data = await res.json();
      setFolder(data);
      setFolderPath(data.path || p);
    } catch {
      setFolder({ path: p, parent: null, dirs: [], drives: [], error: 'Could not read folder.' });
    }
  };

  useEffect(() => { loadFolder(current || 'E:\\aiprojects'); /* eslint-disable-next-line */ }, []);

  const create = async () => {
    const res = await fetch('/api/fs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent: folderPath, name: newFolder }) });
    const data = await res.json();
    if (data.ok) { setNewFolder(''); loadFolder(data.path); }
  };

  const [browsing, setBrowsing] = useState(false);
  const browseNative = async () => {
    setBrowsing(true);
    try {
      const res = await fetch('/api/fs/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initial: folder?.path || folderPath }) });
      const data = await res.json();
      if (data.ok && data.path) { loadFolder(data.path); onPick(data.path); onClose(); }
    } finally { setBrowsing(false); }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer workspace" role="dialog" aria-label="Choose workspace">
        <div className="drawer-head">
          <span className="title">Choose working folder</span>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body" style={{ gap: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Current workspace</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadFolder(folderPath); }} />
              <button className="btn sm" onClick={browseNative} disabled={browsing} style={{ whiteSpace: 'nowrap' }}>{browsing ? '...' : 'Browse (Windows)'}</button>
            </div>
            <div className="hint">Type a path and press Enter, click a folder below, or use the native Windows picker.</div>
          </div>
          <div className="folder-browser" style={{ maxHeight: 340 }}>
            <div className="folder-path">{folder?.path || folderPath}{folder?.error ? '  - ' + folder.error : ''}</div>
            {folder?.parent && <div className="folder-row" onClick={() => loadFolder(folder.parent!)}>.. (up)</div>}
            {folder?.drives?.map((d) => <div className="folder-row" key={d} onClick={() => loadFolder(d)}>{d}</div>)}
            {folder?.dirs?.map((d) => <div className="folder-row" key={d} onClick={() => loadFolder((folder.path + '\\' + d).replace(/\\\\/g, '\\'))}>[DIR] {d}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="new folder name" />
            <button className="btn sm" onClick={create} disabled={!newFolder.trim()}>Create</button>
          </div>
        </div>
        <div className="drawer-foot">
          <span className="hint" style={{ marginRight: 'auto', alignSelf: 'center' }}>{folderPath}</span>
          <button className="btn primary" onClick={() => { onPick(folderPath || (folder?.path ?? '')); onClose(); }}>Use this folder</button>
        </div>
      </div>
    </>
  );
}
```

===== FILE: src/components/CommandPalette.tsx =====

```ts
'use client';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export interface Command { id: string; label: string; sub?: string; run: () => void }

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

export default function CommandPalette({ open, onClose, commands }: Props) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => (c.label + ' ' + (c.sub || '')).toLowerCase().includes(s));
  }, [q, commands]);

  useEffect(() => { setSel(0); }, [q]);

  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = filtered[sel]; if (c) { c.run(); onClose(); } }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Type a command..." />
        <div className="palette-list">
          {!filtered.length && <div className="palette-item">No matching command.</div>}
          {filtered.map((c, i) => (
            <div key={c.id} className={'palette-item' + (i === sel ? ' sel' : '')} onMouseEnter={() => setSel(i)} onClick={() => { c.run(); onClose(); }}>
              <span>{c.label}</span>
              {c.sub && <span className="sub">{c.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

