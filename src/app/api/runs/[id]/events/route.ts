import { checkRequest, forbidden } from '@/server/security/auth';
import { validPersistentId } from '@/server/store';
import { eventStore } from '@/server/events';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  if (!validPersistentId(params.id)) return Response.json({ ok: false, error: 'Invalid run ID.' }, { status: 400 });
  const url = new URL(req.url);
  // compact=1: merge delta runs and replace embedded payloads with summaries, so
  // reconnects and task opens on multi-MB logs transfer kilobytes, not megabytes.
  const compact = url.searchParams.get('compact') === '1';
  let after = Math.max(Number(url.searchParams.get('after')) || 0, Number(req.headers.get('last-event-id')) || 0);
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      let ping: ReturnType<typeof setInterval> | undefined;
      cleanup = () => { if (closed) return; closed = true; clearInterval(timer); if (ping) clearInterval(ping); req.signal.removeEventListener('abort', cleanup); try { controller.close(); } catch {} };
      const flush = () => {
        if (closed) return;
        // Read durable events across route bundles/workers as well as reconnects.
        for (const e of eventStore.replay(params.id, after, compact)) {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`id: ${e.sequence}\ndata: ${JSON.stringify(e)}\n\n`)); after = e.sequence; }
          catch { cleanup(); return; }
          if (e.type === 'run.finished') { cleanup(); return; }
        }
      };
      timer = setInterval(flush, 150);
      // v1.13: SSE heartbeat. Long silent phases (builds, local inference) previously produced
      // zero bytes, letting proxies/browsers drop the stream; a run then LOOKED stopped.
      ping = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { cleanup(); }
      }, 15000);
      req.signal.addEventListener('abort', cleanup, { once: true });
      if (req.signal.aborted) cleanup(); else flush();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
