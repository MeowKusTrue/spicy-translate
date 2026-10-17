// What «Spicy Translate.bat» runs: one click -> the editor in the browser, nothing to think about.
// - a current server already on the port (the app, the MCP server, another launch) -> just open it;
// - an outdated one -> ask it to hand the port over (/api/yield); a very old one that can't -> use the next free port;
// - otherwise: install / build when needed, start the server hidden with --auto-exit, open the browser.
// The server stops by itself a little after the last editor tab is closed.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 11, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (m) => console.log(m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const version = (port) => fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok ? r.json() : { api: 0 }).catch(e => e?.cause?.code === 'ECONNREFUSED' || e?.name === 'TypeError' ? null : { api: 0 });
const free = (port) => new Promise(r => { const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(port, '127.0.0.1'); });
const open = (url) => { if (process.env.SPICY_NO_BROWSER !== '1') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(); };
const npm = (args) => spawnSync(`npm ${args.join(' ')}`, { cwd: root, stdio: 'inherit', shell: true }).status === 0;

let port = +(process.env.SPICY_PORT || 8787);
const v = await version(port);
if (v && v.api >= API) { say('Редактор уже запущен — открываю.'); open(`http://127.0.0.1:${port}/`); process.exit(0); }
if (v) { // something older holds the port
  await fetch(`http://127.0.0.1:${port}/api/yield`, { method: 'POST', signal: AbortSignal.timeout(1500) }).catch(() => {});
  for (let i = 0; i < 20 && !(await free(port)); i++) await sleep(150);
  if (!(await free(port))) { // too old to hand over (e.g. an MCP server started before an update): take the next free port
    while (!(await free(++port)));
    say(`На порту ${+(process.env.SPICY_PORT || 8787)} работает старая версия сервера — запускаю рядом, на ${port}.`);
  }
}
if (!fs.existsSync(path.join(root, 'node_modules'))) { say('Первый запуск: ставлю зависимости (минута-две)…'); if (!npm(['install'])) process.exit(1); }
const dist = path.join(root, 'dist', 'index.html'), newest = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).mtimeMs), 0);
if (!fs.existsSync(dist) || newest(path.join(root, 'src')) > fs.statSync(dist).mtimeMs) { say('Собираю редактор…'); if (!npm(['run', 'build', '--silent'])) process.exit(1); }

const srv = spawn(process.execPath, [path.join(root, 'server', 'index.ts'), '--http', '--auto-exit'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, SPICY_PORT: String(port) } });
srv.unref();
for (let i = 0; i < 50 && !(await version(port))?.api; i++) await sleep(100);
say(`Готово: http://127.0.0.1:${port}/ — закроешь вкладку, сервер выключится сам.`);
open(`http://127.0.0.1:${port}/`);
