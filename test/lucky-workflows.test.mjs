import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import JSZip from 'jszip';

fs.mkdirSync('test-output', { recursive: true });
const root = fs.mkdtempSync(path.resolve('test-output/lucky-workflows-'));
process.env.EC12_DATA_DIR = path.join(root, 'data');

const cm = await import('../src/server/agent/context-manager.ts');
const loop = await import('../src/server/agent/loop.ts');
const mgr = await import('../src/server/runs/manager.ts');
const att = await import('../src/server/attachments.ts');

const done = { type: 'done', finishReason: 'stop' };
const tool = (name, args, id = 'call', index = 0) => ({ type: 'tool_delta', index, id, name, argsDelta: JSON.stringify(args) });
const toolCallEv = (id, name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] });
const contentEv = (text) => ({ choices: [{ delta: { content: text } }] });
const sse = (events) => 'data: ' + events.map((e) => JSON.stringify(e)).join('\n\ndata: ') + '\n\ndata: [DONE]\n\n';

function sseServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'fixture-model', max_context_length: 32000 }] }));
        return;
      }
      res.setHeader('Content-Type', 'text/event-stream');
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { parsed = { messages: [{ content: '' }] }; }
        handler(parsed, res);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function fake(scripts) {
  return { requests: [], async *stream(messages, opts) {
    this.requests.push({ messages: structuredClone(messages), opts });
    for (const e of scripts.shift() || []) yield e;
    yield done;
  } };
}

function pdfFixture(pages = ['PDF first page', 'PDF final page'], imageOnly = false) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const text of pages) {
    const stream = imageOnly ? 'q 20 0 0 20 10 10 cm BI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx ID FF0000> EI Q' : `BT /F1 12 Tf 20 100 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function docxFixture(paragraphs = ['DOCX first paragraph', 'DOCX final paragraph']) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const body = paragraphs.map(text => `<w:p><w:r><w:t xml:space="preserve">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('attachments: image bytes stay binary, malformed PDF/DOCX rejected explicitly, run message carries image and text paths', async () => {
  const { storeAttachments, getAttachment, attachmentBytes, attachmentMessage, resolveAttachments } = att;
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]);
  const stored = await storeAttachments([new File([png], 'fixture.png', { type: 'image/png' })], 'ws1');
  assert.equal(stored[0].mime, 'image/png');
  assert.ok(Buffer.compare(attachmentBytes(stored[0].id), png) === 0, 'image bytes stored binary');
  await assert.rejects(storeAttachments([new File([Buffer.from('%PDF-1.7 fake')], 'doc.pdf')], 'ws1'), /doc\.pdf: PDF extraction failed: malformed/);
  await assert.rejects(storeAttachments([new File([Buffer.from('PK\x03\x04 zip')], 'doc.docx')], 'ws1'), /doc\.docx: DOCX extraction failed: malformed/);
  const text = await storeAttachments([new File([Buffer.from('UTF8 text fixture')], 'notes.txt')], 'ws1');
  assert.equal(text[0].mime, 'text/plain');
  const message = attachmentMessage('Use these', [stored[0].id, text[0].id], 'ws1');
  assert.match(message.content, /<attachment-content>\nUTF8 text fixture\n<\/attachment-content>/);
  assert.equal(message.images.length, 1);
  assert.ok(message.images[0].url.startsWith('data:image/png;base64,'));
  assert.equal(message.attachmentIds.length, 2);
  assert.throws(() => resolveAttachments([stored[0].id], 'ws2'), /not found in this workspace/);
  assert.equal(getAttachment(stored[0].id).url, `/api/attachments/${stored[0].id}`);
});

