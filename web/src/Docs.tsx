import { useEffect, useState } from 'react';
import { api, type DocEntry } from './api';
import { renderMarkdown } from './md';

interface Props {
  initialPath: string | null;
  onOpenCard: (id: string) => void;
}

export default function Docs({ initialPath, onOpenCard }: Props) {
  const [list, setList] = useState<DocEntry[]>([]);
  const [path, setPath] = useState<string | null>(initialPath);
  const [html, setHtml] = useState('');
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ cards: Array<{ id: string; title: string }>; docs: Array<{ path: string; title: string; snippet: string }> } | null>(null);

  useEffect(() => {
    api.docs().then(setList).catch(() => setList([]));
  }, []);

  useEffect(() => {
    setPath(initialPath);
  }, [initialPath]);

  useEffect(() => {
    if (!path) {
      setHtml('');
      return;
    }
    setErr('');
    api
      .doc(path)
      .then((d) => setHtml(renderMarkdown(d.content)))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [path]);

  async function search() {
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    try {
      setHits(await api.search(q.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Поиск по задачам и документам…"
        />
        <button onClick={search}>Найти</button>
      </div>
      {hits && (
        <div className="searchres">
          {hits.cards.map((c) => (
            <div key={'c' + c.id} className="ev" onClick={() => onOpenCard(c.id)}>
              задача · {c.title}
            </div>
          ))}
          {hits.docs.map((d) => (
            <div key={'d' + d.path} className="ev" onClick={() => { setPath(d.path); setHits(null); }}>
              документ · {d.title}{d.snippet !== '' && ` — ${d.snippet}`}
            </div>
          ))}
          {hits.cards.length === 0 && hits.docs.length === 0 && <div className="muted">Ничего не нашлось</div>}
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <div className="docscols">
        <div className="docslist">
          {list.map((d) => {
            const base = d.path.split('/').pop() ?? d.path;
            return (
              <div
                key={d.path}
                className={'doctab' + (d.path === path ? ' on' : '')}
                onClick={() => setPath(d.path)}
              >
                <div className="filerow">
                  <span className="fileext">md</span>
                  <span>{base.replace(/\.md$/i, '')}</span>
                </div>
              </div>
            );
          })}
          {list.length === 0 && <div className="muted">Документов рядом нет — положи docs в проект</div>}
        </div>
        <div className="docview">
          {path === null && <div className="muted">Выбери документ слева</div>}
          {path !== null && <div className="mdview tall" dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      </div>
    </div>
  );
}
