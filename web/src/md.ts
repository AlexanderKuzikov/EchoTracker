function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(raw: string): string {
  const s = esc(raw);
  return s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, a: string, u: string) =>
      /^(https?:)/i.test(u) ? `<img src="${u}" alt="${a}" loading="lazy"/>` : a,
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) =>
      /^(https?:|mailto:)/i.test(u)
        ? `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>`
        : t,
    );
}

function rowCells(line: string, tag: string): string {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => `<${tag}>${inline(c.trim())}</${tag}>`)
    .join('');
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let i = 0;
  let para: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let listTag = '';
  const flush = () => {
    if (para.length > 0) {
      html += `<p>${inline(para.join(' ').trim())}</p>`;
      para = [];
    }
  };
  const closeList = () => {
    if (listTag) {
      html += `</${listTag}>`;
      listTag = '';
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      if (inCode) {
        html += `<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`;
        codeBuf = [];
        inCode = false;
      } else {
        flush();
        closeList();
        inCode = true;
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }
    // techdebt: сырой HTML не рендерим — однострочные теги чистим до текста,
    // иначе шапки вроде бейджей в README лезут наружу мусором
    if (line.trim().startsWith('<')) {
      flush();
      closeList();
      const hm = line.trim().match(/^<h([1-3])[^>]*>([\s\S]*)<\/h[1-3]>$/);
      const text = (hm?.[2] ?? line).replace(/<[^>]*>/g, '').trim();
      if (text) {
        html += hm?.[1] ? `<h${hm[1]}>${inline(text)}</h${hm[1]}>` : `<p>${inline(text)}</p>`;
      }
      i++;
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h?.[1] && h[2] !== undefined) {
      flush();
      closeList();
      const level = h[1].length;
      html += `<h${level}>${inline(h[2].trim())}</h${level}>`;
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flush();
      closeList();
      html += '<hr/>';
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      closeList();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      html += `<blockquote>${inline(quote.join(' ').trim())}</blockquote>`;
      continue;
    }
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      lines[i + 1].includes('-') &&
      /^[\s|:~-]+$/.test(lines[i + 1])
    ) {
      flush();
      closeList();
      html += `<table><thead><tr>${rowCells(line, 'th')}</tr></thead><tbody>`;
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        html += `<tr>${rowCells(lines[i], 'td')}</tr>`;
        i++;
      }
      html += '</tbody></table>';
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul?.[1] !== undefined || ol?.[1] !== undefined) {
      flush();
      const tag = ul ? 'ul' : 'ol';
      const text = ul ? (ul[1] as string) : (ol?.[1] as string);
      if (listTag !== tag) {
        closeList();
        html += `<${tag}>`;
        listTag = tag;
      }
      html += `<li>${inline(text.trim())}</li>`;
      i++;
      continue;
    }
    if (line.trim() === '') {
      flush();
      i++;
      continue;
    }
    closeList();
    para.push(line);
    i++;
  }
  flush();
  closeList();
  if (inCode) html += `<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`;
  return html;
}
