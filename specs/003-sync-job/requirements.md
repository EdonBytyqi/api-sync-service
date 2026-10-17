# 003 – Sync-Job: Anforderungen

## Ziel

Der Sync-Job holt den ganzen Produktkatalog seitenweise mit dem ERP-Client (Spec 002) und speichert ihn in PostgreSQL. Jeder Lauf wird in `sync_runs` protokolliert. Der Job verträgt einzelne gescheiterte Seiten, deaktiviert verschwundene Produkte nur nach einem vollständigen Lauf, läuft nie doppelt und erholt sich von abgestürzten Läufen. Ausgelöst wird er per Zeitplan und manuell über `POST /sync`.

## Nicht im Umfang

- Inkrementeller Sync (nur geänderte Produkte): Das ERP bietet keinen Filter nach `updatedAt`. Jeder Lauf ist ein Voll-Sync.
- Authentifizierung für `POST /sync` und `GET /sync/runs`. **Vor einem produktiven Einsatz nötig**, weil `POST /sync` Last auf dem ERP erzeugt. Eigene Spec.
- Eine API, die Produkte an andere Systeme ausliefert; Preis-Historie; mehrere ERP-Quellen.
- Paralleles Abrufen von Seiten (siehe Design: bewusst nacheinander).

## Begriffe

- **Lauf:** ein Sync von Anfang bis Ende, eine Zeile in `sync_runs`.
- **Durchgang:** einmal alle anstehenden Seiten abrufen. Ein Lauf hat einen ersten und höchstens einen zweiten Durchgang.
- **Vollständiger Lauf:** Jede Seite wurde erfolgreich gespeichert und `total` hat sich während des Laufs nicht geändert.
- **Verwaister Lauf:** steht auf `running`, aber sein Prozess lebt nicht mehr (Heartbeat zu alt).

## Anforderung 1 – Datenbank und Migration

- **AK-1.1** Wenn `npm run migrate` auf einer leeren Datenbank ausgeführt wird, dann existieren danach die Tabellen `sync_runs` und `products` mit den Spalten und Constraints aus dem Design.
- **AK-1.2** Wenn `npm run migrate` ein zweites Mal ausgeführt wird, dann ändert sich nichts und der Befehl endet erfolgreich.
- **AK-1.3** Wenn die App startet, dann führt sie keine Migrationen aus. Migrieren ist ein eigener Schritt vor dem Deploy.
- **AK-1.4** Wenn ein Produkt mit negativem `price_cents`, ohne `sku` oder mit `active = false` aber ohne `deactivated_at` gespeichert werden soll, dann lehnt die Datenbank das ab (`CHECK`/`NOT NULL`).

## Anforderung 2 – Alle Seiten abrufen

- **AK-2.1** Wenn ein Lauf startet, dann holt er Seite 1 mit `SYNC_PAGE_SIZE` (Standard 100), berechnet die Seitenzahl als `ceil(total / pageSize)` und holt danach die Seiten 2 bis n **nacheinander**.
- **AK-2.2** Wenn Seite 1 retrybar scheitert, dann wartet der Lauf `retryAfterMs` (falls vorhanden, sonst 0) und versucht Seite 1 genau einmal erneut. Scheitert sie wieder oder endgültig, dann endet der Lauf mit `failed`, weil `total` unbekannt ist.
- **AK-2.3** Wenn `total` 0 ist, dann holt der Lauf keine weiteren Seiten; für die Deaktivierung gilt AK-6.3.
- **AK-2.4** Wenn eine spätere Seite ein anderes `total` meldet als Seite 1, dann speichert der Lauf die Seite trotzdem, loggt eine Warnung und endet höchstens mit `partial`. Grund: Bei Offset-Paginierung können sich Produkte zwischen Seiten verschieben und übersprungen werden.
- **AK-2.5** Wenn ein Lauf eine Seite abruft, dann übergibt er dem ERP-Client das `AbortSignal` des Laufs.

## Anforderung 3 – Upsert nach `external_id`

