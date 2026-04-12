# Документация tk-generator

Этот сайт — статическая документация для `tk-generator` (Docsify через CDN, без сборки).

## Что внутри

- [Быстрый старт за 5 минут](getting-started.md)
- [CLI reference](cli-reference.md)
- [Web API](web-api.md)
- [Telegram bot](telegram-bot.md)
- [Electron app](electron-app.md)
- [Configuration](configuration.md)
- [Plugins](plugins.md)
- [DXF import](dxf-import.md)
- [Docker deploy](docker-deploy.md)
- [Интеграция с 1С](1c-integration.md)
- [FAQ](faq.md)

## Источники правды

Документация составлена по реальным файлам проекта:
- CLI: `src/index.js`
- API/роуты/OpenAPI: `src/server/index.js`
- Telegram bot: `src/bot/index.js`, `src/bot/telegram-api.js`
- Electron: `desktop/main.js`, `desktop/package.json`
- Конфиг и env-оверрайды: `src/config/index.js`, `config/default.json`
- Плагины: `src/plugin-loader.js`, `src/plugin-registry.js`, `plugins/granite-special/*`
- DXF: `src/utils/dxf-import.js`
- Docker: `Dockerfile`, `docker-compose.yml`, `README-docker.md`

## Дополнительно

- [Пользовательские шаблоны DOCX](custom-templates.md)
- [Legacy входной формат](legacy-input-format.md)
