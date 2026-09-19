import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const base = process.env.BASE_URL || 'http://127.0.0.1:3313';
const root = fs.mkdtempSync(path.resolve('test-output', 'lucky-approval-'));
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'approval-fixture', scripts: { test: 'node --check result.cjs' } }));
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'approval-fixture-model' }] }));
  let body = '';
  for await (const chunk of req) body += chunk;
  const parsed = JSON.parse(body);
  const stage = parsed.tools?.some((tool) => tool.function.name === 'report_verdict');
  const called = parsed.messages.some((message) => message.role === 'tool');
  const name = !called ? 'write_file' : stage ? 'report_verdict' : 'attempt_completion';
  const args = !called ? { path: 'result.cjs', content: stage ? 'module.exports = 14;\n' : 'module.exports = 13;\n' } : stage ? { verdict: 'PASS', summary: 'Stage fixture updated the result.' } : { summary: 'Main fixture wrote the result.' };
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const post = async (endpoint, body) => {
  const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok && data.ok, JSON.stringify(data));
  return data;
};
let runId;
let browser;
let page;
try {
  const workspace = (await post('/api/workspaces', { path: root })).workspace;
  const settings = { provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'approval-fixture-model', modelSelection: 'pinned', autoModelLimits: false, contextWindow: 16000, maxTokens: 1000 }, agent: { reviewBeforeApply: true, autoAcceptChanges: false, maxIterations: 8, stageMaxIterations: 8, stageRepairAttempts: 0 }, autoPrompt: { enabled: true, stages: ['review'] }, contextTools: { ponytail: false, codegraph: false, skills: false, search: false, rtk: false, context7: false } };
  const created = await post('/api/runs', { clientRequestId: crypto.randomUUID(), sessionId: 'approval_' + Date.now(), workspaceId: workspace.id, mode: 'code', task: 'Create and review result.cjs.', settings });
  runId = created.runId;
  if (process.env.BROWSER_APPROVAL === '1') {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    page.on('pageerror', (error) => console.log('PAGE_ERROR', error.message));
    page.on('response', async (response) => { if (response.url().includes('/approve') || response.url().includes('/resume') || response.status() >= 400) console.log('HTTP', response.status(), response.url(), await response.text().catch(() => '')); });
    await page.addInitScript(({ settings, workspace, sessionId }) => {
      localStorage.setItem('eclucky13.settings.v1', JSON.stringify({ ...settings, workspace }));
      localStorage.setItem('eclucky13.session', sessionId);
    }, { settings, workspace, sessionId: created.sessionId });
    await page.goto(base);
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  }
  let approvals = 0;
  let record;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    record = (await fetch(base + '/api/runs/' + runId).then((r) => r.json())).run;
    if (record.state === 'waiting_for_approval') {
      const expectedBefore = approvals === 0 ? null : 'module.exports = 13;\n';
      assert.equal(fs.existsSync(path.join(root, 'result.cjs')) ? fs.readFileSync(path.join(root, 'result.cjs'), 'utf8') : null, expectedBefore);
      const events = fs.readFileSync(path.resolve('data', 'runs', runId + '.events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      const ids = events.filter((event) => event.type === 'change.pending').map((event) => event.data.changeId);
      if (page) {
        const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/runs/' + runId + '/resume') && response.request().method() === 'POST').catch(async (error) => { console.log('PAGE_STATE', await page.locator('body').innerText()); await page.screenshot({ path: path.join(root, 'approval-failure.png') }); return null; });
        await page.getByRole('button', { name: 'Approve all & verify', exact: true }).click();
        const response = await responsePromise;
        assert.equal(response.status(), 200);
        assert.equal((await response.json()).ok, true);
        console.log('BROWSER_APPROVAL_CLICK_PASS', approvals + 1);
      } else {
        for (const id of [...new Set(ids)]) {
          const change = await fetch(base + '/api/changes/' + id).then((r) => r.json());
          if (change.change?.status === 'pending') await post('/api/changes/' + id + '/approve', {});
        }
        await post('/api/runs/' + runId + '/resume', { settings });
      }
      approvals++;
    }
    if (['succeeded', 'failed', 'blocked', 'cancelled', 'unverified'].includes(record.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(record.state, 'succeeded', JSON.stringify(record));
  assert.equal(approvals, 2, 'Both main and stage writes require approval');
  assert.equal(fs.readFileSync(path.join(root, 'result.cjs'), 'utf8'), 'module.exports = 14;\n');
  assert.equal(record.summary.stages[0].passed, true);
  fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ approvals, run: record }, null, 2));
  console.log('APPROVAL_API_PASS', JSON.stringify({ runId, approvals, outcome: record.state, stage: record.summary.stages[0] }));
} finally {
  if (runId) await fetch(base + '/api/runs/' + runId + '/cancel', { method: 'POST' }).catch(() => {});
  await browser?.close();
  server.closeAllConnections();
  server.close();
}
