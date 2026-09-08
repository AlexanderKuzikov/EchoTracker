import { useCallback, useEffect, useState } from 'react';
import { AuthError, api, type Card, type Column, type User } from './api';
import Board, { initials } from './Board';
import Calendar from './Calendar';
import CardModalHost from './CardModal';

const ROLE_NAMES: Record<string, string> = {
  admin: 'Администратор',
  member: 'Участник',
  watcher: 'Наблюдатель',
};

export default function App() {
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<'board' | 'cal'>('board');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [u, cols, list] = await Promise.all([api.users().catch(() => [] as User[]), api.columns(), api.cards()]);
    setUsers(u);
    setColumns(cols);
    setCards(list);
  }, []);

  useEffect(() => {
    api
      .me()
      .then((u) => {
        setMe(u);
        return load();
      })
      .catch((e: unknown) => {
        if (!(e instanceof AuthError)) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setReady(true));
  }, [load]);

  async function doLogin() {
    setErr('');
    try {
      const u = await api.login(login.trim(), pass);
      setMe(u);
      setLogin('');
      setPass('');
      await load();
    } catch (e) {
      setErr(e instanceof AuthError ? 'Неверный логин или пароль' : e instanceof Error ? e.message : String(e));
    }
  }

  if (!ready) return <div className="wrap">Загрузка…</div>;

  if (!me) {
    return (
      <div className="wrap narrow">
        <h1>EchoTracker</h1>
        {err && <div className="error">{err}</div>}
        <label>
          Логин
          <input name="username" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLogin()} />
        </label>
        <label>
          Пароль
          <input name="password" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLogin()} />
        </label>
        <button onClick={doLogin}>Войти</button>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="topbar">
        <strong>EchoTracker</strong>
        <span className="who" title="Твой логин">
          <span className="avatar">{initials(me.login)}</span>
          {me.login}
        </span>
        <span className="badge" title="Твоя роль">{ROLE_NAMES[me.role] ?? me.role}</span>
        <button
          className="link"
          onClick={() => api.logout().then(() => setMe(null))}
        >
          Выйти
        </button>
        <span className="viewswitch">
          <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Доска</button>
          <button className={view === 'cal' ? 'on' : ''} onClick={() => setView('cal')}>Календарь</button>
        </span>
      </header>
      {err && <div className="error">{err}</div>}
      {view === 'board' ? (
        <Board user={me} columns={columns} cards={cards} reload={() => load().catch(() => undefined)} setOpenId={setOpenId} />
      ) : (
        <Calendar cards={cards} onOpen={setOpenId} />
      )}
      {openId && (
        <CardModalHost cardId={openId} users={users} columns={columns} onClose={() => { setOpenId(null); load().catch(() => undefined); }} />
      )}
      {me.role === 'admin' && <AdminPanel users={users} reload={load} />}
    </div>
  );
}

function AdminPanel({ users, reload }: { users: User[]; reload: () => void }) {
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [msg, setMsg] = useState('');

  async function add() {
    setMsg('');
    try {
      await api.createUser({ login: login.trim(), pass, email: email.trim() || undefined, role });
      setLogin('');
      setPass('');
      setEmail('');
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <details className="admin">
      <summary>Пользователи ({users.length})</summary>
      {msg && <div className="error">{msg}</div>}
      <ul>
        {users.map((u) => (
          <li key={u.id}>
            {u.login} · {u.role}
            {u.email ? ` · ${u.email}` : ' · без почты'}
          </li>
        ))}
      </ul>
      <div className="row">
        <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Логин" />
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Пароль 8+" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">member</option>
          <option value="watcher">watcher</option>
          <option value="admin">admin</option>
        </select>
        <button onClick={add}>Создать</button>
      </div>
    </details>
  );
}