test('attachments: real PDF and DOCX extract every page/paragraph and reach the provider as inline text', async () => {
  const pdf = pdfFixture();
  const docx = await docxFixture(['DOCX first paragraph café & <text>', 'DOCX final paragraph']);
  const records = await att.storeAttachments([new File([pdf], 'real.PDF'), new File([docx], 'real.DOCX')], 'ws-docs');
  assert.equal(records[0].mime, 'application/pdf');
  assert.equal(records[1].mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(records[0].text, /PDF first page\s+PDF final page/);
  assert.equal(records[1].text, 'DOCX first paragraph café & <text>\n\nDOCX final paragraph\n\n');
  records.forEach((record, i) => {
    assert.deepEqual(att.attachmentBytes(record.id), [pdf, docx][i]);
    assert.equal(record.size, [pdf, docx][i].length);
    assert.equal(att.getAttachment(record.id).text, record.text);
  });
  const detected = await att.storeAttachments([new File([pdf], 'by-magic.bin'), new File([docx], 'by-mime.bin', { type: records[1].mime })], 'ws-docs');
  assert.deepEqual(detected.map(record => record.text), records.map(record => record.text));
  const message = att.attachmentMessage('Read both documents', records.map(record => record.id), 'ws-docs');
  assert.deepEqual(message.images, []);
  let captured;
  const { server, port } = await sseServer((body, res) => { captured = body; res.end(sse([contentEv('Documents received')])); });
  try {
    const { OpenAICompatProvider } = await import('../src/server/providers/openai-compatible.ts');
    const provider = new OpenAICompatProvider({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: '', model: 'fixture-model', maxTokens: 0, temperature: 0, connectTimeoutMs: 0, firstTokenTimeoutMs: 0, streamIdleTimeoutMs: 0, requestTimeoutMs: 0, retries: 0 });
    const events = [];
    for await (const event of provider.stream([message], { maxTokens: 0 })) events.push(event);
    assert.ok(events.some(event => event.type === 'content' && event.text === 'Documents received'));
    assert.ok(!events.some(event => event.type === 'error'));
    assert.equal(captured.messages[0].content, message.content);
    for (const record of records) assert.ok(captured.messages[0].content.includes(`<attachment-content>\n${record.text}\n</attachment-content>`));
    assert.deepEqual(Object.keys(captured.messages[0]).sort(), ['content', 'role']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('attachments: empty/scanned documents reject with OCR notice and legacy DOC stays unsupported', async () => {
  for (const file of [
    new File([pdfFixture([''])], 'empty.pdf'),
    new File([pdfFixture([''], true)], 'scanned.pdf'),
    new File([await docxFixture([])], 'empty.docx'),
    new File([await docxFixture(['   '])], 'whitespace.docx'),
  ]) await assert.rejects(att.storeAttachments([file], 'ws-empty'), /no extractable text.*OCR is unsupported/);
  for (const file of [new File(['legacy'], 'legacy.doc'), new File(['legacy'], 'legacy.bin', { type: 'application/msword' })]) {
    await assert.rejects(att.storeAttachments([file], 'ws-empty'), /legacy \.doc documents are unsupported/);
  }
});

test('attachments: extracted text limits reject whole uploads without truncation and zero remains unlimited', async () => {
  const original = att.attachmentSettings();
  const text = 'Full document contents '.repeat(100) + 'FINAL_SENTINEL';
  const files = [new File([pdfFixture([...Array(100).fill('Full document contents'), 'FINAL_SENTINEL'])], 'large.pdf'), new File([await docxFixture([text])], 'large.docx')];
  const attachmentDir = path.join(process.env.EC12_DATA_DIR, 'attachments');
  try {
    att.saveAttachmentSettings({ maxTextChars: 10 });
    const before = fs.readdirSync(attachmentDir).sort();
    for (const file of files) {
      await assert.rejects(att.storeAttachments([new File(['valid'], 'valid.txt'), file], 'ws-limits'), /extracted text exceeds maxTextChars/);
      assert.deepEqual(fs.readdirSync(attachmentDir).sort(), before, 'failed batches must not persist any attachment');
    }
    att.saveAttachmentSettings({ maxTextChars: 0 });
    for (const file of files) {
      const [record] = await att.storeAttachments([file], 'ws-limits');
      assert.equal(record.text.replace(/\s+/g, ' ').trim(), text);
      att.saveAttachmentSettings({ maxTextChars: record.text.length });
      assert.equal((await att.storeAttachments([file], 'ws-limits'))[0].text, record.text);
      att.saveAttachmentSettings({ maxTextChars: record.text.length - 1 });
      await assert.rejects(att.storeAttachments([file], 'ws-limits'), /extracted text exceeds maxTextChars/);
      att.saveAttachmentSettings({ maxTextChars: 0 });
    }
    att.saveAttachmentSettings({ maxFileBytes: 1 });
    await assert.rejects(att.storeAttachments(files, 'ws-limits'), /maxFileBytes/);
    att.saveAttachmentSettings({ maxFileBytes: 0, maxTotalBytes: 1 });
    await assert.rejects(att.storeAttachments(files, 'ws-limits'), /maxTotalBytes/);
    att.saveAttachmentSettings({ maxTotalBytes: 0, maxFiles: 1 });
    await assert.rejects(att.storeAttachments(files, 'ws-limits'), /At most 1/);
  } finally { att.saveAttachmentSettings(original); }
});

test('attachment settings PATCH persists limits; zero means unlimited and invalid values are rejected', () => {
  const { saveAttachmentSettings, attachmentSettings } = att;
  saveAttachmentSettings({ maxFileBytes: 0 });
  assert.equal(att.attachmentSettings().maxFileBytes, 0);
  assert.throws(() => saveAttachmentSettings({ maxFileBytes: -1 }), /nonnegative integers/);
  assert.throws(() => saveAttachmentSettings({ unknown: 5 }), /nonnegative integers/);
  saveAttachmentSettings({ maxFileBytes: 20 * 1024 * 1024 });
  assert.equal(att.attachmentSettings().maxFileBytes, 20 * 1024 * 1024);
});

test('queued run manager: run executes, same-session double task rejected, queued cancel works, cross-workspace parallel', async () => {
  const concurrency = { current: 0, max: 0 };
  const { server, port } = await sseServer(async (parsed, res) => {
    const isStage = /report_verdict/.test(JSON.stringify(parsed.tools || []));
    concurrency.current++; concurrency.max = Math.max(concurrency.max, concurrency.current);
    await new Promise((r) => setTimeout(r, 300));
    if (isStage) res.end(sse([toolCallEv('s1', 'report_verdict', { verdict: 'PASS', summary: 'ok' })]));
    else res.end(sse([contentEv('Lucky done')]));
    concurrency.current--;
  });
  const waitFor = async (fn, ms = 15000) => { for (let i = 0; i < ms / 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); assert.ok(fn(), 'condition not reached in time'); };
  try {
    const serverUrl = `http://127.0.0.1:${port}/v1`;
    const makeWorkspace = (name) => {
      const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
      return dir;
    };
    const wsA = makeWorkspace('wsA');
    const wsB = makeWorkspace('wsB');
    const settings = (baseUrl) => ({
      provider: { preset: 'custom', baseUrl, apiKey: '', model: 'fixture-model', modelSelection: 'pinned', maxTokens: 512, temperature: 0, contextWindow: 32000, autoModelLimits: false, reasoningReplay: 'auto' },
      agent: { maxIterations: 4, stageMaxIterations: 4, stageRepairAttempts: 0, repeatedFailureLimit: 3 },
      autoPrompt: { enabled: false, stages: ['review'] },
      contextTools: { rtk: false, ponytail: false, context7: false, codegraph: false, search: false, skills: false },
      workspace: { id: 'ws', path: wsA }, mode: 'ask', theme: 'neon',
    });
    const input = (sessionId, wsDir, workspaceId, clientRequestId) => ({
      clientRequestId, sessionId, workspaceId, workspacePath: wsDir, mode: 'ask',
      task: 'task for ' + clientRequestId, attachmentIds: [], settings: settings(serverUrl),
    });
    const sessionA = mgr.getOrCreateSession({ workspaceId: 'wsA', workspacePath: wsA });
    const sessionB = mgr.getOrCreateSession({ workspaceId: 'wsB', workspacePath: wsB });
    const sessionB2 = mgr.getOrCreateSession({ workspaceId: 'wsB', workspacePath: wsB });
    const a1 = mgr.runs.create(input(sessionA.id, wsA, 'wsA', 'lucky-a1'));
    assert.ok(a1.ok);
    const b1 = mgr.runs.create(input(sessionB.id, wsB, 'wsB', 'lucky-b1'));
    assert.ok(b1.ok, 'different workspace starts in parallel');
    await waitFor(() => ['preparing', 'generating'].includes(mgr.runs.get(a1.record.id).state));
    await waitFor(() => ['preparing', 'generating'].includes(mgr.runs.get(b1.record.id).state));
    const dup = mgr.runs.create(input(sessionA.id, wsA, 'wsA', 'lucky-dup'));
    assert.equal(dup.ok, false, 'second active task on the same session is rejected');
    assert.match(dup.error, /already has an active or queued task/);
    const b2 = mgr.runs.create(input(sessionB2.id, wsB, 'wsB', 'lucky-b2'));
    assert.ok(b2.ok, 'same workspace, different session is accepted');
    assert.equal(mgr.runs.get(b2.record.id).state, 'queued', 'same workspace serializes via queue');
    assert.equal(mgr.runs.cancel(b2.record.id).ok, true, 'queued task can be cancelled');
    assert.equal(mgr.runs.get(b2.record.id).state, 'cancelled');
    await waitFor(() => mgr.runs.get(a1.record.id).state === 'succeeded');
    await waitFor(() => mgr.runs.get(b1.record.id).state === 'succeeded');
    assert.ok(concurrency.max >= 2, 'two workspaces ran concurrently (max concurrent requests ' + concurrency.max + ')');
    assert.equal(mgr.runs.get(a1.record.id).finalText, 'Lucky done');
  } finally { server.close(); }
});

test('branch API preserves pre-run conversation and attachment context of an earlier run', async () => {
  const { server, port } = await sseServer((parsed, res) => {
    const isStage = /report_verdict/.test(JSON.stringify(parsed.tools || []));
    if (isStage) res.end(sse([toolCallEv('s1', 'report_verdict', { verdict: 'PASS', summary: 'ok' })]));
    else res.end(sse([contentEv('branch done')]));
  });
  const waitFor = async (fn, ms = 15000) => { for (let i = 0; i < ms / 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); assert.ok(fn(), 'condition not reached in time'); };
  try {
    const serverUrl = `http://127.0.0.1:${port}/v1`;
    const ws = path.join(root, 'branch-ws'); fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'seed.txt'), 'seed');
    const settings = (attachmentIds) => ({
      provider: { preset: 'custom', baseUrl: serverUrl, apiKey: '', model: 'fixture-model', modelSelection: 'pinned', maxTokens: 512, temperature: 0, contextWindow: 32000, autoModelLimits: false, reasoningReplay: 'auto' },
      agent: { maxIterations: 4, stageMaxIterations: 4, stageRepairAttempts: 0, repeatedFailureLimit: 3 },
      autoPrompt: { enabled: false, stages: ['review'] },
      contextTools: { rtk: false, ponytail: false, context7: false, codegraph: false, search: false, skills: false },
      workspace: { id: 'branch', path: ws }, mode: 'ask', theme: 'neon',
    });
    const session = mgr.getOrCreateSession({ workspaceId: 'branch', workspacePath: ws });
    const first = mgr.runs.create({ clientRequestId: 'branch-1', sessionId: session.id, workspaceId: 'branch', workspacePath: ws, mode: 'ask', task: 'earlier task', attachmentIds: [], settings: settings([]) });
    assert.ok(first.ok);
    await waitFor(() => mgr.runs.get(first.record.id).state === 'succeeded');
    const afterFirst = structuredClone(mgr.loadSession(session.id).conversation);
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 9, 9, 9, 9]);
    const uploaded = await att.storeAttachments([new File([png], 'snap.png', { type: 'image/png' })], 'branch');
    const second = mgr.runs.create({ clientRequestId: 'branch-2', sessionId: session.id, workspaceId: 'branch', workspacePath: ws, mode: 'ask', task: 'second task', attachmentIds: [uploaded[0].id], settings: settings([uploaded[0].id]) });
    assert.ok(second.ok);
    await waitFor(() => mgr.runs.get(second.record.id).state === 'succeeded');
    const afterSecond = mgr.loadSession(session.id).conversation;
    assert.ok(afterSecond.messages.length > afterFirst.messages.length, 'second run appended to the original session');

    const branchAtSecond = mgr.branchSession(session.id, { runId: second.record.id });
    assert.equal(branchAtSecond.ok, true);
    assert.deepEqual(mgr.loadSession(branchAtSecond.sessionId).conversation.messages, afterFirst.messages, 'branch at run2 keeps exactly the pre-run2 context (run1 included, run2 excluded)');
    assert.deepEqual(branchAtSecond.attachmentIds, [uploaded[0].id], 'branch returns the run attachment ids');
    assert.equal(branchAtSecond.task, 'second task', 'returned task is the branched run task');

    const branchAtFirst = mgr.branchSession(session.id, { runId: first.record.id, task: 'fresh retry prompt' });
    assert.equal(branchAtFirst.ok, true);
    assert.deepEqual(mgr.loadSession(branchAtFirst.sessionId).conversation.messages, [], 'branch at run1 starts from the pre-run1 context');
    assert.equal(branchAtFirst.task, 'fresh retry prompt', 'explicit task overrides the original');
  } finally { server.close(); }
});

test('stage repair re-reads fresh changed code and verification between attempts', async () => {
  const events = [];
  const requests = [];
  const provider = { async *stream(messages, opts) {
    requests.push(structuredClone(messages[0]));
    const attempt = requests.length;
    if (attempt === 1) {
      yield tool('write_file', { path: 'stage-refresh.cjs', content: 'module.exports = 13;\n' }, 'w1', 0);
      yield tool('report_verdict', { verdict: 'FAIL', summary: 'file content not confirmed yet' }, 'v1', 1);
    } else {
      yield tool('report_verdict', { verdict: 'PASS', summary: 'verified' });
    }
    yield done;
  } };
  const ws = path.join(root, 'verify-ws'); fs.mkdirSync(ws, { recursive: true });
  const refreshes = [];
  const afterAttempts = [];
  const outcome = await loop.runStageWithRepair('review', {
    provider, signal: new AbortController().signal, contextWindow: 32000, requestedMaxTokens: 1000,
    maxIterations: 4, repeatedFailureLimit: 3, noProgressTurnLimit: 3,
    contextTools: {}, journalEnv: { workspacePath: ws, runId: 'stage-refresh', sessionId: 'stage-refresh', reviewMode: false },
    systemBlocks: ['Fixture instructions'], stagePrompt: 'Review the fixture',
    refreshContext: async () => {
      const file = path.join(ws, 'stage-refresh.cjs');
      const code = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '(not written yet)';
      const context = `Current changed code:\nstage-refresh.cjs:\n${code}`;
      refreshes.push(context);
      return context;
    },
    afterAttempt: async () => { events.push('verified-after-attempt'); },
    emit: (type, data) => events.push({ type, data }),
  }, 1);
  assert.equal(outcome.passed, true, 'second attempt passes after repair');
  assert.equal(outcome.attempts, 2);
  assert.equal(refreshes.length, 2, 'context refreshed before every attempt');
  assert.match(refreshes[0], /not written yet/, 'first attempt sees the pre-attempt state');
  assert.match(refreshes[1], /module\.exports = 13;/, 'second attempt reads the code the first attempt actually wrote');
  assert.equal(events.filter((e) => e === 'verified-after-attempt').length, 2, 'verification hook ran after each attempt');
  const sent = requests[1].content || '';
  assert.ok(sent.includes('stage-refresh.cjs') && sent.includes('module.exports = 13'), 'repair attempt received the fresh changed code. Manager actually sent:\n' + sent.slice(0, 600));
  assert.ok(sent.includes('Previous attempt FAILED'), 'repair attempt carries the failure summary. Manager actually sent:\n' + sent.slice(0, 600));
});

test('production stream() assembles two overlapping tool_deltas (different indices) into both complete calls', async () => {
  const { server, port } = await sseServer((parsed, res) => {
    res.end(sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a1', function: { name: 'write_file', arguments: '{"path":"two-' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'b1', function: { name: 'write_file', arguments: '{"path":"two-' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'idx.txt","content":"first"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: 'idx.txt","content":"second"}' } }] } }] },
    ]));
  });
  try {
    const { OpenAICompatProvider, assembleToolCalls } = await import('../src/server/providers/openai-compatible.ts');
    const provider = new OpenAICompatProvider({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'fixture-model', apiKey: '', maxTokens: 1000, temperature: 0, connectTimeoutMs: 0, firstTokenTimeoutMs: 0, streamIdleTimeoutMs: 0, requestTimeoutMs: 0, retries: 0 });
    const deltas = [];
    for await (const ev of provider.stream([{ role: 'user', content: 'go' }], { maxTokens: 1000 })) {
      if (ev.type === 'tool_delta') deltas.push(ev);
      if (ev.type === 'error') assert.fail('stream error: ' + ev.message);
    }
    const { calls, invalid } = assembleToolCalls(deltas);
    assert.equal(calls.length, 2, 'both indexed calls assembled, got: ' + JSON.stringify(calls));
    const byId = new Map(calls.map((c) => [c.id, c]));
    assert.deepEqual(JSON.parse(byId.get('a1').argsRaw), { path: 'two-idx.txt', content: 'first' });
    assert.deepEqual(JSON.parse(byId.get('b1').argsRaw), { path: 'two-idx.txt', content: 'second' });
    assert.equal(byId.get('a1').name, 'write_file');
    assert.equal(byId.get('b1').name, 'write_file');
  } finally { server.close(); }
});