- **AK-3.1** Wenn ein Produkt mit einer neuen `external_id` (= ERP-`id`) kommt, dann wird es mit `active = true` eingefügt und als `inserted` gezählt.
- **AK-3.2** Wenn ein bekanntes Produkt mit geändertem `sku`, `name`, `price_cents` oder `erp_updated_at` kommt, dann werden diese Felder und `updated_at` aktualisiert, gezählt als `updated`.
- **AK-3.3** Wenn ein bekanntes Produkt unverändert kommt, dann bleiben seine Daten und `updated_at` gleich, gezählt als `unchanged`. `last_seen_run_id` und `last_seen_at` werden trotzdem gesetzt.
- **AK-3.4** Wenn ein deaktiviertes Produkt wieder kommt, dann wird es mit `active = true` und `deactivated_at = NULL` reaktiviert und als `reactivated` gezählt (zusätzlich zu `updated`, falls sich Daten geändert haben).
- **AK-3.5** Wenn eine Seite gespeichert wird, dann geschieht das in **einer Transaktion**: Entweder alle Produkte der Seite sind gespeichert oder keines.
- **AK-3.6** Wenn ein Lauf mit unveränderten ERP-Daten wiederholt wird, dann zählt er 0 `inserted`, 0 `updated` und 10'000 `unchanged`.
- **AK-3.7** Wenn dieselbe `external_id` in einem Lauf auf zwei verschiedenen Seiten vorkommt (z. B. durch Verschiebung, AK-2.4), dann gewinnt das zuletzt gelesene Produkt, ohne Fehler.
- **AK-3.9** Wenn dieselbe `external_id` **innerhalb einer Seite** mehrfach vorkommt, dann wird nur das letzte Vorkommen gespeichert, ohne Datenbankfehler, und gezählt wird jedes Produkt einmal. Grund: Ein `INSERT … ON CONFLICT DO UPDATE` mit derselben ID zweimal scheitert in PostgreSQL mit «command cannot affect row a second time», und der Lauf würde nach AK-3.8 `failed`. Die doppelte ID wird als Warnung geloggt.
- **AK-3.8** Wenn die Datenbank beim Speichern einer Seite einen Fehler meldet, dann endet der Lauf sofort mit `failed`. Ein Datenbankfehler ist kein Fehler einer einzelnen Seite.

## Anforderung 4 – Protokoll in `sync_runs`

- **AK-4.1** Wenn ein Lauf startet, dann wird eine Zeile mit `status = 'running'`, `trigger` (`schedule` oder `manual`), `started_at` und `heartbeat_at` angelegt.
- **AK-4.2** Wenn ein Lauf endet, dann enthält seine Zeile `finished_at`, den Endstatus, `pages_total`, `pages_ok`, `pages_failed`, die Zähler `products_inserted`, `_updated`, `_unchanged`, `_reactivated`, `_deactivated`, die Liste `failed_pages` (je Seite: `page`, `reason`, `status`, `attempts`, `retryAfterMs`, `message`) und bei `partial`/`failed` einen Text in `error`.
- **AK-4.3** Der Endstatus ist:
  - `completed`, wenn der Lauf vollständig war und die Deaktivierung durchgeführt wurde;
  - `partial`, wenn mindestens eine Seite auch nach dem zweiten Durchgang fehlt, `total` sich geändert hat (AK-2.4) oder die Deaktivierungs-Sperre gegriffen hat (AK-6.3);
  - `failed`, wenn Seite 1 scheitert (AK-2.2), zu viele Seiten in Folge scheitern (AK-5.6), die Datenbank einen Fehler meldet (AK-3.8), der Lauf abgebrochen wird (AK-8.5) oder er verwaist ist (AK-7.4).
- **AK-4.4** Wenn `GET /sync/runs?limit=20` aufgerufen wird, dann liefert die API die neuesten Läufe zuerst (Standard 20, höchstens 100). `GET /sync/runs/:id` liefert einen Lauf oder 404.
- **AK-4.5** Wenn ein Lauf läuft, dann sind seine Zähler nach jeder gespeicherten Seite aktuell, damit `GET /sync/runs/:id` den Fortschritt zeigt.

## Anforderung 5 – Gescheiterte Seiten

Mit den Mock-Standardraten hat ohne Gegenmassnahme rund 30 % der Läufe mindestens eine gescheiterte Seite (Spec 002, Design; per Simulation bestätigt).

