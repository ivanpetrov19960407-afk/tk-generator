# Web API

## Назначение

HTTP API для валидации, генерации, истории, аналитики, DXF-импорта, auth и webhook-управления.

Базовый запуск:

```bash
npm run serve
```

## Реальные endpoints

### Системные

- `GET /api/health`
- `GET /api/config`
- `GET /api/docs` (Swagger UI)
- `GET /api/docs/spec.json` (OpenAPI JSON)

### Генерация/валидация

- `POST /api/validate`
- `POST /api/generate`
- `POST /api/upload-excel`
- `POST /api/import-dxf` (multipart/form-data)

### История/экспорт

- `GET /api/history?page=&pageSize=`
- `GET /api/history/{id}`
- `GET /api/export/csv?generation_id=`

### Auth

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`

### Analytics

- `GET /api/analytics/summary`
- `GET /api/analytics/cost-trends`
- `GET /api/analytics/materials?limit=`
- `GET /api/analytics/textures`

Фильтры analytics: `from`, `to`, `material`, `texture`, `groupBy=day|week`.

### Webhooks

- `GET /api/webhooks`
- `POST /api/webhooks`
- `DELETE /api/webhooks/{id}`

## Примеры curl

```bash
# Health
curl http://localhost:3000/api/health

# Validate
curl -X POST http://localhost:3000/api/validate \
  -H 'Content-Type: application/json' \
  -d @examples/batch_small.json

# Generate ZIP
curl -X POST http://localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d @examples/batch_small.json \
  --output tk-result.zip

# OpenAPI
curl http://localhost:3000/api/docs/spec.json

# DXF import
curl -X POST 'http://localhost:3000/api/import-dxf?thickness=30' \
  -F 'file=@tests/fixtures/sample.dxf'
```

## Troubleshooting

- `413 Payload too large` — уменьшите размер JSON/Excel/DXF.
- `401/403` — проверьте auth и роль пользователя.
- `400` при DXF — передайте multipart с файлом `.dxf`.
