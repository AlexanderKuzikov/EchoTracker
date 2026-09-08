import { useState } from 'react';
import type { Card } from './api';

function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface Ev {
  id: string;
  title: string;
  cls: string;
  label: string;
}

function eventsFor(cards: Card[], key: string): Ev[] {
  const out: Ev[] = [];
  for (const c of cards) {
    if (c.deadline === key && c.column_id !== 'done') {
      out.push({ id: c.id, title: c.title, cls: 'ev due', label: `до · ${c.title}` });
    }
    if (c.started_at === key) {
      out.push({ id: c.id, title: c.title, cls: 'ev start', label: `с · ${c.title}` });
    }
    if (c.requested_at === key && c.column_id === 'waiting') {
      out.push({ id: c.id, title: c.title, cls: 'ev wait', label: `ждём · ${c.title}` });
    }
  }
  return out;
}

export default function Calendar({ cards, onOpen }: { cards: Card[]; onOpen: (id: string) => void }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const first = new Date(ym.y, ym.m, 1);
  const offset = (first.getDay() + 6) % 7;
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(new Date(ym.y, ym.m, 1 - offset + i));
  const title = first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const todayK = dayKey(new Date());

  const shift = (d: number) => {
    const n = new Date(ym.y, ym.m + d, 1);
    setYm({ y: n.getFullYear(), m: n.getMonth() });
  };

  return (
    <div>
      <div className="row calnav">
        <button onClick={() => shift(-1)}>‹</button>
        <strong className="caltitle">{title}</strong>
        <button onClick={() => shift(1)}>›</button>
        <button onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>Сегодня</button>
      </div>
      <div className="calgrid">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
          <div key={d} className="caldow">{d}</div>
        ))}
        {cells.map((d) => {
          const k = dayKey(d);
          const ev = eventsFor(cards, k);
          const other = d.getMonth() !== ym.m;
          const we = d.getDay() === 0 || d.getDay() === 6;
          return (
            <div key={k} className={'calday' + (other ? ' other' : '') + (k === todayK ? ' today' : '') + (we ? ' we' : '')}>
              <div className="calnum">{d.getDate()}</div>
              {ev.slice(0, 3).map((e) => (
                <div key={e.cls + e.id} className={e.cls} title={e.title} onClick={() => onOpen(e.id)}>
                  {e.label}
                </div>
              ))}
              {ev.length > 3 && <div className="muted">+ещё {ev.length - 3}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
