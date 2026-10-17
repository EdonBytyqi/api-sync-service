# 005 – Docker und CI: Anforderungen

## Ziel

Zwei Dinge, die App B bisher fehlen: Mit einem Befehl läuft das ganze System lokal (`docker compose up`), und **jeder Push** prüft automatisch alle Testsuiten auf GitHub Actions. Bisher laufen die Tests nur, wenn jemand sie von Hand startet.

## Nicht im Umfang

- Deployment in eine echte Umgebung, Registry-Push von Images, Secrets-Verwaltung, TLS.
- Kubernetes, Skalierung auf mehrere Instanzen (das Design aus Spec 003 erlaubt sie, getestet wird sie hier nicht).

## Anforderung 1 – Health-Endpunkte

- **AK-1.1** Wenn `GET /health` am Service aufgerufen wird und die Datenbank erreichbar ist (`SELECT 1`), dann antwortet er mit 200 und `{ "status": "ok", "database": "up" }`; sonst mit 503 und `"database": "down"`.
- **AK-1.2** Wenn das ERP nicht erreichbar ist, dann bleibt `GET /health` trotzdem 200. Der Service ist gesund, auch wenn sein Gegenüber es nicht ist; sonst würde ein unzuverlässiges ERP den Service ständig neu starten lassen.
- **AK-1.3** Wenn `GET /health` am Mock-ERP aufgerufen wird, dann antwortet es immer sofort mit 200, ohne simulierte Fehler oder Verzögerung (Ergänzung zu Spec 001).

## Anforderung 2 – Images

- **AK-2.1** Wenn `docker build` für Service, Mock-ERP und Dashboard läuft, dann entsteht je ein Image; Service und Mock laufen als Nicht-root-Benutzer `node`, das Dashboard als nginx.
- **AK-2.2** Wenn das Service-Image gebaut wird, dann enthält es nur Produktionsabhängigkeiten, das gebaute `dist/` und `migrations/`, keine Tests und keine Quellen aus `dashboard/` oder `mock-erp/` (`.dockerignore`).
- **AK-2.3** Wenn das Dashboard-Image läuft, dann liefert nginx die Angular-Dateien aus, leitet `/api/` an den Service weiter (ohne Präfix) und beantwortet unbekannte Pfade mit `index.html`.

## Anforderung 3 – `docker compose up`

- **AK-3.1** Wenn `docker compose up` in einem frischen Checkout läuft (ohne `.env`), dann starten PostgreSQL, Migration, Mock-ERP, Service und Dashboard; das Dashboard ist unter `http://localhost:8080` erreichbar.
- **AK-3.2** Wenn das System startet, dann in dieser Reihenfolge: PostgreSQL gesund → Migration einmal ausgeführt und beendet (`service_completed_successfully`) → Service startet; Mock-ERP gesund → Service startet; Service gesund → Dashboard startet. Der Service migriert nie selbst (Spec 003, AK-1.3).
- **AK-3.3** Wenn `docker compose up` ein zweites Mal läuft, dann ist die Migration ein Leerlauf und die Daten aus dem ersten Lauf sind noch da (benanntes Volume).
- **AK-3.4** Wenn nichts konfiguriert ist, dann läuft das Mock mit seinen unzuverlässigen Standardraten. Über Umgebungsvariablen (z. B. `FAILURE_RATE=0 docker compose up`) lassen sie sich ändern.
- **AK-3.5** Wenn ein Port nach aussen geöffnet wird, dann nur an `127.0.0.1`: Dashboard 8080, Service 3000, PostgreSQL 5432 (für `TEST_DATABASE_URL` und Entwicklung), Mock 4000. Jeder Port ist über eine Variable änderbar, ohne die Datei zu bearbeiten (`DASHBOARD_PORT`, `SERVICE_PORT`, `POSTGRES_PORT`, `MOCK_PORT`), z. B. `POSTGRES_PORT=5433 docker compose up`, wenn lokal schon eine PostgreSQL auf 5432 läuft.
- **AK-3.6** Wenn der Service-Container gestoppt wird (`docker compose stop`), dann bricht er einen laufenden Lauf über SIGTERM sauber ab (Spec 003, AK-8.4); `stop_grace_period` ist dafür lang genug. Der Container startet Node dafür direkt (`CMD ["node", "dist/main.js"]`), nicht über `npm`.

## Anforderung 4 – CI auf GitHub Actions

- **AK-4.1** Wenn auf `main` gepusht oder ein Pull Request geöffnet/aktualisiert wird, dann läuft `.github/workflows/ci.yml`.
- **AK-4.2** Wenn CI läuft, dann laufen diese Jobs, jeder mit `npm ci` und Node 22:
  1. **service** – Lint, Typprüfung/Build, `npm test` (Unit, ohne Datenbank).
  2. **mock-erp** – `npm test` in `mock-erp/`.
  3. **database** – `npm run test:db` gegen einen PostgreSQL-17-Service-Container über `TEST_DATABASE_URL` (Spec 003, AK-11.1).
  4. **e2e** – `npm run test:e2e` gegen einen PostgreSQL-17-Service-Container und das echte Mock-ERP (dafür `npm ci` in `mock-erp/`).
  5. **dashboard** – `ng test` (inkl. `axe-core`) und Produktions-Build in `dashboard/`.
  6. **docker** – nach den anderen: alle Images bauen, `docker compose up --wait`, ein Smoke-Test über das Dashboard (`POST /api/sync` → Lauf endet `completed`, mit Mock-Raten 0), danach `docker compose down -v`.
- **AK-4.3** Wenn ein Test scheitert, dann ist der Job rot und der Pull Request zeigt, welche Suite betroffen ist (ein Job pro Suite).
- **AK-4.4** Wenn neue Commits auf denselben Pull Request kommen, dann wird der noch laufende CI-Lauf dafür abgebrochen (`concurrency` mit `cancel-in-progress`); auf `main` nicht.
- **AK-4.5** Wenn CI läuft, dann braucht sie keine Secrets; Testcontainers wird nicht genutzt (Service-Container sind schneller).
- **AK-4.6** Wenn ein Job hängt, dann bricht er nach höchstens 15 Minuten ab (`timeout-minutes`).
- **AK-4.7** Wenn die Jobs grün sind, dann sind sie als Pflicht-Checks für `main` vorgesehen (Branch-Protection; eine Einstellung im GitHub-Repository, keine Datei, im README dokumentiert).
