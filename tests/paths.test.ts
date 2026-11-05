import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { dataDirectory } from '../server/paths.ts';

it('resolves a moved data folder before making missing Python directories', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spicy-junction-'));
  const target = path.join(temp, 'moved-data'), link = path.join(temp, 'app-data');
  try {
    fs.mkdirSync(target); fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    const unpack = dataDirectory(path.join(link, 'python-unpack'));
    expect(unpack).toBe(path.join(fs.realpathSync(target), 'python-unpack'));
    fs.mkdirSync(unpack, { recursive: true }); fs.writeFileSync(path.join(unpack, 'check'), 'ok');
    expect(fs.readFileSync(path.join(target, 'python-unpack', 'check'), 'utf8')).toBe('ok');
    expect(dataDirectory(path.join(temp, 'new', 'python'))).toBe(path.join(fs.realpathSync(temp), 'new', 'python'));
  } finally {
    // Both the junction and its target belong to this temporary fixture.
    if (!fs.realpathSync(target).startsWith(fs.realpathSync(temp) + path.sep)) throw new Error('fixture escaped temp');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
