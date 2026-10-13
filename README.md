# Spicy Translate

Редактор синхронных переводов песен для [Spicy Lyrics](https://spicylyrics.org) (Spicetify): TTML с пословной синхрой, хоткеи F/G/H как в официальном TTML Tool, слоги через `|`, склейка двух слов в один блок через NBSP, волна с DaVinci-подобным редактированием, перевод через Google/LLM, MCP-сервер с live-связью.

Однофайловая версия, с которой начинали, лежит в `reference/` (не трогаем, на неё смотрит паритет-тест).

## Команды

Нужен Node ≥ 22.18 (сервер — `.ts`, запускается нативно, без сборки).

```bash
npm install
npm run dev        # редактор на http://localhost:5173 (/api проксируется на 127.0.0.1:8787)
npm test           # vitest: core + паритет с reference/index.html
npm run e2e        # сборка + Playwright smoke (по умолчанию системный Chrome; PW_CHANNEL= — встроенный chromium)
npm run typecheck  # tsc --noEmit
npm run build      # dist/index.html — один самодостаточный файл, открывается и с file://
npm run serve      # build + сервер редактора на http://127.0.0.1:8787 (без MCP)
```

Live-связь в `npm run dev` работает, только если на 8787 запущен сервер (`npm run serve` или MCP-сервер, который поднимает его сам).

## MCP (Claude Code / Claude Desktop)

Сначала `npm run build` (сервер раздаёт `dist/index.html`), потом:

```bash
claude mcp add spicy-translate -- node D:\Projects\spicy-translate\server\index.ts
```

Сервер сам поднимает редактор на http://127.0.0.1:8787 (порт — `SPICY_PORT`). Открой его в браузере: плашка «MCP: связь ✓» значит, что правки агента появляются в редакторе за ~1.5 с, а твои видны агенту.
Инструменты: `lyrics_search`, `load_lyrics`, `get_project`, `set_translations`, `set_word_timings`, `auto_spread`, `qa_check`, `export_ttml`.
Проект хранится в `spicy-project.json`, экспорт — в `exports/` (в корне репо или в `SPICY_DIR`).

## Структура

```
src/core/        чистые функции без DOM (общие для редактора и сервера)
  lrc.ts           parseLRC, parsePlain, entriesToLines
  words.ts         units, wordList, unitsText, syllabify, plainW, splitWords, getWords, syncComplete
  export.ts        fmtTime, buildTTML, lineSpans, buildLRC, buildSRT
  qa.ts            qaCheck
src/state.ts     объект S (модель S.lines[].sync не менялась), emit/useS для React, хелперы слоёв
src/audio.ts     плеер и сглаженные часы now(), виртуальные часы без аудио
src/sync.ts      F/G/H, нудж, сброс, склейка/слоги, undo/redo (снимки текста+sync, 200 шагов)
src/waveform/    пики (Web Worker), отрисовка, мышиное редактирование (roll/Alt/магнит/paint/pan/зум)
src/preview.ts   караоке-превью (градиент, lift, свечение долгих слов, lookahead 0.3 с, сдвиг анимации)
src/loop.ts      единый requestAnimationFrame
src/load.ts      LRCLIB, ручной LRC, аудиофайл + автоподбор текста по имени файла
src/translate.ts Google, промпт для LLM, прямой вызов LLM, вставка списком/JSON
src/persist.ts   автосохранение (localStorage + аудио в IndexedDB), проект .spicy.json
src/live.ts      связь с сервером: GET/PUT /api/project, опрос раз в 1.5 с
src/hotkeys.ts   док и клавиатура
src/ui/          React-компоненты; превью и волна рисуются императивно в контейнеры, которые создаёт React
server/index.ts  HTTP (редактор + /api/project) + MCP по stdio, без зависимостей
tests/           vitest; e2e/ — Playwright
```

## Известные проблемы

Поведение перенесено 1:1, включая странности reference. Не исправлял:

- `F` (Начало) не снимает с слова пометку «авто» (`g`); подтверждают только G/H, перетаскивание и нудж.
- «Очистить» перевод не кладёт снимок в undo и не запускает автосохранение (сохранится при следующей правке/закрытии вкладки).
- Удержание `M`/`U` повторяет действие (они обрабатываются до проверки `e.repeat`).
- «Разбить строку на слоги» без многосложных слов откатывает снимок undo, но стек redo уже очищен.
- Обновление проекта от агента (live) сбрасывает undo/redo и выбранный слой (на «перевод», если он есть).
- Ввод названия/исполнителя не запускает автосохранение и не перекладывает аудио в IndexedDB под новый ключ; аудио кэшируется только при выборе трека или загрузке файла.
- Экспорт пишет «у N строк нет перевода» и в режиме «Оригинал + перевод».
- Цикл строки (`L`) грубый: перемотка при выходе за границы ±0.4 с.
- Фиксированный док перекрывает нижнюю часть левой колонки; кнопки экспорта доступны после закрытия дока или прокрутки.
- MCP: вызовы инструментов обрабатываются параллельно (stdin не сериализуется), поэтому одновременные `set_*` могут перезаписать друг друга (read-modify-write). Клиенты обычно шлют вызовы по одному.
- MCP: если порт занят, сервер молча проксирует в того, кто его держит, — это может быть другой экземпляр с другим проектом. Проверяй `SPICY_PORT`.

Что изменилось при переезде (намеренно, мелочи):

- Подсказка в доке рендерится React-ом, а не через `innerHTML` (текст слова больше не трактуется как HTML).
- В меню скорости нестандартная скорость (после `[`/`]`) показывается одной опцией, а не копится списком.
- Сборка — один `dist/index.html`; сервер хранит `spicy-project.json` и `exports/` в корне репо, а не рядом со скриптом.
