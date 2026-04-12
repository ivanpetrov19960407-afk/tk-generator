# Telegram bot

## Назначение

Telegram-интерфейс для генерации (пошаговый ввод или Excel), проверки стоимости и статуса последнего запуска.

## Запуск

```bash
export BOT_TOKEN=<telegram-bot-token>
npm run bot
```

Ограничение пользователей (опционально):

```bash
export BOT_ALLOWED_USERS=12345,67890
npm run bot
```

Также поддерживается `TKG_BOT_ALLOWED_USERS` через конфиг-loader.

## Доступные команды

- `/start`
- `/generate`
- `/price <позиция>`
- `/status`

## Пошаговый сценарий

1. `/generate`
2. Ввести `name`
3. Ввести размеры `ДxШxТ` (пример: `1200x300x30`)
4. Ввести материал
5. Ввести фактуру
6. Бот отправит DOCX + XLSX

Excel-сценарий: после `/generate` отправьте `.xlsx/.xls` файлом.

## Ограничения

- Максимальный размер файла: 10 MB.
- Поддерживаются только `.xlsx/.xls`.

## Troubleshooting

- `Не задан BOT_TOKEN` — установите env `BOT_TOKEN`.
- Если бот молчит — проверьте `BOT_ALLOWED_USERS`/`TKG_BOT_ALLOWED_USERS`.
- Ошибки Telegram API ретраятся автоматически для transient/429/5xx.
