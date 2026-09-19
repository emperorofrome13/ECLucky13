export interface AuthResult { ok: boolean; status?: number; error?: string }

function localAuthority(host: string, protocol: string): URL | null {
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(host)) return null;
  try { return new URL(protocol + '//' + host); } catch { return null; }
}

export function checkRequest(req: Request): AuthResult {
  const url = new URL(req.url);
  const target = localAuthority(req.headers.get('host') || '', url.protocol);
  if (!target || !['http:', 'https:'].includes(url.protocol)) return { ok: false, status: 403, error: 'Requests must target a loopback host.' };
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const source = new URL(origin);
      if (source.origin !== target.origin || origin !== source.origin) return { ok: false, status: 403, error: 'Cross-origin requests are not allowed.' };
    } catch { return { ok: false, status: 403, error: 'Invalid Origin header.' }; }
  } else if (req.headers.get('sec-fetch-site') === 'cross-site') {
    return { ok: false, status: 403, error: 'Cross-origin requests are not allowed.' };
  }
  const token = process.env.EC12_TOKEN;
  if (token && req.headers.get('authorization') !== `Bearer ${token}`) return { ok: false, status: 401, error: 'Invalid or missing token.' };
  return { ok: true };
}

export function forbidden(res: AuthResult): Response {
  return Response.json({ ok: false, error: res.error || 'Forbidden' }, { status: res.status || 403 });
}
