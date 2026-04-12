# Генератор ТК+МК для изделий из натурального камня

![Coverage >=60%](https://img.shields.io/badge/coverage-%E2%89%A560%25-brightgreen)

Параметрический генератор технологических карт (ТК) и маршрутных карт (МК) для производства изделий из натурального камня (мрамор, гранит и др.).

Работает полностью офлайн — без AI, без API. Чистая шаблонизация + параметрическая подстановка.


## Документация

- Documentation site (Docsify): `docs/`
- Локальный запуск документации: `npx serve docs` или `python -m http.server 8080 --directory docs`
- Основная точка входа: `docs/README.md`

## Что это делает

Генерирует готовые `.docx` документы ТК+МК на основе:
- Библиотеки из 29 детальных технологических операций (3 варианта фактуры)
- Шаблонов разделов 1–13 и титульной страницы
- Параметров конкретного изделия (размеры, материал, фактура, количество)

Каждый сгенерированный документ включает:
- Титульную страницу
- Разделы 1–5 (область применения, исходные данные, нормативы, организация, маршрут)
- Раздел 6 — детальное описание всех 29 операций (связный технологический текст)
- Разделы 7–13 (контроль качества, ОТ, экология, ресурсы, приложения, допущения, missing data)
- Маршрутную карту (МК) в табличной форме по ГОСТ 3.1118-82

## Установка

```bash
cd tk-generator
npm install
```

Для глобального CLI:

```bash
npm i -g tk-generator
tk-generator --help
```

Для одноразового запуска без установки:

```bash
npx tk-generator --help
```

Требуется Node.js 18+ (рекомендуется LTS).

## Быстрый старт

```bash
# Генерация одного изделия
tk-generator --input examples/batch_small.json --output output/

# Генерация из Excel файла
tk-generator --input examples/sample_input.xlsx --output output/

# Справка
tk-generator --help

# Использовать кастомную папку конфигурации
tk-generator --input examples/batch_small.json --config-dir ./config

# Наложить дополнительный конфиг-файл поверх default/local
tk-generator --input examples/batch_small.json --config ./my-config.json
```



## Telegram-бот

- Настройка и запуск: `docs/telegram-bot-setup.md`.
- Docker запуск: `README-docker.md`.

## Матрица совместимости

| Компонент | Поддерживаемые версии | Статус |
|---|---|---|
| Node.js | 18.x, 20.x, 22.x | ✅ поддерживается |
| npm | 9+ | ✅ поддерживается |
| ОС | Ubuntu 22.04+, macOS 13+, WSL2 | ✅ проверяется регулярно |

## Конфигурация (default/local/env)

- Базовый публичный конфиг: `config/default.json`
- Локальный приватный конфиг: `config/local.json` (игнорируется Git)
- Пример локального файла: `config/local.example.json`

Слои загрузки (снизу вверх):
1. встроенные дефолты приложения;
2. `config/default.json`;
3. `config/local.json`;
4. `--config <path>`;
5. ENV-переопределения (`TKG_CONFIG_JSON`, `TKG_LOGISTICS_*`, `TKG_SKIP_TRANSPORT_TK_NUMBERS`, `TKG_COMPANY_*`).

Через конфиг управляются:
- реквизиты компании для титульного листа РКМ;
- дефолтные параметры логистики;
- список позиций с `transport.skip`;
- спец-правила по материалам (например, для `габбро-диабаз`).

## Расчёт стоимости

В проект добавлен модуль `src/cost-calculator.js` для расчёта сметы по операциям:

- `calculateCostByOperation(product, operationNumber)` — стоимость конкретной операции
- `calculateTotalCost(product)` — полная себестоимость изделия
- `calculateMarkup(baseCost, markupPercent)` — наценка и цена продажи
- `calculateControlPrice(baseCost, controlCoefficient)` — расчёт контрольной цены

### Источники ставок

- `data/costs/labor_rates.json` — тарифы работников (руб/ч)
- `data/costs/equipment_costs.json` — стоимость машино-часа (руб/ч)
- `data/costs/material_prices.json` — расходники и удельные материалы по операциям
- `data/costs/overhead.json` — накладные расходы и значения по умолчанию

### CLI-флаги

```bash
# Показать смету в консоли
node src/index.js --input examples/batch_small.json --cost-breakdown

# Экспортировать смету в JSON
node src/index.js --input examples/batch_small.json --export-cost output/costs.json

# Переопределить тарифы труда внешним JSON
node src/index.js --input examples/batch_small.json --cost-breakdown --labor-rates-override ./my_labor_rates.json

# Применить overrides операций
node src/index.js --input examples/batch_small.json --overrides ./examples/operation_overrides.json
```

### Формат JSON экспорта

- `generated_at` — дата и время расчёта
- `products[]` — массив смет по изделиям
- В каждой смете есть `operations_cost[]`, `total_direct_cost`, `overhead_cost`, `total_cost`, `selling_price`, `control_price`, `margin`

Смотрите пример запуска: `examples/cost_calculation_example.js`.

## Формат входных данных

Актуальные примеры входа:

- `examples/product_minimal.json` — минимально необходимый валидный JSON.
- `examples/batch_small.json` — маленький пакет (3 позиции).
- `examples/batch_full.json` — полный большой пакет для боевого прогона и РКМ.

### Обязательные поля продукта

Каждый объект в `products[]` обязан содержать:

- `name`
- `dimensions.length`
- `dimensions.width`
- `dimensions.thickness`
- `material.type`
- `material.name`
- `material.density`
- `texture` (`лощение`, `рельефная_матовая`, `бучардирование_лощение`)

### Опциональные поля продукта

Можно дополнительно указывать, например:

- `tk_number`, `short_name`
- `quantity`, `quantity_pieces`
- `edges`, `geometry_type`, `category`, `gost_primary`, `packaging`, `date`
- `object`, `rkm`, `control_price`, `operation_overrides`, `overrides_path`

### Legacy-формат

Старый формат с корневым полем `USER_INPUT` больше не поддерживается для запуска CLI.
При попытке запуска будет выведено сообщение, что формат устарел, с указанием перейти к актуальным примерам выше.
Подробности вынесены в `docs/legacy-input-format.md`.

### JSON

```json
{
  "products": [
    {
      "tk_number": 1,
      "name": "Плита напольная",
      "short_name": "plita_napolnaya",
      "dimensions": {
        "length": 700,
        "width": 700,
        "thickness": 30
      },
      "material": {
        "type": "мрамор",
        "name": "Delikato light",
        "density": 2700
      },
      "texture": "лощение",
      "quantity": "14,1 кв.м.",
      "quantity_pieces": 29,
      "edges": "фаски 5мм по четырём сторонам",
      "geometry_type": "simple",
      "category": "1",
      "gost_primary": "ГОСТ 9480-2024",
      "packaging": "стандартная",
      "date": "02 апреля 2026 г.",
      "overrides_path": "./examples/operation_overrides.json",
      "operation_overrides": {
        "replace_fields": {
          "10": { "title": "Ручная правка", "text": "Финальная ручная корректировка" }
        }
      }
    }
  ]
}
```

### Excel (.xlsx)

Каждая строка — одно изделие. Колонки:

| Колонка | Описание | Пример |
|---------|----------|--------|
| `tk_number` | Номер ТК | 1 |
| `name` | Название изделия | Плита напольная |
| `short_name` | Код (для имени файла) | plita_napolnaya |
| `length` | Длина, мм | 700 |
| `width` | Ширина, мм | 700 |
| `thickness` | Толщина, мм | 30 |
| `material_type` | Порода камня | мрамор |
| `material_name` | Коммерческое название | Delikato light |
| `density` | Плотность, кг/м³ | 2700 |
| `texture` | Тип фактуры | лощение |
| `quantity` | Объём партии | 14,1 кв.м. |
| `quantity_pieces` | Количество штук | 29 |
| `edges` | Обработка кромок | фаски 5мм |
| `packaging` | Тип упаковки | стандартная |
| `date` | Дата разработки | 02 апреля 2026 г. |

#### Официальный шаблон импорта и явный mapping колонок

Для программной загрузки используйте официальный шаблон, который генерируется локально:

```bash
npm run excel:template
```

По умолчанию будет создан файл `templates/input_template.xlsx` (локально, без хранения бинарного файла в репозитории).

Импорт из Excel с явным сопоставлением колонок:

```bash
node scripts/build_batch_from_excel.js ./input.xlsx ./examples/full_album_batch.json \
  --excel-mapping '{"position":"№","name":"Наименование изделия","texture":"Фактура","dimensions":"Габаритные размеры","unit":"Ед. изм.","quantity":"Кол-во","controlPrice":"Контрольная цена за ед.изм. с НДС"}'
```

Если колонка `Габаритные размеры` отсутствует (и не передан `--excel-mapping` для `dimensions`), импорт завершится ошибкой с подсказкой.

### DXF (.dxf)

Поддержан базовый DXF-импорт для 2D-чертежей с извлечением `length/width/thickness`.
Ограничения и эвристики описаны в `docs/dxf-import.md`.

## Поддерживаемые типы фактуры

| Значение | Описание | Операции 17–20 |
|----------|----------|---------------|
| `лощение` | Матовый сатиновый блеск | НЕ ПРИМЕНЯЮТСЯ |
| `рельефная_матовая` | Текстурированная поверхность | Рельефная матовая обработка |
| `бучардирование_лощение` | Бучардирование + лощение | Полное бучардирование |

> Важно: `полировка` не является поддерживаемой фактурой продукта.  
> Для такой строки генератор завершится на этапе валидации с подсказкой допустимых значений.

## Параметрическая подстановка

Генератор заменяет в шаблонных текстах:

| Параметр | Что заменяется |
|----------|---------------|
| Размеры изделия | 700×700×30 → ваши размеры |
| Название материала | Delikato light → ваш материал |
| Плотность | ~2700 кг/м³ → ваша плотность |
| Масса изделия | Рассчитывается автоматически |
| Масса блока | Рассчитывается по плотности |
| Количество штук | 29 плит → ваше количество |
| Площадь партии | 14,1 м² → ваша площадь |
| Масса партии | Рассчитывается |

**НЕ заменяются:**
- Перекрёстные ссылки между операциями (Операция №8, см. Операцию №12)
- Размеры стандартного блока (3200×1500×1000 мм)
- Названия оборудования и модели станков
- Ссылки на ГОСТы и нормативные документы

## Проверка оборудования

Генератор автоматически проверяет совместимость изделия с оборудованием:

| Станок | Ограничение | Действие при превышении |
|--------|-------------|----------------------|
| JC-1010 | Ширина ≤ 1000 мм, высота ≤ 50 мм | Предупреждение |
| SPG1200-12 | Ширина ≤ 1200 мм, высота ≤ 50 мм | Предупреждение |
| SQC600-4D | Глубина реза ≤ 180 мм | Предупреждение |
| DWSG-22AX-6P | Размер реза ≤ 450 мм | Предупреждение |

## Структура проекта

```
tk-generator/
├── package.json
├── README.md
├── src/
│   ├── index.js            — CLI: парсинг аргументов, чтение JSON/XLSX
│   ├── generator.js        — Оркестрация: валидация, сборка, запись файла
│   ├── operations.js       — Параметрическая подстановка в текстах 29 операций
│   ├── sections.js         — Генерация разделов 1–5, 7–13, титульная страница
│   ├── mk-table.js         — Маршрутная карта: заголовок + таблица 29 строк
│   ├── docx-builder.js     — DOCX-форматирование: markdown→docx, таблицы, стили
│   └── equipment.js        — Анализ оборудования, расчёт масс
├── data/
│   ├── operations_library.json  — 29 операций × 3 фактуры (шаблонные тексты)
│   ├── sections_template.json   — Шаблоны разделов 1–13, МК, титульная
│   ├── equipment.json           — Каталог оборудования с лимитами
│   ├── personnel.json           — Каталог персонала
│   └── gost_references.json     — Справочник ГОСТов и нормативов
├── templates/
│   └── operation_overrides/     — Пользовательские переопределения текстов
├── examples/
│   ├── product_minimal.json     — Пример: минимальный валидный ввод
│   ├── batch_small.json         — Пример: 3 изделия (все фактуры)
│   ├── batch_full.json          — Пример: полный пакет для РКМ
│   └── sample_input.xlsx        — Пример: Excel-ввод
└── output/                      — Сгенерированные документы
```

## Как добавить новый тип изделия

1. Определите `texture` — одну из трёх поддерживаемых фактур (`лощение`, `рельефная_матовая`, `бучардирование_лощение`)
2. Задайте размеры в `dimensions`
3. Укажите материал и плотность в `material`
4. Запустите генерацию — параметрическая подстановка сделает остальное

Для изделий с нестандартной геометрией (радиусные, П-образные, профильные):
- Базовый шаблон операций одинаковый для всех геометрий
- Различия описаны в полях `geometry_type` и `edges`

## Как редактировать тексты операций

### Глобальное изменение
Редактируйте `data/operations_library.json`. Каждая операция имеет:
```json
{
  "title": "НАЗВАНИЕ ОПЕРАЦИИ",
  "text": "Полный текст операции с **markdown** форматированием..."
}
```

### Пользовательские переопределения (overrides)
Поддерживается отдельный JSON-файл (через `--overrides` или `product.overrides_path`).

Пример формата:
```json
{
  "version": 1,
  "rules": [
    {
      "match": { "texture": "бучардирование_лощение" },
      "patch": {
        "drop_operations": [29],
        "replace_fields": {
          "10": { "name": "Уточнённая операция 10", "comment": "переопределено" }
        }
      }
    }
  ]
}
```

Поддерживаемые поля `match`:
- `texture`
- `material_type`
- `material_name`
- `geometry_type`
- `name_regex`

Поддерживаемые поля `patch`:
- `drop_operations: number[]` — удалить операции по номеру
- `replace_fields: { [operationNo]: object }` — заменить поля операции (`title/text`, а также алиасы `name/comment`)

Приоритет применения:
1. База (`data/operations_library.json` + параметризация)
2. Overrides-файл (`--overrides` или `product.overrides_path`)
3. Ручные правки в `product.operation_overrides`

Поведение при ошибках:
- Битый JSON overrides → ошибка с путём файла.
- Ссылка на несуществующую операцию → предупреждение, правило пропускается.

## Форматирование документа

- **Шрифт:** Times New Roman, 12pt основной текст, 14pt заголовки
- **Страница:** A4, поля 20 мм со всех сторон
- **Верхний колонтитул:** название изделия + материал (курсив)
- **Нижний колонтитул:** «Стр. X из Y»
- **Выравнивание:** по ширине (justified)
- **Межстрочный интервал:** 1.15
- **Markdown → DOCX:** `**жирный**` → жирный текст, `---` → тире (—)

## Значения по умолчанию

Если параметр не указан, применяются:

| Параметр | Значение по умолчанию |
|----------|----------------------|
| `density` | 2700 кг/м³ (для мрамора/гранита) |
| `edges` | «калибровка по всем сторонам» |
| `packaging` | стандартная |
| `category` | 1 |
| `gost_primary` | ГОСТ 9480-2024 |
| `quantity_pieces` | Рассчитывается из `quantity` и размеров |

## Техническая информация

- **Зависимости:** `docx` (генерация .docx), `xlsx` (чтение Excel), `minimist` (CLI)
- **Размер выходного файла:** 45–75 КБ
- **Количество страниц:** 30–65 (зависит от фактуры и объёма текста)
- **Время генерации:** < 2 секунды на документ


## Standalone Windows binary (без Node.js)

Сборка исполняемого файла и ассетов рядом с ним:

```bash
npm run build:binary
```

После сборки в `dist/` будут:
- `tk-generator.exe`
- папки `data/`, `config/`, `schemas/`, `templates/`

Запуск бинарника:

```bash
dist/tk-generator.exe --input examples/batch_small.json --output dist/output --rkm
```

Проверка обновлений standalone:

```bash
tk-generator --check-update
tk-generator --self-update
```

`--check-update` проверяет `releases/latest` в GitHub и сообщает доступную версию.
`--self-update` скачивает свежий архив standalone рядом с текущим исполняемым файлом.

## Desktop (Electron)

- Dev run: `npm run desktop:dev`
- Build Windows (NSIS): `npm run desktop:build`
- Build macOS (.dmg): `npm run desktop:build:mac`
- Build Linux (.AppImage): `npm run desktop:build:linux`

Electron uses secure defaults (`nodeIntegration: false`, `contextIsolation: true`) and starts embedded API server on a random local port.

Auto-update для Electron работает через `electron-updater` и GitHub Releases. При обнаружении новой версии показывается диалог: «Доступна версия X.Y.Z. Обновить сейчас?».
