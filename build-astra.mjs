import fs from 'fs';
import path from 'path';
const root = process.cwd();
const files = [
  'package.json', 'next.config.js', 'tsconfig.json', 'AGENTS.md', 'quickstart.bat', 'start-3620.bat',
  'autoprompts/README.md', 'autoprompts/system.md', 'autoprompts/review.md', 'autoprompts/completeness.md', 'autoprompts/senior_review.md', 'autoprompts/run_fix.md',
  'src/app/layout.tsx', 'src/app/page.tsx', 'src/app/globals.css',
  'src/app/api/chat/route.ts', 'src/app/api/models/route.ts', 'src/app/api/model-info/route.ts',
  'src/app/api/files/route.ts', 'src/app/api/fs/route.ts', 'src/app/api/fs/pick/route.ts', 'src/app/api/exec/route.ts',
  'src/app/api/prompts/route.ts', 'src/app/api/skills/route.ts',
  'src/lib/agent.ts', 'src/lib/provider.ts', 'src/lib/tools.ts', 'src/lib/stages.ts', 'src/lib/verify.ts',
  'src/lib/prompts.ts', 'src/lib/contexttools.ts', 'src/lib/localserver.ts', 'src/lib/diff.ts', 'src/lib/settings.ts',
  'src/components/CoderApp.tsx', 'src/components/AgentPanel.tsx', 'src/components/ChatLog.tsx', 'src/components/AutoPromptPanel.tsx',
  'src/components/ChangesPanel.tsx', 'src/components/EditorPane.tsx', 'src/components/FileExplorer.tsx', 'src/components/TerminalPanel.tsx',
  'src/components/SettingsPanel.tsx', 'src/components/PromptsDrawer.tsx', 'src/components/WorkspacePicker.tsx', 'src/components/CommandPalette.tsx',
];
const lang = (p) => p.endsWith('.tsx') || p.endsWith('.ts') ? 'ts' : p.endsWith('.css') ? 'css' : p.endsWith('.json') ? 'json' : p.endsWith('.bat') ? 'bat' : p.endsWith('.md') ? 'md' : 'text';
let out = '\n## 7. Full source\n\nEvery file below is complete and is exactly what runs.\n\n';
for (const f of files) {
  const abs = path.join(root, f);
  if (!fs.existsSync(abs)) { out += `===== FILE: ${f} (MISSING) =====\n\n`; continue; }
  const content = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  out += `===== FILE: ${f} =====\n\n\`\`\`${lang(f)}\n${content}\n\`\`\`\n\n`;
}
fs.appendFileSync(path.join(root, 'EC11_FULL_SOURCE.md'), out);
console.log('appended', files.length, 'files; total bytes', fs.statSync(path.join(root, 'EC11_FULL_SOURCE.md')).size);
