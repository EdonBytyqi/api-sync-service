# 003 – Sync-Job: Aufgaben

> Status: umgesetzt, in vier Commits (Migration, Repositories, Runner/Service, API). Spec vor dem Code reviewt; Änderungen aus der Review: Heartbeat vor jedem `fetchPage` (AK-7.3, AK-7.3a), doppelte IDs in einer Seite (AK-3.9), Datenbank-Tests auch ohne Docker über `TEST_DATABASE_URL` (Anforderung 11).
>
> Tests: 179 Unit-Tests (`npm test`, ohne DB), 61 DB-Tests (`npm run test:db`), 12 E2E-Tests (`npm run test:e2e`, rund 17 s). Gegenprobe mit absichtlich eingebauten Fehlern: Heartbeat nur beim Speichern (der Review-Befund), keine Deduplizierung, Heartbeat ohne Fencing, keine Übernahme verwaister Läufe, keine Deaktivierungs-Sperre, kein zweiter Durchgang, Deaktivierung trotz `partial`. Jeder lässt Tests fehlschlagen.

- [x] **T1** Abhängigkeiten: `pg`, `node-pg-migrate`, `@nestjs/schedule`, `cron`; dev: `@types/pg`, `@testcontainers/postgresql`. `docker-compose.yml` mit PostgreSQL 17.
- [x] **T1a** Test-Infrastruktur: `vitest.config.db.ts`, `test/db/global-setup.ts` (`TEST_DATABASE_URL` oder Testcontainers), `test/db/test-database.ts` (Schema pro Datei über `options=-c search_path`), `npm run test:db`. Beide Wege geprüft: Testcontainers rund 15 s Start, `TEST_DATABASE_URL` 0.5 s. → AK-11.1–11.4
  - Test-Migrationen mit `noLock`: Der Advisory Lock von node-pg-migrate gilt für die ganze Datenbank und liess parallele Testdateien scheitern («Another migration is already running»). `npm run migrate` behält den Lock.
- [x] **T2** `migrations/001_init.sql`, `npm run migrate`; 14 Tests (Spalten, zweimal migrieren, Constraints, ein `running`). Die Testdatei liegt in `test/db/`, weil node-pg-migrate jede Datei in `migrations/` als Migration liest. → AK-1.1–1.4, AK-7.2
- [x] **T3** `sync-config.ts` mit 17 Unit-Tests. → AK-9.1, AK-9.2
- [x] **T4** `page-diff.ts` (rein) mit 13 Unit-Tests. → AK-3.1–3.4, AK-3.9
- [x] **T5** `run-status.ts` (rein) mit 8 Unit-Tests. → AK-4.3
- [x] **T6** `products.repository.ts`, 11 DB-Tests. → AK-3.1–3.7, AK-3.9, AK-6.1, AK-6.3, AK-6.4
  - AK-3.9 gegen echte PostgreSQL: ohne Deduplizierung meldet sie «ON CONFLICT DO UPDATE command cannot affect row a second time» (separat geprüft).
- [x] **T7** `sync-runs.repository.ts`, 12 DB-Tests, u. a. zehn gleichzeitige Starts über eigene Pools → genau einer gewinnt. → AK-4.1, AK-4.2, AK-4.4, AK-7.1–7.6
- [x] **T8** `sync-runner.ts`, 24 DB-Tests mit geskriptetem ERP. → AK-2.x, AK-3.8, AK-5.x, AK-6.1–6.3, AK-7.3, AK-7.3a, AK-7.5, AK-8.4
  - AK-7.3a bildet den Review-Fall nach: Zwei scheiternde Seiten «dauern» je 130 s (Heartbeat in der DB zurückgesetzt), danach versucht ein `POST /sync` zu starten → 409, der Lauf endet `completed`.
- [x] **T9** `sync.service.ts`, `sync.controller.ts`, `sync.scheduler.ts`, `sync.module.ts`, `src/db/database.ts`; `enableShutdownHooks()` in `main.ts` (fehlte, ohne es erreicht SIGTERM die Hooks nicht). 5 + 5 Unit-Tests, Controller über E2E. → AK-4.4, AK-7.1, AK-8.1–8.4
- [x] **T10** `test/sync.e2e-spec.ts`: voller Lauf + 409 + zweiter Lauf unverändert, Abfragen, Standardraten (Seitengrösse 1000), Shutdown in < 5 s, ungültige Konfiguration. → AK-9.2, AK-10.1, AK-10.2
  - Befund: Ein abgewiesener Start (409) verbraucht trotzdem eine ID, weil Identity-Werte bei einem gescheiterten `INSERT` nicht zurückgerollt werden. Lauf-IDs haben also Lücken; Clients müssen die ID aus der Antwort bzw. `Location` nehmen.
- [x] **T11** README: Datenbank, Migration, Endpunkte, Status, Konfiguration, Tests.
- [x] **T12** Gemessen mit dem echten Service (`node dist/main.js`) gegen das Mock mit Standardraten, Seitengrösse 100: 49 s für 10'000 Produkte (Simulation: Median 50 s). Seite 49 scheiterte im ersten Durchgang und kam im zweiten, Lauf `completed`. Absturz-Test: Prozess hart beendet → Lauf bleibt `running` → `POST /sync` 409 → nach gealtertem Heartbeat übernimmt der nächste Lauf.
- [ ] **T13** CI: Service-Container PostgreSQL + `TEST_DATABASE_URL`, `npm install` in `mock-erp/`, dann `npm test`, `npm run test:db`, `npm run test:e2e`, `cd mock-erp && npm test` (zusammen mit 001 T11, 002 T8).
- [ ] **T14** Authentifizierung für `POST /sync` und `GET /sync/runs` (siehe «Nicht im Umfang»), vor produktivem Einsatz.