- **AK-5.1** Wenn eine Seite im ersten Durchgang mit einem `ErpError` scheitert, dann merkt sich der Lauf die Seite mit den Fehlerdetails und macht mit der nächsten Seite weiter.
- **AK-5.2** Wenn der erste Durchgang fertig ist und Seiten mit `retryable: true` gescheitert sind, dann wartet der Lauf das grösste `retryAfterMs` dieser Seiten (0, wenn keines gesetzt ist) und versucht jede dieser Seiten in einem zweiten Durchgang genau einmal erneut.
- **AK-5.3** Wenn eine Seite endgültig gescheitert ist (`retryable: false`, z. B. `invalidResponse` oder 400), dann wird sie im zweiten Durchgang nicht erneut versucht.
- **AK-5.4** Wenn eine Seite mit `reason: 'rateLimited'` gescheitert ist (`retryAfterMs > maxRetryAfterMs`), dann wird sie in diesem Lauf nicht erneut versucht; der nächste geplante Lauf holt sie.
- **AK-5.5** Wenn eine Seite im zweiten Durchgang gelingt, dann zählt sie als erfolgreich und der Lauf kann `completed` werden.
- **AK-5.6** Wenn im ersten Durchgang `SYNC_MAX_CONSECUTIVE_FAILURES` (Standard 3) Seiten in Folge scheitern, dann bricht der Lauf ab und endet mit `failed` («ERP nicht erreichbar»). Ohne diese Grenze könnte ein ausgefallenes ERP einen Lauf auf `Seitenzahl × 130 s` (über 3.5 h) strecken.
- **AK-5.7** Wenn eine Seite endgültig fehlt, dann wird sie mit `page`, `reason` und Meldung als Fehler geloggt.

## Anforderung 6 – Verschwundene Produkte deaktivieren

- **AK-6.1** Wenn ein Lauf vollständig ist, dann setzt er alle Produkte, die aktiv sind und in diesem Lauf nicht vorkamen (`last_seen_run_id` ≠ Lauf), auf `active = false` mit `deactivated_at = now()` und zählt sie als `deactivated`.
- **AK-6.2** Wenn ein Lauf `partial` oder `failed` endet, dann wird kein Produkt deaktiviert. Eine fehlende Seite heisst nicht, dass ihre Produkte gelöscht wurden.
- **AK-6.3** Wenn die Deaktivierung mehr als `SYNC_MAX_DEACTIVATE_RATIO` (Standard 0.1) der aktiven Produkte treffen würde, dann deaktiviert der Lauf nichts, endet mit `partial` und nennt den Grund in `error`. Schutz gegen ein ERP, das plötzlich einen leeren oder halben Katalog liefert.
- **AK-6.4** Wenn ein Produkt deaktiviert wird, dann bleibt seine Zeile erhalten; Produkte werden nie gelöscht.

## Anforderung 7 – Nie zwei Läufe gleichzeitig, verwaiste Läufe

- **AK-7.1** Wenn ein Lauf starten soll, während ein anderer `running` und nicht verwaist ist, dann startet kein neuer Lauf: manuell → 409 (AK-8.3), per Zeitplan → übersprungen und als Info geloggt.
- **AK-7.2** Wenn mehrere Instanzen des Service gleichzeitig einen Lauf starten wollen, dann gewinnt genau eine. Die Datenbank erzwingt höchstens eine Zeile mit `status = 'running'`.
- **AK-7.3** Wenn ein Lauf eine Seite abrufen will, dann setzt er **vor jedem** `fetchPage` `heartbeat_at = now()`, egal ob die vorherige Seite gelungen oder gescheitert ist. Ebenso vor jeder Pause (Wiederholung von Seite 1, zweiter Durchgang) und beim Speichern einer Seite. Zwischen zwei Heartbeats liegt damit höchstens ein `fetchPage` oder eine Pause.
- **AK-7.3a** Wenn mehrere Seiten nacheinander scheitern und jede bis zu `maxDurationMs` dauert, dann wird der Lauf trotzdem nie für verwaist erklärt, solange er lebt.
- **AK-7.4** Wenn ein Lauf starten soll und ein `running`-Lauf seit mehr als `staleAfterMs` keinen Heartbeat hatte, dann markiert der neue Lauf ihn als `failed` mit `finished_at` und `error = 'abandoned: no heartbeat since <Zeit>'` und startet danach. `staleAfterMs = ErpClient.maxDurationMs(erpConfig) + SYNC_STALE_MARGIN_MS` (Standard 130 s + 60 s = 190 s).
- **AK-7.5** Wenn ein Lauf beim Heartbeat feststellt, dass seine Zeile nicht mehr `running` ist (er wurde für verwaist erklärt), dann bricht er sofort ab, ohne weitere Seiten abzurufen oder zu speichern und ohne seine Zeile zu ändern (Fencing).
- **AK-7.6** Alle Zeitvergleiche für Heartbeat und Verwaisung nutzen die Uhr der Datenbank (`now()`), nicht die der App.

