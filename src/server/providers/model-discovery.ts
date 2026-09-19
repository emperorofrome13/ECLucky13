// Model discovery: separate cached catalog metadata, fresh loaded-model state, and effective model.
// Provider adapters are chosen by parsed hostname (not substring matching the whole URL), and
// native LM Studio/Ollama probes are only made for local adapters.
import { createHash } from 'node:crypto';

export type ProviderKind = 'lmstudio' | 'ollama' | 'openrouter' | 'openai-compatible' | 'invalid';

export interface ModelMeta { ctx?: number; maxOut?: number; inPrice?: number; outPrice?: number; desc?: string }
export interface Catalog { models: string[]; catalog: Record<string, ModelMeta>; source: ProviderKind; fetchedAt: number }

export function providerKind(baseUrl: string): ProviderKind {
  let u: URL;
  try { u = new URL(baseUrl); } catch { return 'invalid'; }
  const host = u.hostname.toLowerCase();
  const local = isLocal(baseUrl);
  if (/openrouter\.ai$/i.test(host)) return 'openrouter';
  if (local) {
    if (u.port === '1234') return 'lmstudio';
    if (u.port === '11434') return 'ollama';
    return 'openai-compatible';
  }
  return 'openai-compatible';
}

export const isLocal = (baseUrl: string): boolean => {
  try { const h = new URL(baseUrl).hostname.toLowerCase(); return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' || h === '[::1]' || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h); } catch { return false; }
};

const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined; };
const keyOf = (url: string, apiKey: string) => url.replace(/\/$/, '') + '|' + createHash('sha1').update(apiKey || 'anonymous').digest('hex').slice(0, 12);

async function getJson(url: string, apiKey: string, timeoutMs = 10000): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const catalogCache = new Map<string, Catalog>();
const TTL = 5 * 60 * 1000;

/** Cached catalog metadata (context/output/pricing). */
export async function getCatalog(baseUrl: string, apiKey: string): Promise<Catalog> {
  const key = keyOf(baseUrl, apiKey);
  const hit = catalogCache.get(key);
  // Local /models often describes the currently served model, not a static catalog.
  if (hit && !isLocal(baseUrl) && Date.now() - hit.fetchedAt < TTL) return hit;

  const kind = providerKind(baseUrl);
  const root = baseUrl.replace(/\/$/, '');
  const models: string[] = [];
  const catalog: Record<string, ModelMeta> = {};

  const list = await getJson(`${root}/models`, apiKey);
  const arr = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : [];
  for (const e of arr) {
    const id = typeof e === 'string' ? e : e?.id;
    if (!id) continue;
    models.push(id);
    if (e && typeof e === 'object') {
      const ctx = num(e.context_length) || num(e.max_model_len) || num(e.max_context_length) || num(e.max_position_embeddings);
      const maxOut = num(e.top_provider?.max_completion_tokens) || num(e.max_completion_tokens) || num(e.max_output_tokens);
      const inPrice = e.pricing?.prompt !== undefined ? Number(e.pricing.prompt) * 1_000_000 : undefined;
      const outPrice = e.pricing?.completion !== undefined ? Number(e.pricing.completion) * 1_000_000 : undefined;
      catalog[id] = { ctx, maxOut, inPrice: Number.isFinite(inPrice) ? inPrice : undefined, outPrice: Number.isFinite(outPrice) ? outPrice : undefined, desc: e.name };
    }
  }

  if (kind === 'lmstudio' || kind === 'openai-compatible') {
    const origin = (() => { try { return new URL(baseUrl).origin; } catch { return ''; } })();
    const native = origin ? await getJson(`${origin}/api/v0/models`, apiKey) : null;
    if (Array.isArray(native?.data)) {
      for (const m of native.data) {
        if (!m?.id) continue;
        const id = String(m.id);
        if (!models.includes(id)) models.push(id);
        const ctx = num(m.loaded_context_length) || num(m.max_context_length) || num(m.context_length);
        const meta = catalog[id] || {};
        if (ctx && !meta.ctx) meta.ctx = ctx;
        catalog[id] = meta;
      }
    }
  }

  const out: Catalog = { models, catalog, source: kind, fetchedAt: Date.now() };
  catalogCache.set(key, out);
  return out;
}

