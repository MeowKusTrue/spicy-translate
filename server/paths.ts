import fs from 'node:fs';
import path from 'node:path';

/** Node's recursive mkdir can fail beneath a Windows junction; write through its real target. */
export function dataDirectory(dir: string): string {
  let parent = path.resolve(dir);
  const missing: string[] = [];
  for (;;) {
    try { return path.join(fs.realpathSync(parent), ...missing); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(parent) === parent) throw e;
      missing.unshift(path.basename(parent)); parent = path.dirname(parent);
    }
  }
}
