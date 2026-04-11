# Docker deployment for tk-generator

Этот документ описывает запуск `tk-generator` в Docker для двух процессов:
- `web` — HTTP API на порту `3000`.
- `bot` — Telegram-бот.

Оба сервиса используют один общий Docker volume для каталогов `data/` и `output/`.

## 1) Требования

- Docker Engine 24+
- Docker Compose v2+

## 2) Переменные окружения

Создайте `.env` рядом с `docker-compose.yml`:

```env
# Required for bot
BOT_TOKEN=123456:your-telegram-bot-token

# Auth and app mode
AUTH_ENABLED=false
ADMIN_USER=admin
ADMIN_PASS=change-me
NODE_ENV=production
```

> `web` сервис маппит эти переменные в внутренние настройки приложения:
> - `AUTH_ENABLED` -> `TKG_AUTH_ENABLED`
> - `ADMIN_USER` -> `TKG_AUTH_ADMIN_USERNAME`
> - `ADMIN_PASS` -> `TKG_AUTH_ADMIN_PASSWORD`
>
> `bot` сервис использует переменную `BOT_TOKEN`.

## 3) Сборка и запуск

```bash
docker compose build
docker compose up -d
```

Проверка API:

```bash
curl http://localhost:3000/api/health
```

Ожидаемый ответ:

```json
{"status":"ok","service":"tk-generator-api"}
```

## 4) Остановка

```bash
docker compose down
```

## 5) Обновление образа

```bash
docker compose pull
docker compose up -d
```

## 6) GHCR image (release)

В workflow `.github/workflows/release.yml` добавлен job, который на GitHub Release:
1. Логинится в GHCR.
2. Собирает Docker image из текущего коммита.
3. Публикует теги:
   - `ghcr.io/<owner>/tk-generator:latest`
   - `ghcr.io/<owner>/tk-generator:<release-tag>`

Для этого нужны стандартные права `GITHUB_TOKEN` пакетов (`packages: write`).
