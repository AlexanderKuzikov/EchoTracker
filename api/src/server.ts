import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, extname, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openDb, nextCode } from './db.ts';
import {
  getUser,
  roleRank,
  hashPassword,
  verifyPassword,
  createSession,
  sessionCookie,
  seedAdmin,
  type SessionUser,
} from './auth.ts';
import { enqueue, pumpOutbox, sweepReminders, type SmtpEnv } from './email.ts';

function loadEnvFile(): void {
  for (const p of ['./.env', '../.env']) {
    try {
      const text = readFileSync(p, 'utf8');
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 0) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
        if (k && !(k in process.env)) process.env[k] = v;
      }
      break;
    } catch {
      /* файла нет — идём дальше */
    }
  }
}

loadEnvFile();

const VERSION = '0.3.0';

function normBase(v: string | undefined): string {
  let b = (v ?? '/echo/').trim() || '/echo/';
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  return b;
}

const env = {
  port: Number(process.env['PORT'] ?? 8100),
  base: normBase(process.env['ECHO_BASE']),
  dataDir: process.env['DATA_DIR'] ?? './data',
  uploadsDir: process.env['UPLOADS_DIR'] ?? './uploads',
  docsDir: process.env['DOCS_DIR'] ?? '../../docs',
  adminLogin: process.env['ADMIN_LOGIN'] ?? '',
  adminPass: process.env['ADMIN_PASS'] ?? '',
  adminEmail: process.env['ADMIN_EMAIL'] ?? '',
  cookieSecure: process.env['COOKIE_SECURE'] === '1',
  baseUrl: process.env['BASE_URL'] ?? '',
  warnDays: Number(process.env['WAITING_WARN_DAYS'] ?? 3),
  workerMs: Number(process.env['OUTBOX_INTERVAL_MS'] ?? 60000),
};

const smtp: SmtpEnv | null =
  process.env['SMTP_HOST'] && process.env['SMTP_USER'] && process.env['SMTP_PASS']
    ? {
        host: process.env['SMTP_HOST'],
        port: Number(process.env['SMTP_PORT'] ?? 465),
        user: process.env['SMTP_USER'],
        pass: process.env['SMTP_PASS'],
        from: process.env['SMTP_FROM'] ?? process.env['SMTP_USER'],
        insecure: process.env['SMTP_INSECURE'] === '1',
      }
    : null;

const db = openDb(join(env.dataDir, 'echotracker.sqlite'));
mkdirSync(env.uploadsDir, { recursive: true });
const seeded = seedAdmin(db, env.adminLogin, env.adminPass, env.adminEmail);
if (seeded) console.log(`seeded admin ${seeded.login}`);

const MAX_FILE = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/xml',
  'text/xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
]);
const EXT_MIME: Record<string, string> = {
  '.bpmn': 'application/xml',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
const FILE_KINDS = new Set(['original', 'md', 'svg', 'thumb']);

function log(s: string): void {
  console.log(new Date().toISOString(), s);
}

function json(res: ServerResponse, code: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function fail(res: ServerResponse, code: number, msg: string): void {
  json(res, code, { error: msg });
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        reject(new Error('too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

interface Part {
  name: string;
  filename?: string;
  mime?: string;
  data: Buffer;
}

function parseDisposition(head: string): { name: string; filename?: string } {
  let name = '';
  let filename: string | undefined;
  const mStar = head.match(/filename\*=UTF-8''([^;\r\n]+)/i);
  if (mStar?.[1]) {
    try {
      filename = decodeURIComponent(mStar[1].replace(/\+/g, ' '));
    } catch {
      /* берём как есть ниже */
    }
  }
  for (const line of head.split('\r\n')) {
    const m = line.match(/content-disposition:\s*form-data;\s*(.*)/i);
    if (!m?.[1]) continue;
    for (const seg of m[1].split(';')) {
      const nm = seg.trim().match(/^name="([^"]*)"/);
      if (nm?.[1] !== undefined) name = nm[1];
      const fn = seg.trim().match(/^filename="([^"]*)"/);
      if (fn?.[1] !== undefined && filename === undefined) filename = fn[1];
    }
  }
  return { name, filename };
}

function parseMultipart(body: Buffer, boundary: string): Part[] {
  const out: Part[] = [];
  const delim = Buffer.from('--' + boundary);
  const close = Buffer.from('--' + boundary + '--');
  let pos = body.indexOf(delim);
  while (pos >= 0) {
    if (body.subarray(pos, pos + close.length).equals(close)) break;
    let p = pos + delim.length;
    if (body[p] === 13 && body[p + 1] === 10) p += 2;
    const headEnd = body.indexOf('\r\n\r\n', p);
    if (headEnd < 0) break;
    const head = body.subarray(p, headEnd).toString('utf8');
    const mime = head.match(/content-type:\s*([^\r\n;]+)/i)?.[1]?.trim().toLowerCase();
    const { name, filename } = parseDisposition(head);
    const dataStart = headEnd + 4;
    const needle = Buffer.concat([Buffer.from('\r\n'), delim]);
    const next = body.indexOf(needle, dataStart);
    if (next < 0) break;
    out.push({ name, filename, mime, data: body.subarray(dataStart, next) });
    pos = next + 2;
  }
  return out;
}

interface CardRow {
  id: string;
  code: string;
  files_count: number;
  comments_count: number;
  checklist_open: number;
  checklist_total: number;
  started_at: string | null;
  doc_ref: string | null;
  title: string;
  body: string;
  column_id: string;
  kind: string;
  assignee_id: string | null;
  assignee_login: string | null;
  assignee_email: string | null;
  deadline: string | null;
  requested_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / (24 * 3600 * 1000));
}

function withComputed(c: CardRow): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...c,
    overdue: c.deadline !== null && c.deadline < today && c.column_id !== 'done',
    waitingDays:
      c.column_id === 'waiting' && c.requested_at ? daysSince(c.requested_at) : null,
  };
}

