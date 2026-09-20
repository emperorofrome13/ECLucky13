import { checkRequest, forbidden } from '@/server/security/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface PublicMarket {
  source: 'kalshi' | 'polymarket';
  title: string;
  /** Yes-side probability 0-100, or null when the venue reports no price. */
  yesPct: number | null;
  url: string;
}

interface CacheEntry { at: number; data: PublicMarket[]; sources: { kalshi: number; polymarket: number } }
let cache: CacheEntry | null = null;
const TTL_MS = 90_000;

async function fetchJson(url: string, ms: number): Promise<any> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'ECLucky13-markets/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function strArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); if (Array.isArray(p)) return p.map(String); } catch { /* not JSON */ }
  }
  return [];
}

function toPct(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return null;
  // Kalshi reports integer cents (1-99); Polymarket reports 0-1 floats as strings.
  if (n > 1 && n <= 100) return Math.round(n);
  if (n >= 0 && n <= 1) return Math.round(n * 100);
  return null;
}

async function kalshiMarkets(): Promise<PublicMarket[]> {
  const out: PublicMarket[] = [];
  const data = await fetchJson('https://api.elections.kalshi.com/trade-api/v2/events?status=open&limit=20&with_nested_markets=true', 8000);
  const events: any[] = Array.isArray(data?.events) ? data.events : [];
  for (const ev of events) {
    const markets: any[] = Array.isArray(ev?.markets) ? ev.markets : [];
    for (const m of markets.slice(0, 2)) {
      const title = String(m?.yes_sub_title || m?.title || ev?.title || '').trim();
      if (!title) continue;
      const ticker = String(m?.ticker || ev?.event_ticker || '');
      out.push({
        source: 'kalshi',
        title,
        yesPct: toPct(m?.last_price_dollars ?? m?.yes_ask_dollars ?? m?.yes_bid_dollars ?? m?.last_price ?? m?.yes_ask ?? m?.yes_bid),
        url: ticker ? `https://kalshi.com/markets/${encodeURIComponent(ticker)}` : 'https://kalshi.com/',
      });
      if (out.length >= 12) return out;
    }
  }
  return out;
}

async function polymarketMarkets(): Promise<PublicMarket[]> {
  const out: PublicMarket[] = [];
  const data = await fetchJson('https://gamma-api.polymarket.com/events?active=true&closed=false&limit=20', 8000);
  const events: any[] = Array.isArray(data) ? data : [];
  for (const ev of events) {
    const slug = String(ev?.slug || '');
    const markets: any[] = Array.isArray(ev?.markets) ? ev.markets : [];
    const m = markets[0];
    if (!m) continue;
    const outcomes: string[] = strArr(m?.outcomes);
    const prices: string[] = strArr(m?.outcomePrices);
    const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === 'yes');
    const title = String(m?.question || ev?.title || '').trim();
    if (!title) continue;
    out.push({
      source: 'polymarket',
      title,
      yesPct: yesIdx >= 0 ? toPct(prices[yesIdx]) : null,
      url: slug ? `https://polymarket.com/event/${encodeURIComponent(slug)}` : 'https://polymarket.com/',
    });
    if (out.length >= 12) return out;
  }
  return out;
}

export async function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  if (cache && Date.now() - cache.at < TTL_MS) {
    return Response.json({ ok: true, cached: true, cachedAt: cache.at, sources: cache.sources, markets: cache.data });
  }
  const [k, p] = await Promise.allSettled([kalshiMarkets(), polymarketMarkets()]);
  const kalshi = k.status === 'fulfilled' ? k.value : [];
  const polymarket = p.status === 'fulfilled' ? p.value : [];
  // Interleave venues so one outage never blanks the panel.
  const data: PublicMarket[] = [];
  for (let i = 0; i < Math.max(kalshi.length, polymarket.length) && data.length < 16; i++) {
    if (kalshi[i]) data.push(kalshi[i]);
    if (polymarket[i] && data.length < 16) data.push(polymarket[i]);
  }
  cache = { at: Date.now(), data, sources: { kalshi: kalshi.length, polymarket: polymarket.length } };
  return Response.json({ ok: true, cached: false, cachedAt: cache.at, sources: cache.sources, markets: data });
}
