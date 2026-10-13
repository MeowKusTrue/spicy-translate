import { describe, expect, it } from 'vitest';
import { buildTTML, type Line } from '../src/core/index.ts';

// invented lines only
const L = (t: number, tr: string, agent?: Line['agent']): Line => ({ t, end: t + 2, text: 'x y', tr, ...(agent ? { agent } : {}) });

describe('singers (ttm:agent)', () => {
  it('defaults to v1 and declares only v1', () => {
    const x = buildTTML({ lines: [L(1, 'жёлтый чайник')] });
    expect(x).toContain('ttm:agent="v1" itunes:key="L1"');
    expect(x).toContain('<ttm:agent type="person" xml:id="v1"/>');
    expect(x).not.toContain('xml:id="v2"');
  });
  it('writes v2 / v1000 per line and declares them in head (v1000 = group)', () => {
    const x = buildTTML({ lines: [L(1, 'жёлтый чайник'), L(3, 'синий кактус', 'v2'), L(5, 'тихий фонарь', 'v1000')] });
    expect(x).toContain('ttm:agent="v2" itunes:key="L2"');
    expect(x).toContain('ttm:agent="v1000" itunes:key="L3"');
    expect(x).toContain('<ttm:agent type="person" xml:id="v2"/>');
    expect(x).toContain('<ttm:agent type="group" xml:id="v1000"/>');
  });
});
