'use client';
// Lucky rail: decorative craps dice on the left plus live public prediction-market
// odds (Kalshi + Polymarket, keyless public APIs via /api/markets). The dice are a
// for-fun roller only — no wagers, no money, no bets are placed anywhere.
import { useCallback, useEffect, useRef, useState } from 'react';

interface Market { source: 'kalshi' | 'polymarket'; title: string; yesPct: number | null; url: string }

// Pip cells (3x3 grid indices) lit for each face value.
const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

const CALLS: Record<number, string> = {
  2: 'Snake eyes', 3: 'Ace deuce', 4: 'Little Joe', 5: 'Fever five', 6: 'Six, easy way',
  7: 'Seven out', 8: 'Eight, easy way', 9: 'Nina nine', 10: 'Big ten', 11: 'Yo eleven', 12: 'Boxcars',
};

function Die({ value, rolling }: { value: number; rolling: boolean }) {
  const lit = PIPS[value] || [];
  return (
    <div className={'die' + (rolling ? ' rolling' : '')} aria-label={`die showing ${value}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={'pip' + (lit.includes(i) ? ' on' : '')} />
      ))}
    </div>
  );
}

export default function LuckyPanel() {
  const [dice, setDice] = useState<[number, number]>([6, 1]);
  const [rolling, setRolling] = useState(false);
  const [rolls, setRolls] = useState(0);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [oddsState, setOddsState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [updatedAt, setUpdatedAt] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const roll = useCallback(() => {
    if (rolling) return;
    setRolling(true);
    const iv = setInterval(() => {
      setDice([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
    }, 70);
    setTimeout(() => {
      clearInterval(iv);
      setDice([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
      setRolling(false);
      setRolls((n) => n + 1);
    }, 650);
  }, [rolling]);

  const loadOdds = useCallback(async () => {
    try {
      const r = await fetch('/api/markets');
      const d = await r.json();
      if (d?.ok && Array.isArray(d.markets) && d.markets.length) {
        setMarkets(d.markets.slice(0, 14));
        setUpdatedAt(new Date(d.cachedAt || Date.now()).toLocaleTimeString());
        setOddsState('ready');
      } else if (d?.ok) {
        setOddsState('empty');
      } else {
        setOddsState('error');
      }
    } catch {
      setOddsState('error');
    }
  }, []);

  useEffect(() => {
    void loadOdds();
    timer.current = setInterval(loadOdds, 90_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [loadOdds]);

  const total = dice[0] + dice[1];
  return (
    <aside className="lucky-rail" aria-label="Lucky craps table and live odds">
      <div className="lucky-section">
        <div className="lucky-title"><span className="gly">⚄</span> Craps table</div>
        <div className="dice-row">
          <Die value={dice[0]} rolling={rolling} />
          <Die value={dice[1]} rolling={rolling} />
        </div>
        <div className="dice-call">{rolling ? 'Rolling…' : `${total} — ${CALLS[total] || ''}`}</div>
        <button className="btn sm primary lucky-roll" disabled={rolling} onClick={roll}>
          {rolling ? 'Rolling…' : 'Roll the dice'}
        </button>
        {rolls > 0 && <div className="hint">Rolls this visit: {rolls} (just for luck)</div>}
      </div>
      <div className="lucky-section">
        <div className="lucky-title"><span className="gly">◉</span> Live odds <button className="btn sm" onClick={() => { setOddsState('loading'); void loadOdds(); }} title="Refresh odds now">↻</button></div>
        {oddsState === 'loading' && <div className="hint">Loading Kalshi + Polymarket…</div>}
        {oddsState === 'error' && <div className="hint">Odds unavailable right now. Check your connection and press ↻.</div>}
        {oddsState === 'empty' && <div className="hint">No open markets reported. Press ↻ to retry.</div>}
        {oddsState === 'ready' && (
          <>
            <div className="hint">Updated {updatedAt} · public prices, not advice</div>
            <ul className="odds-list">
              {markets.map((m, i) => (
                <li key={i} className="odds-row">
                  <span className={'venue ' + m.source}>{m.source === 'kalshi' ? 'K' : 'PM'}</span>
                  <span className="odds-main">
                    <a href={m.url} target="_blank" rel="noreferrer" title={m.title}>{m.title}</a>
                    <span className="odds-bar"><span style={{ width: `${m.yesPct ?? 0}%` }} /></span>
                  </span>
                  <b className="odds-pct">{m.yesPct == null ? '—' : `${m.yesPct}%`}</b>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
