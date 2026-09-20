import type { TokenUsage } from '@/shared/contracts';
import { completionRequest } from './transport';
import { isLocal } from './model-discovery';

export interface ProviderConfig {
  baseUrl: string; apiKey: string; model: string; maxTokens: number; temperature: number;
  connectTimeoutMs: number; firstTokenTimeoutMs: number; streamIdleTimeoutMs: number; requestTimeoutMs: number; retries: number;
  /** Cost-saver mode: mark cache breakpoints (never sent to local models). */
  cacheBreakpoints?: boolean;
}
export type StreamEvent =
  | { type: 'content' | 'reasoning'; text: string }
  | { type: 'tool_delta'; index: number; id?: string; name?: string; argsDelta?: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; finishReason?: string }
  | { type: 'retry'; attempt: number; reason: string }
  | { type: 'error'; message: string };
export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; name?: string; tool_call_id?: string; tool_calls?: any[]; reasoning_content?: string; attachmentIds?: string[]; images?: Array<{ url: string; detail?: 'auto' | 'low' | 'high' }> }
export interface AssembledToolCall { id: string; name: string; argsRaw: string }
export class AuthenticationOrRequestError extends Error {
  status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

export function* payloadEvents(ev: any): Generator<StreamEvent> {
  if (ev?.error) throw new AuthenticationOrRequestError('Provider error: ' + (typeof ev.error === 'string' ? ev.error : ev.error.message || JSON.stringify(ev.error)));
  const choice = ev?.choices?.[0];
  const delta = choice?.delta || choice?.message;
  if (delta) {
    const reasoning = delta.reasoning_content || delta.reasoning;
    if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
    const content = typeof delta.content === 'string' ? delta.content : Array.isArray(delta.content) ? delta.content.map((p: any) => p.text || '').join('') : '';
    if (content) yield { type: 'content', text: content };
    if (Array.isArray(delta.tool_calls)) for (const [i, tc] of delta.tool_calls.entries()) {
      yield { type: 'tool_delta', index: tc.index ?? i, id: tc.id, name: tc.function?.name, argsDelta: typeof tc.function?.arguments === 'object' ? JSON.stringify(tc.function.arguments) : tc.function?.arguments };
    }
  }
  if (ev?.usage) {
    const u = ev.usage;
    const promptTokens = Number(u.prompt_tokens || 0), completionTokens = Number(u.completion_tokens || 0);
    const cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? 0);
    yield { type: 'usage', usage: { promptTokens, completionTokens, totalTokens: Number(u.total_tokens || promptTokens + completionTokens), ...(cached > 0 ? { cachedTokens: cached } : {}) } };
  }
}

/**
 * Cost-saver: mark prompt-cache breakpoints on the stable prefix (system messages)
 * and the trailing tail, mirroring opencode's applyCaching. Returns new objects;
 * never mutates. Whether a provider honors the marks is up to it — unknown marks
 * are ignored by tolerant servers, which is why this stays behind the toggle.
 */
export function withCacheBreakpoints<T extends { role: string }>(messages: T[]): (T & { cache_control?: { type: string } })[] {
  const systems = messages.filter((m) => m.role === 'system').slice(0, 2);
  const tail = messages.filter((m) => m.role !== 'system').slice(-2);
  const marked = new Set([...systems, ...tail]);
  return messages.map((m) => (marked.has(m) ? { ...m, cache_control: { type: 'ephemeral' } } : m));
}

/** Breakpoints are never sent to local models, even with the toggle on. */
export function cacheBreakpointsAllowed(baseUrl: string, enabled?: boolean): boolean {
  return enabled === true && !isLocal(baseUrl);
}

