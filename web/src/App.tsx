import { useCallback, useEffect, useState } from 'react';
import { AuthError, api, type Card, type Column, type User } from './api';
import Board, { initials } from './Board';
import Calendar from './Calendar';
import CardModalHost from './CardModal';
import Docs from './Docs';
import NoFill from './NoFill';

const ROLE_NAMES: Record<string, string> = {
  admin: 'Администратор',
  member: 'Участник',
  watcher: 'Наблюдатель',
};

let loginBusy = false;

function loginErr(e: unknown): string {
  if (e instanceof AuthError) return 'Неверный логин или пароль';
  const msg = e instanceof Error ? e.message : String(e);
  if (/too many attempts/i.test(msg)) return 'Слишком много попыток входа, подожди пару минут';
  return msg;
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.5 8S3.8 3.8 8 3.8 14.5 8 14.5 8 12.2 12.2 8 12.2 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.5 8S3.8 3.8 8 3.8c1.5 0 2.8.5 3.9 1.2M14.5 8S12.2 12.2 8 12.2c-1.5 0-2.8-.5-3.9-1.2" />
      <path d="M2.5 2.5l11 11" />
    </svg>
  );
}

export default function App() {
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<'board' | 'cal' | 'docs'>('board');
  const [openId, setOpenId] = useState<string | null>(null);
  const [docPath, setDocPath] = useState<string | null>(null);
  const [ver, setVer] = useState('');

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
    fetch(`${import.meta.env.BASE_URL}api/health`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j: unknown) => {
        const v = (j as { version?: unknown }).version;
        if (typeof v === 'string') setVer(v);
      })
      .catch(() => undefined);
  }, [load]);

  async function doLogin() {
    if (loginBusy) return;
    loginBusy = true;
    setErr('');
    try {
      const u = await api.login(login.trim(), pass);
      setMe(u);
      setLogin('');
      setPass('');
      await load();
    } catch (e) {
      setErr(loginErr(e));
    } finally {
      loginBusy = false;
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
          <span className="passwrap">
            <input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLogin()} />
            <button
              type="button"
              className="iconbtn eyebtn"
              title={show ? 'Скрыть пароль' : 'Показать пароль'}
              aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
              aria-pressed={show}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </span>
        </label>
        <button onClick={doLogin}>Войти</button>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="topbar">
        <strong><span className="logodot" />EchoTracker</strong>
        {ver !== '' && (
          <span className="muted" title="версия api — если её нет, фронт старый, обновись">
            v{ver}
          </span>
        )}
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
          <button className={view === 'docs' ? 'on' : ''} onClick={() => setView('docs')}>Документы</button>
        </span>
      </header>
      {err && <div className="error">{err}</div>}
      {view === 'board' && (
        <Board user={me} columns={columns} cards={cards} reload={() => load().catch(() => undefined)} setOpenId={setOpenId} />
      )}
      {view === 'cal' && <Calendar cards={cards} onOpen={setOpenId} />}
      {view === 'docs' && <Docs initialPath={docPath} onOpenCard={(id) => { setView('board'); setOpenId(id); }} />}
      {openId && (
        <CardModalHost
          cardId={openId}
          users={users}
          columns={columns}
          onClose={() => { setOpenId(null); load().catch(() => undefined); }}
          onOpenDoc={(p) => { setDocPath(p); setView('docs'); }}
        />
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
        <NoFill name="echotracker-new-login" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Логин" />
        <NoFill name="echotracker-new-pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Пароль 8+" />
        <NoFill name="echotracker-new-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
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
