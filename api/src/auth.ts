import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage } from 'node:http';

export interface SessionUser {
  id: string;
  login: string;
  email: string | null;
  role: string;
}

export function roleRank(role: string): number {
  if (role === 'admin') return 2;
  if (role === 'member') return 1;
  return 0;
}

export function hashPassword(pass: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pass, salt, 32).toString('hex');
  return { salt, hash };
}

export function verifyPassword(pass: string, salt: string, hash: string): boolean {
  const ref = Buffer.from(hash, 'hex');
  if (ref.length !== 32) return false;
  const cur = scryptSync(pass, salt, 32);
  return timingSafeEqual(cur, ref);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(sid: string, secure: boolean, path: string): string {
  let c = `et_sid=${sid}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=2592000`;
  if (secure) c += '; Secure';
  return c;
}

export function getUser(db: DatabaseSync, req: IncomingMessage): SessionUser | null {
  const sid = parseCookies(req.headers.cookie)['et_sid'];
  if (!sid) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.login, u.email, u.role FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sid, Date.now()) as SessionUser | undefined;
  return row ?? null;
}

export function createSession(db: DatabaseSync, userId: string): string {
  const sid = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    sid,
    userId,
    Date.now() + 30 * 24 * 3600 * 1000,
  );
  return sid;
}

export function seedAdmin(
  db: DatabaseSync,
  login: string,
  pass: string,
  email: string,
): SessionUser | null {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  const clean = login.trim().toLowerCase();
  if (count.c > 0 || !clean || !pass) return null;
  const { salt, hash } = hashPassword(pass);
  const id = randomBytes(8).toString('hex');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO users (id, login, email, pass_salt, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, clean, email || null, salt, hash, 'admin', now);
  return { id, login: clean, email: email || null, role: 'admin' };
}
