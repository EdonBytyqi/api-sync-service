# 001 – Mock-ERP: Design

## Überblick

Ein kleiner Express-Server in `mock-erp/` mit eigenem `package.json`. Er teilt keinen Code und keine Abhängigkeiten mit dem NestJS-Service, damit der Sync-Service ihn nur über HTTP kennt, so wie ein echtes ERP.

```
api-sync-service ──HTTP──▶ mock-erp :4000  GET /products?page&pageSize
```

| Datei       | Aufgabe                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| `config.js` | `loadConfig(env)`: Umgebungsvariablen lesen, validieren, Objekt zurückgeben |
| `app.js`    | `generateProducts()`, `rollChaos(config, random)`, `createApp(config, deps)` |
| `server.js` | Einstiegspunkt: Konfiguration laden, bei Fehler Exit-Code 1, sonst `listen` |

### Abgrenzung zum Root-Projekt

`mock-erp/` ist wie ein externes System vollständig eigenständig:

- Eigene Abhängigkeiten (`express`, `vitest`, `supertest`) und eigenes `npm test` in `mock-erp/package.json`.
- Tests heissen `*.test.js` (JavaScript wie der Server), das Root-Muster `**/*.spec.ts` trifft sie nie.
- Beide Root-Configs (`vitest.config.ts`, `vitest.config.e2e.ts`) schliessen `mock-erp/**` zusätzlich explizit aus. Dabei werden `configDefaults.exclude` gespreizt, weil ein eigenes `exclude` die Standardwerte ersetzt und sonst `node_modules` durchsucht würde.
- `mock-erp/vitest.config.js` ist nötig, nicht nur Dokumentation: Ohne sie hat Vitest in `mock-erp/` die Root-Config im Elternordner gefunden und nur `*.spec.ts` gesucht («No test files found»).
- CI später in zwei Schritten: `npm test` im Root und `npm test` in `mock-erp/`.

## Datenmodell

Beim Start werden 10'000 Produkte im Speicher erzeugt, ohne Zufall:

