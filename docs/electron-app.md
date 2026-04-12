# Electron app

## Назначение

Desktop-оболочка над встроенным локальным Web API и web-интерфейсом.

## Запуск и сборка

```bash
npm run desktop:dev
npm run desktop:build
npm run desktop:build:mac
npm run desktop:build:linux
```

## Как это устроено

- Поднимает встроенный API-сервер на случайном localhost-порту.
- Открывает `http://127.0.0.1:<port>/` в `BrowserWindow`.
- Есть tray/menu, выбор входного файла и output-dir через IPC.

## Troubleshooting

- Если окно не открывается — проверьте логи `desktop/electron-error.log`.
- Если не стартует встроенный сервер, убедитесь, что локальные порты доступны.
