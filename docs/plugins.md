# Plugins

## Назначение

Расширение материалов/фактур/операций/экспортёров через runtime-плагины.

## Включение

По умолчанию плагины отключены (`plugins_enabled: false`).

Включить можно через config или ENV:

```bash
TKG_PLUGINS_ENABLED=true npx tk-generator --input examples/batch_small.json --list-plugins
```

## Формат плагина

Папка: `plugins/<plugin-dir>/`

Обязательные файлы:
- `manifest.json`
- `index.js`

`manifest.json` требует поля:
- `name` (string)
- `version` (string)
- `type` (`material|operation|texture|export`)
- `dependencies` (array)

`index.js` должен экспортировать функцию регистрации.

## Plugin API

В функцию плагина передаются методы:
- `registerMaterial(config)`
- `registerTexture(config)`
- `registerOperation(config)`
- `registerExporter(config)`

## Минимальный пример

См. рабочий пример `plugins/granite-special/`.

```js
module.exports = function (api) {
  api.registerMaterial({ type: 'гранит_спец', name: 'Гранит Special Black', density: 2850 });
};
```

## Troubleshooting

- `Plugin not allowed` — плагин не входит в `allowed_plugins`.
- Циклические зависимости в `dependencies` приводят к ошибке загрузки.
- При `--disable-plugin` плагин исключается из загрузки.
