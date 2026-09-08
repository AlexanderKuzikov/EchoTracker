import { connect } from 'node:tls';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface SmtpEnv {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  insecure?: boolean;
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function codeOf(resp: string): number {
  const last = resp.split('\n').pop() ?? '';
  return parseInt(last.slice(0, 3), 10);
}

export function sendMail(env: SmtpEnv, to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = connect({
      host: env.host,
      port: env.port,
      timeout: 15000,
      rejectUnauthorized: !env.insecure,
    });
    const timer = setTimeout(() => {
      sock.destroy(new Error('smtp timeout'));
    }, 30000);
    let acc = '';
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err);
      else resolve();
    };
    const waitLine = (): Promise<string> => {
      const ready = pending.shift();
      if (ready !== undefined) return Promise.resolve(ready);
      return new Promise((res) => {
        waiters.push(res);
      });
    };
    const waiters: Array<(line: string) => void> = [];
    const pending: string[] = [];
    const pushLine = (line: string): void => {
      const w = waiters.shift();
      if (w) w(line);
      else pending.push(line);
    };
    sock.on('data', (d: Buffer) => {
      acc += d.toString('utf8');
      let i: number;
      while ((i = acc.indexOf('\r\n')) >= 0) {
        const line = acc.slice(0, i);
        acc = acc.slice(i + 2);
        pushLine(line);
      }
    });
    sock.on('error', (e) => done(e instanceof Error ? e : new Error(String(e))));
    const cmd = async (c: string | null, expect: number | number[]): Promise<string> => {
      let resp: string;
      if (c === null) {
        resp = await waitLine();
      } else {
        const p = waitLine();
        sock.write(c + '\r\n');
        resp = await p;
      }
      while (!/^\d{3} /.test(resp.split('\n').pop() ?? '')) {
        resp += '\n' + (await waitLine());
      }
      const got = codeOf(resp);
      const wants = Array.isArray(expect) ? expect : [expect];
      if (!wants.includes(got)) throw new Error(`smtp: expected ${wants.join('/')}, got ${resp}`);
      return resp;
    };
    const stuffed = body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const msg =
      `From: EchoTracker <${env.from}>\r\n` +
      `To: <${to}>\r\n` +
      `Subject: =?UTF-8?B?${b64(subject)}?=\r\n` +
      'MIME-Version: 1.0\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      'Content-Transfer-Encoding: 8bit\r\n' +
      `\r\n${stuffed}\r\n.`;
    (async () => {
      try {
        await cmd(null, 220);
        await cmd('EHLO echotracker', 250);
        await cmd('AUTH LOGIN', 334);
        await cmd(b64(env.user), 334);
        await cmd(b64(env.pass), 235);
        await cmd(`MAIL FROM:<${env.from}>`, 250);
        await cmd(`RCPT TO:<${to}>`, [250, 251]);
        await cmd('DATA', 354);
        await cmd(msg, 250);
        try {
          await cmd('QUIT', 221);
        } catch {
          /* прощаемся молча */
        }
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
}

export function enqueue(
  db: DatabaseSync,
  to: string,
  subject: string,
  body: string,
  delayMs = 0,
): void {
  db.prepare(
    `INSERT INTO outbox (id, to_addr, subject, body, status, attempts, next_try, created_at)
     VALUES (?, ?, ?, ?, 'queued', 0, ?, ?)`,
  ).run(randomUUID(), to, subject, body, Date.now() + delayMs, new Date().toISOString());
}

interface OutboxRow {
  id: string;
  to_addr: string;
  subject: string;
  body: string;
  attempts: number;
}

export async function pumpOutbox(
  db: DatabaseSync,
  env: SmtpEnv | null,
  log: (s: string) => void,
): Promise<void> {
  if (!env) return;
  const rows = db
    .prepare(
      `SELECT id, to_addr, subject, body, attempts FROM outbox
       WHERE status IN ('queued', 'failed') AND next_try <= ? AND attempts < 5
       ORDER BY created_at LIMIT 10`,
    )
    .all(Date.now()) as unknown as OutboxRow[];
  for (const r of rows) {
    try {
      await sendMail(env, r.to_addr, r.subject, r.body);
      db.prepare(`UPDATE outbox SET status = 'sent' WHERE id = ?`).run(r.id);
    } catch (e) {
      const attempts = r.attempts + 1;
      const next = Date.now() + attempts * attempts * 5 * 60 * 1000;
      db.prepare(`UPDATE outbox SET status = 'failed', attempts = ?, next_try = ? WHERE id = ?`).run(
        attempts,
        next,
        r.id,
      );
      log(`mail failed to ${r.to_addr}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

export function sweepReminders(
  db: DatabaseSync,
  baseUrl: string,
  warnDays: number,
): { enqueued: number } {
  const today = new Date().toISOString().slice(0, 10);
  const last = db.prepare(`SELECT value FROM settings WHERE key = 'last_sweep'`).get() as
    | { value: string }
    | undefined;
  if (last?.value === today) return { enqueued: 0 };
  let enqueued = 0;
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const due = db
    .prepare(
      `SELECT c.id, c.title, c.deadline, u.email FROM cards c
       JOIN users u ON u.id = c.assignee_id
       WHERE c.deadline IS NOT NULL AND c.deadline <= ? AND c.column_id != 'done'
       AND u.email IS NOT NULL`,
    )
    .all(tomorrow) as Array<{ id: string; title: string; deadline: string; email: string }>;
  for (const d of due) {
    enqueue(
      db,
      d.email,
      `Срок: ${d.title}`,
      `Карточка «${d.title}» — срок ${d.deadline}.\n${baseUrl}/#${d.id}`,
    );
    enqueued++;
  }
  const staleMs = warnDays * 24 * 3600 * 1000;
  const stale = db
    .prepare(
      `SELECT c.id, c.title, c.updated_at, u.email FROM cards c
       JOIN users u ON u.id = c.created_by
       WHERE c.column_id = 'waiting' AND u.email IS NOT NULL`,
    )
    .all() as Array<{ id: string; title: string; updated_at: string; email: string }>;
  for (const s of stale) {
    if (Date.now() - Date.parse(s.updated_at) < staleMs) continue;
    enqueue(
      db,
      s.email,
      `Висит ожидание: ${s.title}`,
      `Карточка «${s.title}» ждёт заказчика дольше ${warnDays} дн.\n${baseUrl}/#${s.id}`,
    );
    enqueued++;
  }
  db.prepare(`INSERT INTO settings (key, value) VALUES ('last_sweep', ?) ON CONFLICT(key) DO UPDATE SET value = ?`).run(
    today,
    today,
  );
  return { enqueued };
}
