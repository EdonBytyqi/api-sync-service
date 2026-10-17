# 005 – Docker und CI: Aufgaben

> Status: Spec zur Review. Noch kein Code. Fasst die offenen CI-Aufgaben aus 001 (T11), 002 (T8) und 003 (T13) zusammen.

- [ ] **T1** `GET /health` im Service (`SELECT 1`, 200/503) mit Tests; ERP spielt keine Rolle. → AK-1.1, AK-1.2
- [ ] **T2** `GET /health` im Mock-ERP vor dem Chaos, mit Test; Spec 001 ergänzen. → AK-1.3
- [ ] **T3** `Dockerfile` + `.dockerignore` für Service (mehrstufig, `USER node`), Mock-ERP und Dashboard (nginx mit `/api/`-Proxy); `docker build` lokal geprüft, Image-Inhalt geprüft. → AK-2.1–2.3
- [ ] **T4** `docker-compose.yml` mit `postgres`, `migrate`, `mock-erp`, `service`, `dashboard`; Reihenfolge über Healthchecks, Volume, Ports an `127.0.0.1`, `stop_grace_period`. Lokal: frischer Start, zweiter Start, `docker compose stop` während eines Laufs. → AK-3.1–3.6
- [ ] **T5** `.github/workflows/ci.yml` mit den sechs Jobs, `concurrency`, `timeout-minutes`. → AK-4.1–4.6
- [ ] **T6** Smoke-Test-Skript `scripts/smoke.sh` (von CI und lokal nutzbar). → AK-4.2 (Job 6)
- [ ] **T7** Gegenprobe in einem Branch: einen Test absichtlich rot machen und prüfen, dass genau der betroffene Job rot wird. → AK-4.3
- [ ] **T8** README: `docker compose up`, Ports, CI-Übersicht, Branch-Protection einrichten. → AK-4.7
