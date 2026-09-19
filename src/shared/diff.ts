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