function visibleTo(user: SessionUser): { sql: string; params: string[] } {
  if (roleRank(user.role) >= 1) return { sql: '1=1', params: [] };
  return { sql: '(c.created_by = ? OR c.assignee_id = ?)', params: [user.id, user.id] };
}

const CARD_SELECT = `SELECT c.*,
       (SELECT COUNT(*) FROM files f WHERE f.card_id = c.id) AS files_count,
       (SELECT COUNT(*) FROM comments m WHERE m.card_id = c.id) AS comments_count,
       (SELECT COUNT(*) FROM checklist k WHERE k.card_id = c.id AND k.done = 0) AS checklist_open,
       (SELECT COUNT(*) FROM checklist k WHERE k.card_id = c.id) AS checklist_total,
       u.login AS assignee_login, u.email AS assignee_email FROM cards c
       LEFT JOIN users u ON u.id = c.assignee_id`;

function getCard(ref: string): CardRow | undefined {
  const byId = db.prepare(`${CARD_SELECT} WHERE c.id = ?`).get(ref) as CardRow | undefined;
  if (byId) return byId;
  if (/^T-\d+$/i.test(ref)) {
    return db.prepare(`${CARD_SELECT} WHERE c.code = ?`).get(ref.toUpperCase()) as
      | CardRow
      | undefined;
  }
  return undefined;
}

function canSeeCard(user: SessionUser, card: CardRow): boolean {
  if (roleRank(user.role) >= 1) return true;
  return card.created_by === user.id || card.assignee_id === user.id;
}

function cardFiles(cardId: string): unknown[] {
  return db
    .prepare(
      `SELECT id, card_id, kind, derived_from, orig_name, mime, size, created_by, created_at
       FROM files WHERE card_id = ? ORDER BY created_at`,
    )
    .all(cardId) as unknown[];
}