test('main-loop ProgressGuard fires recoveries on a duplicate-success loop (never stops it)', async () => {
  const c = cm.newConversation();
  fs.writeFileSync(path.join(root, 'dup.txt'), 'same content every read');
  const provider = fake(Array.from({ length: 10 }, () => [tool('read_file', { path: 'dup.txt' })]));
  const outcome = await loop.runMainLoop({
    provider, signal: new AbortController().signal, contextWindow: 32000, requestedMaxTokens: 1000,
    maxIterations: 6, repeatedFailureLimit: 3, noProgressTurnLimit: 0, duplicateObservationLimit: 2,
    // Default (unlimited recoveries): the guard fires, the run continues, the budget ends it.
    autoCompact: true, autoCompactAtPercent: 80, keepRecentTurns: 4,
    contextTools: {}, journalEnv: { workspacePath: root, runId: 'lucky', sessionId: 'lucky', reviewMode: false },
    systemBlocks: ['Fixture instructions'], task: 'read the file', conversation: c, emit: () => {},
  });
  assert.equal(outcome.blocked, false, 'a stall must never stop the run');
  assert.equal(outcome.exhausted, true, 'the iteration budget ends it');
  assert.ok(c.messages.some((m) => m.role === 'user' && String(m.content).includes('going in circles')), 'guard fired a recovery note');
  assert.ok(outcome.turns <= 6, 'budget honored instead of looping forever');
});

