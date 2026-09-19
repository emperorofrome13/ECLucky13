// Discover project-appropriate checks from manifests. Zero applicable checks means UNVERIFIED.
import fs from 'node:fs';
import path from 'node:path';

export interface DiscoveredCheck {
  checkId: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  required: boolean;
  kind: 'typecheck' | 'test' | 'build' | 'lint' | 'boot' | 'browser' | 'python';
}

function readJson(p: string): any | null { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
const exists = (p: string) => { try { return fs.existsSync(p); } catch { return false; } };

function pm(workspace: string): 'npm' | 'pnpm' | 'yarn' {
  if (exists(path.join(workspace, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(workspace, 'yarn.lock'))) return 'yarn';
  return 'npm';
}
const pmBin = (p: string) => (process.platform === 'win32' ? p + '.cmd' : p);

export function discoverChecks(workspace: string): DiscoveredCheck[] {
  const checks: DiscoveredCheck[] = [];
  const pkgPath = path.join(workspace, 'package.json');
  const pkg = readJson(pkgPath);

  if (pkg) {
    const scripts = pkg.scripts || {};
    const manager = pmBin(pm(workspace));
    const hasTs = exists(path.join(workspace, 'tsconfig.json'));
    if (scripts.typecheck) checks.push({ checkId: 'typecheck', name: 'npm run typecheck', command: manager, args: ['run', 'typecheck'], cwd: workspace, required: true, kind: 'typecheck' });
    else if (hasTs) checks.push({ checkId: 'typecheck', name: 'tsc --noEmit', command: manager, args: ['exec', '--', 'tsc', '--noEmit'], cwd: workspace, required: true, kind: 'typecheck' });
    if (scripts.test && !/no test specified/i.test(String(scripts.test))) checks.push({ checkId: 'test', name: 'npm test', command: manager, args: ['test', '--silent'], cwd: workspace, required: true, kind: 'test' });
    if (scripts.lint) checks.push({ checkId: 'lint', name: 'npm run lint', command: manager, args: ['run', 'lint'], cwd: workspace, required: true, kind: 'lint' });
    if (scripts.build) checks.push({ checkId: 'build', name: 'npm run build', command: manager, args: ['run', 'build'], cwd: workspace, required: true, kind: 'build' });
    if (scripts.start) checks.push({ checkId: 'boot', name: 'boot (npm start)', command: manager, args: ['start'], cwd: workspace, required: true, kind: 'boot' });
    else if (scripts.dev) checks.push({ checkId: 'boot', name: 'boot (npm run dev)', command: manager, args: ['run', 'dev'], cwd: workspace, required: true, kind: 'boot' });
  }

  const htmlFiles = exists(workspace) ? fs.readdirSync(workspace).filter((f) => f.endsWith('.html')) : [];
  if (htmlFiles.length) checks.push({ checkId: 'browser', name: 'browser smoke test', command: '', args: [], cwd: workspace, required: false, kind: 'browser' });

  if (exists(path.join(workspace, 'pytest.ini')) || exists(path.join(workspace, 'pyproject.toml')) || exists(path.join(workspace, 'requirements.txt'))) {
    if (exists(path.join(workspace, 'tests')) || exists(path.join(workspace, 'test'))) checks.push({ checkId: 'pytest', name: 'pytest', command: 'python', args: ['-m', 'pytest', '-q'], cwd: workspace, required: false, kind: 'python' });
  }

  return checks;
}

