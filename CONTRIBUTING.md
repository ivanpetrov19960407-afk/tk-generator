# Contributing

Спасибо за вклад в `tk-generator`.

## Требования к окружению

- Node.js 18+ (рекомендуется LTS).
- npm 9+.

## Локальный запуск

```bash
npm ci
npm run hooks:install
npm test
npm run smoke
```

Для ручной проверки CLI:

```bash
tk-generator --input examples/batch_small.json --output ./output
# или
npx tk-generator --input examples/batch_small.json --output ./output
```

## Conventional Commits

В проекте используется `commitlint` с `@commitlint/config-conventional`.

Примеры корректных сообщений коммитов:

- `feat(api): add webhook retries`
- `fix(dxf): handle boundary parsing`
- `docs: update release process`

Локально проверка выполняется через Husky hook `.husky/commit-msg`.

## Стиль изменений

- Изменения должны быть атомарными и покрываться тестами.
- Для новых входных форматов добавляйте пример в `examples/`.
- Для изменений схем обновляйте `schemas/*.json` и тесты валидации.

## Pull Request checklist

- [ ] `npm ci` выполнен без ошибок
- [ ] `npm test` зелёный
- [ ] `npm run lint` зелёный
- [ ] Обновлены docs (`README.md`, `CHANGELOG.md`) при необходимости
