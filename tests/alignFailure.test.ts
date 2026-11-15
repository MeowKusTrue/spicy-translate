import {expect,it} from 'vitest';
import {alignmentFailure} from '../server/alignFailure.ts';
it('explains both signed and unsigned Windows native crashes instead of blaming an unrelated warning',()=>{
 for(const code of [3221225477,-1073741819]){
  const message=alignmentFailure(code,null,'locate','generation_config deprecated');
  expect(message).toContain('Whisper');expect(message).toContain('0xC0000005');expect(message).not.toContain('deprecated');
 }
});
it('keeps ordinary Python details and reports signals or missing output honestly',()=>{
 expect(alignmentFailure(1,null,'align','ValueError: bad audio')).toContain('ValueError: bad audio');
 expect(alignmentFailure(null,'SIGTERM','align','')).toContain('SIGTERM');
 expect(alignmentFailure(0,null,'align','')).toContain('без результата');
});
