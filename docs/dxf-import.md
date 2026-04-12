# DXF import

## Назначение

Извлечение `length/width/thickness` из DXF для последующей генерации.

## Поддерживаемые сущности

- Геометрия: `LWPOLYLINE`, `LINE`, `POLYLINE`
- Размеры: `DIMENSION`
- Подсказки толщины: `TEXT`, `MTEXT`, имена слоёв, имя файла

## Определение размеров

1. Считываются bbox по геометрии.
2. Если есть минимум 2 валидных `DIMENSION`, они приоритетнее bbox.
3. Единицы берутся из `$INSUNITS`:
   - `1` => inches (конвертация в мм)
   - `4` => millimeters

## Определение толщины (по приоритету)

1. `options.thickness`
2. CLI `--thickness`
3. Имя файла
4. `TEXT` / `MTEXT`
5. Слои (`T=30`, `THK=30`, `30mm`)

## Пример CLI

```bash
npx tk-generator --input tests/fixtures/sample.dxf --thickness 30 --output output/
```

## Пример API

```bash
curl -X POST 'http://localhost:3000/api/import-dxf?thickness=30' \
  -F 'file=@tests/fixtures/sample.dxf'
```

## Troubleshooting

- Если толщина не найдена — передайте `--thickness`.
- Поддержка только 2D DXF.
- Для многоконтурных файлов выбирается один основной контур.