## Anforderung 8 – Auslöser

- **AK-8.1** Wenn `SYNC_SCHEDULE_ENABLED` `true` ist (Standard), dann startet der Service nach dem Zeitplan `SYNC_CRON` (Standard `*/15 * * * *`) einen Lauf mit `trigger = 'schedule'`.
- **AK-8.2** Wenn `POST /sync` aufgerufen wird und kein Lauf aktiv ist, dann antwortet die API sofort mit 202, dem Header `Location: /sync/runs/<id>` und `{ "id", "status": "running", "trigger": "manual" }`, ohne auf das Ende des Laufs zu warten.
- **AK-8.3** Wenn `POST /sync` aufgerufen wird, während ein Lauf aktiv ist, dann antwortet die API mit 409 und `{ "error": "...", "runningRunId": <id> }`.
- **AK-8.4** Wenn der Service herunterfährt (SIGTERM), dann bricht er einen laufenden Lauf über dessen `AbortSignal` ab. Der Lauf endet innerhalb weniger Sekunden mit `failed` und `error = 'aborted: shutdown'`, nicht erst nach bis zu 130 s.

## Anforderung 9 – Konfiguration

- **AK-9.1** Wenn keine Variablen gesetzt sind, dann gelten `SYNC_PAGE_SIZE=100`, `SYNC_CRON=*/15 * * * *`, `SYNC_SCHEDULE_ENABLED=true`, `SYNC_MAX_CONSECUTIVE_FAILURES=3`, `SYNC_MAX_DEACTIVATE_RATIO=0.1`, `SYNC_STALE_MARGIN_MS=60000`. `DATABASE_URL` hat keinen Standard und ist Pflicht.
- **AK-9.2** Wenn ein Wert ungültig ist (z. B. `SYNC_PAGE_SIZE=0` oder `1001`, ungültiger Cron-Ausdruck, `SYNC_SCHEDULE_ENABLED=yes`, Ratio ausserhalb 0–1, fehlende `DATABASE_URL`), dann startet der Service nicht und nennt jede ungültige Variable.

## Anforderung 10 – Zusammenspiel mit dem echten Mock-ERP

- **AK-10.1** Wenn ein Lauf gegen das Mock-ERP mit allen Raten 0 läuft, dann endet er `completed` mit 100 Seiten, 10'000 `inserted` und 0 `deactivated`; ein zweiter Lauf zählt 10'000 `unchanged`.
- **AK-10.2** Wenn ein Lauf gegen das Mock-ERP mit den Standardraten läuft, dann endet er `completed` oder `partial`, und alle erfolgreich gelesenen Seiten sind gespeichert.

## Anforderung 11 – Datenbank-Tests überall ausführbar

- **AK-11.1** Wenn `TEST_DATABASE_URL` gesetzt ist, dann laufen die Datenbank-Tests gegen diese PostgreSQL (z. B. ein Service-Container in CI oder eine Cloud-Umgebung ohne Docker) und starten keinen Container.
- **AK-11.2** Wenn `TEST_DATABASE_URL` nicht gesetzt ist, dann starten die Tests eine PostgreSQL mit Testcontainers (Docker nötig).
- **AK-11.3** Wenn mehrere Testdateien parallel gegen dieselbe Datenbank laufen, dann stören sie sich nicht: Jede Datei arbeitet in einem eigenen, frisch migrierten Schema und löscht es am Ende.
- **AK-11.4** Wenn `npm test` läuft, dann braucht es weder Docker noch eine Datenbank; Datenbank-Tests laufen getrennt mit `npm run test:db`.
