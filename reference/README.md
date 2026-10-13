# Spicy Translate

Открыть редактор: `node spicy-mcp.mjs --http` → http://127.0.0.1:8787 (или просто открыть `index.html` — без live-связи с агентом).

## MCP (Claude Code / Claude Desktop)
```
claude mcp add spicy-translate -- node /путь/к/spicy-translate/spicy-mcp.mjs
```
Сервер сам поднимает редактор на http://127.0.0.1:8787 (порт: `SPICY_PORT`). Открой его в браузере — плашка «MCP: связь ✓» значит, что правки агента появляются в редакторе за ~1.5 с, а твои — видны агенту.
Инструменты: `lyrics_search`, `load_lyrics`, `get_project`, `set_translations`, `set_word_timings`, `auto_spread`, `qa_check`, `export_ttml`.
Проект хранится в `spicy-project.json`, экспорт — в `exports/`.