function logActivity(cardId: string, actorId: string | null, kind: string, detail: string): void {
  db.prepare(
    `INSERT INTO activity (id, card_id, actor_id, kind, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), cardId, actorId, kind, detail, new Date().toISOString());
}

function colTitle(id: string): string {
  const r = db.prepare('SELECT title FROM columns WHERE id = ?').get(id) as
    | { title: string }
    | undefined;
  return r?.title ?? id;
}

function cardExtras(cardId: string): Record<string, unknown> {
  const comments = db
    .prepare(
      `SELECT m.id, m.body, m.created_at, u.login AS author FROM comments m
       LEFT JOIN users u ON u.id = m.author_id WHERE m.card_id = ? ORDER BY m.created_at`,
    )
    .all(cardId);
  const activity = db
    .prepare(
      `SELECT a.id, a.kind, a.detail, a.created_at, u.login AS actor FROM activity a
       LEFT JOIN users u ON u.id = a.actor_id WHERE a.card_id = ? ORDER BY a.created_at`,
    )
    .all(cardId);
  const checklist = db
    .prepare(
      `SELECT id, text, done, pos, created_at FROM checklist WHERE card_id = ? ORDER BY pos, rowid`,
    )
    .all(cardId);
  return { comments, activity, checklist };
}

const loginHits = new Map<string, number[]>();

function loginAllowed(ip: string): boolean {
  const now = Date.now();
  const hits = (loginHits.get(ip) ?? []).filter((t) => now - t < 5 * 60 * 1000);
  hits.push(now);
  loginHits.set(ip, hits);
  return hits.length <= 10;
}

const MIME_STATIC: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.bpmn': 'application/xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));

function serveStatic(pathname: string, res: ServerResponse): void {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const full = normalize(join(webRoot, rel));
  if (!full.startsWith(webRoot)) {
    fail(res, 403, 'forbidden');
    return;
  }
  if (existsSync(full)) {
    const data = readFileSync(full);
    res.writeHead(200, { 'Content-Type': MIME_STATIC[extname(full)] ?? 'application/octet-stream' });
    res.end(data);
    return;
  }
  const index = join(webRoot, 'index.html');
  if (existsSync(index)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(index));
    return;
  }
  fail(res, 503, 'web not built');
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const raw = url.pathname;
    const method = req.method ?? 'GET';
    const ip = req.socket.remoteAddress ?? '?';
    const bare = env.base.slice(0, -1);
    let path = raw;
    if (env.base !== '/' && raw === bare) {
      res.writeHead(302, { Location: env.base });
      res.end();
      return;
    }
    if (env.base !== '/' && raw.startsWith(env.base)) {
      path = raw.slice(env.base.length - 1);
    } else if (env.base !== '/') {
      fail(res, 404, 'not found');
      return;
    }

    if (path === '/api/health' && method === 'GET') {
      json(res, 200, { ok: true, version: VERSION });
      return;
    }

    if (path === '/api/auth/login' && method === 'POST') {
      if (!loginAllowed(ip)) {
        fail(res, 429, 'too many attempts');
        return;
      }
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')) as {
        login?: string;
        pass?: string;
      };
      const row = db.prepare('SELECT * FROM users WHERE login = ?').get(
        (body.login ?? '').trim().toLowerCase(),
      ) as
        | { id: string; login: string; email: string | null; pass_salt: string; pass_hash: string; role: string }
        | undefined;
      if (!row || !verifyPassword(body.pass ?? '', row.pass_salt, row.pass_hash)) {
        fail(res, 401, 'bad credentials');
        return;
      }
      const sid = createSession(db, row.id);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': sessionCookie(sid, env.cookieSecure, env.base),
      });
      res.end(JSON.stringify({ id: row.id, login: row.login, email: row.email, role: row.role }));
      return;
    }

    const me = getUser(db, req);
    if (!me) {
      if (path.startsWith('/api/')) {
        fail(res, 401, 'auth required');
        return;
      }
      serveStatic(path, res);
      return;
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const sid = (req.headers.cookie ?? '').match(/et_sid=([^;]+)/)?.[1];
      if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'et_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      });
      res.end('{}');
      return;
    }

    if (path === '/api/auth/me' && method === 'GET') {
      json(res, 200, me);
      return;
    }

    if (path === '/api/users' && method === 'GET') {
      if (me.role !== 'admin') {
        fail(res, 403, 'admin only');
        return;
      }
      json(
        res,
        200,
        db.prepare('SELECT id, login, email, role, created_at FROM users ORDER BY login').all(),
      );
      return;
    }

    if (path === '/api/users' && method === 'POST') {
      if (me.role !== 'admin') {
        fail(res, 403, 'admin only');
        return;
      }
      const b = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')) as {
        login?: string;
        pass?: string;
        email?: string;
        role?: string;
      };
      if (!b.login?.trim() || !b.pass || b.pass.length < 8) {
        fail(res, 400, 'login and pass>=8 required');
        return;
      }
      const cleanLogin = b.login.trim().toLowerCase();
      const role = ['admin', 'member', 'watcher'].includes(b.role ?? '') ? b.role! : 'member';
      const { salt, hash } = hashPassword(b.pass);
      try {
        db.prepare(
          'INSERT INTO users (id, login, email, pass_salt, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(randomUUID(), cleanLogin, b.email?.trim() || null, salt, hash, role, new Date().toISOString());
      } catch {
        fail(res, 409, 'login taken');
        return;
      }
      json(res, 201, { ok: true });
      return;
    }

    if (path === '/api/columns' && method === 'GET') {
      json(res, 200, db.prepare('SELECT id, title, pos FROM columns ORDER BY pos').all());
      return;
    }

    if (path === '/api/columns' && method === 'PUT') {
      if (roleRank(me.role) < 1) {
        fail(res, 403, 'read only');
        return;
      }
      const b = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')) as Array<{
        id?: string;
        title?: string;
      }>;
      if (!Array.isArray(b) || b.length === 0) {
        fail(res, 400, 'columns array required');
        return;
      }
      const upd = db.prepare('UPDATE columns SET title = ?, pos = ? WHERE id = ?');
      b.forEach((c, i) => {
        if (c.id && c.title?.trim()) upd.run(c.title.trim(), i, c.id);
      });
      json(res, 200, { ok: true });
      return;
    }

    if (path === '/api/cards' && method === 'GET') {
      const v = visibleTo(me);
      const rows = db
        .prepare(
          `${CARD_SELECT} WHERE ${v.sql} ORDER BY c.updated_at DESC`,
        )
        .all(...v.params) as unknown as CardRow[];
      json(res, 200, rows.map(withComputed));
      return;
    }

    if (path === '/api/cards' && method === 'POST') {
      const b = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8')) as {
        title?: string;
        body?: string;
        column_id?: string;
        kind?: string;
        assignee_id?: string | null;
        deadline?: string | null;
        requested_at?: string | null;
        started_at?: string | null;
        doc_ref?: string | null;
      };
      if (!b.title?.trim()) {
        fail(res, 400, 'title required');
        return;
      }
      const col = b.column_id ?? 'incoming';
      const colExists = db.prepare('SELECT id FROM columns WHERE id = ?').get(col);
      if (!colExists) {
        fail(res, 400, 'bad column');
        return;
      }
      const kind = b.kind === 'request' ? 'request' : 'task';
      if (b.assignee_id) {
        const u = db.prepare('SELECT id, email FROM users WHERE id = ?').get(b.assignee_id) as
          | { id: string; email: string | null }
          | undefined;
        if (!u) {
          fail(res, 400, 'bad assignee');
          return;
        }
      }
      const now = new Date().toISOString();
      const today = now.slice(0, 10);
      const id = randomUUID();
      const code = nextCode(db);
      db.prepare(
        `INSERT INTO cards (id, code, title, body, column_id, kind, assignee_id, deadline, requested_at, started_at, doc_ref, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        code,
        b.title.trim(),
        b.body ?? '',
        col,
        kind,
        b.assignee_id ?? null,
        b.deadline || null,
        b.requested_at || null,
        b.started_at || today,
        b.doc_ref?.trim() || null,
        me.id,
        now,
        now,
      );
      if (b.assignee_id && b.assignee_id !== me.id) {
        const u = db.prepare('SELECT email FROM users WHERE id = ?').get(b.assignee_id) as {
          email: string | null;
        };
        if (u?.email) {
          enqueue(db, u.email, `Новая карточка: ${b.title.trim()}`, `Тебе назначили «${b.title.trim()}».\n${baseUrl()}/#${id}`);
        }
      }
      logActivity(id, me.id, 'created', '');
      if (b.assignee_id) {
        const u = db.prepare('SELECT login FROM users WHERE id = ?').get(b.assignee_id) as
          | { login: string }
          | undefined;
        if (u) logActivity(id, me.id, 'assigned', u.login);
      }
      const created = getCard(id);
      json(res, 201, withComputed(created!));
      return;
    }

    const cardMatch = path.match(/^\/api\/cards\/([^/]+)(\/files)?$/);
    if (cardMatch?.[1]) {
      const card = getCard(cardMatch[1]);
      if (!card || !canSeeCard(me, card)) {
        fail(res, 404, 'not found');
        return;
      }
      if (!cardMatch[2] && method === 'GET') {
        json(res, 200, { ...withComputed(card), files: cardFiles(card.id), ...cardExtras(card.id) });
        return;
      }
      if (!cardMatch[2] && method === 'PATCH') {
        const b = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8')) as Partial<{
          title: string;
          body: string;
          column_id: string;
          kind: string;
          assignee_id: string | null;
          deadline: string | null;
          requested_at: string | null;
          started_at: string | null;
          doc_ref: string | null;
        }>;
        if (roleRank(me.role) < 1 && (b.title !== undefined || b.column_id !== undefined)) {
          fail(res, 403, 'read only');
          return;
        }
        const sets: string[] = [];
        const params: Array<string | number | null> = [];
        if (b.title !== undefined) {
          if (!b.title.trim()) {
            fail(res, 400, 'empty title');
            return;
          }
          sets.push('title = ?');
          params.push(b.title.trim());
        }
        if (b.body !== undefined) {
          sets.push('body = ?');
          params.push(b.body);
        }
        if (b.column_id !== undefined) {
          const colExists = db.prepare('SELECT id FROM columns WHERE id = ?').get(b.column_id);
          if (!colExists) {
            fail(res, 400, 'bad column');
            return;
          }
          sets.push('column_id = ?');
          params.push(b.column_id);
          if (b.column_id === 'waiting' && !card.requested_at && b.requested_at === undefined) {
            sets.push('requested_at = ?');
            params.push(new Date().toISOString().slice(0, 10));
          }
          if (b.column_id !== card.column_id) {
            logActivity(card.id, me.id, 'moved', `${colTitle(card.column_id)} → ${colTitle(b.column_id)}`);
          }
        }
        if (b.kind !== undefined) {
          sets.push('kind = ?');
          params.push(b.kind === 'request' ? 'request' : 'task');
        }
        if (b.assignee_id !== undefined) {
          if (b.assignee_id) {
            const u = db.prepare('SELECT id FROM users WHERE id = ?').get(b.assignee_id);
            if (!u) {
              fail(res, 400, 'bad assignee');
              return;
            }
          }
          sets.push('assignee_id = ?');
          params.push(b.assignee_id);
          if (b.assignee_id !== card.assignee_id) {
            const u = b.assignee_id
              ? (db.prepare('SELECT login FROM users WHERE id = ?').get(b.assignee_id) as { login: string } | undefined)
              : undefined;
            logActivity(card.id, me.id, 'assigned', u?.login ?? '—');
          }
          if (b.assignee_id && b.assignee_id !== card.assignee_id && b.assignee_id !== me.id) {
            const u = db.prepare('SELECT email FROM users WHERE id = ?').get(b.assignee_id) as {
              email: string | null;
            };
            if (u?.email) {
              enqueue(db, u.email, `Назначена карточка: ${card.title}`, `Тебе назначили «${card.title}».\n${baseUrl()}/#${card.id}`);
            }
          }
        }
        if (b.deadline !== undefined) {
          sets.push('deadline = ?');
          params.push(b.deadline || null);
        }
        if (b.requested_at !== undefined) {
          sets.push('requested_at = ?');
          params.push(b.requested_at || null);
        }
        if (b.started_at !== undefined) {
          sets.push('started_at = ?');
          params.push(b.started_at || null);
        }
        if (b.doc_ref !== undefined) {
          sets.push('doc_ref = ?');
          params.push(b.doc_ref?.trim() || null);
        }
        if (sets.length > 0) {
          sets.push('updated_at = ?');
          params.push(new Date().toISOString());
          params.push(card.id);
          db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        }
        const updated = getCard(card.id);
        json(res, 200, { ...withComputed(updated!), files: cardFiles(card.id), ...cardExtras(card.id) });
        return;
      }
      if (!cardMatch[2] && method === 'DELETE') {
        if (roleRank(me.role) < 1) {
          fail(res, 403, 'read only');
          return;
        }
        const rows = db.prepare('SELECT id FROM files WHERE card_id = ?').all(card.id) as Array<{
          id: string;
        }>;
        db.prepare('DELETE FROM cards WHERE id = ?').run(card.id);
        for (const r of rows) {
          try {
            unlinkSync(join(env.uploadsDir, r.id));
          } catch {
            /* файла уже нет */
          }
        }
        json(res, 200, { ok: true });
        return;
      }
      if (cardMatch[2] && method === 'POST') {
        if (roleRank(me.role) < 1 && card.created_by !== me.id && card.assignee_id !== me.id) {
          fail(res, 403, 'read only');
          return;
        }
        const ct = req.headers['content-type'] ?? '';
        const m = ct.match(/boundary=(.+)$/);
        if (!m?.[1]) {
          fail(res, 400, 'multipart required');
          return;
        }
        const parts = parseMultipart(await readBody(req, MAX_FILE + 1024 * 1024), m[1]);
        const file = parts.find((p) => p.filename);
        if (!file?.filename) {
          fail(res, 400, 'file required');
          return;
        }
        if (file.data.length > MAX_FILE) {
          fail(res, 413, 'file too large');
          return;
        }
        const kindRaw = parts.find((p) => p.name === 'kind')?.data.toString('utf8').trim() ?? 'original';
        const kind = FILE_KINDS.has(kindRaw) ? kindRaw : 'original';
        const parentRaw = parts.find((p) => p.name === 'derived_from')?.data.toString('utf8').trim() || null;
        let parent: string | null = null;
        if (parentRaw) {
          const prow = db.prepare('SELECT id FROM files WHERE id = ? AND card_id = ?').get(parentRaw, card.id);
          if (!prow) {
            fail(res, 400, 'bad parent');
            return;
          }
          parent = parentRaw;
        }
        let mime = file.mime || 'application/octet-stream';
        if (mime === 'application/octet-stream') {
          const byExt = EXT_MIME[extname(file.filename ?? '').toLowerCase()];
          if (!byExt) {
            fail(res, 415, 'mime not allowed: application/octet-stream');
            return;
          }
          mime = byExt;
        }
        if (!ALLOWED_MIME.has(mime)) {
          fail(res, 415, `mime not allowed: ${mime}`);
          return;
        }
        if (kind !== 'original') {
          const olds = db.prepare('SELECT id FROM files WHERE card_id = ? AND kind = ?').all(card.id, kind) as Array<{
            id: string;
          }>;
          db.prepare('DELETE FROM files WHERE card_id = ? AND kind = ?').run(card.id, kind);
          for (const o of olds) {
            try {
              unlinkSync(join(env.uploadsDir, o.id));
            } catch {
              /* файла уже нет */
            }
          }
        }
        const fid = randomUUID();
        const now = new Date().toISOString();
        writeFileSync(join(env.uploadsDir, fid), file.data);
        db.prepare(
          `INSERT INTO files (id, card_id, kind, derived_from, orig_name, mime, size, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(fid, card.id, kind, parent, file.filename, mime, file.data.length, me.id, now);
        db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now, card.id);
        if (kind === 'original') logActivity(card.id, me.id, 'file_added', file.filename);
        json(res, 201, { id: fid, card_id: card.id, kind, derived_from: parent, orig_name: file.filename, mime, size: file.data.length, created_at: now });
        return;
      }
    }

    const fileMatch = path.match(/^\/api\/files\/([^/]+)$/);
    if (fileMatch?.[1]) {
      const row = db.prepare('SELECT * FROM files WHERE id = ?').get(fileMatch[1]) as
        | { id: string; card_id: string; orig_name: string; mime: string; size: number }
        | undefined;
      if (!row) {
        fail(res, 404, 'not found');
        return;
      }
      const card = getCard(row.card_id);
      if (!card || !canSeeCard(me, card)) {
        fail(res, 404, 'not found');
        return;
      }
      if (method === 'GET') {
        const full = join(env.uploadsDir, row.id);
        if (!existsSync(full)) {
          fail(res, 404, 'file lost');
          return;
        }
        const inline = row.mime.startsWith('image/') || row.mime === 'application/pdf' || row.mime === 'image/svg+xml';
        res.writeHead(200, {
          'Content-Type': row.mime,
          'Content-Length': row.size,
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.orig_name)}`,
        });
        res.end(readFileSync(full));
        return;
      }
      if (method === 'DELETE') {
        if (roleRank(me.role) < 1) {
          fail(res, 403, 'read only');
          return;
        }
        const kids = db.prepare('SELECT id FROM files WHERE derived_from = ?').all(row.id) as Array<{
          id: string;
        }>;
        db.prepare('DELETE FROM files WHERE id = ?').run(row.id);
        for (const k of [row.id, ...kids.map((x) => x.id)]) {
          try {
            unlinkSync(join(env.uploadsDir, k));
          } catch {
            /* файла уже нет */
          }
        }
        logActivity(card.id, me.id, 'file_removed', row.orig_name);
        json(res, 200, { ok: true });
        return;
      }
    }

    const commentMatch = path.match(/^\/api\/cards\/([^/]+)\/comments$/);
    if (commentMatch?.[1] && method === 'POST') {
      const card = getCard(commentMatch[1]);
      if (!card || !canSeeCard(me, card)) {
        fail(res, 404, 'not found');
        return;
      }
      const b = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')) as { body?: string };
      if (!b.body?.trim()) {
        fail(res, 400, 'body required');
        return;
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO comments (id, card_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, card.id, me.id, b.body.trim(), now);
      db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now, card.id);
      json(res, 201, { id, body: b.body.trim(), author: me.login, created_at: now });
      return;
    }

    const commentDel = path.match(/^\/api\/comments\/([^/]+)$/);
    if (commentDel?.[1] && method === 'DELETE') {
      const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentDel[1]) as
        | { id: string; card_id: string; author_id: string | null }
        | undefined;
      if (!row) {
        fail(res, 404, 'not found');
        return;
      }
      const card = getCard(row.card_id);
      if (!card || !canSeeCard(me, card)) {
        fail(res, 404, 'not found');
        return;
      }
      if (row.author_id !== me.id && roleRank(me.role) < 1) {
        fail(res, 403, 'read only');
        return;
      }
      db.prepare('DELETE FROM comments WHERE id = ?').run(row.id);
      json(res, 200, { ok: true });
      return;
    }

    const checkMatch = path.match(/^\/api\/cards\/([^/]+)\/checklist$/);
    if (checkMatch?.[1] && method === 'POST') {
      const card = getCard(checkMatch[1]);
      if (!card || !canSeeCard(me, card)) {
        fail(res, 404, 'not found');
        return;
      }
      if (roleRank(me.role) < 1 && card.created_by !== me.id && card.assignee_id !== me.id) {
        fail(res, 403, 'read only');
        return;
      }
      const b = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')) as { text?: string };
      if (!b.text?.trim()) {
        fail(res, 400, 'text required');
        return;
      }
      const max = db.prepare('SELECT MAX(pos) AS m FROM checklist WHERE card_id = ?').get(card.id) as {
        m: number | null;
      };
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO checklist (id, card_id, text, done, pos, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
      ).run(id, card.id, b.text.trim(), (max.m ?? -1) + 1, me.id, now);
      json(res, 201, { id, text: b.text.trim(), done: 0, created_at: now });
      return;
    }

    const checkItem = path.match(/^\/api\/checklist\/([^/]+)$/);
    if (checkItem?.[1]) {
      const row = db.prepare('SELECT * FROM checklist WHERE id = ?').get(checkItem[1]) as
        | { id: string; card_id: string }
        | undefined;
      if (!row) {
        fail(res, 404, 'not found');
        return;
      }
      const card = getCard(row.card_id);
      if (!card || !canSeeCard(me, card)) {
        fail(res, 404, 'not found');
        return;
      }
      if (roleRank(me.role) < 1 && card.created_by !== me.id && card.assignee_id !== me.id) {
        fail(res, 403, 'read only');
        return;
      }
      if (method === 'PATCH') {
        const b = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')) as {
          text?: string;
          done?: boolean | number;
        };
        if (b.text !== undefined) {
          if (!b.text.trim()) {
            fail(res, 400, 'empty text');
            return;
          }
          db.prepare('UPDATE checklist SET text = ? WHERE id = ?').run(b.text.trim(), row.id);
        }
        if (b.done !== undefined) {
          db.prepare('UPDATE checklist SET done = ? WHERE id = ?').run(b.done ? 1 : 0, row.id);
        }
        json(res, 200, { ok: true });
        return;
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM checklist WHERE id = ?').run(row.id);
        json(res, 200, { ok: true });
        return;
      }
    }

    if (path === '/api/docs' && method === 'GET') {
      const one = url.searchParams.get('path');
      if (one) {
        const full = resolveDoc(one);
        if (!full) {
          fail(res, 404, 'not found');
          return;
        }
        try {
          json(res, 200, { path: one, content: readFileSync(full, 'utf8') });
        } catch {
          fail(res, 404, 'not found');
        }
        return;
      }
      json(res, 200, listDocs());
      return;
    }

    if (path === '/api/search' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim();
      if (q.length < 2) {
        json(res, 200, { cards: [], docs: [] });
        return;
      }
      const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
      const v = visibleTo(me);
      const cards = db
        .prepare(
          `SELECT c.id, c.title FROM cards c WHERE ${v.sql}
           AND (c.title LIKE ? ESCAPE '\\' OR c.body LIKE ? ESCAPE '\\')
           ORDER BY c.updated_at DESC LIMIT 20`,
        )
        .all(...v.params, like, like) as Array<{ id: string; title: string }>;
      const docs: Array<{ path: string; title: string; snippet: string }> = [];
      for (const d of listDocs()) {
        if (docs.length >= 20) break;
        const full = resolveDoc(d.path);
        if (!full) continue;
        let content = '';
        try {
          content = readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        const atName = d.path.toLowerCase().includes(q.toLowerCase());
        const at = content.toLowerCase().indexOf(q.toLowerCase());
        if (!atName && at < 0) continue;
        const snippet =
          at < 0
            ? ''
            : content
                .slice(Math.max(0, at - 60), at + 120)
                .replace(/\s+/g, ' ')
                .trim();
        docs.push({ path: d.path, title: d.title, snippet });
      }
      json(res, 200, { cards, docs });
      return;
    }

    if (path === '/api/outbox' && method === 'GET') {
      if (me.role !== 'admin') {
        fail(res, 403, 'admin only');
        return;
      }
      json(res, 200, db.prepare('SELECT id, to_addr, subject, status, attempts, next_try, created_at FROM outbox ORDER BY created_at DESC LIMIT 50').all());
      return;
    }

    if (path.startsWith('/api/')) {
      fail(res, 404, 'unknown api');
      return;
    }
    if (method === 'GET') {
      serveStatic(path, res);
      return;
    }
    fail(res, 404, 'not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 500, 'internal');
    else res.end();
  }
});

