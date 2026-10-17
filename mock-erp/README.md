# mock-erp

A deliberately unreliable ERP API that `api-sync-service` syncs from.

```bash
cd mock-erp
npm install
npm start            # unreliable defaults
npm run start:stable # all failure rates set to 0
npm test             # vitest + supertest, no real randomness or waiting
```

Spec: [`specs/001-mock-erp`](../specs/001-mock-erp/requirements.md).

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

Invalid values (`FAILURE_RATE=abc`, a rate outside 0–1, `FAILURE_RATE + RATE_LIMIT_RATE > 1`, a bad `SLOW_MS` or `PORT`) stop the server at startup with exit code 1 and a message naming each bad variable.

The 500 and 429 rates come from one random roll so they don't overlap. The delay is rolled separately, so a slow response can still end in an error, which is the nastiest case for a client's timeout handling.

## Testing

`createApp(config, { random, sleep })` takes the random source and the delay function as parameters. Tests pass a fixed sequence (e.g. `0.99, 0.01` = not slow, 429) and a sleep stub, so each request's outcome is decided by the test. Rates are verified exactly by running 1,000 evenly spaced values through `rollChaos`.
