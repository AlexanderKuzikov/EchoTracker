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
  derived_from: string | null;
  orig_name: string;
  mime: string;
  size: number;
  created_by: string | null;
  created_at: string;
}

export interface CommentRow {
  id: string;
  body: string;
  author: string | null;
  created_at: string;
}

export interface ActivityRow {
  id: string;
  kind: string;
  detail: string;
  actor: string | null;
  created_at: string;
}

export interface CheckItem {
  id: string;
  text: string;
  done: number;
  pos: number;
  created_at: string;
}

export interface Card {
  id: string;
  code: string;
  files_count: number;
  title: string;
  body: string;
  column_id: string;
  kind: 'task' | 'request';
  assignee_id: string | null;
  assignee_login: string | null;
  deadline: string | null;
  requested_at: string | null;
  started_at: string | null;
  doc_ref: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  overdue: boolean;
  waitingDays: number | null;
  files?: FileRow[];
  comments?: CommentRow[];
  activity?: ActivityRow[];
  checklist?: CheckItem[];
  comments_count: number;
  checklist_open: number;
  checklist_total: number;
}

export interface DocEntry {
  path: string;
  title: string;
}

export interface SearchHit {
  cards: Array<{ id: string; title: string }>;
  docs: Array<{ path: string; title: string; snippet: string }>;
}

export class AuthError extends Error {}

const BASE: string = import.meta.env.BASE_URL;

const u = (p: string): string => `${BASE}api${p}`;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(u(path), { credentials: 'same-origin', ...init });
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
  me: () => req<User>('/auth/me'),
  login: (login: string, pass: string) => post<User>('/auth/login', { login, pass }),
  logout: () => post<null>('/auth/logout', {}),
  users: () => req<User[]>('/users'),
  createUser: (u: { login: string; pass: string; email?: string; role?: string }) =>
    post<{ ok: boolean }>('/users', u),
  columns: () => req<Column[]>('/columns'),
  saveColumns: (cols: Array<{ id: string; title: string }>) =>
    req<{ ok: boolean }>('/columns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cols),
    }),
  cards: () => req<Card[]>('/cards'),
  getCard: (id: string) => req<Card>(`/cards/${id}`),
  createCard: (c: {
    title: string;
    body?: string;
    column_id?: string;
    kind?: string;
    assignee_id?: string | null;
    deadline?: string | null;
    requested_at?: string | null;
    started_at?: string | null;
    doc_ref?: string | null;
  }) => post<Card>('/cards', c),
  patchCard: (id: string, p: Partial<Card>) =>
    req<Card>(`/cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }),
  deleteCard: (id: string) => req<{ ok: boolean }>(`/cards/${id}`, { method: 'DELETE' }),
  fileUrl: (id: string) => u(`/files/${id}`),
  async uploadFile(cardId: string, file: Blob, name: string, kind = 'original', derivedFrom?: string): Promise<FileRow> {
    const form = new FormData();
    form.append('kind', kind);
    if (derivedFrom) form.append('derived_from', derivedFrom);
    form.append('file', file, name);
    const r = await fetch(u(`/cards/${cardId}/files`), {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    if (r.status === 401) throw new AuthError('auth');
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()) as FileRow;
  },
  deleteFile: (id: string) => req<{ ok: boolean }>(`/files/${id}`, { method: 'DELETE' }),
  addComment: (cardId: string, body: string) => post<CommentRow>(`/cards/${cardId}/comments`, { body }),
  deleteComment: (id: string) => req<{ ok: boolean }>(`/comments/${id}`, { method: 'DELETE' }),
  addCheck: (cardId: string, text: string) => post<CheckItem>(`/cards/${cardId}/checklist`, { text }),
  patchCheck: (id: string, p: { text?: string; done?: boolean }) =>
    req<{ ok: boolean }>(`/checklist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }),
  deleteCheck: (id: string) => req<{ ok: boolean }>(`/checklist/${id}`, { method: 'DELETE' }),
  docs: () => req<DocEntry[]>('/docs'),
  doc: (path: string) => req<{ path: string; content: string }>(`/docs?path=${encodeURIComponent(path)}`),
  search: (q: string) => req<SearchHit>(`/search?q=${encodeURIComponent(q)}`),
};
