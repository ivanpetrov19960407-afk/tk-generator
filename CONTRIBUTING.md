# Contributing

Спасибо за вклад в `tk-generator`.

## Требования к окружению

- Node.js 18 LTS или 20 LTS (рекомендуется).
- npm 9+.
- Linux/macOS/WSL (Windows без WSL не тестируется в CI).

## Локальный запуск

```bash
npm ci
npm test
npm run smoke
```

Для ручной проверки CLI:

```bash
tk-generator --input examples/batch_small.json --output ./output
# или
npx tk-generator --input examples/batch_small.json --output ./output
```

## Стиль изменений

- Изменения должны быть атомарными и покрываться тестами.
- Для новых входных форматов добавляйте пример в `examples/`.
- Для изменений схем обновляйте `schemas/*.json` и тесты валидации.

## Коммиты и версии

- Используем SemVer (`MAJOR.MINOR.PATCH`).
- Патч-релиз (`x.y.z`) — исправления без ломающих изменений.
- Для заметных изменений обновляйте `CHANGELOG.md`.

## Pull Request checklist

- [ ] `npm ci` выполнен без ошибок
- [ ] `npm test` зелёный
- [ ] Обновлены docs (`README.md`, `CHANGELOG.md`) при необходимости
- [ ] Изменения совместимы с заявленной матрицей совместимости
