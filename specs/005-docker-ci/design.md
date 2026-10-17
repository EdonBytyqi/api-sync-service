# 005 – Docker und CI: Design

## `docker compose up`

```
postgres ──healthy──▶ migrate (einmalig) ──completed──┐
mock-erp ──healthy────────────────────────────────────┼──▶ service ──healthy──▶ dashboard (nginx :8080)
                                                      ┘        ▲                      │
                                                               └────── /api/ ─────────┘
```

| Dienst      | Image / Build                      | Healthcheck                              | Port (nur 127.0.0.1) |
| ----------- | ---------------------------------- | ---------------------------------------- | -------------------- |
| `postgres`  | `postgres:17-alpine`, Volume `pgdata` | `pg_isready`                          | `${POSTGRES_PORT:-5432}` |
| `migrate`   | Service-Image, `command: migrate`  | – (läuft einmal und endet)               | –                    |
| `mock-erp`  | `./mock-erp`                       | `GET /health`                            | 4000                 |
| `service`   | `.` (Root)                         | `GET /health`                            | 3000                 |
| `dashboard` | `./dashboard`                      | –                                        | 8080                 |

Die bestehende `docker-compose.yml` (nur PostgreSQL) wird ersetzt. Wer nur die Datenbank braucht (Entwicklung, `TEST_DATABASE_URL`), startet `docker compose up postgres`.

## Images

**Service** (`Dockerfile` im Root), mehrstufig wie in App A:
1. `build`: `node:22-alpine`, `npm ci`, `npm run build`.
2. `runtime`: `node:22-alpine`, `npm ci --omit=dev`, `dist/` und `migrations/` kopieren, `USER node`, `CMD ["node", "dist/main.js"]`. Der Migrationsdienst nutzt dasselbe Image mit `node-pg-migrate up` (ist eine Produktionsabhängigkeit). Ein Image für beides, damit Code und Migrationen immer zusammenpassen.

**Mock-ERP** (`mock-erp/Dockerfile`): `node:22-alpine`, `npm ci --omit=dev`, `USER node`.

**Dashboard** (`dashboard/Dockerfile`): Build mit Node, Auslieferung mit `nginx:1.27-alpine` wie in App A. `nginx.conf`: `location /api/ { proxy_pass http://service:3000/; }` (der abschliessende Slash entfernt `/api`), `proxy_redirect / /api/` und `absolute_redirect off`, damit `Location: /sync/runs/7` als `/api/sync/runs/7` beim Browser ankommt (ohne `absolute_redirect off` machte nginx daraus `http://localhost/api/…` mit dem Container-Port 80; vom Smoke-Test gefunden), `try_files $uri /index.html` für Angular-Routen.

## CI-Workflow

Ein Workflow, sechs Jobs. Die fünf Test-Jobs laufen parallel; `docker` wartet auf alle (`needs`).

```yaml
on:
  push: { branches: [main] }
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

`database` und `e2e` bekommen je einen eigenen Service-Container:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    env: { POSTGRES_USER: sync, POSTGRES_PASSWORD: sync, POSTGRES_DB: sync_test }
    ports: ['5432:5432']
    options: --health-cmd "pg_isready -U sync -d sync_test" --health-interval 5s --health-retries 10
env:
  TEST_DATABASE_URL: postgres://sync:sync@localhost:5432/sync_test
```

`docker` baut die Images, startet `FAILURE_RATE=0 SLOW_RATE=0 RATE_LIMIT_RATE=0 docker compose up -d --wait`, schickt `POST http://localhost:8080/api/sync`, pollt `GET /api/sync/runs/<id>` bis zum Endstatus und erwartet `completed` mit 10’000 Produkten. Bei Fehlern hängt der Job `docker compose logs` an.

## Entscheidungen

**Ein Job pro Suite statt eines grossen Jobs.** Ein roter Haken sagt dann sofort, *welche* Suite scheitert (AK-4.3), und die Jobs laufen parallel. Das kostet etwas doppeltes `npm ci`, das der npm-Cache von `setup-node` abfedert.

**Service-Container statt Testcontainers in CI.** Beides funktioniert auf GitHub (Docker ist vorhanden). Service-Container sind schneller, weil Actions die Datenbank parallel zum Checkout startet, und der Weg über `TEST_DATABASE_URL` wird so auch getestet. Testcontainers bleibt der Weg für Rechner mit Docker und ohne laufende Datenbank.

