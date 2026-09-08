export interface User {
  id: string;
  login: string;
  email: string | null;
  role: string;
}

export interface Column {
  id: string;
  title: string;
  pos: number;
}

export interface FileRow {
  id: string;
  card_id: string;
  kind: string;
  orig_name: string;
  mime: string;
  size: number;
  created_by: string | null;
  created_at: string;
}

export interface Card {
  id: string;
  title: string;
  body: string;
  column_id: string;
  kind: 'task' | 'request';
  assignee_id: string | null;
  assignee_login: string | null;
  deadline: string | null;
  requested_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  overdue: boolean;
  waitingDays: number | null;
  files?: FileRow[];
}

export class AuthError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin', ...init });
  if (r.status === 401) throw new AuthError('auth');
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as T;
}

function post<T>(path: string, obj: unknown): Promise<T> {
  return req<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });
}

export const api = {
  me: () => req<User>('/api/auth/me'),
  login: (login: string, pass: string) => post<User>('/api/auth/login', { login, pass }),
  logout: () => post<null>('/api/auth/logout', {}),
  users: () => req<User[]>('/api/users'),
  createUser: (u: { login: string; pass: string; email?: string; role?: string }) =>
    post<{ ok: boolean }>('/api/users', u),
  columns: () => req<Column[]>('/api/columns'),
  saveColumns: (cols: Array<{ id: string; title: string }>) =>
    req<{ ok: boolean }>('/api/columns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cols),
    }),
  cards: () => req<Card[]>('/api/cards'),
  getCard: (id: string) => req<Card>(`/api/cards/${id}`),
  createCard: (c: {
    title: string;
    body?: string;
    column_id?: string;
    kind?: string;
    assignee_id?: string | null;
    deadline?: string | null;
    requested_at?: string | null;
  }) => post<Card>('/api/cards', c),
  patchCard: (id: string, p: Partial<Card>) =>
    req<Card>(`/api/cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }),
  deleteCard: (id: string) => req<{ ok: boolean }>(`/api/cards/${id}`, { method: 'DELETE' }),
  fileUrl: (id: string) => `/api/files/${id}`,
  async uploadFile(cardId: string, file: Blob, name: string, kind = 'original'): Promise<FileRow> {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file, name);
    const r = await fetch(`/api/cards/${cardId}/files`, {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    if (r.status === 401) throw new AuthError('auth');
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()) as FileRow;
  },
  deleteFile: (id: string) => req<{ ok: boolean }>(`/api/files/${id}`, { method: 'DELETE' }),
};
