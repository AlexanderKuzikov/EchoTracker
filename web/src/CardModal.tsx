import { Suspense, lazy, useEffect, useState } from 'react';
import { api, type Card, type CheckItem, type Column, type FileRow, type User } from './api';
import NoFill from './NoFill';
import { baseName, bpmnToSvg, docxToMarkdown, hasBpmnLayout, svgHasContent, svgToPng } from './derivatives';
import { renderMarkdown } from './md';

const BpmnView = lazy(() => import('./BpmnView'));

interface Props {
  cardId: string;
  users: User[];
  columns: Column[];
  onClose: () => void;
  onOpenDoc: (path: string) => void;
}

export default function CardModalHost({ cardId, users, columns, onClose, onOpenDoc }: Props) {
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const [showBpmn, setShowBpmn] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', body: '', kind: 'task' as 'task' | 'request', column_id: '', assignee_id: '', deadline: '', requested_at: '', started_at: '', doc_ref: '' });

  useEffect(() => {
    api
      .getCard(cardId)
      .then((c) => {
        setCard(c);
        setDraft({
          title: c.title,
          body: c.body,
          kind: c.kind,
          column_id: c.column_id,
          assignee_id: c.assignee_id ?? '',
          deadline: c.deadline ?? '',
          requested_at: c.requested_at ?? '',
          started_at: c.started_at ?? '',
          doc_ref: c.doc_ref ?? '',
        });
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [cardId]);

  async function refresh() {
    const c = await api.getCard(cardId);
    setCard(c);
  }

  async function save() {
    if (!card) return;
    setErr('');
    try {
      await api.patchCard(card.id, {
        title: draft.title,
        body: draft.body,
        kind: draft.kind,
        column_id: draft.column_id,
        assignee_id: draft.assignee_id || null,
          deadline: draft.deadline || null,
          requested_at: draft.requested_at || null,
          started_at: draft.started_at || null,
          doc_ref: draft.doc_ref.trim() || null,
        });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    if (!card || !confirm('Удалить карточку с файлами?')) return;
    await api.deleteCard(card.id);
    onClose();
  }

  async function onPick(f: File) {
    if (!card) return;
    setErr('');
    setNote('');
    setBusy('Загружаю…');
    try {
      const buf = await f.arrayBuffer();
      const orig = await api.uploadFile(card.id, new Blob([buf], { type: f.type || 'application/octet-stream' }), f.name, 'original');
      const low = f.name.toLowerCase();
      if (low.endsWith('.docx')) {
        setBusy('Конвертирую в md…');
        const md = await docxToMarkdown(buf);
        await api.uploadFile(card.id, new Blob([md], { type: 'text/markdown' }), baseName(f.name) + '.md', 'md', orig.id);
      } else if (low.endsWith('.bpmn')) {
        setBusy('Рисую схему…');
        const xml = new TextDecoder().decode(buf);
        if (!hasBpmnLayout(xml)) {
          setNote('В bpmn нет раскладки — превью не построилось, смотри в Modeler');
        } else {
          const svg = await bpmnToSvg(xml);
          if (!svgHasContent(svg)) {
            setNote('Схема вышла пустой — проверь файл в Modeler');
          } else {
            await api.uploadFile(card.id, new Blob([svg], { type: 'image/svg+xml' }), baseName(f.name) + '.svg', 'svg', orig.id);
            const png = await svgToPng(svg);
            await api.uploadFile(card.id, png, baseName(f.name) + '.thumb.png', 'thumb', orig.id);
          }
        }
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  if (!card) {
    return (
      <div className="backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          {err || 'Загрузка…'}
        </div>
      </div>
    );
  }
  const originals = (card.files ?? []).filter((x) => x.kind === 'original');
  const kids = (id: string, kind: string) => (card.files ?? []).filter((x) => x.derived_from === id && x.kind === kind);
  const isBpmn = (name: string) => name.toLowerCase().endsWith('.bpmn');
  const isMd = (f: FileRow) => f.orig_name.toLowerCase().endsWith('.md') || f.mime === 'text/markdown';
  const isTxt = (f: FileRow) => f.mime === 'text/plain' || f.orig_name.toLowerCase().endsWith('.txt');
  const isImg = (f: FileRow) => f.mime.startsWith('image/') || f.orig_name.toLowerCase().endsWith('.svg');

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {err && <div className="error">{err}</div>}
        <div className="modalcols">
        <div className="modalmain">
        <NoFill className="modaltitle" name="echotracker-card-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <div className="grid2">
          <label>
            Тип
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'task' | 'request' })}>
              <option value="task">Задача</option>
              <option value="request">Запрос</option>
            </select>
          </label>
          <label>
            Колонка
            <select value={draft.column_id} onChange={(e) => setDraft({ ...draft, column_id: e.target.value })}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </label>
          <label>
            Исполнитель
            <select value={draft.assignee_id} onChange={(e) => setDraft({ ...draft, assignee_id: e.target.value })}>
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.login}</option>
              ))}
            </select>
          </label>
          <label>
            Срок
            <input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
          </label>
          <label>
            Дата запроса
            <input type="date" value={draft.requested_at} onChange={(e) => setDraft({ ...draft, requested_at: e.target.value })} />
          </label>
          <label>
            Старт
            <input type="date" value={draft.started_at} onChange={(e) => setDraft({ ...draft, started_at: e.target.value })} />
          </label>
        </div>
        <textarea rows={5} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Описание…" />
        <div className="row">
          <NoFill
            name="echotracker-docref"
            value={draft.doc_ref}
            onChange={(e) => setDraft({ ...draft, doc_ref: e.target.value })}
            placeholder="Документ: docs/CONTEXT.md…"
          />
          <button onClick={() => draft.doc_ref.trim() !== '' && onOpenDoc(draft.doc_ref.trim())}>Открыть</button>
        </div>
        <div className="row">
          <button className="primary" onClick={save}>Сохранить</button>
          <button className="danger" onClick={remove}>Удалить</button>
          <button onClick={onClose}>Закрыть</button>
        </div>
        <Checklist card={card} refresh={refresh} />
        <Feed card={card} refresh={refresh} />
        </div>
        <div className="modalside">
        <h3>Файлы</h3>
        <input
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPick(f);
            e.target.value = '';
          }}
        />
        {busy && <div className="busy">{busy}</div>}
        {note && <div className="muted">{note}</div>}
        <ul className="files">
          {originals.map((f) => (
            <li key={f.id}>
              <div className="filerow">
                <span className="fileext">{extOf(f.orig_name)}</span>
                <a href={api.fileUrl(f.id)} target="_blank" rel="noreferrer">{f.orig_name}</a>
                <span className="muted"> {(f.size / 1024).toFixed(1)} КБ</span>
                <button className="link" onClick={() => api.deleteFile(f.id).then(refresh)}>убрать</button>
              </div>
              {isImg(f) && (
                <div><img className="preview zoomable" src={api.fileUrl(f.id)} alt={f.orig_name} onClick={() => setZoom(api.fileUrl(f.id))} /></div>
              )}
              {f.mime === 'application/pdf' && (
                <div><iframe className="previewdoc" src={api.fileUrl(f.id)} title={f.orig_name} /></div>
              )}
              {isTxt(f) && <TxtPreview id={f.id} name={f.orig_name} />}
              {isMd(f) && <MdPreview id={f.id} name={f.orig_name} />}
              {kids(f.id, 'md').map((m) => (
                <MdPreview key={m.id} id={m.id} name={m.orig_name} />
              ))}
              {kids(f.id, 'svg').map((s) => (
                <div key={s.id}>
                  <h4>Схема</h4>
                  <img className="previewwide zoomable" src={api.fileUrl(s.id)} alt={s.orig_name} onClick={() => setZoom(api.fileUrl(s.id))} />
                  {isBpmn(f.orig_name) && showBpmn !== f.id && <div><button onClick={() => setShowBpmn(f.id)}>Открыть интерактивно</button></div>}
                </div>
              ))}
              {isBpmn(f.orig_name) && kids(f.id, 'svg').length === 0 && (
                <div className="muted">Превью схемы нет — перезалей bpmn, появится диагноз</div>
              )}
              {isBpmn(f.orig_name) && showBpmn === f.id && (
                <Suspense fallback={<div>Гружу вьювер…</div>}>
                  <BpmnTextView id={f.id} />
                </Suspense>
              )}
            </li>
          ))}
        </ul>
        </div>
        </div>
        {zoom && (
          <div className="lightbox" onClick={() => setZoom(null)}>
            <img src={zoom} alt="увеличено" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </div>
    </div>
  );
}

