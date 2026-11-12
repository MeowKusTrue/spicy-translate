// Standalone isolated HTTP regression: node --test server/align-cache.test.mjs
// Uses only port 18788, a temporary data directory and a fake ML runner. Requires ffmpeg on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const port = 18788, base = `http://127.0.0.1:${port}`;
function wav(seconds = 1) {
  const sr = 8000, samples = Math.round(sr * seconds), b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40); return b;
}
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
}
async function request(url, method = 'GET', body) {
  const response = await fetch(base + url, { method, body });
  const data = await response.json(); return { status: response.status, data };
}
async function ready(child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('sandbox exited before ready');
    try { const r = await fetch(base + '/api/version'); if (r.ok) return; } catch {}
    await delay(30);
  }
  throw new Error('sandbox did not start');
}
async function finished() {
  for (let i = 0; i < 100; i++) {
    const { data } = await request('/api/align');
    if (!data.running) { assert.equal(data.error, ''); return data; }
    await delay(30);
  }
  throw new Error('fake runner did not finish');
}

test('durable hash cache, isolated operations, RX import and conflict safety', { timeout: 30000 }, async () => {
  await freePort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spicy-align-cache-'));
  const fake = path.join(tmp, 'fake'); fs.mkdirSync(fake);
  // Node accepts the fake .py entry as JS. No Python/model/package installation is involved.
  fs.writeFileSync(path.join(fake, 'align.py'), `
    const fs = require('node:fs'), path = require('node:path');
    const args = process.argv.slice(2), out = args[args.indexOf('-o') + 1];
    if (!args.includes('--separate-only') && !args.includes('--vocal-file')) process.exit(8);
    let vocal = args.includes('--vocal-file') ? args[args.indexOf('--vocal-file') + 1] : '';
    if (!vocal) {
      const stems = out.replace(/\\.json$/, '.stems'); fs.mkdirSync(stems, {recursive:true});
      vocal = path.join(stems, args[args.indexOf('--sep')+1] === 'roformer' ? 'vocals-roformer.wav' : 'vocals.wav');
      fs.copyFileSync(args[0], vocal);
      const source = args[args.indexOf('--sep')+1] === 'roformer' ? 'roformer' : 'htdemucs';
      fs.writeFileSync(vocal + '.json', JSON.stringify({source, model: source === 'roformer' ? 'vocals_mel_band_roformer.ckpt' : 'htdemucs'}));
      fs.appendFileSync(path.join(__dirname, 'extractions.log'), source + '\\n');
    }
    fs.appendFileSync(path.join(__dirname, 'runs.log'), JSON.stringify(args) + '\\n');
    const project = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    if (args.includes('--transcribe')) {
      if (!args.includes('--vocal-file') || args.includes('--detect-back') || project.lines.length) process.exit(9);
      project.lines = [{t:0, end:1, text:'recognized words', tr:'', sync:{orig:[{a:0,b:.5,g:1},{a:.5,b:1,g:1}]}}];
    }
    console.log(JSON.stringify({plan: args.includes('--separate-only') ? ['demucs'] : args.includes('--transcribe') ? ['transcribe', 'align'] : ['align']}));
    setTimeout(() => { fs.writeFileSync(out, JSON.stringify(project)); console.log(JSON.stringify({done:true, out, vocals:vocal})); }, 250);
  `);
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['server/index.ts', '--http'], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, SPICY_PORT: String(port), SPICY_DIR: path.join(tmp, 'data'), SPICY_ALIGN_DIR: fake, SPICY_ALIGN_PY: process.execPath } });
    await ready(child);
  };
  const stop = async () => { if (child && child.exitCode === null) { const closed = new Promise(resolve => child.once('exit', resolve)); child.kill(); await closed; } };
  try {
    await start();
    const original = wav(), key = createHash('sha256').update(original).digest('hex');
    let r = await request('/api/align/audio?ext=wav', 'POST', original);
    assert.deepEqual(r.data, { ok: true, bytes: original.length, audioKey: key, vocals: false });
    const project = { lines: [{ t: 0, end: 1, text: 'existing words', tr: 'unchanged translation' }], meta: { title: 'unchanged' }, backingCandidates: [{ text: 'keep' }] };
    const emptyProject = { lines: [], meta: { title: 'no lyrics', artist: 'preserve me' }, warnings: ['keep'], backingCandidates: [] };
    r = await request('/api/align?operation=words', 'POST', JSON.stringify(project)); assert.equal(r.status, 409);
    assert.equal((await request('/api/align?operation=transcribe', 'POST', JSON.stringify(emptyProject))).status, 409);
    r = await request('/api/align?operation=separate', 'POST', JSON.stringify(project)); assert.equal(r.status, 200);
    const separateRun = r.data.runId; assert.match(separateRun, /^[a-f0-9-]{36}$/);
    assert.equal((await request('/api/align')).data.runId, separateRun);
    assert.equal((await request('/api/align/audio', 'POST', wav(2))).status, 409);
    assert.equal((await request('/api/align/vocals?audioKey=' + key, 'POST', original)).status, 409);
    let status = await finished(); assert.deepEqual(status.result, project); assert.equal(status.operation, 'separate');
    assert.equal(status.vocalSource, 'htdemucs'); assert.equal(status.audioKey, key);
    assert.equal((await request('/api/align/audio', 'POST', original)).data.vocals, true);
    assert.equal((await request('/api/align')).data.runId, '', 'audio reupload resets result ownership');
    assert.equal((await request('/api/align?sep=roformer')).data.vocals, false);
    assert.equal((await request('/api/align?operation=words&sep=roformer', 'POST', JSON.stringify(project))).status, 409);
    await stop(); await start();
    assert.equal((await request('/api/align/audio', 'POST', original)).data.vocals, true, 'reupload after restart restores stem');
    assert.equal((await request('/api/align?operation=words&transcribe=1', 'POST', JSON.stringify(project))).status, 400);
    assert.equal((await request('/api/align?operation=words&detectBack=1', 'POST', JSON.stringify(project))).status, 400);
    assert.equal((await request('/api/align?operation=words', 'POST', JSON.stringify({ lines: [] }))).status, 400);
    r = await request('/api/align?operation=words', 'POST', JSON.stringify(project)); assert.equal(r.status, 200);
    assert.notEqual(r.data.runId, separateRun, 'each accepted run has unique ownership');
    status = await finished(); assert.equal(status.runId, r.data.runId); assert.deepEqual(status.result, project); assert.equal(status.operation, 'words');
    const liveProject = (await request('/api/project')).data;
    const extractionLog = path.join(fake, 'extractions.log'), runsLog = path.join(fake, 'runs.log');
    const beforeTranscribe = fs.readFileSync(extractionLog, 'utf8');
    const runsBeforeRejects = fs.readFileSync(runsLog, 'utf8');
    assert.equal((await request('/api/align?operation=transcribe', 'POST', JSON.stringify(project))).status, 409);
    assert.equal((await request('/api/align?operation=transcribe&detectBack=1', 'POST', JSON.stringify(emptyProject))).status, 400);
    assert.equal((await request('/api/align?operation=transcribe&audioKey=' + '0'.repeat(64), 'POST', JSON.stringify(emptyProject))).status, 409);
    assert.equal(fs.readFileSync(runsLog, 'utf8'), runsBeforeRejects, 'rejected requests never start ML');
    r = await request('/api/align?operation=transcribe&audioKey=' + key, 'POST', JSON.stringify(emptyProject));
    assert.equal(r.status, 200); assert.notEqual(r.data.runId, status.runId);
    assert.equal((await request('/api/align')).data.runId, r.data.runId);
    assert.equal((await request('/api/align?operation=words', 'POST', JSON.stringify(project))).status, 409);
    status = await finished();
    assert.equal(status.runId, r.data.runId); assert.equal(status.operation, 'transcribe');
    assert.deepEqual(status.plan, ['transcribe', 'align']);
    assert.deepEqual({ ...status.result, lines: [] }, emptyProject, 'metadata and review fields survive recognition');
    assert.equal(status.result.lines[0].text, 'recognized words');
    assert.ok(status.result.lines[0].sync.orig.every(w => w.g === 1), 'recognized timings are draft');
    assert.deepEqual((await request('/api/project')).data, liveProject, 'result never overwrites live project');
    const cachedArgs = JSON.parse(fs.readFileSync(runsLog, 'utf8').trim().split('\n').at(-1));
    assert.ok(cachedArgs.includes('--transcribe'));
    const cachedVocalPath = cachedArgs[cachedArgs.indexOf('--vocal-file') + 1];
    assert.equal(cachedVocalPath, path.join(tmp, 'data', 'align', 'cache', key, 'htdemucs', 'out.spicy.stems', 'vocals.wav'));
    assert.deepEqual(fs.readFileSync(cachedVocalPath), original);
    assert.equal(fs.readFileSync(extractionLog, 'utf8'), beforeTranscribe, 'transcribe never separates');
    // Only committed, identity-matching markers may advertise a generated stem.
    const cache = path.join(tmp, 'data', 'align', 'cache', key), roformer = path.join(cache, 'roformer', 'out.spicy.stems');
    fs.mkdirSync(roformer, { recursive: true });
    const direct = path.join(roformer, 'vocals-roformer.wav'), fallback = path.join(roformer, 'vocals.wav');
    fs.writeFileSync(direct, original);
    assert.equal((await request('/api/align?sep=roformer')).data.vocals, false, 'unmarked stem is not committed');
    fs.writeFileSync(direct + '.json', '{broken');
    assert.equal((await request('/api/align?sep=roformer')).data.vocals, false, 'broken marker rejected');
    fs.writeFileSync(direct + '.json', JSON.stringify({source: 'roformer', model: 'wrong-model'}));
    assert.equal((await request('/api/align?sep=roformer')).data.vocals, false, 'wrong model rejected');
    fs.writeFileSync(direct + '.json', JSON.stringify({source: 'roformer', model: 'vocals_mel_band_roformer.ckpt'}));
    assert.equal((await request('/api/align?sep=roformer')).data.vocalSource, 'roformer');
    fs.writeFileSync(direct + '.json', JSON.stringify({source: 'htdemucs', model: 'htdemucs'}));
    assert.equal((await request('/api/align?sep=roformer')).data.vocals, false, 'wrong source rejected');
    fs.writeFileSync(fallback, original);
    assert.equal((await request('/api/align?sep=roformer')).data.vocals, false, 'fallback also requires marker');
    fs.writeFileSync(fallback + '.json', JSON.stringify({source: 'htdemucs', model: 'htdemucs'}));
    assert.equal((await request('/api/align?sep=roformer')).data.vocalSource, 'htdemucs', 'fallback reports actual source');
    const count = fs.readFileSync(path.join(fake, 'extractions.log'), 'utf8');
    assert.equal((await request('/api/align?operation=words&sep=roformer', 'POST', JSON.stringify(project))).status, 200);
    status = await finished(); assert.equal(status.vocalSource, 'htdemucs');
    assert.equal(fs.readFileSync(path.join(fake, 'extractions.log'), 'utf8'), count, 'words reused fallback without separation');
    await stop(); await start();
    assert.equal((await request('/api/align/audio?sep=roformer', 'POST', original)).data.vocals, true);
    assert.equal((await request('/api/align?sep=roformer')).data.vocalSource, 'htdemucs', 'fallback survives restart');
    r = await request('/api/align/vocals?audioKey=' + key, 'POST', original); assert.equal(r.status, 200); assert.equal(r.data.vocalSource, 'imported');
    const importMarker = path.join(cache, 'imported.json'), importMeta = fs.readFileSync(importMarker, 'utf8');
    fs.renameSync(importMarker, importMarker + '.hold');
    assert.equal((await request('/api/align?sep=roformer')).data.vocalSource, 'htdemucs', 'imported WAV without marker is ignored');
    fs.writeFileSync(importMarker, '{broken');
    assert.equal((await request('/api/align?sep=roformer')).data.vocalSource, 'htdemucs', 'malformed import marker is ignored');
    fs.writeFileSync(importMarker, JSON.stringify({source: 'roformer'}));
    assert.equal((await request('/api/align?sep=roformer')).data.vocalSource, 'htdemucs', 'wrong imported identity is ignored');
    fs.writeFileSync(importMarker, importMeta);
    const importFile = path.join(cache, 'imported.wav'); fs.renameSync(importFile, importFile + '.hold');
    assert.equal((await request('/api/align?sep=roformer')).data.vocalSource, 'htdemucs', 'marker without WAV is ignored');
    fs.renameSync(importFile + '.hold', importFile);
    const getVocal = () => fetch(base + '/api/align/vocals?audioKey=' + key + '&sep=roformer').then(r => r.arrayBuffer()).then(x => Buffer.from(x));
    const imported = await getVocal(); assert.ok(imported.length > 44);
    assert.equal((await request('/api/align?sep=roformer')).data.vocalSource, 'imported');
    const importedMarkerBefore = fs.readFileSync(importMarker, 'utf8');
    assert.equal((await request('/api/align?operation=transcribe&sep=roformer', 'POST', JSON.stringify(emptyProject))).status, 200);
    status = await finished(); assert.equal(status.vocalSource, 'imported'); assert.equal(status.result.lines[0].text, 'recognized words');
    const importedArgs = JSON.parse(fs.readFileSync(runsLog, 'utf8').trim().split('\n').at(-1));
    assert.equal(importedArgs[importedArgs.indexOf('--vocal-file') + 1], importFile);
    assert.deepEqual(await getVocal(), imported); assert.equal(fs.readFileSync(importMarker, 'utf8'), importedMarkerBefore);
    assert.equal(fs.readFileSync(extractionLog, 'utf8'), beforeTranscribe);
    assert.equal((await request('/api/align/vocals?audioKey=' + key, 'POST', Buffer.from('not audio'))).status, 422);
    assert.deepEqual(await getVocal(), imported);
    assert.equal((await request('/api/align/vocals?audioKey=' + key, 'POST', wav(2))).status, 422);
    assert.deepEqual(await getVocal(), imported);
    assert.equal((await request('/api/align/vocals?audioKey=../../bad', 'POST', original)).status, 400);
    assert.equal((await request('/api/align/vocals?audioKey=' + '0'.repeat(64), 'POST', original)).status, 409);
    assert.equal((await request('/api/align?operation=words&audioKey=' + '0'.repeat(64), 'POST', JSON.stringify(project))).status, 409);
    assert.deepEqual(fs.readFileSync(path.join(tmp, 'data', 'align', 'cache', key, 'original')), original);
    await stop(); await start();
    assert.equal((await request('/api/align/audio?sep=roformer', 'POST', original)).data.vocals, true);
    assert.equal((await request('/api/align?sep=roformer')).data.vocalSource, 'imported');
  } finally {
    await stop();
    // tmp is a freshly created test-only directory, never SPICY_DIR from the caller.
    assert.ok(path.basename(tmp).startsWith('spicy-align-cache-')); fs.rmSync(tmp, { recursive: true, force: true });
  }
});
