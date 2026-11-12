import { describe, expect, it } from 'vitest';
import { transcriptionDraft } from '../src/core/transcription.ts';

describe('recognition draft boundary', () => {
  it('keeps recognized text and boundaries, but strips invented backing/translation/protection', () => {
    const input = [{t:1,end:3,text:' при|вет ',tr:'invented',bg:{text:'invented',tr:''},approved:{orig:true},sync:{orig:[{a:1,b:2},{a:2,b:3,c:2}],bgo:[{a:1,b:3}]}}];
    expect(transcriptionDraft(input)).toEqual([{t:1,end:3,text:'при|вет',tr:'',sync:{orig:[{a:1,b:2,g:1},{a:2,b:3,g:1,c:1}]}}]);
    expect(input[0].approved.orig).toBe(true);
  });
  it('keeps plain recognized text when word timings are missing, invalid or count-mismatched', () => {
    for (const orig of [[],[{a:1,b:3}],[{a:1,b:1},{a:1,b:3}],[{a:1,b:2},{a:2,b:Infinity}]]) {
      expect(transcriptionDraft([{t:1,end:3,text:'hello world',sync:{orig}}])).toEqual([{t:1,end:3,text:'hello world',tr:''}]);
    }
  });
  it('rejects empty, malformed and unbounded drafts rather than importing them', () => {
    for (const value of [null,{},[],[{t:0,end:1,text:''}],[{t:NaN,end:1,text:'bad'}],[{t:2,end:1,text:'bad'}],[{t:-1,end:1,text:'bad'}],Array(2001).fill({t:0,end:1,text:'too many'})]) expect(()=>transcriptionDraft(value)).toThrow();
  });
});