| Feld         | Wert für Produkt n (1 … 10'000)                  |
| ------------ | ------------------------------------------------ |
| `id`         | `n`                                              |
| `sku`        | `SKU-` + n auf 5 Stellen aufgefüllt (`SKU-00037`) |
| `name`       | `Product n`                                      |
| `priceCents` | `100 + (n * 7919) % 99'900` → 1.00 bis 999.99 CHF |
| `updatedAt`  | 2026-01-01T00:00Z + n Minuten                    |

Die Liste ist nach `id` sortiert. Eine Seite ist `products.slice((page - 1) * pageSize, page * pageSize)`.

## Ablauf einer Anfrage

1. `page` und `pageSize` validieren → bei Fehler sofort 400, ohne `random` oder `sleep` aufzurufen (AK-1.7).
2. `rollChaos(config, random)` zieht genau zwei Werte aus `random`:
   - 1. Wert `< SLOW_RATE` → langsam
   - 2. Wert `r`: `r < RATE_LIMIT_RATE` → 429, `r < RATE_LIMIT_RATE + FAILURE_RATE` → 500, sonst 200
3. Wenn langsam: `await sleep(SLOW_MS)` (AK-4.1).
4. Antwort mit dem ausgewürfelten Status, bei 429 mit `Retry-After: 2`.

`rollChaos` ist eine reine Funktion ohne HTTP und ohne Zeit. Sie enthält die ganze Raten-Logik.

## Entscheidungen

**Preise in Rappen als Ganzzahl (`priceCents`).** Gleitkommazahlen können viele Dezimalbrüche nicht exakt darstellen: `0.1 + 0.2` ergibt `0.30000000000000004`. Bei Summen, Rabatten oder dem Vergleich «hat sich der Preis geändert?» führt das zu Rundungsfehlern und falschen Änderungen beim Sync. Ganzzahlen sind exakt; umgerechnet wird erst bei der Anzeige.

**Daten berechnet statt zufällig.** Jeder Wert ergibt sich aus der `id`. Dadurch sind Reihenfolge und Werte nach jedem Neustart gleich (AK-2.1), ohne Seed-Bibliothek und ohne Datei. Der Faktor 7919 ist eine Primzahl und verteilt die Preise, damit sie nicht einfach mit der `id` steigen.

**Ein Wurf für 500 und 429.** Mit zwei unabhängigen Würfen wären die echten Raten verfälscht (ein 429 würde einen bereits gewürfelten 500 verdecken). Mit einem Wurf und aneinandergereihten Bereichen entsprechen die Raten genau der Konfiguration (AK-5.3).

**Verzögerung unabhängig vom Statuscode.** Ein langsamer 500er ist der schwierigste Fall für den Client: Er muss zuerst den Timeout und danach den Retry richtig behandeln (AK-4.2).

**Validierung vor dem Chaos.** Ein 400 ist ein Fehler des Aufrufers und soll nie zufällig als 500 erscheinen. Sonst würde der Sync-Service einen Programmierfehler endlos wiederholen.

**Ungültige Konfiguration bricht den Start ab.** `Number("abc")` ergibt `NaN`, und `Math.random() < NaN` ist immer `false`. Ein Tippfehler würde die Fehler also still abschalten, und Tests wären grün, ohne etwas zu prüfen. Deshalb validiert `loadConfig` beim Start alle Variablen, meldet alle Fehler auf einmal, und `server.js` beendet sich mit Exit-Code 1 (AK-6.4).

**Zufall und Zeit werden injiziert.** `createApp(config, { random, sleep })` nimmt die Zufallsquelle und die Warte-Funktion als Parameter; Standard sind `Math.random` und `setTimeout`. Ein Test übergibt eine feste Folge, z. B. `sequence(0.99, 0.01)` für «nicht langsam, 429», und eine `sleep`-Attrappe, die sofort zurückkehrt und ihren Aufruf aufzeichnet. So entscheidet der Test, was eine einzelne Anfrage tut, ohne 1'000 Anfragen zu senden und ohne 5 Sekunden zu warten. Die Raten (AK-3.2, 4.3, 5.2) werden geprüft, indem 1'000 gleichmässig verteilte Werte `(i + 0.5) / 1000` durch `rollChaos` laufen. Das Ergebnis ist exakt (z. B. genau 200 × 500), statt eines Toleranzbands, das gelegentlich zufällig fehlschlägt. Nur ein Test nutzt echtes `Math.random`, um die Verdrahtung zu prüfen; seine Toleranz liegt bei über 10 Standardabweichungen.

**Warum `(i + 0.5) / 1000` und nicht `i / 1000`.** Die Werte `i / 1000` liegen genau auf den Schwellen. Ist eine Schwelle durch Gleitkomma-Rundung minimal verschoben, kippt ein Wert auf die falsche Seite: Bei `RATE_LIMIT_RATE=0.1` und `FAILURE_RATE=0.2` ist die Schwelle `0.1 + 0.2 = 0.30000000000000004`, und `300 / 1000` zählt fälschlich noch als 500er, also 301 statt 300 Fehler. Die Mittelpunkte `(i + 0.5) / 1000` liegen immer einen halben Schritt von jeder Schwelle entfernt, so etwas kann nicht passieren. Ausserdem sind sie symmetrisch: Ihr Mittel ist genau 0.5, das von `i / 1000` 0.4995 (0 ist dabei, 1 nicht). Die Grenzwerte selbst (z. B. genau 0.05) prüfen eigene Tests.

**Der Vertrag mit `random` ist Teil des Designs.** Tests verlassen sich darauf, dass pro Anfrage genau zwei Werte gezogen werden, zuerst Verzögerung, dann Status. Die `sequence`-Attrappe wirft, wenn mehr gezogen wird. Ändert sich die Reihenfolge, schlagen die Tests deshalb laut fehl statt still Falsches zu prüfen.
