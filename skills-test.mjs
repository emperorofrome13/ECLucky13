const PORT = '3620';
const DIR = 'E:\\aiprojects\\coders\\ec\\ec11\\workspace-test';
const MODEL = process.argv[2] || 'qwen3.5-4b-claude-4.6-opus-reasoning-distilled-v2';
const body = {
  messages: [{ role: 'user', content: "First call the list_skills tool. Then call read_skill for the skill named 'human-ui' and report the first 3 lines of its SKILL.md. Then call attempt_completion." }],
  workingDirectory: DIR,
  provider: { baseUrl: 'http://127.0.0.1:1234/v1', model: MODEL, maxTokens: 3000, temperature: 0.2, contextWindow: 16384, connectTimeoutMs: 30000, completionTimeoutMs: 600000, retries: 1 },
  agent: { maxIterations: 10, stageMaxIterations: 4 },
  autoPrompt: { enabled: false, stages: [] },
  contextTools: { rtk: false, ponytail: true, context7: false, codegraph: false, search: false, skills: true, context7ApiKey: '' },
};
const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
const tools = []; let listOut = '', readOut = ''; const errs = [];
while (true) {
  const { done, value } = await reader.read(); if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop() || '';
  for (const l of lines) {
    if (!l.startsWith('data: ')) continue;
    let ev; try { ev = JSON.parse(l.slice(6)); } catch { continue; }
    if (ev.type === 'tool_call') tools.push(ev.toolCall.name);
    if (ev.type === 'tool_result' && ev.toolCall.name === 'list_skills') listOut = String(ev.toolCall.result).slice(0, 200);
    if (ev.type === 'tool_result' && ev.toolCall.name === 'read_skill') readOut = String(ev.toolCall.result).slice(0, 260);
    if (ev.type === 'error') errs.push(String(ev.error).slice(0, 160));
  }
}
console.log('tool_calls=', JSON.stringify(tools));
console.log('list_skills_output=', JSON.stringify(listOut));
console.log('read_skill_output=', JSON.stringify(readOut));
console.log('errors=', JSON.stringify(errs));
