import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const children = new Set();

function portFree(port) {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port, timeout: 500 });
    s.on('connect', () => {
      s.end();
      resolve(false);
    });
    s.on('error', () => resolve(true));
    s.on('timeout', () => {
      s.destroy();
      resolve(true);
    });
  });
}

async function pick(start) {
  for (let p = start; p < start + 50; p++) {
    if (await portFree(p)) return p;
  }
  throw new Error(`no free port from ${start}`);
}

function run(name, cmd, args, cwd, env) {
  const p = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  children.add(p);
  let rest = '';
  const tag = (d, out) => {
    rest += d.toString();
    const lines = rest.split('\n');
    rest = lines.pop() ?? '';
    for (const l of lines) out.write(`[${name}] ${l}\n`);
  };
  p.stdout.on('data', (d) => tag(d, process.stdout));
  p.stderr.on('data', (d) => tag(d, process.stderr));
  p.on('exit', (code) => {
    console.log(`[${name}] exit ${code ?? '?'}`);
    shutdown();
  });
  return p;
}

let done = false;
function shutdown() {
  if (done) return;
  done = true;
  for (const p of children) {
    try {
      p.kill();
    } catch {
      /* уже вышел */
    }
  }
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const apiPort = await pick(Number(process.env['PORT'] ?? 8100));
let webPort = Number(process.env['WEB_PORT'] ?? 5174);
if (webPort === apiPort) webPort = apiPort + 1;
webPort = await pick(webPort);
const base = process.env['ECHO_BASE'] ?? '/echo/';
run('api', 'node', ['--watch', 'src/server.ts'], join(root, 'api'), { PORT: String(apiPort) });
run('web', 'pnpm', ['--filter', '@echotracker/web', 'dev'], root, {
  WEB_PORT: String(webPort),
  API_PORT: String(apiPort),
});
console.log(`dev: api :${apiPort}, web :${webPort}${base} — Ctrl+C гасит всё`);
