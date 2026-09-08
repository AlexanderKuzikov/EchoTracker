import { useState } from 'react';
import { api, type Card, type Column, type User } from './api';
import NoFill from './NoFill';

export function initials(login: string): string {
  const clean = login.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, '').slice(0, 2).toUpperCase();
  return clean || '?';
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return Number(y) === new Date().getFullYear() ? `${d}.${m}` : `${d}.${m}.${y}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

interface Props {
  user: User;
  columns: Column[];
  cards: Card[];
  reload: () => void;
  setOpenId: (id: string | null) => void;
}

export default function Board({ user, columns, cards, reload, setOpenId }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('task');
  const [err, setErr] = useState('');
  const byCol = (id: string) => cards.filter((c) => c.column_id === id);
  const canEdit = user.role === 'admin' || user.role === 'member';

  async function create() {
    if (!title.trim()) return;
    setErr('');
    try {
      await api.createCard({ title: title.trim(), kind });
      setTitle('');
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function drop(colId: string) {
    setOverCol(null);
    if (!dragId || !canEdit) return;
    setDragId(null);
    const card = cards.find((c) => c.id === dragId);
    if (!card || card.column_id === colId) return;
    try {
      await api.patchCard(dragId, { column_id: colId });
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      {canEdit && (
        <div className="composer">
          <NoFill
            name="echotracker-new-card"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Новая карточка…"
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="task">Задача</option>
            <option value="request">Запрос</option>
          </select>
          <button className="primary" onClick={create}>Добавить</button>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <div className="board">
        {columns.map((col) => (
          <div
            key={col.id}
            className={'column' + (overCol === col.id ? ' dragover' : '')}
            onDragOver={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setOverCol(col.id);
            }}
            onDragLeave={() => setOverCol(null)}
            onDrop={() => drop(col.id)}
          >
            <div className="colhead">
              {col.title} <span className="count">{byCol(col.id).length}</span>
            </div>
            {byCol(col.id).length === 0 && <div className="colempty">Пусто</div>}
            {byCol(col.id).map((c) => (
              <div
                key={c.id}
                className={'card' + (c.kind === 'request' ? ' kind-request' : '') + (c.overdue ? ' overdue' : '')}
                draggable={canEdit}
                onDragStart={() => setDragId(c.id)}
                onClick={() => setOpenId(c.id)}
              >
                <div className="cardtitle">{c.title}</div>
                {c.body.trim() !== '' && <div className="cardbody">{c.body}</div>}
                <div className="cardmeta">
                  {c.started_at && <span className="badge">с {fmtDate(c.started_at)}</span>}
                  {c.kind === 'request' && <span className="badge req">запрос</span>}
                  {c.waitingDays !== null && c.waitingDays > 0 && (
                    <span className={'badge' + (c.waitingDays > 3 ? ' bad' : ' wait')}>
                      ждём {plural(c.waitingDays, 'день', 'дня', 'дней')}
                    </span>
                  )}
                  {c.deadline && <span className={'badge' + (c.overdue ? ' bad' : '')}>до {fmtDate(c.deadline)}</span>}
                </div>
                {(c.assignee_login || c.files_count > 0 || c.comments_count > 0 || c.checklist_total > 0) && (
                  <div className="cardfoot">
                    {c.assignee_login && (
                      <span className="assignee">
                        <span className="avatar">{initials(c.assignee_login)}</span>
                        {c.assignee_login}
                      </span>
                    )}
                    <span className="muted">
                      {c.checklist_total > 0 && `✓ ${c.checklist_total - c.checklist_open}/${c.checklist_total}`}
                      {c.checklist_total > 0 && (c.files_count > 0 || c.comments_count > 0) && ' · '}
                      {c.files_count > 0 && `${plural(c.files_count, 'файл', 'файла', 'файлов')}`}
                      {c.files_count > 0 && c.comments_count > 0 && ' · '}
                      {c.comments_count > 0 && `${c.comments_count} комм.`}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
