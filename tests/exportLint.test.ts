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
  expect(lintExport({lines:[line],mode:'original'}).some(x => x.fix?.label.includes('знаки'))).toBe(false);
  expect(lintExport({lines:[line],mode:'translation'}).some(x => x.fix)).toBe(true);
});

it('offers a draft for missing sync and preserves partial boundaries, metadata and other layers', () => {
  const line: Line = { t: 1, end: 6, text: 'Раз два три четыре', tr: 'One two',
    sync: { orig: [{ a: 1.12345, b: 1.8, c: 0.9 }, { a: 2.1, b: null }, { a: null, b: 4.7 }], tr: [{ a: 1, b: 3 }, { a: 3, b: 6 }] } };
  const before = structuredClone(line);
  const issue = lintExport({ lines: [line], mode: 'original' }).find(x => x.fixes?.[0].label === 'Распределить неразмеченные слова (черновик)')!;
  expect(issue.layer).toBe('orig'); expect(issue.advice).toContain('проверить на слух');
  expect(issue.fix).toBe(issue.fixes![0]);
  const fixed = issue.fix!.line, sy = fixed.sync!.orig!;
  expect(sy).toHaveLength(4);
  expect(sy[0]).toEqual(line.sync!.orig![0]);
  expect(sy[1].a).toBe(2.1); expect(sy[2].b).toBe(4.7);
  expect(sy.slice(1).every(x => x.a != null && x.b != null && x.g === 1)).toBe(true);
  expect(fixed.sync!.tr).toEqual(line.sync!.tr);
  expect([fixed.t, fixed.end]).toEqual([1, 6]); expect(line).toEqual(before);
  sy[0].a = 99; expect(line).toEqual(before);
});

it('offers drafts only for exported layers and keeps drafts unconfirmed', () => {
  const line: Line = { t: 1, end: 4, text: 'Раз два', tr: 'One two', bg: { text: 'Эй', tr: 'Hey' } };
  const issues = lintExport({ lines: [line], mode: 'translation' });
  expect(issues.filter(x => x.fixes).map(x => x.layer)).toEqual(['tr', 'bg']);
  const fixed = issues.find(x => x.layer === 'tr')!.fix!.line;
  expect(fixed.sync!.tr!.every(x => x.g === 1)).toBe(true);
  expect(lintExport({ lines: [fixed], mode: 'translation' }).some(x => x.msg.includes('не проверены вручную'))).toBe(true);
  expect(lintExport({ lines: [line], mode: 'original', wordSpread: false }).some(x => x.fixes)).toBe(false);
});

it('plans an explicit positive whole-line shift for overlapping duet vocals without mutation or trimming', () => {
  const lines: Line[] = [
    { t: 0, end: 5, text: 'Первая', tr: '', sync: { orig: [{ a: 0.5, b: 4.25 }] } },
    { t: 2, end: 7, text: 'Вторая', tr: 'Second', agent: 'v2', bg: { text: 'Эй', tr: 'Hey' },
      sync: { orig: [{ a: 3, b: 6 }], tr: [{ a: 2.5, b: null }], bgo: [{ a: null, b: 6.5 }], bg: [{ a: 4, b: 6, g: 1 }] } },
  ];
  const before = structuredClone(lines);
  const issue = lintExport({ lines, mode: 'original' }).find(x => x.ignoredKey)!;
  expect(issue.advice).toContain('дуэтом'); expect(issue.layer).toBe('orig');
  expect(issue.fix!.label).toContain('+1.250 с'); expect(issue.fixes![0]).toBe(issue.fix);
  const fixed = issue.fix!.line;
  expect(fixed.t).toBe(3.25); expect(fixed.end).toBe(8.25); expect(fixed.agent).toBe('v2');
  for (const layer of ['orig', 'tr', 'bgo', 'bg'] as const) {
    const old = lines[1].sync![layer]![0], moved = fixed.sync![layer]![0];
    expect(moved.a).toBe(old.a == null ? null : old.a + 1.25);
    expect(moved.b).toBe(old.b == null ? null : old.b + 1.25);
    expect(moved.g).toBe(old.g);
  }
  expect(fixed.sync!.orig![0].b! - fixed.sync!.orig![0].a!).toBe(3);
  expect(lintExport({ lines: [lines[0], fixed], mode: 'original' }).some(x => x.ignoredKey)).toBe(false);
  expect(lintExport({ lines, mode: 'original' }).find(x => x.ignoredKey)!.ignoredKey).toBe(issue.ignoredKey);
  expect(lines).toEqual(before);
  const changed = structuredClone(lines); changed[0].text = 'Другая';
  expect(lintExport({ lines: changed, mode: 'original' }).find(x => x.ignoredKey)!.ignoredKey).not.toBe(issue.ignoredKey);
  changed[0].sync!.orig![0].b = 4.5;
  expect(lintExport({ lines: changed, mode: 'original' }).find(x => x.ignoredKey)!.ignoredKey).not.toBe(issue.ignoredKey);
});