export class OpenAICompatProvider {
  private cfg: ProviderConfig;
  constructor(cfg: ProviderConfig) { this.cfg = cfg; }
  async *stream(messages: ChatMessage[], opts: { tools?: unknown[]; maxTokens: number; retries?: number }, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const local = isLocal(this.cfg.baseUrl);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;
    const mapped = messages.map(({ images, attachmentIds, ...message }) => images?.length ? {
      ...message, content: [{ type: 'text', text: message.content || '' }, ...images.map(image => ({ type: 'image_url', image_url: image }))],
    } : message);
    // Cost-saver breakpoints; the helper hard-refuses local models even if toggled on.
    const wireMessages = cacheBreakpointsAllowed(this.cfg.baseUrl, this.cfg.cacheBreakpoints) ? withCacheBreakpoints(mapped) : mapped;
    const body = JSON.stringify({ model: this.cfg.model, messages: wireMessages, temperature: this.cfg.temperature,
      ...(opts.maxTokens > 0 ? { max_tokens: Math.floor(opts.maxTokens) } : {}), stream: true,
      stream_options: { include_usage: true }, ...(opts.tools?.length ? { tools: opts.tools } : {}) });
    for (let attempt = 0; ; attempt++) {
      const ac = new AbortController();
      const onAbort = () => ac.abort(signal?.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const timers = new Set<ReturnType<typeof setTimeout>>();
      let timeoutPhase = '';
      const arm = (ms: number, phase: string) => {
        if (local || ms <= 0) return undefined;
        const t = setTimeout(() => { timeoutPhase = phase; ac.abort(); }, ms);
        timers.add(t); return t;
      };
      const clear = (t?: ReturnType<typeof setTimeout>) => { if (t) { clearTimeout(t); timers.delete(t); } };
      const total = arm(this.cfg.requestTimeoutMs, 'request');
      const connect = arm(this.cfg.connectTimeoutMs, 'connect');
      let first: ReturnType<typeof setTimeout> | undefined;
      let idle: ReturnType<typeof setTimeout> | undefined;
      let emitted = false, sawPayload = false, completed = false;
      let badFrames = 0;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let retryReason = '';
      let finishReason: string | undefined;
      try {
        const res = await completionRequest(this.cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', headers, body, ac.signal);
        clear(connect);
        if (!res.ok) throw new AuthenticationOrRequestError(`Provider HTTP ${res.status}: ${(await res.text()).slice(0, 1000)}`, res.status);
        first = arm(this.cfg.firstTokenTimeoutMs, 'first token');
        if (!res.body) throw new Error('Provider returned no response body.');
        reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        const jsonResponse = res.headers.get('content-type')?.includes('application/json');
        for (;;) {
          const chunk = await reader.read();
          buf += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
          if (jsonResponse) {
            if (!chunk.done) continue;
            const ev = JSON.parse(buf);
            for (const event of payloadEvents(ev)) { sawPayload = true; emitted ||= event.type !== 'usage'; yield event; }
            finishReason = ev.choices?.[0]?.finish_reason;
            completed = true;
            break;
          }
          const lines = buf.split(/\r?\n/);
          buf = chunk.done ? '' : lines.pop() || '';
          for (const raw of lines) {
            if (!raw.startsWith('data:')) continue;
            const payload = raw.slice(5).trim();
            if (!payload) continue;
            if (payload === '[DONE]') { completed = true; continue; }
            let ev: any;
            // v1.13: one corrupted frame no longer kills the stream; it is skipped. A stream that
            // ends with nothing usable still fails below via the sawPayload guard.
            try { ev = JSON.parse(payload); } catch { badFrames++; continue; }
            if (ev.choices?.[0]?.finish_reason) { finishReason = ev.choices[0].finish_reason; completed = true; }
            for (const event of payloadEvents(ev)) {
              sawPayload = true;
              if (event.type !== 'usage') { emitted = true; clear(first); clear(idle); idle = arm(this.cfg.streamIdleTimeoutMs, 'stream idle'); }
              yield event;
            }
          }
          // [DONE] or finish_reason is authoritative; usage can arrive before EOF.
          if (chunk.done || lines.some((line) => /^data:\s*\[DONE\]\s*$/.test(line))) break;
        }
        if (badFrames) throw new Error(`Malformed streaming JSON: ${badFrames} corrupt frame(s); request tainted, no tools executed.`);
        if (!sawPayload) throw new Error('Model returned an empty response. Check the LM Studio server log and retry.');
        if (!completed) throw new Error('Provider stream ended before completion. Partial output was preserved; no partial tool call was executed.');
        yield { type: 'done', finishReason };
        return;
      } catch (e: any) {
        const reason = signal?.aborted ? 'Cancelled.' : ac.signal.aborted ? `${timeoutPhase || 'Provider'} timeout` : String(e?.message || e);
        const transient = /fetch failed|ECONNREFUSED|ECONNRESET|socket|network|429|502|503|overloaded|timeout/i.test(reason);
        if (!emitted && transient && attempt < (opts.retries ?? this.cfg.retries) && !signal?.aborted) retryReason = reason;
        else { yield { type: 'error', message: reason }; return; }
      } finally {
        for (const t of timers) clearTimeout(t);
        signal?.removeEventListener('abort', onAbort);
        await reader?.cancel().catch(() => {});
        ac.abort();
      }
      yield { type: 'retry', attempt: attempt + 1, reason: retryReason };
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); };
        const t = setTimeout(done, Math.min(1000 * 2 ** attempt, 8000));
        signal?.addEventListener('abort', done, { once: true });
        if (signal?.aborted) done();
      });
    }
  }
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const res = await fetch(this.cfg.baseUrl.replace(/\/$/, '') + '/models', { headers: this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}, signal });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((m: any) => m.id).filter(Boolean);
  }
}

