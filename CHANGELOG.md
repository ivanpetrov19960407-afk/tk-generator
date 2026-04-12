# Changelog

Все значимые изменения проекта фиксируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/) и [Semantic Versioning](https://semver.org/lang/ru/).

## [2.0.0] - 2026-04-12

### Added
- Инфраструктура релиза: draft release workflow по тегам `v*` с автогенерацией release notes (`.github/workflows/draft-release.yml`).
- Conventional Commits-инфраструктура: `commitlint` + Husky `commit-msg` hook.
- Репозиторные мета-файлы: `SECURITY.md`, шаблоны issue/PR, `LICENSE`.

### Changed
- Версия пакета обновлена до `2.0.0`.
- В `README.md` обновлены бейджи версии/лицензии и добавлен бейдж CI с относительным endpoint-источником.
- Workflow документации обновлён для предотвращения ошибки `Resource not accessible by integration` при `actions/configure-pages`.

### Notes (Блоки I-IV / T1-T40)

> Ограничение трассировки: в репозитории нет явной карты соответствия «Блок I-IV» и «T1-T40» (нет файлов/меток с такими идентификаторами). Ниже — только подтверждённые изменения из `git log`, workflow-файлов и документации.

- **Блок I (T1-T10):** явные идентификаторы задач `T1-T10` не найдены; подтверждены изменения по CLI/линтингу/базовой стабилизации в истории коммитов.
- **Блок II (T11-T20):** явные идентификаторы задач `T11-T20` не найдены; подтверждены DXF-импорт, исправления API import-dxf и связанные тесты.
- **Блок III (T21-T30):** явные идентификаторы задач `T21-T30` не найдены; подтверждены webhooks, расширенный summary export, покрытие c8, миграции зависимостей.
- **Блок IV (T31-T40):** явные идентификаторы задач `T31-T40` не найдены; подтверждены docsify-сайт, docs workflow и исправления CI для Pages.

### Verified repository history highlights
- docs: добавление docsify-сайта и workflow деплоя документации.
- ci: включение setup Pages и дальнейшие фиксы для деплоя документации.
- feat/fix: DXF import, API import-dxf, webhooks, summary export.

## [1.0.1] - 2026-04-10

### Fixed
- Добавлен `bin`-entry для CLI, чтобы пакет запускался как команда `tk-generator` после `npm i -g` и через `npx`.
- Уточнены npm scripts для повторяемого запуска проверок (`test`, `smoke`).

### Docs
- Добавлен `CONTRIBUTING.md` с правилами вклада и checklist.
- В `README.md` описан запуск как CLI-команды и добавлена матрица совместимости.

## [1.0.0] - 2026-04-09

### Added
- Первый стабильный релиз генератора ТК/МК.
