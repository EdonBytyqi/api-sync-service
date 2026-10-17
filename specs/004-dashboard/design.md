# 004 – Dashboard: Design

## Überblick

```
Browser ──/api/sync/…──▶ (dev: ng serve Proxy | Container: nginx) ──/sync/…──▶ api-sync-service :3000
```

Eigenes Angular-Projekt in `dashboard/`, gleich aufgebaut wie das Frontend aus App A: Angular 21, Standalone Components, Signals, Vitest mit jsdom, eigene `package.json`. Keine UI-Bibliothek; ein paar Dutzend Zeilen CSS reichen und lassen volle Kontrolle über Kontrast und Fokus.

| Datei                                   | Aufgabe                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `src/app/sync-api.service.ts`           | HTTP: `listRuns(limit)`, `startSync()` → `{ kind: 'started', id } \| { kind: 'running', id } \| { kind: 'error', message }` |
| `src/app/runs.store.ts`                 | Signals: `runs`, `loading`, `error`, `lastUpdated`, `runningRun`; Polling, Sichtbarkeit, «neueste Anfrage gewinnt» |
| `src/app/runs-page.component.ts`        | Seite: Überschrift, Knopf, Live-Region, Fehler, Tabelle                            |
| `src/app/run-row.component.ts`          | Eine Zeile plus aufklappbare Details mit gescheiterten Seiten                     |
| `src/app/status-badge.component.ts`     | Status als Symbol + Text                                                          |
| `src/app/format.ts`                     | Reine Funktionen: Zahlen `de-CH`, Datum Europe/Zurich, Dauer, Statustexte          |
| `proxy.conf.json`                       | `/api` → `http://localhost:3000`, Pfad ohne `/api`                                 |

## Datenfluss

- `RunsStore` hält den Zustand als Signals. `runningRun` ist ein `computed` aus `runs`; davon hängen Knopf (AK-3.5) und Polling-Intervall (AK-4.1) ab.
- Polling über einen einzigen Timer, der nach jeder Antwort neu gesetzt wird (3 s oder 30 s). So gibt es nie zwei Anfragen gleichzeitig (AK-4.3), und ein langsamer Server verlängert das Intervall, statt Anfragen zu stapeln.
- Jede Anfrage bekommt eine laufende Nummer; eine Antwort mit älterer Nummer als der zuletzt angewendeten wird verworfen (AK-4.3). Nötig, weil «Jetzt synchronisieren» ein sofortiges Neuladen auslöst, während ein Polling unterwegs sein kann.
- `document.visibilitychange` pausiert und setzt fort (AK-4.2).
- Die Ankündigungen (AK-4.4, AK-5.3) vergleichen den Status jedes Laufs mit dem vorherigen Stand. Nur ein Übergang `running` → Endstatus erzeugt eine Meldung. Beim ersten Laden wird nichts angekündigt.

## Darstellung des Status

| Status      | Text            | Symbol | Bedeutung für den Nutzer                         |
| ----------- | --------------- | ------ | ------------------------------------------------ |
| `running`   | läuft           | ⟳      | Fortschritt sichtbar, Knopf gesperrt             |
| `completed` | abgeschlossen   | ✓      | alles da, Verschwundenes deaktiviert             |
| `partial`   | teilweise       | ⚠      | Daten gespeichert, nichts deaktiviert, Grund sichtbar |
| `failed`    | fehlgeschlagen  | ✕      | Grund sichtbar                                   |

Symbole sind `aria-hidden="true"`; der Text trägt die Bedeutung (AK-2.1).

## Entscheidungen

**Polling statt WebSocket/SSE.** Ein Lauf dauert rund 50 s, Zustandswechsel sind selten. 3 s Verzögerung ist für ein Betriebs-Dashboard genug, und die API bleibt zustandslos. Push würde einen zweiten Kanal, Reconnect-Logik und Arbeit im Service bedeuten.

**409 ist eine Information, kein Fehler.** Für den Nutzer heisst «läuft bereits» dasselbe wie «gestartet»: Die Daten werden gerade synchronisiert. Darum eine neutrale Meldung mit Verweis auf den laufenden Lauf statt einer roten Fehlermeldung (AK-3.3).

**Knopf deaktivieren, aber der API vertrauen.** Der deaktivierte Knopf verhindert unnötige Klicks. Die eigentliche Sperre ist der Partial Unique Index (Spec 003, AK-7.2); zwischen zwei Polling-Zyklen kann ein anderer Nutzer starten. Ein deaktivierter Knopf bekommt einen sichtbaren Grund daneben und bleibt per `aria-describedby` damit verbunden, weil deaktivierte Elemente sonst nicht erklären, warum.

**Ankündigen nur bei Übergängen.** Eine Live-Region, die alle 3 s «läuft, Seite 38 von 100» vorliest, macht einen Screenreader unbenutzbar. Angekündigt wird, was eine Handlung des Nutzers beantwortet oder einen Lauf beendet.

**Aufklappen per `<button>` in der ersten Zelle.** Ein klickbares `<tr>` ist für Tastatur und Screenreader unsichtbar. Der Button sitzt in der Nummernspalte («Details zu Lauf #12»), die Details folgen als eigene Zeile mit `id` für `aria-controls`.

**Formatierung als reine Funktionen mit `Intl`.** `Intl.NumberFormat('de-CH')` liefert `10’000`, `Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich' })` die Zeit unabhängig von der Zeitzone des Rechners. Rein und ohne Angular testbar.

**Dauer und «läuft seit» aus Server-Zeiten.** Für beendete Läufe `finishedAt − startedAt`, beides vom Server. Für laufende Läufe `jetzt − startedAt` mit der Uhr des Browsers; eine kleine Abweichung ist hier unwichtig und wird nicht korrigiert.

**`axe-core` in den Komponententests, plus Handprüfung.** Automatische Prüfung fängt fehlende Labels, falsche ARIA-Attribute und Struktur ab, aber in jsdom keine Kontraste und keine echte Fokus-Reihenfolge. Kontrast wird mit festen Farbwerten im CSS geprüft (Tabelle im README), Tastatur und Screenreader (NVDA) von Hand mit einer Checkliste.

## Testbarkeit

- `format.ts`: Unit-Tests ohne Angular.
- `SyncApiService` mit `HttpTestingController`: 202, 409, 500, Netzwerkfehler → die drei Ergebnisarten.
- `RunsStore` mit Fake-Timern (`vi.useFakeTimers`) und `HttpTestingController`: Intervalle 3 s/30 s, keine parallelen Anfragen, veraltete Antwort verworfen, Pause bei unsichtbarem Tab, Ankündigung nur beim Übergang.
- Komponenten mit `TestBed`: jede AK als Test über das gerenderte DOM (Rollen, Texte, `aria-*`), plus `axe-core` je Zustand (AK-5.9).