function baseUrl(): string {
  return (env.baseUrl || `http://127.0.0.1:${env.port}`).replace(/\/+$/, '');
}

const docsRoot = resolve(env.docsDir);
const projRoot = dirname(docsRoot);

interface DocEntry {
  path: string;
  title: string;
}

function docTitle(file: string, content: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  if (m?.[1]) return m[1].trim().slice(0, 80);
  return file;
}

function listDocs(): DocEntry[] {
  const out: DocEntry[] = [];
  const readme = join(projRoot, 'README.md');
  if (existsSync(readme)) {
    try {
      out.push({ path: 'README.md', title: docTitle('README.md', readFileSync(readme, 'utf8')) });
    } catch {
      /* пропускаем */
    }
  }
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 3 || out.length > 100) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names.sort()) {
      if (n.startsWith('.')) continue;
      const full = join(dir, n);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, rel + n + '/', depth + 1);
      else if (n.toLowerCase().endsWith('.md') && st.size < 512 * 1024) {
        out.push({ path: 'docs/' + rel + n, title: n });
      }
    }
  };
  walk(docsRoot, '', 0);
  for (const d of out) {
    if (d.path === 'README.md') continue;
    try {
      d.title = docTitle(d.path, readFileSync(resolveDoc(d.path) as string, 'utf8'));
    } catch {
      /* оставляем имя файла */
    }
  }
  return out;
}

