import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained dist/index.html: opens from file:// like the old single-file version,
// and the server only has to serve that one file.
export default defineConfig({
  plugins: [viteSingleFile()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { include: ['tests/**/*.test.ts'] },
});
