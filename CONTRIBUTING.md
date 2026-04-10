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

## JSDoc и постепенная типизация (без миграции на TS)

- Ставьте `// @ts-check` в верхней части файла для модулей с активной доработкой или повышенным риском регрессий.
- Для экспортируемых функций обязательно указывайте `@param` и `@returns`, включая optional/nullable поля.
- Для типов проекта используйте `@typedef` через `import('../types').TypeName` и описывайте shape объектов явно (вложенные поля, union-подобные значения).
- `any` допустим только локально (например, при чтении внешнего JSON), когда точный shape заранее неизвестен; старайтесь сразу сужать тип после валидации.

Примеры из репозитория:

```js
/** @typedef {import('./types').Product} Product */
/**
 * @param {Product} product
 * @returns {Product}
 */
function applyDefaults(product) { /* ... */ }
```

```js
/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isPositiveNumber(v) { /* ... */ }
```

## Коммиты и версии

- Используем SemVer (`MAJOR.MINOR.PATCH`).
- Патч-релиз (`x.y.z`) — исправления без ломающих изменений.
- Для заметных изменений обновляйте `CHANGELOG.md`.

## Pull Request checklist

- [ ] `npm ci` выполнен без ошибок
- [ ] `npm test` зелёный
- [ ] Обновлены docs (`README.md`, `CHANGELOG.md`) при необходимости
- [ ] Изменения совместимы с заявленной матрицей совместимости
