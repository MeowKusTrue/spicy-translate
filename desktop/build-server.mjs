// The editor's server as one Windows exe for the desktop app (Node "single executable application"):
// esbuild bundles server/index.ts into one CommonJS file, Node turns it into a blob, postject injects it into node.exe.
// Output: desktop/src-tauri/binaries/spicy-server-<target triple>.exe (Tauri's externalBin naming).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = 'desktop/.build', bin = 'desktop/src-tauri/binaries';
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(bin, { recursive: true });
await build({ entryPoints: ['server/index.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: `${out}/server.cjs`, logLevel: 'warning', logOverride: { 'empty-import-meta': 'silent' } }); // import.meta only matters when run as .ts
fs.writeFileSync(`${out}/sea.json`, JSON.stringify({ main: `${out}/server.cjs`, output: `${out}/server.blob`, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
execFileSync(process.execPath, ['--experimental-sea-config', `${out}/sea.json`], { stdio: 'inherit' });
const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH + path.delimiter + path.join(process.env.USERPROFILE || '', '.cargo', 'bin') } }).match(/host: (\S+)/)[1];
const exe = path.join(bin, `spicy-server-${triple}.exe`);
fs.copyFileSync(process.execPath, exe);
execFileSync(process.execPath, [path.join('node_modules', 'postject', 'dist', 'cli.js'), exe, 'NODE_SEA_BLOB', `${out}/server.blob`, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'], { stdio: 'inherit' });
console.log('server exe:', exe, (fs.statSync(exe).size / 1e6).toFixed(1) + ' MB');