it('does not offer a destructive draft for mismatched or invalid existing timing', () => {
  for (const sync of [[{ a: 1, b: null }, { a: 2, b: 3 }], [{ a: NaN, b: null }]]) {
    const line: Line = { t: 1, end: 4, text: 'Слово', tr: '', sync: { orig: sync } };
    const before = structuredClone(line), issues = lintExport({ lines: [line], mode: 'original' });
    expect(issues.some(x => x.fixes)).toBe(false);
    expect(issues.every(x => x.layer === 'orig' && x.advice)).toBe(true);
    expect(line).toEqual(before);
  }
});
it('reports invalid phrase times as errors with manual correction advice', () => {
  expect(lintExport({lines:[{t:NaN,end:2,text:'Привет',tr:''}],mode:'original'}).some(x => x.sev === 'err')).toBe(true);
});

it('distributes missing words proportionally inside a narrow anchored gap', () => {
  const line: Line = { t: 1, end: 10, text: 'Первое а длинное Последнее', tr: '',
    sync: { orig: [{ a: 1, b: 8 }, { a: null, b: null }, { a: null, b: null }, { a: 9, b: 10 }] } };
  const before = structuredClone(line);
  const fixed = lintExport({ lines: [line], mode: 'original' }).find(x => x.layer === 'orig' && x.fix)!.fix!.line;
  const sy = fixed.sync!.orig!;
  expect(sy[0]).toEqual(before.sync!.orig![0]); expect(sy[3]).toEqual(before.sync!.orig![3]);
  expect(sy[1].a).toBe(8); expect(sy[2].b).toBe(9);
  expect(sy[1].b).toBe(sy[2].a);
  expect((sy[2].b! - sy[2].a!) / (sy[1].b! - sy[1].a!)).toBeCloseTo(7.5 / 1.5);
  expect(sy[1].b! > sy[1].a! && sy[2].b! > sy[2].a!).toBe(true);
  expect(line).toEqual(before);
});

it('fills partial starts and ends between exact anchors without adding overlaps', () => {
  const line: Line = { t: 1, end: 10, text: 'Раз два три четыре', tr: '',
    sync: { orig: [{ a: null, b: 2.12345 }, { a: 3.12345, b: null }, { a: null, b: 8.12345 }, { a: 9.12345, b: null }] } };
  const before = structuredClone(line);
  const sy = lintExport({ lines: [line], mode: 'original' }).find(x => x.fix)!.fix!.line.sync!.orig!;
  sy.forEach((x, k) => {
    const old = before.sync!.orig![k];
    if (old.a != null) expect(x.a).toBe(old.a);
    if (old.b != null) expect(x.b).toBe(old.b);
    expect(x.b! > x.a!).toBe(true);
    if (k) expect(x.a! >= sy[k - 1].b!).toBe(true);
  });
  expect(sy[0].a).toBe(1); expect(sy[3].b).toBe(10); expect(line).toEqual(before);
});

it('offers no draft when anchored gaps have no positive space for missing words', () => {
  for (const end of [8, 9]) {
    const line: Line = { t: 1, end: 10, text: 'Раз два три четыре', tr: '',
      sync: { orig: [{ a: 1, b: end }, { a: null, b: null }, { a: null, b: null }, { a: 8, b: 10 }] } };
    const before = structuredClone(line);
    expect(lintExport({ lines: [line], mode: 'original' }).some(x => x.fix)).toBe(false);
    expect(line).toEqual(before);
  }
});
