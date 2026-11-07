import { expect, it } from 'vitest';
import { buildTTML, lintExport, type Line } from '../src/core/index.ts';

it('proposes punctuation fixes without mutating input or altering word times', () => {
  const line: Line = { t: 1, end: 4, text: 'а|-а|-а – да?!', tr: '', sync: { orig: [{a:1,b:1.5},{a:1.5,b:2},{a:2,b:2.5},{a:2.5,b:3},{a:3,b:4}] } };
  const before = structuredClone(line), issues = lintExport({ lines: [line], mode: 'original' });
  const fixed = issues.find(x => x.fix)!.fix!.line;
  expect(fixed.text).toBe('а-|а-|а — да?!'); expect(fixed.sync).toEqual(line.sync); expect(line).toEqual(before);
  expect(lintExport({lines:[fixed],mode:'original'}).some(x => x.fix)).toBe(false);
  expect(issues.some(x => x.msg.includes('авторской'))).toBe(true);
});
it('offers explicit promotion of a standalone background preserving both tracks and singer', () => {
  const line: Line = {t:1,end:3,text:'',tr:'',agent:'v2',bg:{text:'Эй',tr:'Hey'},sync:{bgo:[{a:1,b:3}],bg:[{a:1.2,b:2.8}]}};
  const issues = lintExport({lines:[line],mode:'original'}), fixed = issues.find(x => x.fix)!.fix!.line;
  expect(issues.some(x => x.msg.includes('начинается с бэка'))).toBe(true);
  expect(fixed).toMatchObject({text:'Эй',tr:'Hey',agent:'v2',sync:{orig:line.sync!.bgo,tr:line.sync!.bg}});
  expect(fixed.bg).toBeUndefined(); expect(line.bg).toBeDefined();
  expect(buildTTML({lines:[fixed],mode:'original'})).toContain('begin="0:01.000" end="0:03.000">Эй');
});
it('checks only exported language, leaves attached backgrounds and valid hyphen splits intact', () => {
  const line: Line = {t:1,end:3,text:'а-|а',tr:'wrong – dash',bg:{text:'бэк',tr:''}};
  expect(lintExport({lines:[line],mode:'original'}).some(x => x.fix)).toBe(false);
  expect(lintExport({lines:[line],mode:'translation'}).some(x => x.fix)).toBe(true);
});
it('reports invalid phrase times as errors with manual correction advice', () => {
  expect(lintExport({lines:[{t:NaN,end:2,text:'Привет',tr:''}],mode:'original'}).some(x => x.sev === 'err')).toBe(true);
});