**`database` und `e2e` getrennt.** Die E2E-Tests brauchen zusätzlich das Mock-ERP und sind langsamer. Getrennt sieht man sofort, ob ein Fehler in den Repositories oder im Zusammenspiel liegt.

**Migration als eigener Compose-Dienst.** Spec 003 sagt: Die App migriert nicht selbst, damit mehrere Instanzen nicht gleichzeitig migrieren. Compose bildet das mit `service_completed_successfully` ab. Derselbe Ablauf gilt später in jeder echten Umgebung (eigener Job vor dem Deploy).

**Health prüft die Datenbank, nicht das ERP.** Ein Healthcheck, der vom unzuverlässigen ERP abhängt, wäre ständig rot, und Orchestrierer würden einen gesunden Service neu starten. Die Unzuverlässigkeit des ERP behandelt der Sync-Job selbst (Spec 002/003).

**Smoke-Test über das Dashboard, mit Mock-Raten 0.** Er prüft das Zusammenspiel aller Container inklusive nginx-Proxy und Migration, nicht noch einmal die Retry-Logik; die ist in den anderen Jobs abgedeckt. Mit Raten 0 ist das Ergebnis deterministisch (`completed`), ein roter Smoke-Test bedeutet also wirklich «das System läuft nicht».

**Ports nur an `127.0.0.1`.** Die Compose-Datei ist für die lokale Entwicklung. Gebunden an alle Interfaces wäre die Datenbank mit Standardpasswort im ganzen Netz sichtbar.

**`CMD ["node", "dist/main.js"]`, nie `npm run start:prod` (Review-Befund).** Docker schickt SIGTERM an PID 1 im Container. Mit `npm run …` ist das npm, und der Service hängt davon ab, ob npm das Signal an den Node-Prozess weiterreicht. Kommt es nicht an, wartet Docker `stop_grace_period` ab und beendet den Service hart mit SIGKILL; der laufende Lauf bliebe auf `running` liegen, bis ihn nach 190 s ein anderer Lauf als verwaist übernimmt.

Gemessen mit `docker compose stop service` während eines Laufs (T4):

| Start im Container                        | Stoppen dauert | Lauf danach                   |
| ----------------------------------------- | -------------- | ----------------------------- |
| `node dist/main.js` mit `init: true`      | 0.5 s          | `failed`, `aborted: shutdown` |
| `npm run start:prod` ohne `init` (npm 10.9) | 1.0 s        | `failed`, `aborted: shutdown`, npm meldet `npm error signal SIGTERM` |

Ehrlich festgehalten: Mit npm 10.9 auf `node:22-alpine` kam SIGTERM in diesem Versuch an. Wir verlassen uns trotzdem nicht darauf: Ob npm Signale weiterreicht, hing in der Vergangenheit von der Version ab, über ein `sh -c` dazwischen geht es verloren, npm endet mit einem Fehler-Exit-Code, und es ist ein zusätzlicher Prozess, der nichts beiträgt. Mit Node direkt gibt es keine Abhängigkeit von diesem Verhalten. Zusätzlich `init: true` in Compose: Ein kleines Init (tini) ist PID 1, reicht Signale weiter und räumt Zombie-Prozesse ab. Dasselbe gilt für Mock (`node server.js`) und Migration (`node node_modules/node-pg-migrate/bin/node-pg-migrate.js up`).

**Ports über Variablen (Review-Befund).** Viele Entwickler haben schon eine PostgreSQL auf 5432; ein fester Port liesse `docker compose up` mit «port is already allocated» scheitern. Darum `127.0.0.1:${POSTGRES_PORT:-5432}:5432`, ebenso für die anderen Ports. Im Compose-Netz ändern sich die Ports nie, nur die Weiterleitung nach aussen.

**`stop_grace_period: 30s` für den Service.** Docker sendet SIGTERM und nach 10 s standardmässig SIGKILL. Der Abbruch eines Laufs dauert nach Spec 003 Sekunden; 30 s geben Reserve, damit der Lauf als `failed` mit `aborted: shutdown` abgeschlossen wird statt als verwaister Lauf liegen zu bleiben.