test('queued run continues automatically on the same workspace after the active run finishes', async () => {
  const { server, port } = await sseServer((parsed, res) => {
    const isStage = /report_verdict/.test(JSON.stringify(parsed.tools || []));
    if (isStage) res.end(sse([toolCallEv('s1', 'report_verdict', { verdict: 'PASS', summary: 'ok' })]));
    else res.end(sse([contentEv('Queued continuation done')]));
  });
  const waitFor = async (fn, ms = 15000) => { for (let i = 0; i < ms / 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); assert.ok(fn(), 'condition not reached in time'); };
  try {
    const serverUrl = `http://127.0.0.1:${port}/v1`;
    const wsDir = path.join(root, 'wsC'); fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'file.txt'), 'x');
    const settings = {
      provider: { preset: 'custom', baseUrl: serverUrl, apiKey: '', model: 'fixture-model', modelSelection: 'pinned', maxTokens: 512, temperature: 0, contextWindow: 32000, autoModelLimits: false, reasoningReplay: 'auto' },
      agent: { maxIterations: 4, stageMaxIterations: 4, stageRepairAttempts: 0, repeatedFailureLimit: 3 },
      autoPrompt: { enabled: false, stages: ['review'] },
      contextTools: { rtk: false, ponytail: false, context7: false, codegraph: false, search: false, skills: false },
      workspace: { id: 'wsC', path: wsDir }, mode: 'ask', theme: 'neon',
    };
    const input = (sessionId, clientRequestId) => ({ clientRequestId, sessionId, workspaceId: 'wsC', workspacePath: wsDir, mode: 'ask', task: 'task ' + clientRequestId, attachmentIds: [], settings });
    const s1 = mgr.getOrCreateSession({ workspaceId: 'wsC', workspacePath: wsDir });
    const s2 = mgr.getOrCreateSession({ workspaceId: 'wsC', workspacePath: wsDir });
    const first = mgr.runs.create(input(s1.id, 'qc-1'));
    assert.ok(first.ok);
    await waitFor(() => ['preparing', 'generating'].includes(mgr.runs.get(first.record.id).state));
    const second = mgr.runs.create(input(s2.id, 'qc-2'));
    assert.ok(second.ok);
    assert.equal(mgr.runs.get(second.record.id).state, 'queued');
    await waitFor(() => mgr.runs.get(first.record.id).state === 'succeeded');
    await waitFor(() => mgr.runs.get(second.record.id).state !== 'queued', 5000);
    await waitFor(() => ['succeeded', 'failed'].includes(mgr.runs.get(second.record.id).state));
    assert.equal(mgr.runs.get(second.record.id).state, 'succeeded');
    assert.equal(mgr.runs.get(second.record.id).finalText, 'Queued continuation done');
  } finally { server.close(); }
});