function Checklist({ card, refresh }: { card: Card; refresh: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const items = card.checklist ?? [];
  const done = items.filter((x) => x.done).length;

  async function act(p: Promise<unknown>) {
    setErr('');
    try {
      await p;
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function add() {
    if (!text.trim()) return;
    await act(api.addCheck(card.id, text.trim()));
    setText('');
  }

  return (
    <div>
      <h3>Чек-лист {items.length > 0 && `${done}/${items.length}`}</h3>
      {err && <div className="error">{err}</div>}
      <ul className="check">
        {items.map((it: CheckItem) => (
          <li key={it.id} className={it.done ? 'done' : ''}>
            <input
              type="checkbox"
              checked={!!it.done}
              onChange={() => act(api.patchCheck(it.id, { done: !it.done }))}
            />
            <span>{it.text}</span>
            <button className="link" onClick={() => act(api.deleteCheck(it.id))}>
              убрать
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <NoFill
          name="echotracker-check"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Новый пункт…"
        />
        <button onClick={add}>
          Добавить
        </button>
      </div>
    </div>
  );
}

function fmtDT(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

const ACT_TEXT: Record<string, string> = {
  created: 'создана',
  moved: 'перемещена',
  assigned: 'исполнитель',
  file_added: 'файл',
  file_removed: 'убран файл',
};

function Feed({ card, refresh }: { card: Card; refresh: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const events = [
    ...(card.activity ?? []).map((a) => ({ at: a.created_at, key: 'a' + a.id, node: (
      <div key={'a' + a.id} className="alog">
        <span className="muted">{fmtDT(a.created_at)} · {a.actor ?? '?'}:</span> {ACT_TEXT[a.kind] ?? a.kind}
        {a.detail !== '' && ` — ${a.detail}`}
      </div>
    ) })),
    ...(card.comments ?? []).map((c) => ({ at: c.created_at, key: 'c' + c.id, node: (
      <div key={'c' + c.id} className="bubble">
        <div className="muted">{c.author ?? '?'} · {fmtDT(c.created_at)}</div>
        <div>{c.body}</div>
      </div>
    ) })),
  ].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));

  async function send() {
    if (!text.trim()) return;
    setErr('');
    try {
      await api.addComment(card.id, text.trim());
      setText('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <h3>Обсуждение</h3>
      {err && <div className="error">{err}</div>}
      <div className="feed">{events.map((e) => e.node)}</div>
      <div className="row">
        <NoFill
          name="echotracker-comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Комментарий…"
        />
        <button className="primary" onClick={send}>Отправить</button>
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="5" width="9" height="9" rx="2" />
      <path d="M11 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1" />
    </svg>
  );
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? 'файл' : name.slice(i + 1).toLowerCase();
}

function MdPreview({ id, name }: { id: string; name: string }) {
  const [html, setHtml] = useState('');
  const [raw, setRaw] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch(api.fileUrl(id), { credentials: 'same-origin' })
      .then((r) => r.text())
      .then((t) => {
        setRaw(t);
        setHtml(renderMarkdown(t));
      })
      .catch(() => setHtml(''));
  }, [id]);
  return (
    <div>
      <h4>
        {name}{' '}
        <button className="iconbtn" title={copied ? 'Скопировано' : 'Копировать текст в буфер'} onClick={() => copyText(raw).then((ok) => flash(ok, setCopied))}>
          <CopyIcon />
        </button>
      </h4>
      <div className="mdview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function flash(ok: boolean, set: (v: boolean) => void): void {
  if (!ok) return;
  set(true);
  setTimeout(() => set(false), 2000);
}

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function TxtPreview({ id, name }: { id: string; name: string }) {
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch(api.fileUrl(id), { credentials: 'same-origin' })
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText(''));
  }, [id]);
  return (
    <div>
      <h4>
        {name}{' '}
        <button className="iconbtn" title={copied ? 'Скопировано' : 'Копировать текст в буфер'} onClick={() => copyText(text).then((ok) => flash(ok, setCopied))}>
          <CopyIcon />
        </button>
      </h4>
      <pre className="mdview">{text}</pre>
    </div>
  );
}

function BpmnTextView({ id }: { id: string }) {
  const [xml, setXml] = useState('');
  useEffect(() => {
    fetch(api.fileUrl(id), { credentials: 'same-origin' })
      .then((r) => r.text())
      .then(setXml)
      .catch(() => setXml(''));
  }, [id]);
  if (!xml) return <div>Загрузка…</div>;
  if (!hasBpmnLayout(xml)) {
    return <div className="error">В файле нет раскладки — открой в Modeler</div>;
  }
  return <BpmnView xml={xml} />;
}
