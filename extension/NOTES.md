# Spicy Translate для Spicetify — заметки исследования

Дата: 2026-10-14. Проверено по исходникам и докам, ссылки ниже.

## Spicetify

Источники: <https://spicetify.app/docs/advanced-usage/extensions>, <https://spicetify.app/docs/development/api-wrapper>,
локальные тайпинги `%LOCALAPPDATA%\spicetify\globals.d.ts` и реализация `%LOCALAPPDATA%\spicetify\jsHelper\spicetifyWrapper.js` (Spicetify 2.45.3 у пользователя).

- **Расширение = один JS-файл** в `%APPDATA%\spicetify\Extensions\` (Linux/macOS: `~/.config/spicetify/Extensions/`).
  Включение: `spicetify config extensions <file>.js` (дописывает к списку, не заменяет), затем `spicetify apply`.
  Удаление: `spicetify config extensions <file>.js-` + `spicetify apply`.
  Custom app — это отдельная страница в сайдбаре (папка с `index.js`/`manifest.json` в `CustomApps`); нам не нужна: панель поверх Spotify делается из обычного расширения.
- **Сборка.** `spicetify-creator` (и его наследник `@spicemod/creator`, на нём собран Spicy Lyrics) — генератор проекта с React/esbuild. Нам хватает голого esbuild: TS → один IIFE-файл. Расширение запускается раньше, чем Spicetify готов, поэтому стандартный приём — ждать `Spicetify.Player.data`, `Spicetify.Topbar`, `Spicetify.LocalStorage` в цикле с `setTimeout`.
- **Player API** (`Spicetify.Player`):
  - `getProgress()` → мс. Реализация: `(isPaused ? 0 : Date.now() - state.timestamp) + state.positionAsOfTimestamp` — то есть уже интерполирована по `Date.now()` между событиями плеера, но скачет при обновлении state. Поэтому сглаживаем как `now()` в reference (маленькая ошибка — плавно подтягиваем, >100 мс — прыгаем).
  - `getDuration()` → мс, `isPlaying()`, `togglePlay()`, `play()`, `pause()`, `seek(ms | 0..1)` (целое число трактуется как мс, дробное 0..1 — как доля!). Поэтому в `seek` всегда передаём `Math.round(ms)` ≥ 1.
  - События: `songchange`, `onplaypause`, `onprogress` (data = мс), `appchange`.
  - Текущий трек: `Spicetify.Player.data.item` → `uri`, `name`, `artists[].name`, `album.name`, `duration.milliseconds`, `metadata.title/artist_name/album_title`.
  - Скорости воспроизведения для музыки нет (только подкасты), поэтому хоткеи `[` `]` `'` из reference в расширении не работают.
- **UI:** `new Spicetify.Topbar.Button(label, iconSvg, onClick)`, `new Spicetify.Playbar.Button(label, icon, onClick, disabled, active, registerOnCreate)`; `Spicetify.PopupModal.display({title, content, isLarge})` / `hide()`; `Spicetify.showNotification(msg, isError)`.
- **LocalStorage:** `Spicetify.LocalStorage.get/set/remove/clear` — обёртка над `localStorage` страницы xpui.
- Spotify сам ловит хоткеи (Space и т.п.). Пока панель открыта, наш `keydown` висит на `window` в capture-фазе и гасит обработанные клавиши (`stopImmediatePropagation`), иначе Space сработает дважды.

## Spicy Lyrics

Источник: <https://github.com/Spikerko/spicy-lyrics> (коммит `0ecf3925`, 2026-10-12). Ключевые файлы:
`src/utils/db.ts`, `src/utils/Lyrics/manager/index.ts`, `src/components/ReactComponents/LyricsManager/components/UploadTTMLModal.tsx`,
`src/utils/Lyrics/fetchLyrics.ts`, `src/utils/expose.ts`, `src/utils/Lyrics/ttml/parser.ts`.

- **Где лежат локальные TTML.** IndexedDB базы страницы xpui: БД `spicylyrics`, версия `1`, object store `lyricsStore`,
  **ключ = Spotify track URI** (`spotify:track:…`), **значение = сырой TTML-строкой** (парсится при чтении). Создаётся через `idb.openDB("spicylyrics", 1, { upgrade: createObjectStore("lyricsStore") })`.
- **Upload TTML:** Lyrics Manager → Upload → режим `Save` (persistent: `LocalLyricsManager.put(uri, ttml)` → тот же IndexedDB) или `Just once` (temporary: парсит и кладёт в in-memory атом `$currentLyricsData`, до смены трека). URI берётся у текущего трека. Есть ещё drop файла и **Ctrl+V скопированного .ttml-файла** в окне Upload.
- **Приоритет при загрузке** (`runFetchLyrics`): 1) in-memory `$currentLyricsData`, если его `uri` совпадает с текущим треком; 2) `LocalLyricsManager.get(uri)` — наш локальный TTML; 3) кэш API и сам API.
  Следствие: после записи в IndexedDB текущий трек продолжит показывать старую лирику из памяти, пока не переключишь трек (на другой и обратно) или не перезагрузишь Spotify.
- **Публичный API.** `window.SpicyLyrics` (`db.objectStores.lyricsStore.manager.put/get/getRaw/listKeys/remove`, `panels.lyricsDB.open()`) выставляется **только в dev-режиме** (`App.isDev() || $developerMode` — тумблер Settings → Developer). Функции «применить лирику сейчас» (`ApplyLyrics`, `fetchLyrics`) наружу не торчат. Событий для подкладывания TTML нет.
- **Вывод: программно положить TTML можно.** Расширения Spicetify живут в одном origin со Spicy Lyrics, так что мы пишем прямо в `spicylyrics/lyricsStore` по URI. Открываем `indexedDB.open("spicylyrics", 1)` с тем же `upgrade`, что у Spicy (если Spicy ещё не создавал БД, схема совпадёт и он её примет); если версия БД уже выше (`VersionError`) — открываем без версии. Это контракт по внутренностям Spicy, а не публичный API: если они сменят имя БД/стора, сломается — тогда остаются кнопки «Скачать .ttml» / «Копировать» + ручной Upload.
- **Парсер TTML** (`ttml/parser.ts`): `itunes:timing` = `Word` → тип Syllable, `Line`, `None` → Static, нет атрибута → выводит из структуры; другое значение — отказ. `ttm:role="x-bg"` внутри `<p>` = фоновый вокал; поддерживаются `ttm:agent`, songwriters. Наш формат из core (`Word|Line`, span-ы с begin/end, x-bg) подходит.

## LRCLIB

<https://lrclib.net/docs>: `GET /api/get?track_name&artist_name&album_name&duration` (duration в секундах, ±2 с, 404 если нет), `GET /api/search?track_name&artist_name` или `?q=`. CORS открыт. Из xpui делаем обычный `fetch`.

## Не проверено вживую (проверить после `spicetify apply`)

- что `fetch` к `lrclib.net` и LLM-провайдерам не режется CSP клиента Spotify (Spicy Lyrics и lyrics-plus ходят наружу через `fetch`, так что ожидаю, что ок);
- что `a.download` в CEF Spotify сохраняет файл (если нет — кнопка «Копировать TTML»);
- реальная задержка между `getProgress()` и звуком — для этого есть поле «реакция, мс» и «сдвиг, мс».
