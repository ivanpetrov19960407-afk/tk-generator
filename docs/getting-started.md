# Быстрый старт (5 минут)

## Назначение

Минимальный запуск генерации ТК/МК и РКМ из готовых примеров.

## Шаги

1. Установите зависимости:

```bash
npm install
```

2. Проверьте CLI:

```bash
npx tk-generator --help
```

3. Сгенерируйте ТК из JSON-примера:

```bash
npx tk-generator --input examples/batch_small.json --output output/
```

4. Сгенерируйте ТК + РКМ:

```bash
npx tk-generator --input examples/batch_small.json --output output/ --rkm
```

5. (Опционально) запустите Web API:

```bash
npm run serve
```

Проверка:

```bash
curl http://localhost:3000/api/health
```

## Частые ошибки

- `Не указан входной файл (--input)`
  - Передайте `--input <path>`.
- `Файл не найден`
  - Проверьте относительный путь (обычно от корня репозитория).
- `Входные данные не прошли валидацию`
  - Прогоните сначала `--validate-only`:

```bash
npx tk-generator --input examples/batch_small.json --validate-only
```