/** Fresh loaded-model state (never cached). "loading" does NOT count as ready. */
export async function getLoadedModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const kind = providerKind(baseUrl);
  if (!isLocal(baseUrl)) return [];
  let origin = ''; try { origin = new URL(baseUrl).origin; } catch { return []; }
  const loaded: string[] = [];
  if (kind === 'lmstudio' || kind === 'openai-compatible') {
    const native = await getJson(`${origin}/api/v0/models`, apiKey, 5000);
    if (Array.isArray(native?.data)) for (const m of native.data) if (m?.state === 'loaded' && m.id) loaded.push(String(m.id));
  }
  if (kind === 'ollama') {
    const ps = await getJson(`${origin}/api/ps`, apiKey, 5000);
    if (Array.isArray(ps?.models)) for (const m of ps.models) { const id = m?.name || m?.model; if (id) loaded.push(String(id)); }
  }
  return [...new Set(loaded)];
}

export interface EffectiveModel { configured: string; effective: string; changed: boolean; reason: string; ctx?: number; maxOut?: number; inPrice?: number; outPrice?: number }

/** Resolve the model for a run. Does NOT substitute for a pinned selection. */
export function resolveEffectiveModel(selection: 'auto' | 'pinned', requested: string, loaded: string[], catalog: Record<string, ModelMeta>): EffectiveModel {
  let effective = requested;
  let changed = false;
  let reason = 'configured';
  if (selection === 'auto' && loaded.length && (!requested || !loaded.includes(requested))) {
    effective = loaded[0]; changed = true; reason = 'auto: loaded model';
  } else if (selection === 'auto' && loaded.includes(requested)) {
    reason = 'auto: configured model is loaded';
  }
  const meta = catalog[effective] || {};
  return { configured: requested, effective, changed, reason, ctx: meta.ctx, maxOut: meta.maxOut, inPrice: meta.inPrice, outPrice: meta.outPrice };
}

/** Fresh native metadata: loaded context overrides advertised training context and cached data. */
export async function discoverModels(baseUrl: string, apiKey: string): Promise<Catalog & { loaded: string[] }> {
  const cached = await getCatalog(baseUrl, apiKey);
  const catalog = Object.fromEntries(Object.entries(cached.catalog).map(([id, meta]) => [id, { ...meta }]));
  const models = [...cached.models];
  const loaded: string[] = [];
  if (isLocal(baseUrl) && providerKind(baseUrl) !== 'ollama') {
    const origin = new URL(baseUrl).origin;
    const native = await getJson(`${origin}/api/v1/models`, apiKey);
    if (Array.isArray(native?.models)) {
      for (const m of native.models) {
        if (m.type !== 'llm' || !m.key) continue;
        const instances = Array.isArray(m.loaded_instances) ? m.loaded_instances : [];
        const ctx = num(instances[0]?.config?.context_length) || num(m.max_context_length);
        catalog[m.key] = { ...catalog[m.key], ctx, maxOut: ctx, desc: m.display_name };
        if (!models.includes(m.key)) models.push(m.key);
        for (const instance of instances) {
          const id = instance.id || m.key;
          loaded.push(id);
          catalog[id] = { ...catalog[m.key], ctx: num(instance.config?.context_length) || ctx, maxOut: num(instance.config?.context_length) || ctx };
          if (!models.includes(id)) models.push(id);
        }
      }
      // Embedding models cannot service chat requests.
      const embeddings = new Set(native.models.filter((m: any) => m.type === 'embedding').map((m: any) => m.key));
      return { ...cached, catalog, models: models.filter((id) => !embeddings.has(id)), loaded };
    }
    const legacy = await getJson(`${origin}/api/v0/models`, apiKey);
    for (const m of legacy?.data || []) {
      if (m.type === 'embeddings' || m.type === 'embedding' || !m.id) continue;
      const ctx = num(m.loaded_context_length) || num(m.max_context_length);
      catalog[m.id] = { ...catalog[m.id], ctx, maxOut: ctx };
      if (m.state === 'loaded') loaded.push(m.id);
    }
    // FreeToken/vLLM expose their active model through /v1/models, with no LM Studio API.
    // Only infer readiness for a single-model endpoint when no native catalog exists.
    if (!Array.isArray(legacy?.data) && models.length === 1) loaded.push(models[0]);
    return { ...cached, catalog, models, loaded };
  }
  return { ...cached, catalog, models, loaded: await getLoadedModels(baseUrl, apiKey) };
}
