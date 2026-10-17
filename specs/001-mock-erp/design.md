# 001 – Mock-ERP: Design

## Überblick

Ein einzelner Express-Server in `mock-erp/server.js` mit eigenem `package.json`. Er teilt keinen Code und keine Abhängigkeiten mit dem NestJS-Service, damit der Sync-Service ihn nur über HTTP kennt, so wie ein echtes ERP.

```
api-sync-service ──HTTP──▶ mock-erp :4000  GET /products?page&pageSize
```

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

1. `page` und `pageSize` validieren → bei Fehler sofort 400 (AK-1.7).
2. Mit Wahrscheinlichkeit `SLOW_RATE` `SLOW_MS` warten (AK-4.1).
3. Eine Zufallszahl `r` in [0, 1) ziehen:
   - `r < RATE_LIMIT_RATE` → 429 mit `Retry-After: 2`
   - `r < RATE_LIMIT_RATE + FAILURE_RATE` → 500
   - sonst → 200 mit der Seite

## Entscheidungen

**Preise in Rappen als Ganzzahl (`priceCents`).** Gleitkommazahlen können viele Dezimalbrüche nicht exakt darstellen: `0.1 + 0.2` ergibt `0.30000000000000004`. Bei Summen, Rabatten oder dem Vergleich «hat sich der Preis geändert?» führt das zu Rundungsfehlern und falschen Änderungen beim Sync. Ganzzahlen sind exakt; umgerechnet wird erst bei der Anzeige.

**Daten berechnet statt zufällig.** Jeder Wert ergibt sich aus der `id`. Dadurch sind Reihenfolge und Werte nach jedem Neustart gleich (AK-2.1), ohne Seed-Bibliothek und ohne Datei. Der Faktor 7919 ist eine Primzahl und verteilt die Preise, damit sie nicht einfach mit der `id` steigen.

**Ein Wurf für 500 und 429.** Mit zwei unabhängigen Würfen wären die echten Raten verfälscht (ein 429 würde einen bereits gewürfelten 500 verdecken). Mit einem Wurf und aneinandergereihten Bereichen entsprechen die Raten genau der Konfiguration (AK-5.3).

**Verzögerung unabhängig vom Statuscode.** Ein langsamer 500er ist der schwierigste Fall für den Client: Er muss zuerst den Timeout und danach den Retry richtig behandeln (AK-4.2).

**Validierung vor dem Chaos.** Ein 400 ist ein Fehler des Aufrufers und soll nie zufällig als 500 erscheinen. Sonst würde der Sync-Service einen Programmierfehler endlos wiederholen.

**Ungültige Konfiguration bricht den Start ab.** `Number("abc")` ergibt `NaN`, und `Math.random() < NaN` ist immer `false`. Ein Tippfehler würde die Fehler also still abschalten, und Tests wären grün, ohne etwas zu prüfen. Deshalb validieren wir beim Start (AK-6.4).
