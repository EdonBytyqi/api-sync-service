# 003 – Sync-Job: Design

## Überblick

```
 Zeitplan (@nestjs/schedule) ──┐
                               ├──▶ SyncService.start(trigger) ──▶ SyncRunner.run(runId, signal)
 POST /sync (SyncController) ──┘          │                              │
                                          │ sync_runs (Start, Sperre)    │ pro Seite:
                                          ▼                              ▼
                                    PostgreSQL ◀── Upsert + Heartbeat ── ErpClient.fetchPage (Spec 002)
```

| Datei                             | Aufgabe                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `migrations/001_init.sql`         | Tabellen, Constraints, Indizes                                                                 |
| `src/db/database.module.ts`       | `pg.Pool` aus `DATABASE_URL`, schliesst beim Herunterfahren                                     |
| `src/sync/sync-config.ts`         | `loadSyncConfig(env)`, Validierung wie in 001/002                                              |
| `src/sync/sync-runs.repository.ts`| Lauf starten (mit Sperre und Verwaisung), Heartbeat mit Fencing, Zähler, Abschluss, Abfragen     |
| `src/sync/products.repository.ts` | Seite in einer Transaktion speichern, Deaktivierung mit Sperre                                  |
| `src/sync/page-diff.ts`           | Reine Funktion: vorhandene vs. neue Produkte → `inserted`, `updated`, `unchanged`, `reactivated` |
| `src/sync/run-status.ts`          | Reine Funktion: Ergebnisse des Laufs → Endstatus (Tabelle unten)                                |
| `src/sync/sync-runner.ts`         | Ablauf eines Laufs: Seiten, zweiter Durchgang, Abbruchregeln, Deaktivierung                     |
| `src/sync/sync.service.ts`        | Startet Läufe im Hintergrund, hält deren `AbortController`, bricht beim Herunterfahren ab        |
| `src/sync/sync.controller.ts`     | `POST /sync`, `GET /sync/runs`, `GET /sync/runs/:id`                                           |
| `src/sync/sync.scheduler.ts`      | Cron-Auslöser                                                                                  |

## Datenmodell

```sql
CREATE TABLE sync_runs (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger              text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status               text NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  started_at           timestamptz NOT NULL DEFAULT now(),
  heartbeat_at         timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  page_size            integer NOT NULL,
  total_expected       integer,          -- total von Seite 1
  pages_total          integer,
  pages_ok             integer NOT NULL DEFAULT 0,
  pages_failed         integer NOT NULL DEFAULT 0,
  products_inserted    integer NOT NULL DEFAULT 0,
  products_updated     integer NOT NULL DEFAULT 0,
  products_unchanged   integer NOT NULL DEFAULT 0,
  products_reactivated integer NOT NULL DEFAULT 0,
  products_deactivated integer NOT NULL DEFAULT 0,
  failed_pages         jsonb NOT NULL DEFAULT '[]',
  error                text,
  CHECK ((status = 'running') = (finished_at IS NULL))
);

-- Höchstens ein laufender Lauf, erzwungen von der Datenbank (AK-7.2).
CREATE UNIQUE INDEX sync_runs_one_running ON sync_runs ((true)) WHERE status = 'running';
CREATE INDEX sync_runs_started_at ON sync_runs (started_at DESC);

CREATE TABLE products (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id      bigint NOT NULL UNIQUE,                 -- ERP-id
  sku              text NOT NULL,
  name             text NOT NULL,
  price_cents      integer NOT NULL CHECK (price_cents >= 0),
  erp_updated_at   timestamptz NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  deactivated_at   timestamptz,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_run_id bigint NOT NULL REFERENCES sync_runs (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (active = (deactivated_at IS NULL))
);

-- Für die Deaktivierung: aktive Produkte, die im Lauf nicht vorkamen.
CREATE INDEX products_active_last_seen ON products (last_seen_run_id) WHERE active;
```

## Ablauf eines Laufs

