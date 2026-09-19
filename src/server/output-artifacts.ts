import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { dataDir, assertPersistentId, readJson, writeJsonAtomic } from './store';

export interface OutputArtifact { artifactId: string; runId: string; toolCallId: string; downloadUrl: string }
interface ArtifactMeta extends OutputArtifact { sessionId: string; name: string; createdAt: string }
interface Capture { artifact: OutputArtifact; append: (type: string, data: unknown) => void; secrets: string[] }
const captures = new AsyncLocalStorage<Capture>();

export function knownOutputSecrets(extra: string[] = []): string[] {
  const credentials = readJson<{ creds: Record<string, { apiKey: string }> }>(dataDir('credentials.json'), { creds: {} });
  const servers = readJson<Array<{ env?: Record<string, string>; headers?: Record<string, string> }>>(dataDir('custom-mcp.json'), []);
  const tools = readJson<{ context7ApiKey?: string }>(dataDir('context-tools.json'), {});
  const values = [...extra, ...Object.values(credentials.creds).map((c) => c.apiKey), ...servers.flatMap((s) => [...Object.values(s.env || {}), ...Object.values(s.headers || {})]), tools.context7ApiKey || '', ...Object.entries(process.env).filter(([key]) => /(?:TOKEN|SECRET|PASSWORD|API_KEY|APIKEY)/i.test(key)).map(([, value]) => value || '')];
  return [...new Set(values.filter(Boolean).flatMap((s) => [s, JSON.stringify(s).slice(1, -1), encodeURIComponent(s)]))].sort((a, b) => b.length - a.length);
}

export function redactOutput(text: string, secrets = knownOutputSecrets()): string {
  for (const value of secrets) text = text.split(value).join('[redacted]');
  return text;
}

export function redactOutputValue(value: unknown, secrets = knownOutputSecrets()): any {
  if (typeof value === 'string') return redactOutput(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactOutputValue(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [redactOutput(k, secrets), redactOutputValue(v, secrets)]));
  return value;
}

export function artifactFile(runId: string, artifactId: string): string {
  assertPersistentId(runId); assertPersistentId(artifactId);
  return dataDir('output-artifacts', runId, artifactId + '.jsonl');
}

export function getOutputArtifact(runId: string, artifactId: string): ArtifactMeta | undefined {
  artifactFile(runId, artifactId);
  const meta = readJson<ArtifactMeta | undefined>(dataDir('output-artifacts', runId, artifactId + '.json'), undefined);
  if (!meta || meta.runId !== runId || meta.artifactId !== artifactId) return undefined;
  return meta;
}

export function createOutputCapture(env: { runId: string; sessionId: string }, toolCallId: string, name: string, extraSecrets: string[] = []): Capture {
  assertPersistentId(env.sessionId);
  const secrets = knownOutputSecrets(extraSecrets);
  const artifactId = 'out_' + randomUUID();
  const artifact = { artifactId, runId: env.runId, toolCallId: redactOutput(toolCallId, secrets), downloadUrl: `/api/runs/${env.runId}/artifacts/${artifactId}` };
  const file = artifactFile(env.runId, artifactId);
  fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  writeJsonAtomic(dataDir('output-artifacts', env.runId, artifactId + '.json'), { ...artifact, sessionId: env.sessionId, name: redactOutput(name, secrets), createdAt: new Date().toISOString() });
  return { artifact, secrets, append(type, data) { fs.appendFileSync(artifactFile(env.runId, artifactId), JSON.stringify({ type, data: redactOutputValue(data, secrets) }) + '\n', 'utf8'); } };
}

export function currentOutputCapture() { return captures.getStore(); }
export function withOutputCapture<T>(capture: Capture, work: () => T): T { return captures.run(capture, work); }
export function captureOutput(type: string, data: unknown) { captures.getStore()?.append(type, data); }

export function outputStream(type: string, capture = currentOutputCapture()) {
  const secrets = capture?.secrets || knownOutputSecrets();
  let pending = '';
  const publish = (final: boolean) => {
    let end = pending.length;
    if (!final) for (const secret of secrets) {
      for (let n = Math.min(secret.length - 1, pending.length); n > 0; n--) {
        if (pending.endsWith(secret.slice(0, n))) { end = Math.min(end, pending.length - n); break; }
      }
    }
    for (const secret of secrets) {
      let at = pending.indexOf(secret);
      while (at >= 0 && at < end) { if (at + secret.length > end) end = at; at = pending.indexOf(secret, at + 1); }
    }
    const text = redactOutput(pending.slice(0, end), secrets);
    pending = pending.slice(end);
    if (text) capture?.append(type, text);
    return text;
  };
  return { push(text: string) { pending += text; return publish(false); }, end() { return publish(true); } };
}

export function readArchivedProcessOutput(artifact: OutputArtifact): string {
  return fs.readFileSync(artifactFile(artifact.runId, artifact.artifactId), 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    const record = JSON.parse(line);
    return ['stdout', 'stderr'].includes(record.type) ? [record.data] : [];
  }).join('');
}
