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

export const STAGE_COMPLETION_PROTOCOL = 'Stage completion protocol: finish by calling report_verdict with verdict PASS or FAIL and a concise summary. Plain-text verdicts and attempt_completion do not complete a stage. Report missing requirements as FAIL rather than asking interactive questions.';

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
  return workspace ? path.join(workspace, '.ec12', 'autoprompts') : null;
}

/** Legacy EC11 override dir, still honored as a fallback. */
function legacyWorkspaceAutopromptDir(workspace?: string): string | null {
  return workspace ? path.join(workspace, '.ec11', 'autoprompts') : null;
}

function readSafe(file: string): string | null {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

export function promptSource(name: string, workspace?: string): 'workspace' | 'app' | 'builtin' {
  const wsDir = workspaceAutopromptDir(workspace);
  if (wsDir && fs.existsSync(path.join(wsDir, name + '.md'))) return 'workspace';
  const legacy = legacyWorkspaceAutopromptDir(workspace);
  if (legacy && fs.existsSync(path.join(legacy, name + '.md'))) return 'workspace';
  if (fs.existsSync(path.join(appAutopromptDir(), name + '.md'))) return 'app';
  return 'builtin';
}

export function readPrompt(name: string, workspace?: string): string {
  const wsDir = workspaceAutopromptDir(workspace);
  if (wsDir) {
    const c = readSafe(path.join(wsDir, name + '.md'));
    if (c !== null) return c;
  }
  const legacy = legacyWorkspaceAutopromptDir(workspace);
  if (legacy) {
    const c = readSafe(path.join(legacy, name + '.md'));
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

/** Global skill roots. `EC12_SKILLS_DIR` (path-separator delimited) prepends custom roots, so a
 * skills library can live outside the home directory and so this is testable without depending on
 * whatever happens to be installed on the machine running the suite. */
export function skillsRoots(): string[] {
  const home = os.homedir();
  const configured = (process.env.EC12_SKILLS_DIR || '').split(path.delimiter).map((r) => r.trim()).filter(Boolean);
  const roots = [...configured, path.join(home, '.agents', 'skills'), path.join(home, '.codex', 'skills'), path.join(home, '.claude', 'skills')];
  return roots.filter((r) => { try { return fs.statSync(r).isDirectory(); } catch { return false; } });
}

export function listSkills(): SkillInfo[] {
  const out: SkillInfo[] = [];
  const seen = new Set<string>();
  for (const root of skillsRoots()) {
    const visit = (parent: string, depth: number) => {
      let dirs: fs.Dirent[];
      try { dirs = fs.readdirSync(parent, { withFileTypes: true }); } catch { return; }
      for (const d of dirs) {
        if (!d.isDirectory() || d.isSymbolicLink()) continue;
        const dir = path.join(parent, d.name);
      const skillFile = path.join(dir, 'SKILL.md');
        if (!fs.existsSync(skillFile)) {
          if (depth < 2) visit(dir, depth + 1); // includes ~/.codex/skills/.system/*
          continue;
        }
        try {
          const relative = path.relative(fs.realpathSync(root), fs.realpathSync(skillFile));
          if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;
        } catch { continue; }
        const content = readSafe(skillFile) || '';
        const fmName = content.match(/^---[\s\S]*?\bname:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
        const fmDesc = content.match(/^---[\s\S]*?\bdescription:\s*([\s\S]*?)(?:\n[a-zA-Z_]+:|\n---)/m)?.[1]?.trim().replace(/\s+/g, ' ').replace(/^["']|["']$/g, '');
        const desc = fmDesc || content.split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---'))?.trim() || '';
        const name = fmName || d.name;
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        out.push({ name, description: desc.slice(0, 400), dir, root, skillFile });
      }
    };
    visit(root, 0);
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
  const requested = file || 'SKILL.md';
  if (path.isAbsolute(requested) || /^[a-zA-Z]:/.test(requested) || requested.includes(':') || requested.includes('\0')) return { ok: false, error: 'A relative skill file path is required.' };
  let target: string;
  try {
    const root = fs.realpathSync(s.root);
    const dir = fs.realpathSync(s.dir);
    const inside = (base: string, value: string) => {
      const rel = path.relative(base, value);
      return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
    };
    target = fs.realpathSync(path.resolve(dir, requested));
    if (!inside(root, dir) || !inside(dir, target)) return { ok: false, error: 'Path escapes the skill directory.' };
  } catch { return { ok: false, error: `File not found in skill "${name}": ${file}` }; }
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
