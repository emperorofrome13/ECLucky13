import { checkRequest, forbidden } from '@/server/security/auth';
import { listMcpServers, readMcpServers, saveMcpServer, deleteMcpServer, discoverMcpTools } from '@/server/custom-mcp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fail(e: unknown, status: number) {
  const message = String(e instanceof Error ? e.message : e).replace(/^[^:]+: /, '').replace(/\n.*/s, '');
  return Response.json({ ok: false, error: message || 'MCP request failed.' }, { status });
}

export async function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const servers = listMcpServers();
  return Response.json({ ok: true, servers, redacted: MCP_REDACTED_VALUE });
}

export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  try { return Response.json({ ok: true, server: saveMcpServer(await req.json().catch(() => ({}))) }); }
  catch (e) { return fail(e, 400); }
}

export async function PATCH(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!id) return fail(new Error('MCP server id is required.'), 400);
    return Response.json({ ok: true, server: saveMcpServer(body, id) });
  } catch (e) { return fail(e, 400); }
}

export async function DELETE(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id') || '';
    if (!id) return fail(new Error('MCP server id is required.'), 400);
    deleteMcpServer(id);
    return Response.json({ ok: true });
  } catch (e) { return fail(e, 404); }
}

export async function PUT(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  try {
    const body = await req.json().catch(() => ({}));
    const server = readMcpServers().find((s) => s.id === body.id);
    if (!server) return fail(new Error('MCP server not found.'), 404);
    const tools = await discoverMcpTools(server, String(body.workspace || process.cwd()), req.signal);
    return Response.json({ ok: true, tools });
  } catch (e) { return fail(e, 502); }
}

const MCP_REDACTED_VALUE = '[redacted]';
