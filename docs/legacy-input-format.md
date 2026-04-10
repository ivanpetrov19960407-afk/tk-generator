# Legacy формат входных данных (`USER_INPUT`)

Файл `examples/sample_product.json` сохранён только как исторический пример раннего прототипа.

Этот формат имеет вид:

```json
{
  "USER_INPUT": {
    "Тип документа": "...",
    "Изделие": "..."
  }
}
```

## Статус

- Статус: **устарел**.
- Поддержка в CLI: **нет**.
- Что использовать вместо него: `products[]` из примеров:
  - `examples/product_minimal.json`
  - `examples/batch_small.json`
  - `examples/batch_full.json`

При запуске CLI на legacy-файле выводится понятное сообщение об устаревшем формате и ссылка на README.
