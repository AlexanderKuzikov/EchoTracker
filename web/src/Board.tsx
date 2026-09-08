import { useState } from 'react';
import { api, type Card, type Column, type User } from './api';
import CardModalHost from './CardModal';

interface Props {
  user: User;
  users: User[];
  columns: Column[];
  cards: Card[];
  reload: () => void;
}

export default function Board({ user, users, columns, cards, reload }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('task');
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

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
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Новая карточка…"
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="task">Задача</option>
            <option value="request">Запрос</option>
          </select>
          <button onClick={create}>Добавить</button>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <div className="board">
        {columns.map((col) => (
          <div
            key={col.id}
            className="column"
            onDragOver={(e) => canEdit && e.preventDefault()}
            onDrop={() => drop(col.id)}
          >
            <div className="colhead">
              {col.title} <span className="count">{byCol(col.id).length}</span>
            </div>
            {byCol(col.id).map((c) => (
              <div
                key={c.id}
                className={'card' + (c.overdue ? ' overdue' : '')}
                draggable={canEdit}
                onDragStart={() => setDragId(c.id)}
                onClick={() => setOpenId(c.id)}
              >
                <div className="cardtitle">{c.title}</div>
                <div className="cardmeta">
                  <span className="badge">{c.code}</span>
                  {c.kind === 'request' && <span className="badge req">запрос</span>}
                  {c.assignee_login && <span className="badge">{c.assignee_login}</span>}
                  {c.deadline && <span className={'badge' + (c.overdue ? ' bad' : '')}>до {c.deadline}</span>}
                  {c.waitingDays !== null && (
                    <span className={'badge' + (c.waitingDays > 3 ? ' bad' : ' wait')}>
                      ждём {c.waitingDays} дн.
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {openId && (
        <CardModalHost cardId={openId} users={users} columns={columns} onClose={() => { setOpenId(null); reload(); }} />
      )}
    </div>
  );
}
