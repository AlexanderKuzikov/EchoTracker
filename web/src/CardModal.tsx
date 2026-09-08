import { Suspense, lazy, useEffect, useState } from 'react';
import { api, type Card, type Column, type User } from './api';
import { baseName, bpmnToSvg, docxToMarkdown, svgToPng } from './derivatives';
import { renderMarkdown } from './md';

const BpmnView = lazy(() => import('./BpmnView'));

interface Props {
  cardId: string;
  users: User[];
  columns: Column[];
  onClose: () => void;
}

export default function CardModalHost({ cardId, users, columns, onClose }: Props) {
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [showBpmn, setShowBpmn] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '', kind: 'task' as 'task' | 'request', column_id: '', assignee_id: '', deadline: '', requested_at: '', started_at: '' });

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
    setBusy('Загружаю…');
    try {
      const buf = await f.arrayBuffer();
      await api.uploadFile(card.id, new Blob([buf], { type: f.type || 'application/octet-stream' }), f.name, 'original');
      const low = f.name.toLowerCase();
      if (low.endsWith('.docx')) {
        setBusy('Конвертирую в md…');
        const md = await docxToMarkdown(buf);
        await api.uploadFile(card.id, new Blob([md], { type: 'text/markdown' }), baseName(f.name) + '.md', 'md');
      } else if (low.endsWith('.bpmn')) {
        setBusy('Рисую схему…');
        const xml = new TextDecoder().decode(buf);
        const svg = await bpmnToSvg(xml);
        await api.uploadFile(card.id, new Blob([svg], { type: 'image/svg+xml' }), baseName(f.name) + '.svg', 'svg');
        const png = await svgToPng(svg);
        await api.uploadFile(card.id, png, baseName(f.name) + '.thumb.png', 'thumb');
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
  const md = (card.files ?? []).find((x) => x.kind === 'md');
  const svg = (card.files ?? []).find((x) => x.kind === 'svg');
  const bpmnSrc = (card.files ?? []).find((x) => x.orig_name.toLowerCase().endsWith('.bpmn'));

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {err && <div className="error">{err}</div>}
        <input className="modaltitle" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
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
          <button onClick={save}>Сохранить</button>
          <button className="danger" onClick={remove}>Удалить</button>
          <button onClick={onClose}>Закрыть</button>
        </div>
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
        <ul className="files">
          {originals.map((f) => (
            <li key={f.id}>
              <a href={api.fileUrl(f.id)} target="_blank" rel="noreferrer">{f.orig_name}</a>
              <span className="muted"> {(f.size / 1024).toFixed(1)} КБ</span>
              <button className="link" onClick={() => api.deleteFile(f.id).then(refresh)}>убрать</button>
              {(f.mime.startsWith('image/') || f.orig_name.toLowerCase().endsWith('.svg')) && (
                <div><img className="preview" src={api.fileUrl(f.id)} alt={f.orig_name} /></div>
              )}
              {f.mime === 'application/pdf' && (
                <div><iframe className="previewdoc" src={api.fileUrl(f.id)} title={f.orig_name} /></div>
              )}
              {(f.mime === 'text/plain' || f.orig_name.toLowerCase().endsWith('.txt')) && (
                <TxtPreview id={f.id} />
              )}
            </li>
          ))}
        </ul>
        {md && <MdPreview id={md.id} name={md.orig_name} />}
        {svg && (
          <div>
            <h4>Схема</h4>
            <img className="previewwide" src={api.fileUrl(svg.id)} alt={svg.orig_name} />
            {bpmnSrc && !showBpmn && <div><button onClick={() => setShowBpmn(true)}>Открыть интерактивно</button></div>}
          </div>
        )}
        {showBpmn && bpmnSrc && (
          <Suspense fallback={<div>Гружу вьювер…</div>}>
            <BpmnTextView id={bpmnSrc.id} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function MdPreview({ id, name }: { id: string; name: string }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    fetch(api.fileUrl(id), { credentials: 'same-origin' })
      .then((r) => r.text())
      .then((t) => setHtml(renderMarkdown(t)))
      .catch(() => setHtml(''));
  }, [id]);
  return (
    <div>
      <h4>{name}</h4>
      <div className="mdview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function TxtPreview({ id }: { id: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    fetch(api.fileUrl(id), { credentials: 'same-origin' })
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText(''));
  }, [id]);
  return <pre className="mdview">{text}</pre>;
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
  if (!xml.includes('bpmn:definitions') && !xml.includes('<definitions')) {
    return <div className="error">В файле нет раскладки — открой в Modeler</div>;
  }
  return <BpmnView xml={xml} />;
}
