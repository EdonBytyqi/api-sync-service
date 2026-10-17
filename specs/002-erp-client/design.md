# 002 – ERP-Client: Design

## Überblick

```
SyncJob (Spec 003) ──fetchPage(page, pageSize, signal)──▶ ErpClient ──fetch──▶ mock-erp :4000
                                                            │
                                         retry-policy.ts (reine Funktionen)
```

Der Kern ist reines TypeScript ohne NestJS-Abhängigkeit. Nest kennt den Client nur über einen Provider. So bleibt der Client mit einfachen Unit-Tests prüfbar, und die Retry-Logik hängt nicht am Framework.

| Datei                       | Aufgabe                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `src/erp/erp-config.ts`     | `loadErpConfig(env)`: Variablen lesen und validieren, alle Fehler auf einmal melden          |
| `src/erp/retry-policy.ts`   | Reine Funktionen: `classify(outcome)`, `backoffDelay(attempt, config, random)`, `parseRetryAfter(header, now)` |
| `src/erp/erp-error.ts`      | `ErpError` mit `reason`, `retryable`, `attempts`, `status?`, `retryAfterMs?`, `cause?`        |
| `src/erp/erp-client.ts`     | `ErpClient`: Versuchsschleife, Timeout, Abbruch, Schema-Prüfung der Antwort                  |
| `src/erp/erp.module.ts`     | Nest-Modul: liest die Konfiguration, stellt `ErpClient` mit Standard-Abhängigkeiten bereit    |

## Schnittstelle

```ts
interface ErpClientDeps {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>; // wirft bei Abbruch
  random: () => number; // [0, 1)
  now: () => number; // ms seit Epoch
  logger: { warn(message: string, context: object): void };
}

class ErpClient {
  constructor(config: ErpConfig, deps?: Partial<ErpClientDeps>);
  fetchPage(page: number, pageSize: number, signal?: AbortSignal): Promise<ProductPage>;
}

type ErpErrorReason =
  | 'timeout' | 'network' | 'http' | 'rateLimited'
  | 'invalidResponse' | 'invalidArgument' | 'aborted';
```

`ProductPage` und `Product` haben dieselbe Form wie in Spec 001 (`priceCents` als Ganzzahl).

## Ablauf von `fetchPage`

```
Argumente prüfen → bei Fehler 'invalidArgument'
für attempt = 1 … maxAttempts:
  signal schon abgebrochen? → 'aborted'
  attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  Ergebnis = fetch + Body lesen + Schema prüfen, alles unter attemptSignal
  classify(Ergebnis):
    Erfolg            → Seite zurückgeben
    endgültig         → ErpError werfen (retryable: false)
    retrybar, letzter → ErpError werfen (retryable: true)
    retrybar          → delay = Retry-After oder backoffDelay(attempt)
                        delay > maxRetryAfterMs? → 'rateLimited' werfen
                        logger.warn(...); await sleep(delay, signal)
```

| Ergebnis                                   | Klasse     | Wartezeit vor dem nächsten Versuch       |
| ------------------------------------------ | ---------- | ---------------------------------------- |
| 200 + gültiges Schema                      | Erfolg     | –                                        |
| 200 + ungültiges JSON/Schema               | endgültig  | –                                        |
| 400, 401, 403, 404, 422, übrige 4xx        | endgültig  | –                                        |
| 408, 500, 502, 504, Timeout, Netzwerkfehler | retrybar   | Backoff mit Jitter                       |
| 429, 503                                   | retrybar   | `Retry-After`, ohne gültigen Header Backoff |
| Abbruch durch Aufrufer                     | endgültig  | –                                        |

## Entscheidungen

**Retry ist nur erlaubt, weil `GET` idempotent ist.** Ein wiederholter Lese-Request ändert im ERP nichts. Bei einem `POST` («Bestellung anlegen») wäre ein Retry nach einem Timeout gefährlich, weil der erste Versuch vielleicht angekommen ist. Der Client bietet deshalb bewusst nur `fetchPage` an.

**Kein Retry bei 400 und anderen 4xx.** Ein 4xx sagt: «Dein Request ist falsch». Derselbe Request bekommt dieselbe Antwort, ein Retry kann also nicht helfen. Er würde nur Versuche verbrauchen, den Fehler um mehrere Sekunden verzögern, das ERP zusätzlich belasten und einen Programmierfehler hinter Warn-Logs verstecken. Beim Mock ist das garantiert: Er validiert vor dem Chaos (Spec 001), ein 400 ist also nie zufällig. Ausnahmen sind 408 («Request Timeout») und 429 («zu viele Requests»): Beide beschreiben einen Zustand, keinen falschen Request.

