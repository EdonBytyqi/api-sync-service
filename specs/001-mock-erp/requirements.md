# 001 – Mock-ERP: Anforderungen

## Ziel

Ein kleiner, absichtlich unzuverlässiger HTTP-Server, der ein ERP-System mit 10'000 Produkten simuliert. Er ist das Gegenüber, an dem `api-sync-service` Retries, Timeouts und Rate-Limit-Handling beweisen muss. Er läuft getrennt vom Sync-Service im Ordner `mock-erp/`.

## Nicht im Umfang

- Schreibzugriffe (POST/PUT/DELETE), Authentifizierung, Persistenz, Filter- oder Sortierparameter.
- Produkte, die sich zur Laufzeit ändern: `updatedAt` ist fix. Inkrementeller Sync wird in einer späteren Spec behandelt.

## Anforderung 1 – Produkte seitenweise abrufen

Als Sync-Service möchte ich die Produktliste seitenweise abrufen, damit ich den ganzen Katalog in Portionen laden kann.

- **AK-1.1** Wenn `GET /products?page=1&pageSize=100` aufgerufen wird und kein Fehler simuliert wird, dann antwortet die API mit 200 und genau 100 Produkten, sortiert nach `id`.
- **AK-1.2** Wenn `GET /products?page=37&pageSize=100` aufgerufen wird und kein Fehler simuliert wird, dann enthält `items` die Produkte mit `id` 3601 bis 3700.
- **AK-1.3** Wenn eine Anfrage erfolgreich ist, dann hat die Antwort die Form `{ "items": [...], "page": <n>, "pageSize": <n>, "total": 10000 }`, wobei `page` und `pageSize` den angefragten Werten entsprechen.
- **AK-1.4** Wenn ein Produkt geliefert wird, dann hat es genau die Felder `id` (Ganzzahl), `sku` (String), `name` (String), `priceCents` (Ganzzahl > 0) und `updatedAt` (ISO-8601-Zeitstempel in UTC).
- **AK-1.5** Wenn `page` hinter der letzten Seite liegt (z. B. `page=101&pageSize=100`), dann antwortet die API mit 200, `items: []` und `total: 10000`.
- **AK-1.6** Wenn `page` oder `pageSize` fehlt, dann gilt `page=1` bzw. `pageSize=100`.
- **AK-1.7** Wenn `page` oder `pageSize` keine positive Ganzzahl ist oder `pageSize` grösser als 1000 ist, dann antwortet die API sofort mit 400 und einer Fehlermeldung, ohne Fehler oder Verzögerung zu simulieren.

## Anforderung 2 – Stabile Reihenfolge

Als Sync-Service möchte ich mich auf eine feste Reihenfolge verlassen, damit Seiten sich weder überlappen noch Lücken haben.

- **AK-2.1** Wenn der Server neu gestartet wird, dann liefert dieselbe Anfrage dieselben Produkte in derselben Reihenfolge mit denselben Feldwerten.
- **AK-2.2** Wenn alle Seiten 1 bis 100 mit `pageSize=100` abgerufen werden, dann kommt jede `id` von 1 bis 10'000 genau einmal vor.

## Anforderung 3 – Serverfehler (500)

Als Entwickler möchte ich zufällige Serverfehler, damit der Sync-Service sein Retry-Verhalten beweisen muss.

- **AK-3.1** Wenn ein Serverfehler simuliert wird, dann antwortet die API mit 500 und einem JSON-Body `{ "error": "..." }` ohne `items`.
- **AK-3.2** Wenn `FAILURE_RATE=0.2` gesetzt ist und alle anderen Raten 0 sind, dann enden von 1'000 gültigen Anfragen zwischen 15 % und 25 % mit 500.

## Anforderung 4 – Langsame Antworten

Als Entwickler möchte ich zufällig langsame Antworten, damit der Sync-Service Timeouts behandeln muss.

- **AK-4.1** Wenn eine langsame Antwort simuliert wird, dann kommt die Antwort frühestens nach 5 Sekunden (`SLOW_MS`, Standard 5000).
- **AK-4.2** Wenn eine langsame Antwort simuliert wird, dann kann sie trotzdem mit 200, 500 oder 429 enden. Verzögerung und Statuscode werden unabhängig voneinander ausgewürfelt.
- **AK-4.3** Wenn `SLOW_RATE=0.1` gesetzt ist und alle anderen Raten 0 sind, dann dauern von 1'000 gültigen Anfragen zwischen 5 % und 15 % mindestens 5 Sekunden.

## Anforderung 5 – Rate Limiting (429)

Als Entwickler möchte ich zufällige 429-Antworten, damit der Sync-Service den `Retry-After`-Header respektieren muss.

- **AK-5.1** Wenn ein Rate Limit simuliert wird, dann antwortet die API mit 429, dem Header `Retry-After: 2` (Sekunden) und einem JSON-Body `{ "error": "..." }`.
- **AK-5.2** Wenn `RATE_LIMIT_RATE=0.05` gesetzt ist und alle anderen Raten 0 sind, dann enden von 1'000 gültigen Anfragen zwischen 2 % und 8 % mit 429.
- **AK-5.3** Wenn eine Anfrage beantwortet wird, dann hat sie genau einen Statuscode: 500 und 429 schliessen sich gegenseitig aus, und ihre Raten addieren sich (5 % + 20 % = 25 % Fehler).

## Anforderung 6 – Konfiguration

Als Entwickler möchte ich das Verhalten über Umgebungsvariablen steuern, damit ich in Tests einen stabilen Server habe.

- **AK-6.1** Wenn keine Umgebungsvariablen gesetzt sind, dann gelten `FAILURE_RATE=0.2`, `SLOW_RATE=0.1`, `RATE_LIMIT_RATE=0.05`, `SLOW_MS=5000` und `PORT=4000`.
- **AK-6.2** Wenn `FAILURE_RATE`, `SLOW_RATE` und `RATE_LIMIT_RATE` auf 0 gesetzt sind, dann antwortet jede gültige Anfrage mit 200 in weniger als 100 ms.
- **AK-6.3** Wenn eine Rate auf 1 gesetzt ist, dann tritt das entsprechende Verhalten bei jeder gültigen Anfrage ein.
- **AK-6.4** Wenn eine Rate keine Zahl zwischen 0 und 1 ist (z. B. `FAILURE_RATE=abc` oder `1.5`) oder `FAILURE_RATE + RATE_LIMIT_RATE` grösser als 1 ist, dann startet der Server nicht und nennt die ungültige Variable.
- **AK-6.5** Wenn der Server startet, dann gibt er Port und aktive Raten auf der Konsole aus.
