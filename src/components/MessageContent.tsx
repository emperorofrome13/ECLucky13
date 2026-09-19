'use client';

import { Fragment, useState, type ReactNode } from 'react';

export function CopyButton({ text, label = 'Copy reply' }: { text: string; label?: string }) {
  const [status, setStatus] = useState('');
  return <button type="button" className="btn sm" aria-label={label} onClick={async () => {
    try { await navigator.clipboard.writeText(text); setStatus('Copied'); }
    catch { setStatus('Copy failed — select the text manually'); }
  }}>{status || label}</button>;
}

function inline(text: string): ReactNode[] {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^\s)]+\))/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    const token = match[0];
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
    let node: ReactNode = token;
    if (token.startsWith('`')) node = <code>{token.slice(1, -1)}</code>;
    else if (token.startsWith('**') || token.startsWith('__')) node = <strong>{token.slice(2, -2)}</strong>;
    else if (token.startsWith('*') || token.startsWith('_')) node = <em>{token.slice(1, -1)}</em>;
    else if (link && /^(https?:\/\/|mailto:)/i.test(link[2])) node = <a href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    nodes.push(<Fragment key={index}>{node}</Fragment>);
    cursor = index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export default function MessageContent({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  const startsBlock = (line: string) => /^\s*(`{3,}|~{3,})|^#{1,6}\s|^\s*([-+*]|\d+[.)])\s|^>\s?/.test(line);
  while (i < lines.length) {
    const start = i;
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (fence) {
      const language = fence[2].trim();
      const code: string[] = [];
      i++;
      const closing = new RegExp('^\\s*' + fence[1][0] + '{' + fence[1].length + ',}\\s*$');
      while (i < lines.length && !closing.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<div className="code-block" key={start}><div className="code-block-header"><span>{language || 'Code'}</span><CopyButton text={code.join('\n')} label="Copy code" /></div><pre style={{ overflowX: 'auto', whiteSpace: 'pre' }}><code>{code.join('\n')}</code></pre></div>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (heading) {
      const Tag = `h${heading[1].length}` as keyof JSX.IntrinsicElements;
      blocks.push(<Tag key={start}>{inline(heading[2])}</Tag>); i++; continue;
    }
    const list = /^\s*([-+*]|\d+[.)])\s+(.*)$/.exec(lines[i]);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const item = /^\s*([-+*]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(<li key={i}>{inline(item[2])}</li>); i++;
      }
      blocks.push(ordered ? <ol key={start} start={parseInt(list[1], 10)}>{items}</ol> : <ul key={start}>{items}</ul>); continue;
    }
    if (/^>\s?/.test(lines[i])) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={start}>{inline(quote.join('\n'))}</blockquote>); continue;
    }
    if (!lines[i].trim()) { i++; continue; }
    const paragraph = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={start} style={{ whiteSpace: 'pre-wrap' }}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="message-content" style={{ minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'normal' }}>{blocks}</div>;
}
