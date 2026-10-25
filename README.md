<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

Syncs a product catalogue from an unreliable ERP into PostgreSQL, with retries, run logging, crash recovery and an Angular dashboard. Specs live in [`specs/`](specs/): 001 mock ERP, 002 ERP client, 003 sync job, 004 dashboard, 005 Docker and CI.

[![CI](https://github.com/EdonBytyqi/api-sync-service/actions/workflows/ci.yml/badge.svg)](https://github.com/EdonBytyqi/api-sync-service/actions/workflows/ci.yml)

## Everything with Docker

```bash
docker compose up --build        # → http://localhost:8080
```

This starts PostgreSQL, a one-off migration, the mock ERP (unreliable by default), the service and the dashboard. Each waits for the previous one's health check. Data survives restarts in the `pgdata` volume; `docker compose down -v` wipes it.

| Variable                                           | Default        | Purpose                                                     |
| -------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| `DASHBOARD_PORT`, `SERVICE_PORT`, `POSTGRES_PORT`, `MOCK_PORT` | 8080, 3000, 5432, 4000 | Host ports (bound to 127.0.0.1), e.g. `POSTGRES_PORT=5433` if 5432 is taken |
| `FAILURE_RATE`, `SLOW_RATE`, `RATE_LIMIT_RATE`     | 0.2, 0.1, 0.05 | Mock chaos; `0` for a stable demo                           |
| `SYNC_SCHEDULE_ENABLED`, `SYNC_CRON`               | true, `*/15 * * * *` | Scheduled syncs                                       |
| `POSTGRES_PASSWORD`                                | `sync`         | Local development only                                      |

`docker compose up postgres` starts only the database, e.g. for `TEST_DATABASE_URL`. To run the smoke test against a running stack, start it with the chaos rates at 0 and the schedule off, then run `bash scripts/smoke.sh`.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main` and on every pull request, with one job per suite:

| Job        | What it runs                                                                      |
| ---------- | --------------------------------------------------------------------------------- |
| service    | `npm run lint`, `npm run build`, `npm test` (unit, no database)                   |
| mock-erp   | `npm test` in `mock-erp/`                                                         |
| database   | `npm run test:db` against a PostgreSQL 17 service container (`TEST_DATABASE_URL`) |
| e2e        | `npm run test:e2e`: service + real mock-erp + PostgreSQL service container        |
| dashboard  | `ng test` incl. axe-core, `scripts/contrast.mjs`, production build                |
| docker     | after all others: `docker compose up --wait` with chaos 0, then `scripts/smoke.sh` |

New commits on a PR cancel its running CI; pushes to `main` always finish. No secrets are needed.

**Branch protection** is a repository setting, not a file. To make these checks mandatory: *Settings → Branches → Add rule* for `main`, enable "Require status checks to pass", and select all six jobs.

## ERP client

`src/erp/` fetches one page of products from the ERP (spec: [`specs/002-erp-client`](specs/002-erp-client/requirements.md)). For local development, run the unreliable mock ERP in [`mock-erp/`](mock-erp/README.md).

| Env var                  | Default                 | Meaning                                             |
| ------------------------ | ----------------------- | --------------------------------------------------- |
| `ERP_BASE_URL`           | `http://localhost:4000` | ERP base URL                                        |
| `ERP_TIMEOUT_MS`         | `2000`                  | Timeout per attempt, including reading the body     |
| `ERP_MAX_ATTEMPTS`       | `5`                     | Attempts in total, including the first              |
| `ERP_BASE_DELAY_MS`      | `200`                   | Backoff base: cap is `base × 2^(attempt−1)`         |
| `ERP_MAX_DELAY_MS`       | `5000`                  | Backoff cap                                         |
| `ERP_MAX_RETRY_AFTER_MS` | `30000`                 | Longer `Retry-After` → fail with `rateLimited`      |

Invalid values stop the app at startup, naming each bad variable.

Behaviour on failure:

- **Retried** with full-jitter backoff: timeouts, network errors (also mid-body), 408, 500, 502, 504.
- **Retried after `Retry-After`** (seconds or HTTP date): 429 and 503. Without a valid header: backoff.
- **Not retried**: 400 and other 4xx, other 5xx such as 501, and a complete body that is invalid JSON, breaks the schema or is the wrong page.
- Errors are `ErpError` with `reason`, `retryable`, `attempts`, `status` and, for long rate limits, `retryAfterMs`.
- One `fetchPage` takes at most `ErpClient.maxDurationMs(config)`: 130 s with the defaults.

```bash
npm test             # unit tests, incl. a real node:http server for dropped bodies
npm run test:e2e     # against the real mock-erp, started as a child process
                     # (needs `npm install` in mock-erp/ first, and a database, see below)
cd mock-erp && npm test
```

## Sync job

`src/sync/` fetches the whole catalogue page by page and stores it in PostgreSQL (spec: [`specs/003-sync-job`](specs/003-sync-job/requirements.md)).

```bash
docker compose up -d                                   # PostgreSQL 17 on :5432
export DATABASE_URL=postgres://sync:sync@localhost:5432/sync
npm run migrate                                        # separate step; the app never migrates itself
(cd mock-erp && npm install && npm start)              # unreliable ERP on :4000
npm run start:dev
curl -i -X POST localhost:3000/sync                    # 202 + Location: /sync/runs/<id>
curl localhost:3000/sync/runs/1
```

| Endpoint              | Result                                                              |
| --------------------- | ------------------------------------------------------------------- |
| `POST /sync`          | 202 with `{ id, status, trigger }` and `Location`; 409 with `runningRunId` if a run is active |
| `GET /sync/runs`      | Newest runs first, `?limit=1..100` (default 20)                      |
| `GET /sync/runs/:id`  | One run with counters, `failedPages` and `error`; 404 if unknown     |

**Run status:** `completed`: every page stored, missing products deactivated. `partial`: some pages still missing after the second pass, `total` changed during the run, or more than `SYNC_MAX_DEACTIVATE_RATIO` would have been deactivated. Stored pages are kept, nothing is deactivated. `failed`: page 1 failed, too many pages failed in a row, database error, shutdown, or abandoned (no heartbeat for `maxDurationMs + SYNC_STALE_MARGIN_MS`).

| Env var                         | Default        | Meaning                                                  |
| ------------------------------- | -------------- | -------------------------------------------------------- |
| `DATABASE_URL`                  | –              | Required                                                 |
| `SYNC_PAGE_SIZE`                | `100`          | 1–1000                                                   |
| `SYNC_CRON`                     | `*/15 * * * *` | Schedule; a tick during a running run is skipped         |
| `SYNC_SCHEDULE_ENABLED`         | `true`         | `true` or `false`                                        |
| `SYNC_MAX_CONSECUTIVE_FAILURES` | `3`            | Abort the run as `failed` after this many failed pages in a row |
| `SYNC_MAX_DEACTIVATE_RATIO`     | `0.1`          | Refuse to deactivate more than this share of active products |
| `SYNC_STALE_MARGIN_MS`          | `60000`        | Added to `maxDurationMs` (130 s) to detect abandoned runs |

Measured against the mock with default rates and page size 100: one run of 10,000 products took 49 s (simulation: median 50 s, p99 81 s).

### Database tests

```bash
npm run test:db      # repositories, migration, runner against real PostgreSQL
npm run test:e2e     # whole service against mock-erp and PostgreSQL
```

Both use `TEST_DATABASE_URL` if set (CI service container, environments without Docker), otherwise they start `postgres:17-alpine` with Testcontainers (needs Docker). Each test file migrates its own schema and drops it afterwards, so an existing database stays clean. `npm test` needs neither Docker nor a database.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

This project is already instrumented. Create a free account at [observe.nestjs.com](https://observe.nestjs.com), add an application, and paste the generated app key and secret into the `ObserveModule.forRoot()` call in `src/app.module.ts`.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Working with AI

How I use AI assistants on this project, safely and responsibly: [AI_GUIDE.md](AI_GUIDE.md).
In short: *AI delivers the code, I take the accountability.*

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
