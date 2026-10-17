# mock-erp

A deliberately unreliable ERP API that `api-sync-service` syncs from.

```bash
cd mock-erp
npm install
npm start            # unreliable defaults
npm run start:stable # all failure rates set to 0
```

## Endpoint

`GET /products?page=1&pageSize=100`

```json
{ "items": [{ "id": 1, "sku": "SKU-00001", "name": "Product 1", "priceCents": 8019, "updatedAt": "2026-01-01T00:01:00.000Z" }], "page": 1, "pageSize": 100, "total": 10000 }
```

- 10,000 products, generated deterministically (same order and values on every start).
- Prices are integer cents (`priceCents`), never floats.
- `page` and `pageSize` must be positive integers, `pageSize <= 1000`, otherwise `400`. A page past the end returns `items: []`.

## Failure injection

| Env var           | Default | Effect                                   |
| ----------------- | ------- | ---------------------------------------- |
| `FAILURE_RATE`    | `0.2`   | Share of requests answered with `500`    |
| `RATE_LIMIT_RATE` | `0.05`  | Share answered with `429` + `Retry-After: 2` |
| `SLOW_RATE`       | `0.1`   | Share delayed by `SLOW_MS` before answering |
| `SLOW_MS`         | `5000`  | Delay for slow responses (ms)            |
| `PORT`            | `4000`  | Listen port                              |

The 500 and 429 rates come from one random roll so they don't overlap. The delay is rolled separately, so a slow response can still end in an error, which is the nastiest case for a client's timeout handling.
