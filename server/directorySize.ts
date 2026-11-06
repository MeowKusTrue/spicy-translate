import fs from 'node:fs/promises';
import path from 'node:path';
const cached = new Map<string,{at:number; value:Promise<number>}>();
/** Installation details must not block the HTTP editor while scanning thousands of Python files. */
export function directorySize(dir: string, fresh = false): Promise<number> {
  const hit = cached.get(dir); if (!fresh && hit && Date.now()-hit.at < 300_000) return hit.value;
  const value = (async()=>{
    const folders = [dir]; let total = 0;
    while (folders.length) {
      await Promise.all(folders.splice(0,8).map(async folder=>{
        for (const e of await fs.readdir(folder,{withFileTypes:true}).catch(()=>[])) {
          const p = path.join(folder,e.name);
          if (e.isDirectory()) folders.push(p); else if (e.isFile()) { const size = (await fs.stat(p).catch(()=>null))?.size || 0; total += size; }
        }
      }));
    }
    return total;
  })();
  cached.set(dir,{at:Date.now(),value}); return value;
}
