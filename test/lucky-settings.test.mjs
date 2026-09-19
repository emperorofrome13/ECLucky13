import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings-schema.ts';

test('partial context tool settings preserve flags and receive every limit default', () => {
  const limits = { mcpTimeoutMs: 60000, codegraphTimeoutMs: 120000, toolOutputMaxChars: 12000, readFileMaxChars: 24000, shellOutputMaxChars: 8000, searchOutputMaxChars: 16000, webTimeoutMs: 15000, context7TimeoutMs: 30000 };
  const normalized = normalizeSettings({ contextTools: { codegraph: true, ponytail: false } });
  assert.equal(normalized.contextTools.codegraph, true);
  assert.equal(normalized.contextTools.ponytail, false);
  for (const [key, value] of Object.entries(limits)) {
    assert.equal(normalized.contextTools[key], value, key);
    assert.equal(DEFAULT_SETTINGS.contextTools[key], value, key);
    assert.equal(normalizeSettings({ contextTools: { [key]: 0 } }).contextTools[key], 0, key);
  }
});
