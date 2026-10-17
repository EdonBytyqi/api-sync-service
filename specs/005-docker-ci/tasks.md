# 005 – Docker und CI: Aufgaben

> Status: umgesetzt, CI auf GitHub grün (erster Lauf: alle sechs Jobs, rund 2.5 min). Fasst die offenen CI-Aufgaben aus 001 (T11), 002 (T8) und 003 (T13) zusammen. Spec vor dem Code reviewt; Änderungen aus der Review: `CMD` mit Node direkt (Design, mit Messung), Ports über Variablen (AK-3.5).

- [x] **T1** `GET /health` im Service (`SELECT 1`, 200/503), Pool mit 3 s Verbindungs-Timeout; Unit-Tests und E2E mit unerreichbarem ERP → 200. → AK-1.1, AK-1.2
- [x] **T2** `GET /health` im Mock-ERP vor dem Chaos; Test mit `FAILURE_RATE=1`, `SLOW_RATE=1` → 200 ohne Zufall und Pause; Spec 001 AK-1.9. → AK-1.3
- [x] **T3** `Dockerfile` + `.dockerignore` für Service (mehrstufig), Mock-ERP und Dashboard (nginx). Geprüft: Service und Mock laufen als `uid=1000(node)`; das Service-Image enthält nur `dist/`, `migrations/`, Produktionsabhängigkeiten (45 MB `node_modules`), keine Quellen und Tests. → AK-2.1–2.3
  - Befund: `proxy_redirect / /api/` machte aus `Location: /sync/runs/7` eine absolute URL mit dem Container-Port (`http://localhost/api/…`). `absolute_redirect off` hält sie relativ. Gefunden vom Smoke-Test.
- [x] **T4** `docker-compose.yml`. Lokal geprüft: frischer Start mit `--wait` (postgres → migrate beendet → service gesund → dashboard), zweiter Start mit leerer Migration und erhaltenen Daten. → AK-3.1–3.6
  - Port 8080 war auf diesem Rechner belegt (App A); `DASHBOARD_PORT=8081` genügte, ohne die Datei zu ändern (AK-3.5).
  - `docker compose stop service` während eines Laufs: 0.5 s, Lauf `failed` mit `aborted: shutdown` (AK-3.6). Gegenprobe mit `npm run start:prod` ohne `init`: SIGTERM kam bei npm 10.9 trotzdem an (1.0 s, gleiches Ergebnis, npm meldet `npm error signal SIGTERM`); im Design ehrlich festgehalten, Entscheidung für Node direkt bleibt.
- [x] **T5** `.github/workflows/ci.yml`: sechs Jobs, `concurrency` (nur PRs abbrechen), `timeout-minutes: 15`, `permissions: contents: read`, keine Secrets. → AK-4.1–4.6
- [x] **T6** `scripts/smoke.sh`: Dashboard und Client-Route, `/api/health`, `POST /api/sync` → 202 + `Location: /api/sync/runs/<id>`, Lauf endet `completed` mit 100/100 Seiten und 10'000 Produkten. Lokal grün. → AK-4.2 (Job 6)
- [x] **T7** Gegenprobe: Draft-PR #1 mit einem absichtlich falschen Mock-Test. Ergebnis: nur «Mock-ERP» rot, die vier anderen Test-Jobs grün, «Docker» übersprungen (wartet auf alle). PR ohne Merge geschlossen, Branch gelöscht. → AK-4.3
- [x] **T8** README: `docker compose up`, Ports, CI-Übersicht, Branch-Protection. → AK-4.7
- [ ] **T9** Branch-Protection für `main` im GitHub-Repository einschalten (Einstellung, keine Datei). → AK-4.7