```
start(trigger):                                   ── eine Transaktion
  UPDATE sync_runs SET status='failed', … WHERE status='running'
         AND heartbeat_at < now() - staleAfterMs  ── verwaiste Läufe (AK-7.4)
  INSERT sync_runs (status='running', …)          ── 23505 (unique) → «läuft schon» (AK-7.1)
  → runId; run() im Hintergrund starten, nicht abwarten

run(runId, signal):
  Seite 1 holen (bei retrybarem Fehler: retryAfterMs warten, einmal neu) → sonst failed
  pages_total = ceil(total / pageSize) speichern
  erster Durchgang, Seiten 1 … n nacheinander:
    ok      → savePage (Transaktion, siehe unten); consecutive = 0
    ErpError→ failed_pages merken; consecutive++ ; ≥ SYNC_MAX_CONSECUTIVE_FAILURES → failed
  zweiter Durchgang für retrybare, nicht rateLimited Seiten:
    Heartbeat; sleep(max(retryAfterMs)); jede Seite einmal
  Status mit decideStatus(); bei vollständig: deactivate() mit Sperre
  finish(runId, status, error)
  Jede Ausnahme (DB, Abbruch, Fencing) → failed mit Grund; Fencing ändert die Zeile nicht
```

`savePage(runId, page)` in **einer** Transaktion:

1. `UPDATE sync_runs SET heartbeat_at = now() WHERE id = $run AND status = 'running'` → 0 Zeilen: Fencing, `ROLLBACK`, Lauf bricht ab (AK-7.5).
2. `SELECT … FROM products WHERE external_id = ANY($ids) FOR UPDATE`
3. `diffPage(vorhanden, neu)` (rein) → welche einfügen, ändern, reaktivieren, unverändert.
4. Einfügen/Ändern mit `INSERT … ON CONFLICT (external_id) DO UPDATE` für neue und geänderte Produkte (ein Statement mit `unnest`).
5. `UPDATE products SET last_seen_run_id = $run, last_seen_at = now() WHERE external_id = ANY($ids)` für alle.
6. Zähler in `sync_runs` erhöhen.

`deactivate(runId)` in einer Transaktion: Fencing wie oben, Kandidaten und aktive Produkte zählen, bei Anteil ≤ `SYNC_MAX_DEACTIVATE_RATIO` deaktivieren, sonst nichts tun und `partial` melden.

## Endstatus (`decideStatus`, rein)

| Bedingung (erste zutreffende gilt)                                         | Status      | Deaktivierung |
| -------------------------------------------------------------------------- | ----------- | ------------- |
| Abbruch (Shutdown), DB-Fehler, Seite 1 gescheitert, zu viele Fehler in Folge | `failed`    | nein          |
| Seiten fehlen nach dem zweiten Durchgang                                   | `partial`   | nein          |
| `total` hat sich während des Laufs geändert                                | `partial`   | nein          |
| vollständig, aber Deaktivierungs-Sperre greift                             | `partial`   | nein          |
| vollständig                                                                | `completed` | ja            |
| (vom nächsten Lauf als verwaist erkannt)                                    | `failed`    | nein          |

## Entscheidungen

**Voll-Sync bei jedem Lauf.** Das ERP kennt keinen Änderungsfilter. Ein Voll-Sync ist ausserdem selbstheilend: Was ein Lauf verpasst, holt der nächste. Darum braucht es keine dauerhafte Warteschlange für gescheiterte Seiten.

**Ein zweiter Durchgang statt Aufgeben oder Endlos-Retry.** Simulation mit Mock-Standardraten, 20'000 Läufe à 100 Seiten:

| Strategie                         | Läufe mit fehlender Seite |
| --------------------------------- | ------------------------- |
| nur erster Durchgang              | 30.0 %                    |
| plus ein zweiter Durchgang        | 0.11 %                    |

Ein dritter Durchgang brächte kaum mehr. Was übrig bleibt, holt der nächste Lauf in 15 Minuten. Vor dem zweiten Durchgang wartet der Lauf das grösste `retryAfterMs` (Spec 002, AK-4.7). Ein ERP, das «warte 2 s» sagt, bekommt also erst nach 2 s die nächste Anfrage.

