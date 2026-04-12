# Docker deploy

## Назначение

Запуск Web API и Telegram-бота через `docker compose`.

## Шаги

1. Подготовьте `.env` рядом с `docker-compose.yml`:

```env
BOT_TOKEN=123456:telegram-token
AUTH_ENABLED=false
ADMIN_USER=admin
ADMIN_PASS=change-me
NODE_ENV=production
```

2. Сборка и запуск:

```bash
docker compose build
docker compose up -d
```

3. Проверка:

```bash
curl http://localhost:3000/api/health
```

4. Остановка:

```bash
docker compose down
```

## Что поднимается

- `web`: `node src/server/index.js`, порт `3000`.
- `bot`: `node src/bot/index.js`.
- Общий volume `tk_shared` для `/app/data` и `/app/output`.

## Troubleshooting

- `bot` не стартует: проверьте `BOT_TOKEN`.
- `web` unhealthy: проверьте `curl /api/health` внутри контейнера.
