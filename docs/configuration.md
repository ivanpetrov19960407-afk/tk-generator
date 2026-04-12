# Configuration

## Назначение

Слои конфигурации и реальные ENV-переопределения.

## Источники

1. Встроенный `DEFAULT_CONFIG`.
2. `config/default.json`.
3. `config/local.json` (если есть).
4. `--config <file.json|yaml>`.
5. ENV overrides.

`--config-dir <dir>` меняет директорию, где ищутся `default.json`/`local.json`.

## Ключевые config-поля

- `locale`
- `company.*`
- `rkm.logisticsDefaults.*`
- `rkm.skipTransportTkNumbers[]`
- `rkm.specialMaterialRules`
- `cost.paths`
- `auth.enabled`, `auth.accessTokenTtlSec`, `auth.refreshTokenTtlSec`, `auth.jwtSecret`
- `bot.allowedUsers[]`
- `plugins_enabled`, `allowed_plugins[]`
- `autoUpdate.enabled`, `autoUpdate.checkInterval`
- `webhooks[]`

## ENV overrides (реально поддерживаемые)

- `TKG_CONFIG_JSON`
- `TKG_COMPANY_NAME`, `TKG_COMPANY_ADDRESS`, `TKG_COMPANY_INN`, `TKG_COMPANY_KPP`, `TKG_COMPANY_RS`, `TKG_COMPANY_BANK`, `TKG_COMPANY_KS`, `TKG_COMPANY_BIK`, `TKG_COMPANY_TEL`, `TKG_COMPANY_EMAIL`
- `TKG_LOGISTICS_DISTANCE_KM`, `TKG_LOGISTICS_TARIFF_RUB_KM`, `TKG_LOGISTICS_TRIPS`, `TKG_LOGISTICS_LOADING`, `TKG_LOGISTICS_UNLOADING`, `TKG_LOGISTICS_INSURANCE_PCT`
- `TKG_SKIP_TRANSPORT_TK_NUMBERS`
- `TKG_BOT_ALLOWED_USERS` / `BOT_ALLOWED_USERS`
- `TKG_AUTH_ENABLED`, `TKG_AUTH_ACCESS_TTL_SEC`, `TKG_AUTH_REFRESH_TTL_SEC`, `TKG_AUTH_JWT_SECRET`
- `TKG_PLUGINS_ENABLED`

Дополнительно в других модулях:
- `BOT_TOKEN`
- `PORT`
- `TK_GENERATOR_DB_PATH`
- `TKG_AUTH_ADMIN_USERNAME`, `TKG_AUTH_ADMIN_PASSWORD`

## Пример

```bash
TKG_AUTH_ENABLED=true \
TKG_AUTH_JWT_SECRET=supersecret_supersecret \
TKG_BOT_ALLOWED_USERS=12345 \
npm run serve
```

## Troubleshooting

- Для production auth обязателен JWT secret длиной >=16.
- YAML-конфиги работают только при установленном пакете `yaml`.
