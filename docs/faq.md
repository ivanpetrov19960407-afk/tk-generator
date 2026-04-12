# FAQ

## Какие форматы входа поддерживаются?

- JSON (`products[]`)
- Excel (`.xlsx/.xls`)
- DXF (`.dxf`)

## Поддерживается ли legacy `USER_INPUT`?

Нет. Этот формат помечен как устаревший и CLI выдаёт ошибку.

## Можно ли получить PDF?

Да, через `--format pdf` или `--format docx,pdf`.

## Есть ли API-документация?

Да: `GET /api/docs` и `GET /api/docs/spec.json`.

## Как включить плагины?

Установить `plugins_enabled=true` в конфиге или `TKG_PLUGINS_ENABLED=true` в окружении.

## Как быстро проверить корректность входа?

```bash
npx tk-generator --input examples/batch_small.json --validate-only
```
