import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { directorySize } from '../server/directorySize.ts';
it('counts nested installation files asynchronously, caches and explicitly refreshes the result', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spicy-size-')), sub=path.join(dir,'nested'), a=path.join(dir,'a'),b=path.join(sub,'b'), other=path.join(dir,'other'), c=path.join(other,'c');
 try{await fs.mkdir(sub);await fs.mkdir(other);await fs.writeFile(c,Buffer.alloc(17));await fs.writeFile(a,Buffer.alloc(12));await fs.writeFile(b,Buffer.alloc(23));expect(await directorySize(dir)).toBe(52);await fs.writeFile(b,Buffer.alloc(40));expect(await directorySize(dir)).toBe(52);expect(await directorySize(dir,true)).toBe(69);}finally{await fs.unlink(a).catch(()=>{});await fs.unlink(b).catch(()=>{});await fs.unlink(c).catch(()=>{});await fs.rmdir(other).catch(()=>{});await fs.rmdir(sub).catch(()=>{});await fs.rmdir(dir);}
});
