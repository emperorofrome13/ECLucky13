import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

process.env.EC12_DATA_DIR = fs.mkdtempSync(path.join(path.resolve('test-output'), 'lucky-output-'));
const workspace = path.join(process.env.EC12_DATA_DIR, 'workspace');
fs.mkdirSync(workspace);
const { executeTool } = await import('../src/server/tools/registry.ts');
const { startShell, fullShellOutput } = await import('../src/server/tools/managed-shell.ts');
const env = { workspacePath: workspace, runId: 'run_output', sessionId: 'ses_output', reviewMode: false };
const ctx = { env, mode: 'code', contextTools: { toolOutputMaxChars: 100 }, toolCallId: 'call_output' };

test('full tool result survives the configured preview cap and authenticated download', async () => {
  const raw = 'BEGIN' + 'x'.repeat(300000) + 'END';
  const execution = await executeTool(ctx, 'todo', { steps: [raw] });
  assert.ok(execution.result.output.length < raw.length);
  assert.ok(execution.artifact?.artifactId, 'tool output must be archived before capping');
  const { GET } = await import('../src/app/api/runs/[id]/artifacts/[artifactId]/route.ts');
  const response = await GET(new Request('http://localhost:3313' + execution.artifact.downloadUrl, { headers: { host: 'localhost:3313' } }), { params: { id: env.runId, artifactId: execution.artifact.artifactId } });
  assert.equal(response.status, 200);
  const records = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(records.find((r) => r.type === 'result').data.output, 'TODO:\n' + raw);
});

test('shell read_full returns complete stdout/stderr from disk and works after a restart', async () => {
  const unique = 'tail-' + Date.now();
  const start = await executeTool(ctx, 'shell_command', { command: `Write-Output ('head-' + ('x' * 250000)); Start-Sleep -Seconds 2; Write-Output '${unique}'`, yield_ms: 500 });
  const processId = start.result.output.match(/Process ID: (proc_[a-f0-9-]+)/)?.[1];
  assert.ok(processId, start.result.output);
  let exit;
  for (let i = 0; i < 60 && exit === undefined; i++) {
    const poll = await executeTool(ctx, 'shell_process', { process_id: processId, action: 'wait', wait_ms: 1000 });
    if (poll.result.exitCode !== undefined && poll.result.exitCode !== null) exit = poll.result.exitCode;
  }
  assert.notEqual(exit, undefined, 'shell_process wait must observe process exit');
  const full = fullShellOutput(env, processId);
  assert.equal(full.ok, true, String(full.error));
  assert.ok(full.output.includes('head-'), 'early output beyond the ring/preview must be retained');
  assert.ok(full.output.includes(unique), 'read_full must return the complete output, not the capped preview');
  const { GET } = await import('../src/app/api/runs/[id]/artifacts/[artifactId]/route.ts');
  const processArtifact = start.artifact.processArtifact || start.artifact;
  const response = await GET(new Request('http://localhost:3313' + processArtifact.downloadUrl, { headers: { host: 'localhost:3313' } }), { params: { id: env.runId, artifactId: processArtifact.artifactId } });
  assert.equal(response.status, 200);
  const records = (await response.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(records.some((r) => r.type === 'stdout' && String(r.data).includes(unique)), 'complete stdout must be downloadable via the artifact API');
  const { validPersistentId } = await import('../src/server/store.ts');
  const jobsFile = path.join(process.env.EC12_DATA_DIR, 'shell-jobs', processId + '.json');
  assert.equal(validPersistentId(processId), true);
  assert.ok(fs.existsSync(jobsFile), 'shell job metadata must persist for post-restart read_full');
  const saved = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const after = await GET(new Request('http://localhost:3313' + saved.artifact.downloadUrl, { headers: { host: 'localhost:3313' } }), { params: { id: env.runId, artifactId: saved.artifact.artifactId } });
  assert.equal(after.status, 200);
  const restarted = fullShellOutput(env, processId);
  assert.equal(restarted.ok, true, String(restarted.error));
  assert.ok(restarted.output.includes(unique), 'read_full must reconstruct output from the artifact after restart');
});
