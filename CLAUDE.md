# Spicy Translate
Редактор синхронных переводов песен для Spicy Lyrics: TTML с пословной синхрой, перевод, авто-тайминг нейросетью.

## Стек
React 19 + Vite (один `dist/index.html`), TypeScript, Node ≥22.18 сервер (`server/index.ts`, HTTP + MCP), Tauri (desktop/), Python прототип авто-тайминга (`experiments/auto-align`).

## Команды
- `npm run dev` — vite :5173 (пишет в живой проект на 8787! тестить на песочнице)
- Песочница: `SPICY_PORT=18790 SPICY_DIR=$TEMP/spicy-sandbox node server/index.ts --http`
- `npm test` · `npm run typecheck` · `npm run build` · `npm run e2e`
- Авто-тайминг: `experiments/auto-align/.venv/Scripts/python align.py`, замер — `bench.py`

## Архитектура
- `src/core/` — чистые функции без DOM (общие для редактора и сервера): words, export, import, qa, sections, edit
- `src/state.ts` — мутируемый `S` + `emit()`/`useS()`; горячие пути рисуют напрямую
- `src/sync.ts` — F/G/H, undo (`snap()`); `src/waveform/` — волна и правка мышью
- `src/ui/` — React-карточки и модалки; `src/styles.css` — все стили
- `server/index.ts` — проект, Genius, авто-тайминг; версия API: `API` в server, `SERVER_API` в live.ts, `API` в scripts/launch.mjs — менять вместе

## Правила
- Слова: пробел делит, NBSP склеивает, `|` — слоги. Новые функции текста — в core + тест.
- Изменения поведения — с тестом в `tests/`. Перед коммитом: typecheck, test, build.
- `reference/` не трогать (паритет-тест).