**Abbruch nach drei Fehlern in Folge.** Eine Seite scheitert mit 0.36 %, drei in Folge also mit etwa 5 × 10⁻⁸. Das passiert praktisch nur, wenn das ERP ausgefallen ist. Dann lohnt es nicht, jede der 100 Seiten bis zu 130 s zu versuchen.

**Seite 1 bekommt sofort einen zweiten Versuch.** Ohne Seite 1 kennt der Lauf `total` nicht und kann keine Seiten planen. Mit 0.36 % würde sonst jeder 280. Lauf `failed`. Mit einem zweiten Versuch sind es rund 1 zu 80'000.

**Seiten nacheinander, nicht parallel.** Ein Lauf dauert mit dem Mock im Median 50 s (p99 81 s, Simulation). Bei einem Zeitplan von 15 Minuten ist Parallelität nicht nötig, und parallele Anfragen würden das ERP stärker belasten und mehr 429 erzeugen.

**Deaktivieren nur nach vollständigem Lauf, mit Sperre.** Fehlt eine Seite, sind ihre 100 Produkte nicht «gelöscht», sondern nur nicht gelesen. Ein voreiliges Deaktivieren würde sie für den Shop verschwinden lassen. Die Sperre (`SYNC_MAX_DEACTIVATE_RATIO`) schützt zusätzlich vor einem ERP, das fälschlich einen leeren Katalog meldet: Lieber eine Warnung und `partial` als 10'000 deaktivierte Produkte. Erkannt werden verschwundene Produkte über `last_seen_run_id`, nicht über eine Liste aller gesehenen IDs; das braucht keinen Speicher im Prozess und funktioniert auch nach einem Neustart.

**`total` als Konsistenzprüfung.** Bei Offset-Paginierung verschiebt ein neues Produkt auf Seite 3 alle folgenden um eins. Das letzte Produkt von Seite 50 erscheint dann auf Seite 51 nochmals, und eines wird übersprungen. Ein übersprungenes Produkt würde fälschlich deaktiviert. Ändert sich `total`, ist der Lauf darum höchstens `partial`. Eine Verschiebung ohne Änderung von `total` (gleich viele neu wie gelöscht) erkennt das nicht; dafür bräuchte das ERP eine Cursor-Paginierung. Das Mock ist statisch, also ist das Risiko hier nur theoretisch.

**Sperre über einen Partial Unique Index, nicht über `pg_advisory_lock`.** Der Index erzwingt «höchstens ein `running`» für alle Instanzen, in derselben Transaktion wie das Anlegen des Laufs, und ist in der Tabelle sichtbar. Ein Advisory Lock würde bei einem Absturz zwar automatisch frei, bräuchte aber eine Datenbankverbindung, die über die ganze Laufzeit offen bleibt, und funktioniert nicht hinter einem Connection-Pooler im Transaktionsmodus (z. B. PgBouncer).

**Verwaisung über Heartbeat und `maxDurationMs`.** Ein abgestürzter Prozess hinterlässt eine Zeile auf `running`, die sonst jeden weiteren Lauf blockieren würde. Zwischen zwei Heartbeats liegt höchstens ein `fetchPage` (≤ `maxDurationMs` = 130 s, Spec 002 AK-10) oder die Pause vor dem zweiten Durchgang (≤ `maxRetryAfterMs` = 30 s, mit Heartbeat davor). Ist der Heartbeat älter als 130 s + 60 s Reserve, lebt der Lauf nicht mehr. Eine Grenze für die *ganze* Laufzeit wäre unbrauchbar: Sie müsste Stunden betragen und würde einen Absturz erst nach Stunden erkennen.

**Fencing.** Ein Lauf kann fälschlich für verwaist erklärt werden, z. B. nach einer langen GC-Pause oder einer Netzwerkunterbrechung. Damit dann nicht zwei Läufe schreiben, prüft jede Seiten-Transaktion zuerst `WHERE id = $run AND status = 'running'`. Ist die Zeile nicht mehr `running`, wird nichts geschrieben und der Lauf hört auf.

