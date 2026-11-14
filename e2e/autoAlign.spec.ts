import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const fixture = { v: 1, meta: { title: 'Backing fixture', artist: 'Test', lang: 'ru', mode: 'translation', md: [] }, lines: [
  { t: 0, end: 1, text: 'основная строка', tr: 'lead line', sync: { orig: [{ a: 0, b: .5, g: 1 }, { a: .5, b: 1, g: 1 }] } },
] };
function wav() {
  const b = Buffer.alloc(44 + 16000 * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40);
  return b;
}

test('words-only forwards models, preserves text and ignores unsolicited backing candidates', async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  const original = wav(), audioKey = createHash('sha256').update(original).digest('hex');
  let started = false, query = '';
  await page.addInitScript(() => { localStorage.setItem('helpSeen','1'); if (!localStorage.getItem('alignModels')) localStorage.setItem('alignModels', JSON.stringify({detectBack:true})); });
  await page.route('**/api/align/setup*', route => route.fulfill({ json: { installed:true, backend:'cpu', running:false } }));
  await page.route('**/api/align/gpu', route => route.fulfill({ json: { names:[], backend:'cpu', why:'test' } }));
  await page.route(/\/api\/align(?:\?.*)?$/, route => {
    if(route.request().method()==='POST'){ query=route.request().url();started=true;return route.fulfill({json:{ok:true}}); }
    return route.fulfill({json:{available:true,running:false,audioKey,vocals:true,result:started?{...fixture,backingCandidates:[{t:.2,end:.8,text:'',tr:'',bg:{text:'invented backing',tr:''}}]}:null}});
  });
  await page.route('**/api/align/audio?*', route => route.fulfill({json:{ok:true,audioKey,vocals:true}}));
  await page.route('**/api/align/vocals*', route => route.fulfill({contentType:'audio/wav',body:original}));
  await page.goto('/');
  await page.locator('#fileAudio').setInputFiles({name:'test.wav',mimeType:'audio/wav',buffer:original});
  await page.locator('#nav-sync').click();await page.locator('#btnEditorCommands').click();await page.locator('#btnAlignPanel').click();
  await expect(page.locator('#alignDetectBack')).toHaveCount(0);
  await page.locator('#alignAdvanced summary').click();
  await page.locator('#alignSeparator').selectOption('roformer');await page.locator('#alignAsr').selectOption('large-v3');await page.locator('#alignModel').selectOption('mms');await page.locator('#alignLocateLines').check();
  await page.locator('#alignPanel .close').click();await page.locator('#btnAutoAlign').click();
  await expect.poll(()=>query).toContain('operation=words');await expect(page.locator('#btnAutoAlign')).toBeEnabled();
  expect(query).toContain('asr=large-v3');expect(query).toContain('sep=roformer');expect(query).toContain('aligner=mms');expect(query).toContain('detectBack=0');expect(query).toContain('locateLines=1');
  await expect(page.locator('#backingReview')).toHaveCount(0);
  expect((await(await request.get('/api/project')).json()).project.lines).toEqual(fixture.lines);
  await page.reload();await page.locator('#nav-sync').click();if(await page.locator('#editorCommands').isHidden())await page.locator('#btnEditorCommands').click();await page.locator('#btnAlignPanel').click();
  await expect(page.locator('#alignAsr')).toHaveValue('large-v3');await expect(page.locator('#alignLocateLines')).toBeChecked();await expect(page.locator('#alignDetectBack')).toHaveCount(0);
});
test('desktop asynchronous confirmation: Cancel prevents deleting the timing installation', async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  let deletes = 0;
  await page.route('**/api/align/setup*', route => {
    if (route.request().method() === 'DELETE') deletes++;
    return route.fulfill({ json: { installed: true, external: false, backend: 'cpu', running: false } });
  });
  await page.addInitScript(() => {
    (window as any).confirm = async () => { await new Promise(r => setTimeout(r, 50)); (window as any).answered = true; return false; };
  });
  await page.goto('/');
  await page.locator('#nav-sync').click(); await page.locator('#helpClose').click();
  await page.locator('#btnEditorCommands').click();
  await page.locator('#btnAlignPanel').click();
  await page.locator('#btnAlignRemove').click();
  await expect.poll(() => page.evaluate(() => (window as any).answered)).toBe(true);
  expect(deletes).toBe(0);
  await expect(page.locator('#btnAlignRemove')).toBeVisible();
});

test('inline model hints and hardware preset explain the choice and preserve backing preference', async ({ page, request }) => {
  await request.put('/api/project?by=page', { data: fixture });
  await page.route('**/api/align/setup*', route => route.fulfill({ json: { installed:true, external:false, backend:'cuda', running:false } }));
  await page.route('**/api/align/gpu', route => route.fulfill({ json: { names: ['NVIDIA RTX test'], backend: 'cuda', why: 'test', memoryTotal: 10240, memoryFree: 5120 } }));
  await page.goto('/');
  await page.locator('#nav-sync').click(); await page.locator('#helpClose').click();
  await page.locator('#btnEditorCommands').click();
  await page.locator('#btnAlignPanel').click();
  await expect(page.locator('#alignRecommendation')).toContainText('MelBand-RoFormer + Whisper Turbo + wav2vec2');
  await page.locator('#alignAdvanced summary').click();
  await expect(page.locator('#alignMemory')).toContainText('10.0 ГБ всего, 5.0 ГБ свободно');
  await expect(page.locator('#alignDetectBack')).toHaveCount(0);
  await page.locator('#btnAlignRecommended').click();
  await expect(page.locator('#alignSeparator')).toHaveValue('roformer');
  await expect(page.locator('#alignAsr')).toHaveValue('turbo');
  await expect(page.locator('#alignDetectBack')).toHaveCount(0);
  await page.locator('#alignAsr').selectOption('large-v3');
  await expect(page.locator('#alignAsrHint')).toContainText('при нехватке памяти верни Turbo');
  await expect(page.locator('#alignAsrHint')).toContainText('только если включено «Сначала найти строки по аудио»');
  await page.locator('.align-hardware summary').click();
  await page.getByRole('radio', { name: 'Только процессор', exact: false }).check();
  await expect(page.locator('#alignRecommendation')).toContainText('HTDemucs + Whisper Turbo');
  await page.locator('#btnAlignRecommended').click();
  await expect(page.locator('#alignSeparator')).toHaveValue('htdemucs');
});