export function assembleToolCalls(deltas: Array<{ index: number; id?: string; name?: string; argsDelta?: string }>): { calls: AssembledToolCall[]; invalid: string[] } {
  const byIndex = new Map<number, { id?: string; name?: string; args: string }>();
  for (const d of deltas) {
    const cur = byIndex.get(d.index) || { args: '' };
    if (d.id) cur.id = d.id;
    if (d.name) cur.name = cur.name === d.name ? cur.name : (cur.name || '') + d.name;
    if (d.argsDelta) cur.args += d.argsDelta;
    byIndex.set(d.index, cur);
  }
  const calls: AssembledToolCall[] = [], invalid: string[] = [];
  for (const [index, v] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    if (!v.name) { invalid.push(`Tool call #${index} had no name.`); continue; }
    const argsRaw = v.args || '{}';
    try { const args = JSON.parse(argsRaw); if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(); }
    catch { invalid.push(`Tool call ${v.name} had malformed JSON arguments.`); continue; }
    calls.push({ id: v.id || `call_${index}_${Date.now()}`, name: v.name, argsRaw });
  }
  return { calls, invalid };
}

/** Plain-text tool fallback for local templates without structured tool support.
 * Only a whole response made of tool tags is executable; quoted examples are never parsed. */
export function parseTextToolCalls(text: string): { calls: AssembledToolCall[]; invalid: string[] } {
  const calls: AssembledToolCall[] = [], invalid: string[] = [];
  const trimmed = text.trim();
  if (!trimmed.startsWith('<tool_call')) return { calls, invalid };
  const tags = [...trimmed.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>|<tool_call=([\s\S]*?)>/g)];
  const remainder = trimmed.replace(/<tool_call>([\s\S]*?)<\/tool_call>|<tool_call=([\s\S]*?)>/g, '').trim();
  if (!tags.length || remainder) return { calls, invalid: ['Incomplete text tool call. No action was executed.'] };
  for (const [i, match] of tags.entries()) {
    try {
      const parsed = JSON.parse(match[1] || match[2]);
      if (typeof parsed.name !== 'string' || !parsed.arguments || typeof parsed.arguments !== 'object' || Array.isArray(parsed.arguments)) throw new Error();
      calls.push({ id: `text_${Date.now()}_${i}`, name: parsed.name, argsRaw: JSON.stringify(parsed.arguments) });
    } catch { invalid.push('Malformed text tool call. No action was executed.'); }
  }
  return { calls: invalid.length ? [] : calls, invalid };
}