function resolveDoc(rel: string): string | null {
  if (rel.includes('\\') || rel.split('/').includes('..')) return null;
  const full = rel === 'README.md' ? join(projRoot, 'README.md') : join(docsRoot, rel.replace(/^docs\//, ''));
  if (!full.toLowerCase().endsWith('.md')) return null;
  const norm = normalize(full);
  if (norm !== normalize(join(projRoot, 'README.md')) && !norm.startsWith(docsRoot + sep)) return null;
  if (!existsSync(norm)) return null;
  return norm;
}

async function tick(): Promise<void> {
  try {
    sweepReminders(db, baseUrl(), env.warnDays);
    await pumpOutbox(db, smtp, log);
  } catch (e) {
    log(`worker: ${e instanceof Error ? e.message : e}`);
  }
}

let serving = false;
function tryListen(port: number, left: number): void {
  const onErr = (e: unknown) => {
    if ((e as { code?: string }).code === 'EADDRINUSE' && left > 0) {
      log(`port ${port} busy, trying ${port + 1}`);
      tryListen(port + 1, left - 1);
    } else {
      throw e;
    }
  };
  server.once('error', onErr);
  server.listen(port, '127.0.0.1', () => {
    server.off('error', onErr);
    if (serving) return;
    serving = true;
    const addr = server.address();
    const real = typeof addr === 'object' && addr !== null ? addr.port : port;
    console.log(`echotracker ${VERSION} on 127.0.0.1:${real}`);
    setTimeout(tick, 3000).unref?.();
    setInterval(tick, env.workerMs).unref?.();
  });
}

tryListen(env.port, 20);