**Datenbank-Uhr.** Mehrere Instanzen haben nicht exakt dieselbe Uhrzeit. `heartbeat_at` und der Vergleich nutzen deshalb `now()` der Datenbank. Tests setzen `heartbeat_at` direkt in der Datenbank zurück, statt eine Uhr zu injizieren.

**Kein «alle `running` beim Start auf `failed`».** Das wäre bei einer einzigen Instanz einfach, würde aber bei mehreren Instanzen einen gesunden Lauf einer anderen Instanz abschiessen. Der Heartbeat funktioniert in beiden Fällen.

**`POST /sync` antwortet mit 202 und wartet nicht.** Ein Lauf dauert Sekunden bis Minuten, im schlimmsten Fall länger als jeder HTTP-Timeout. Der Aufrufer bekommt die ID und fragt `GET /sync/runs/:id` ab.

**Ein Zeitplan-Tick während eines Laufs wird übersprungen, nicht nachgeholt.** Ein nachgeholter Lauf direkt nach einem gerade beendeten Voll-Sync bringt nichts Neues.

**Interne `id` plus `external_id UNIQUE`.** Andere Tabellen verweisen später auf die interne `id` und hängen so nicht an der Nummerierung des ERP. `sku` ist bewusst nicht `UNIQUE`: Tauschen zwei Produkte ihre SKU, würde ein Lauf zwischen den beiden Seiten am Constraint scheitern. Das ERP ist die Quelle der Wahrheit.

**`price_cents integer CHECK (>= 0)`.** Wie im Client (Spec 002): Ganzzahlen in Rappen, Gratisartikel erlaubt. `integer` reicht bis 21 Mio. CHF pro Artikel.

**Diff in TypeScript, nicht in SQL.** Zu zählen, ob ein Upsert eingefügt, geändert oder nichts getan hat, geht in SQL nur mit Tricks (`xmax = 0`) oder ab PostgreSQL 18 mit `RETURNING OLD`. Stattdessen liest die Transaktion die vorhandenen Zeilen `FOR UPDATE`, und die reine Funktion `diffPage` entscheidet. Das ist für 100 Zeilen pro Seite billig, und die Regeln aus Anforderung 3 werden ohne Datenbank testbar.

**`pg` mit SQL, kein ORM.** Die wichtigen Teile sind SQL-Merkmale: Partial Unique Index, `ON CONFLICT`, `FOR UPDATE`, `unnest`, `now()`. Ein ORM würde sie verstecken oder umgehen. Migrationen sind reine SQL-Dateien mit `node-pg-migrate`; die App selbst migriert nicht, damit mehrere Instanzen beim Start nicht gleichzeitig migrieren.

**Abbruch beim Herunterfahren.** `SyncService` hält einen `AbortController` pro Lauf und löst ihn in `onApplicationShutdown` aus. Der ERP-Client bricht dann sofort ab (Spec 002, Anforderung 6), statt bis zu 130 s weiterzulaufen. Danach wird der Lauf noch als `failed` abgeschlossen, bevor der Pool schliesst.

## Testbarkeit

- **Reine Funktionen** (`diffPage`, `decideStatus`, Konfiguration) mit Unit-Tests ohne Datenbank.
- **`SyncRunner`** bekommt eine `ProductSource` (Interface mit `fetchPage`, im Betrieb der `ErpClient`) und `sleep` injiziert. Tests spielen Seitenfolgen mit Fehlern ab, ohne HTTP und ohne Wartezeit.
- **Echte PostgreSQL in Tests** über Testcontainers (`@testcontainers/postgresql`, Docker ist vorhanden), Migration vor den Tests. Nebenläufigkeit, Partial Unique Index, Fencing und `FOR UPDATE` lassen sich mit einer Attrappe nicht glaubwürdig prüfen.
- **Verwaisung** wird getestet, indem der Test `heartbeat_at` in der Datenbank auf «vor 10 Minuten» setzt.
- **Ende-zu-Ende** gegen das echte Mock-ERP (Kindprozess wie in Spec 002) und die Test-Datenbank.