**Ungültige Antworten werden nicht wiederholt.** Ein 200 mit falschem Schema ist ein Vertragsbruch des ERP, kein vorübergehender Fehler. Ein Retry würde ihn verdecken. Der Sync-Job soll laut scheitern, statt kaputte Daten zu speichern. Geprüft wird von Hand ohne Schema-Bibliothek; falls später mehr Endpunkte dazukommen, ist `zod` eine Option.

**Full Jitter statt festem Backoff.** Ohne Jitter versuchen alle Clients, die gleichzeitig einen Fehler bekamen, es auch gleichzeitig wieder, und das ERP wird in Wellen getroffen («Thundering Herd»). Full Jitter (`random() × Obergrenze`) verteilt die Versuche über das ganze Intervall. Im Vergleich der AWS-Architektur-Blogs erzeugt es die wenigsten Requests insgesamt. Der Preis: Die Wartezeit kann 0 sein; das ist akzeptabel, weil die Obergrenze trotzdem exponentiell wächst.

**`Retry-After` hat Vorrang vor dem Backoff, ohne zusätzlichen Jitter.** Das ERP sagt genau, wann es wieder bereit ist; kürzer zu warten wäre unhöflich und würde wieder 429 erzeugen. Länger als nötig zu warten kostet nur Zeit. Mit einer einzigen Service-Instanz gibt es keine Herde, die wir verteilen müssten. Bei mehreren Instanzen würden wir `Retry-After + random() × baseDelayMs` verwenden.

**429 zählt gegen `maxAttempts`.** Sonst könnte ein dauerhaft überlastetes ERP den Client endlos warten lassen. Der Aufrufer bekommt nach endlicher Zeit eine Antwort.

**Obergrenze für `Retry-After` (`maxRetryAfterMs`).** Sagt das ERP «komm in einer Stunde wieder», soll der Client nicht eine Stunde in einem `await` hängen. Er gibt die Entscheidung mit `retryAfterMs` an den Sync-Job zurück, der den nächsten Lauf planen kann.

**Timeout pro Versuch, inklusive Body.** Ein Gesamt-Timeout würde späteren Versuchen weniger Zeit lassen und Retries entwerten. Der Timeout umfasst das Lesen des Body, weil ein Server die Header schnell schicken und dann beim Body hängen kann. Umgesetzt mit `AbortSignal.timeout` und `AbortSignal.any` (Node 22), ohne eigene Timer-Verwaltung.

**`timeoutMs` (2000) liegt unter `SLOW_MS` des Mocks (5000).** Lieber nach 2 s abbrechen und neu würfeln (90 % Chance auf eine schnelle Antwort) als 5 s warten. Eine normale Antwort des Mocks dauert wenige Millisekunden, 2 s sind also grosszügig.

**Zufall, Zeit und Netzwerk werden injiziert, wie im Mock.** `random` für den Jitter, `sleep` für die Wartezeiten, `now` für `Retry-After` als HTTP-Datum, `fetch` für die Antworten. Damit prüft ein Unit-Test eine ganze Retry-Folge in Millisekunden und mit exakten Wartezeiten (AK-3.3, AK-7.2). Der Timeout selbst bleibt ein echter Timer (`AbortSignal.timeout`): Seine Tests verwenden eine `fetch`-Attrappe, die erst beim Abbruch zurückkehrt, und `timeoutMs: 20`. Das kostet pro Test 20 ms und testet das echte Abbruchverhalten statt einer Nachbildung.

**Reine Funktionen für die Retry-Regeln.** `classify`, `backoffDelay` und `parseRetryAfter` haben keine Nebenwirkungen. Die Tabelle oben wird als `it.each` direkt gegen `classify` getestet, ohne HTTP.

**Kein Retry-Paket (`p-retry`, `axios-retry`).** Die Logik ist rund 100 Zeilen und das Herzstück dieser Aufgabe. Selbst geschrieben ist jede Regel sichtbar, an ein AK gebunden und testbar. In einem grösseren Projekt mit vielen Clients wäre eine gemeinsame Bibliothek sinnvoll.

## Was das für den Sync-Job bedeutet (Ausblick auf Spec 003)

Mit den Mock-Standardraten scheitert ein Versuch mit Wahrscheinlichkeit 1 − 0.9 × 0.75 = 0.325 (25 % Fehler, dazu 10 % Timeouts). Mit 5 Versuchen scheitert eine Seite endgültig mit 0.325⁵ ≈ 0.36 %. Bei 100 Seiten scheitert damit in etwa **30 % der Sync-Läufe mindestens eine Seite**. Der Client allein reicht also nicht: Der Sync-Job muss mit einzelnen gescheiterten Seiten umgehen können (später erneut versuchen, Lauf nicht als Ganzes verwerfen). Alternativ senken 8 Versuche das Risiko auf rund 1 % pro Lauf.

Schlimmster Fall für eine Seite mit Standardwerten: 5 Timeouts à 2 s plus 4 Pausen von höchstens 2 s (429) ≈ 18 s.
