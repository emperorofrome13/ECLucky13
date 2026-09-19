import { checkRequest, forbidden } from '@/server/security/auth';
import { getOrCreateSession, saveSession } from '@/server/runs/manager';
import type { SessionRecord } from '@/server/runs/manager';
import { validPersistentId } from '@/server/store';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One-time, repeatable import from EC11 browser storage. EC11's old key is never deleted.
// Only transcript text is reconstructed; tool pairs and diffs are NOT fabricated.
export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const ecSettings = body.settings && typeof body.settings === 'object' ? body.settings : {};
  const ecSessions = Array.isArray(body.sessions) ? body.sessions : [];

  const p = ecSettings.provider || {};
  const applied: Record<string, unknown> = {
    provider: {
      preset: typeof p.preset === 'string' ? p.preset : 'lmstudio',
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : 'http://127.0.0.1:1234/v1',
      model: typeof p.model === 'string' ? p.model : '',
      maxTokens: typeof p.maxTokens === 'number' ? p.maxTokens : 65536,
      temperature: typeof p.temperature === 'number' ? p.temperature : 0.7,
      contextWindow: typeof p.contextWindow === 'number' ? p.contextWindow : 65536,
    },
    theme: typeof ecSettings.theme === 'string' ? ecSettings.theme : 'neon',
    recentModels: Array.isArray(ecSettings.recentModels) ? ecSettings.recentModels.slice(0, 20) : [],
    hiddenModels: Array.isArray(ecSettings.hiddenModels) ? ecSettings.hiddenModels : [],
    hideVariants: !!ecSettings.hideVariants,
    // apiKey is deliberately NOT imported; store it server-side via /api/credentials.
  };

  const imported: Array<{ id: string; title: string; events: number; note: string }> = [];
  for (const s of ecSessions.slice(0, 50)) {
    if (!s || typeof s !== 'object') continue;
    const sourceId = String(s.id || createHash('sha256').update(JSON.stringify(s)).digest('hex'));
    const sid = 'ec11_' + (validPersistentId(sourceId) ? sourceId : createHash('sha256').update(sourceId).digest('hex'));
    const wsPath = typeof ecSettings.workingDirectory === 'string' ? ecSettings.workingDirectory : '';
    const rec: SessionRecord = getOrCreateSession({ id: sid, workspaceId: 'imported', workspacePath: wsPath, title: String(s.title || 'imported').slice(0, 60) });
    if (rec.conversation.messages.length > 0) {
      imported.push({ id: rec.id, title: rec.title, events: 0, note: 'already imported; skipped to avoid duplicates' });
      continue;
    }
    const events = Array.isArray(s.events) ? s.events : [];
    let kept = 0;
    for (const e of events.slice(0, 200)) {
      if (!e || (e.kind !== 'user' && e.kind !== 'assistant')) continue; // transcript text only
      rec.conversation.messages.push({ role: e.kind, content: String(e.content || '').slice(0, 20000) });
      kept++;
    }
    saveSession(rec);
    imported.push({ id: rec.id, title: rec.title, events: kept, note: 'transcript text only; tool history and diffs not reconstructed' });
  }

  return Response.json({ ok: true, applied, importedSessions: imported.length, imported });
}
