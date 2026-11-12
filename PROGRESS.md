# PROGRESS

## Текущий этап
2026-11-12: 1.7.1 — timeline hover tooltips now opt-in (off by default), persistent waveHints setting in Tools. Disabling hides the current tooltip immediately; timing/mouse editing unaffected. Verified typecheck, build, new hover preference regression +4 timeline regressions (5 browser scenarios passed). Release packaging: Windows x64 installer and SHA-256; server API remains21. No data migration or live server restart.
2026-11-12: 1.7.0 — separate vocal extraction and words-only timing; SHA256-keyed persistent original/vocal caches on server and browser, including audio-only restore; external RX/file vocal import with normalized WAV and duration validation. Only existing lyrics/backings are timed; no automatic backing insertion. Source-switch transport preserved; stale audio/name-search responses and shared-server run ownership guarded. API21 synchronized across server, client, launcher and Tauri. Python bounds/overlap/report/Whisper-memory fixes and optional coarse line-location mode included; no claim that singing accuracy is solved, Qwen remains a separate experiment. Verification before packaging: 169 unit tests; full browser run 78/80, then all22 affected scenarios passed after correcting two obsolete test fixtures; Python and server cache integration covered. No live server restart or data migration performed. Rollback installer remains available in v1.6.1; new caches do not overwrite old project backups.
2026-11-11: 1.6.1 — Studio inline word/full-line editing replaces the card; pipes are shown and saved directly; forced centering removed, per-singer alignment retained. Double-click a word edits its complete syllable group; text action/row whitespace edits the line. Enter saves, Esc cancels, Tab advances. Added visible text/empty backing/timeline-first-click regressions. Verified: typecheck (GOMAXPROCS=2 after native compiler OOM), 159 unit tests, full 69 browser tests before final CSS fixes, then 11 focused inline/Studio tests after final fixes, build. Karaoke algorithms unchanged; preview.ts diff is only double-click routing. Classic retains its card. Release package: Windows x64 installer, SHA-256 and inline-editing screenshots.
2026-11-11: 1.6.0 — new Studio layout is default; header switch restores Classic and persists the choice. Rare commands live in a dismissible Tools panel; preview text/syllable/time actions and playback speed are directly accessible. New stylesheet is scoped to Studio; preview.ts, karaokeMotion.ts, loop.ts and base styles.css are unchanged. Verified: typecheck, 159 unit tests, 65 browser tests (existing geometry explicitly Classic + new Studio scenarios), build; Studio checks repeated after final visual adjustments. Screenshot outputs: exports/design-review/. Release packaging: Windows x64 installer, SHA-256 and UI screenshots.
2026-11-11: included in 1.6.0 — simple editor toggle; preview boundary/IME fixes and adjacent-line navigation; durable New empty project + history restore with audio/folder reset; export lint lookalike-letter corrections and explicit ellipsis choices. Verified: typecheck, 159 unit tests, build, 60 sandbox browser tests. History restore intentionally requires reconnecting audio; broader legacy asynchronous Genius/cover/spell operations are not fully session-scoped.
2026-11-07: 1.5.4 — карточки линтера с текстом/временем/дорожкой, переходом к обеим фразам, черновой раскладкой и явным сдвигом/подтверждением наложений; новый редактор внутри предпросмотра с видимыми слогами, сбросом и сохранением; адаптация низких окон.
2026-11-07: 1.5.3 — дефисы слева от границ слогов в памяти, редакторе и TTML; разбиение выбранного слова во всех одинаковых строках активной дорожки; линтер перед TTML-экспортом с явными исправлениями и Ctrl+Z.
2026-11-07: релиз 1.5.2 — сдвиг всей песни («← вся песня», влево не сжимает начало), меню ⚙ открывается вверх и прокручивается; пуш по SSH работает.
2026-11-06: релиз 1.5.1 — клик по слову на таймлайне сразу выделяет (волна перерисовывается на любой emit).
2026-11-05: релиз 1.0.6 — независимое наложение вокальных строк, отдельные ряды слов и подсветка одновременно звучащих фраз; 90 unit-тестов и 7 E2E.
2026-11-05: релиз 1.0.5 — выбор режима импорта Genius, откат, предпросмотр без изменений проекта, снимок перед импортом; 84 unit-теста и 6 E2E.
2026-11-02: пачка удобства и проверок (запрос: орфография, слоги через / \, заглавные, кнопки уезжают, лаг текста, таймлайн, авто-тайминг).

## Этапы
- done — метаданные как в AMLL, секции (категории, ordinal, § в списке строк), слоги после дефиса
- done — авто-тайминг: замер bench.py, гибрид wav2vec2+MMS, сомнительные слова, Whisper-распознавание (см. TODO.md)
- done — 1. Кнопки не уезжают: на «Перевод»/«Синхра» прокручивается только список строк
- done — 2. Слоги: `/` и `\` между буквами = `|` (при выходе из поля, правке слова, «Текст»); `//` = знак; слова с `/` из исходного текста не трогаются
- done — 3. QA (`textIssues`): смешанные алфавиты в слове, латиница в переводе, строка с маленькой буквы (если ≥60% с заглавной)
- done — 4. Орфография: «✓ Орфография» на «Перевод» → `/api/spell` (Яндекс.Спеллер) → замена в один клик; spellcheck браузера в полях перевода; API 12
- done — 5. Отставание в превью: подстройка на слух «=» / «-» по 20 мс на любой вкладке, значок «⇆ N мс» в плеере (клик — сброс); `setVoff` в state. Причина — задержка звука (колонки/Bluetooth) не видна браузеру; заливка слова как в Spicy, не трогали
- done — релиз 1.0.3 (этапы 1–5): коммит 3c80a69, версия b440f2c, тег v1.0.3
- done — 6. «Нельзя выделить и подвинуть строки»: панель «Строк: N −1 с −0.1 +0.1 +1 с [мс]» над списком (`shiftPicked`); в полосе под волной уже было (рамка с пустого места, Ctrl/Shift+клик, тащить)
- done — релиз 1.0.4 (сдвиг строк): a2ba7da, тег v1.0.4
- todo — 7. Авто-тайминг / распознавание «не работает»: нужен пример (TODO.md §4–5 — другая версия трека, Whisper в рэпе)

## Решения
- Слоги через `/` `\` конвертируются в `|` при вводе (формат хранения не меняется; импорт текста не трогается).
- Орфография — Яндекс.Спеллер (ru/uk/en, без ключа). Публичный LanguageTool без русского словаря — не ловит «харашо».

## Известные баги
- см. README «Известные проблемы», TODO.md

## Следующий шаг
Ждём: идеальные разметки (TTML+аудио) в bench, трек где авто-тайминг промахнулся.
