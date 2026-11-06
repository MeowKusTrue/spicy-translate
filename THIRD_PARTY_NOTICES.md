# Additional text-processing components

- Hypher 0.2.5 — Bram Stein, BSD-3-Clause. Source and license: https://github.com/bramstein/hypher (BSD.txt).
- Russian hyphenation patterns, hyphenation.ru 0.2.1 — respective pattern creators and maintainers; Russian table contact: crymos at yandex dot ru. Upstream distributes language patterns under LGPL unless otherwise noted: https://github.com/bramstein/hyphenation-patterns. Package source: https://www.npmjs.com/package/hyphenation.ru.

The Russian patterns are used without modification. The exact dependencies are recorded in package-lock.json; their readable source is installed in node_modules/hypher and node_modules/hyphenation.ru. To use modified or replacement patterns, install dependencies with `npm ci`, replace the relevant package source and rebuild with `npm run build` / `npm run desktop:build`. No service or account is needed for word splitting.
