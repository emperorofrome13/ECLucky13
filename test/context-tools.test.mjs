import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.EC12_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-context-data-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-context-ws-'));
const registry = await import('../src/server/tools/registry.ts');
const prompts = await import('../src/server/prompt-files.ts');

const env = { workspacePath: workspace, runId: 'test', sessionId: 'test', reviewMode: false };
const off = { rtk: false, ponytail: false, context7: false, codegraph: false, search: false, skills: false, context7ApiKey: '' };

test('disabled context tools are absent from the provider schema', () => {
  const names = registry.toolsForRun('code', off).map((tool) => tool.name);
  for (const name of ['web_search', 'ponytail_instructions', 'context7_docs', 'codegraph_explore', 'list_skills', 'read_skill']) assert.equal(names.includes(name), false);
  assert.equal(names.includes('read_file'), true);
  assert.equal(names.includes('report_verdict'), false);
});

test('each context switch exposes only its matching executable tools', () => {
  assert.deepEqual(registry.toolsForRun('ask', { ...off, search: true }).filter((x) => x.name === 'web_search').map((x) => x.name), ['web_search']);
  assert.deepEqual(registry.toolsForRun('ask', { ...off, ponytail: true }).filter((x) => x.name === 'ponytail_instructions').map((x) => x.name), ['ponytail_instructions']);
  assert.deepEqual(registry.toolsForRun('ask', { ...off, codegraph: true }).filter((x) => x.name === 'codegraph_explore').map((x) => x.name), ['codegraph_explore']);
  assert.deepEqual(registry.toolsForRun('ask', { ...off, skills: true }).filter((x) => x.name.includes('skill')).map((x) => x.name), ['list_skills', 'read_skill']);
  assert.equal(registry.toolsForRun('code', off, true).some((x) => x.name === 'report_verdict'), true);
});

const ponytail = await import('../src/server/ponytail-mcp.ts');

test('Ponytail calls the installed official MCP server', { skip: ponytail.ponytailMcpInstalled() ? false : 'Ponytail MCP is not installed (npm run install:mcp)' }, async () => {
  const result = await registry.executeTool({ env, mode: 'ask', contextTools: { ...off, ponytail: true } }, 'ponytail_instructions', { mode: 'full' });
  assert.equal(result.result.ok, true);
  assert.match(result.result.output, /Ponytail MCP \(full\)/);
});

test('an uninstalled MCP reports an actionable error instead of a silent failure', async () => {
  // Whether or not the server is present, the failure path must name the fix.
  const status = ponytail.ponytailMcpStatus();
  if (status.ok) { assert.match(status.output, /installed/i); return; }
  assert.match(status.error, /install:mcp/);
});

test('execution rejects a disabled optional tool even if called directly', async () => {
  const result = await registry.executeTool({ env, mode: 'ask', contextTools: off }, 'codegraph_explore', { query: 'Where is the app entry point?' });
  assert.equal(result.result.ok, false);
  assert.match(result.result.error, /disabled/i);
});

test('CodeGraph switch exposes the official explore tool', () => {
  const tool = registry.toolsForRun('ask', { ...off, codegraph: true }).find((x) => x.name === 'codegraph_explore');
  assert.ok(tool);
  assert.match(tool.description, /official CodeGraph semantic index/i);
});

test('global Skills discovery reads a skill from every configured root', () => {
  // Previously this asserted that the machine running the suite happened to have ~/.codex/skills
  // populated, so it failed on any clean checkout. It now provisions its own root and checks the
  // discovery logic; the standard home-directory roots are asserted separately below.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-skills-'));
  fs.mkdirSync(path.join(root, 'demo-skill'), { recursive: true });
  fs.writeFileSync(path.join(root, 'demo-skill', 'SKILL.md'), '# SKILL: demo-skill\n\nDescription: a test skill used by the suite.\n');
  const previous = process.env.EC12_SKILLS_DIR;
  process.env.EC12_SKILLS_DIR = root;
  try {
    assert.ok(prompts.skillsRoots().includes(root), 'a configured root must be discovered');
    const skills = prompts.listSkills();
    const demo = skills.find((s) => s.name === 'demo-skill');
    assert.ok(demo, 'skills under a configured root must be listed');
    const read = prompts.readSkill('demo-skill');
    assert.equal(read.ok, true);
    assert.match(read.content, /a test skill/);
  } finally {
    if (previous === undefined) delete process.env.EC12_SKILLS_DIR; else process.env.EC12_SKILLS_DIR = previous;
  }
});

test('the standard home-directory skill roots are searched', () => {
  const home = os.homedir().toLowerCase();
  const expected = ['.agents', '.codex', '.claude'];
  const previous = process.env.EC12_SKILLS_DIR;
  delete process.env.EC12_SKILLS_DIR;
  try {
    // Only roots that exist are returned, so assert the search space rather than the machine's
    // contents: every discovered root must be one of the documented locations.
    for (const root of prompts.skillsRoots()) {
      assert.ok(root.toLowerCase().startsWith(home), `unexpected skills root: ${root}`);
      assert.ok(expected.some((e) => root.includes(e)), `unexpected skills root: ${root}`);
    }
  } finally {
    if (previous !== undefined) process.env.EC12_SKILLS_DIR = previous;
  }
});
