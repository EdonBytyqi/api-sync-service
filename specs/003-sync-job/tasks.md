# 003 – Sync-Job: Aufgaben

> Status: Spec reviewt. Änderungen aus der Review: Heartbeat vor jedem `fetchPage` (AK-7.3, AK-7.3a), doppelte IDs in einer Seite (AK-3.9), Datenbank-Tests auch ohne Docker über `TEST_DATABASE_URL` (Anforderung 11).

- [ ] **T1** Abhängigkeiten: `pg`, `node-pg-migrate`, `@nestjs/schedule`; dev: `@testcontainers/postgresql`. `docker-compose.yml` mit PostgreSQL 17 für die lokale Entwicklung.
- [ ] **T1a** Test-Infrastruktur: `vitest.config.db.ts`, `globalSetup` mit `TEST_DATABASE_URL` oder Testcontainers, Helfer für ein Schema pro Datei; `npm run test:db`. → AK-11.1–11.4
- [ ] **T2** `migrations/001_init.sql` und `npm run migrate`; Test: leere DB migrieren, zweimal migrieren, Constraints verletzen. → AK-1.1–1.4
- [ ] **T3** `src/sync/sync-config.ts` mit Validierung und Unit-Tests. → AK-9.1, AK-9.2
- [ ] **T4** `src/sync/page-diff.ts` (rein) mit Unit-Tests: neu, geändert je Feld, unverändert, reaktiviert, reaktiviert + geändert, Duplikat in einer Seite (letzte gewinnt, einmal gezählt). → AK-3.1–3.4, AK-3.9
- [ ] **T5** `src/sync/run-status.ts` (rein) mit Unit-Tests: Tabelle aus dem Design als `it.each`. → AK-4.3
- [ ] **T6** `products.repository.ts` gegen echte DB: Seite in einer Transaktion (Fehler mitten in der Seite → nichts gespeichert), Zähler, `last_seen_run_id`, Deaktivierung mit Sperre, keine Löschung. → AK-3.5, AK-3.6, AK-6.1, AK-6.3, AK-6.4
- [ ] **T7** `sync-runs.repository.ts` gegen echte DB: Start, zweiter Start → «läuft schon», zwei gleichzeitige Starts → genau einer gewinnt, verwaister Lauf wird übernommen, Fencing beim Heartbeat, Abschluss mit Zählern und `failed_pages`, Abfragen. → AK-4.1, AK-4.2, AK-4.5, AK-7.1–7.6
- [ ] **T8** `sync-runner.ts` mit `ProductSource`- und `sleep`-Attrappen und echter DB:
  - Alle Seiten ok → `completed`, Deaktivierung. → AK-2.1, AK-6.1
  - Seite 1 scheitert einmal / zweimal. → AK-2.2
  - `total = 0`, `total` ändert sich. → AK-2.3, AK-2.4
  - Seite scheitert, zweiter Durchgang mit Wartezeit = grösstes `retryAfterMs`, gelingt / scheitert. → AK-5.1, AK-5.2, AK-5.5
  - Endgültige und `rateLimited` Seiten nicht im zweiten Durchgang. → AK-5.3, AK-5.4
  - Drei Fehler in Folge → `failed`. → AK-5.6
  - Heartbeat vor jedem `fetchPage`, auch nach gescheiterten Seiten; zwei langsam scheiternde Seiten machen den Lauf nicht verwaist. → AK-7.3, AK-7.3a
  - Fencing vor `fetchPage`: kein weiterer Abruf. → AK-7.5
  - Duplikat innerhalb einer Seite gegen echte DB. → AK-3.9
  - `partial`/`failed` deaktiviert nichts. → AK-6.2
  - DB-Fehler → `failed`. → AK-3.8
  - Abbruch über `AbortSignal` → `failed`, `aborted: shutdown`. → AK-2.5, AK-8.4
- [ ] **T9** `sync.service.ts`, `sync.controller.ts`, `sync.scheduler.ts`, `sync.module.ts`; Tests mit Supertest: 202 + `Location`, 409 mit `runningRunId`, `GET /sync/runs` (Sortierung, `limit`), `GET /sync/runs/:id` (404), Zeitplan-Tick während eines Laufs übersprungen, Shutdown bricht ab. → AK-4.4, AK-7.1, AK-8.1–8.4
- [ ] **T10** Ende-zu-Ende gegen Mock-ERP und Test-DB: Raten 0 zweimal, Standardraten einmal. → AK-10.1, AK-10.2
- [ ] **T11** README: Datenbank starten, migrieren, Konfiguration, Endpunkte, Status-Bedeutung.
- [ ] **T12** Laufzeit eines echten Laufs gegen das Mock messen und mit der Simulation vergleichen (Median 50 s, p99 81 s).
