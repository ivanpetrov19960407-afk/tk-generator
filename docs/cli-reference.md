# CLI reference

## Назначение

Полный список реальных CLI-флагов `tk-generator` из `src/index.js`.

## Базовый запуск

```bash
tk-generator --input <file.json|file.xlsx|file.dxf> --output output/
```

## Все поддерживаемые флаги

### Ввод/вывод

- `-i, --input <path>` — входной файл (`.json`, `.xlsx/.xls`, `.dxf`), обязателен.
- `-o, --output <dir>` — каталог вывода (по умолчанию `output/`).
- `--format <docx|pdf|docx,pdf>` — формат(ы) ТК.
- `--template <path.docx>` — пользовательский DOCX-шаблон.
- `--export-csv <path>` — CSV-экспорт плоской таблицы позиций партии.

### Режимы генерации

- `--rkm` — генерировать РКМ (XLSX).
- `--optimize` — оптимизация РКМ по контрольной цене (используется с `--rkm`).
- `--summary` — сводный отчёт по партии (XLSX/PDF).
- `--validate-only` — только валидация входа.
- `--watch` — режим наблюдения за изменениями и регенерации 1-й позиции.

### Стоимость/калькуляция

- `--cost-breakdown` — вывести смету в лог.
- `-e, --export-cost <file.json>` — экспорт сметы в JSON.
- `--export-1c` — экспорт калькуляций в XML для 1С.
- `--export-1c-csv` — экспорт калькуляций в CSV для 1С.
- `--labor-rates-override <file.json>`
- `--equipment-costs-override <file.json>`
- `--material-prices-override <file.json>`
- `--overhead-override <file.json>`
- `--overrides <file.json>` — override операций по rules JSON.

### Производительность/поведение

- `--profile` — тайминги стадий генерации.
- `--cache` / `--no-cache` — включить/выключить кэш.
- `--concurrency <n>` — параллелизм пакетной генерации.
- `--unknown-unit-policy <warning|error>` — политика для нераспознанных единиц.
- `--thickness <mm>` — толщина для DXF-импорта.

### Конфиг и логирование

- `--config <file.json|yaml>` — дополнительный конфиг поверх default/local.
- `--config-dir <dir>` — директория с `default.json` и `local.json`.
- `--log-level <error|warn|info|debug>`
- `--log-file <path>`

### Плагины

- `--list-plugins` — вывести статус плагинов.
- `--disable-plugin <name>` — отключить плагин (можно несколько раз или через запятую).

### История/статистика

- `--history` — последние запуски.
- `--history-detail <id>` — детали запуска.
- `--stats` — агрегированная статистика.
- `--page <n>` — страница для `--history`.
- `--limit <n>` — размер страницы для `--history`.
- `--from <date>`, `--to <date>` — фильтры дат для `--stats`.

### Webhooks

- `--webhook <url>` — одноразовый webhook для текущего запуска (добавляется к runtime-конфигу).

### Обновления standalone

- `--check-update` — проверить доступность новой версии standalone.
- `--self-update` — self-update standalone из GitHub Releases.

### Прочее

- `-h, --help` — справка.

## Пошаговые примеры

```bash
# 1) Только валидация
npx tk-generator --input examples/batch_small.json --validate-only

# 2) DOCX+PDF
npx tk-generator --input examples/batch_small.json --format docx,pdf --output output/

# 3) ТК + РКМ + summary
npx tk-generator --input examples/batch_small.json --rkm --summary --output output/

# 4) Экспорт 1С
npx tk-generator --input examples/batch_small.json --export-1c --export-1c-csv --output output/
```

## Troubleshooting

- Ошибка по `--template`: убедитесь, что путь существует.
- `--log-level` принимает только `error|warn|info|debug`.
- `--optimize` имеет смысл только при генерации РКМ (`--rkm`).