test('HTTP routes: attachment upload/serve/settings and branch endpoints honor the documented contracts', async () => {
  process.env.EC12_DATA_DIR = path.join(root, 'http-data');
  const wsDir = path.join(root, 'http-ws'); fs.mkdirSync(wsDir, { recursive: true });
  const { registerWorkspace } = await import('../src/server/workspace/path-policy.ts');
  const ws = registerWorkspace(wsDir);
  const { POST: upload, GET: attachmentSettings, PATCH: patchSettings } = await import('../src/app/api/attachments/route.ts');
  const { GET: serveAttachment } = await import('../src/app/api/attachments/[id]/route.ts');
  const { POST: branchRoute } = await import('../src/app/api/sessions/[id]/branch/route.ts');
  const req = (path, init = {}) => new Request('http://127.0.0.1:1' + path, { ...init, headers: { host: '127.0.0.1:1', ...(init.headers || {}) } });
  const form = new FormData();
  form.append('workspaceId', ws.id);
  form.append('files', new File([Buffer.from('http text attachment')], 'http.txt'));
  const uploadRes = await upload(req('/api/attachments', { method: 'POST', body: form }));
  assert.equal(uploadRes.status, 200);
  const uploaded = (await uploadRes.json()).attachments[0];
  assert.deepEqual(Object.keys(uploaded).sort(), ['id', 'mime', 'name', 'size', 'url'], 'response shape matches the stable contract');
  const serveRes = await serveAttachment(req(`/api/attachments/${uploaded.id}`), { params: { id: uploaded.id } });
  assert.equal(serveRes.status, 200);
  assert.equal((await serveRes.arrayBuffer()).byteLength, 'http text attachment'.length);
  for (const [name, bytes, mime] of [
    ['download.pdf', pdfFixture(), 'application/pdf'],
    ['download.docx', await docxFixture(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ]) {
    const documents = new FormData();
    documents.append('workspaceId', ws.id);
    documents.append('files', new File([bytes], name));
    const response = await upload(req('/api/attachments', { method: 'POST', body: documents }));
    assert.equal(response.status, 200);
    const record = (await response.json()).attachments[0];
    assert.equal(record.mime, mime);
    assert.equal(record.text, undefined);
    const download = await serveAttachment(req(record.url), { params: { id: record.id } });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), mime);
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  }
  const malformed = new FormData();
  malformed.append('workspaceId', ws.id);
  malformed.append('files', new File(['not a document'], 'broken.pdf'));
  const malformedResponse = await upload(req('/api/attachments', { method: 'POST', body: malformed }));
  assert.equal(malformedResponse.status, 400);
  assert.match((await malformedResponse.json()).error, /broken\.pdf: PDF extraction failed: malformed/);
  const settingsRes = await attachmentSettings(req('/api/attachments'));
  assert.equal(settingsRes.status, 200);
  const settingsBody = await settingsRes.json();
  assert.ok(settingsBody.supported.includes('application/pdf'));
  assert.ok(settingsBody.supported.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  assert.deepEqual(settingsBody.unsupported, ['application/msword']);
  assert.deepEqual(Object.keys(settingsBody.settings).sort(), ['maxFileBytes', 'maxFiles', 'maxTextChars', 'maxTotalBytes'], 'settings payload exposes every limit');
  const patched = await patchSettings(req('/api/attachments', { method: 'PATCH', body: JSON.stringify({ maxFileBytes: 2048 }) }));
  assert.equal((await patched.json()).settings.maxFileBytes, 2048);
  const limited = await upload(req('/api/attachments', { method: 'POST', body: (() => { const f = new FormData(); f.append('workspaceId', ws.id); f.append('files', new File([Buffer.alloc(4096).fill(65)], 'big.txt')); return f; })() }));
  assert.equal(limited.status, 400);
  assert.match((await limited.json()).error, /maxFileBytes/);
  const wrongWs = await upload(req('/api/attachments', { method: 'POST', body: (() => { const f = new FormData(); f.append('workspaceId', 'ws_missing'); f.append('files', new File([Buffer.from('x')], 'x.txt')); return f; })() }));
  assert.equal(wrongWs.status, 400);
  assert.match((await wrongWs.json()).error, /Register a workspace/);
  await patchSettings(req('/api/attachments', { method: 'PATCH', body: JSON.stringify({ maxFileBytes: 20 * 1024 * 1024 }) }));
  const branchRes = await branchRoute(req('/api/sessions/x/branch', { method: 'POST', body: JSON.stringify({ runId: 'missing' }) }), { params: { id: 'x' } });
  assert.equal(branchRes.status, 400);
  assert.match((await branchRes.json()).error, /Session or run not found/);
});

