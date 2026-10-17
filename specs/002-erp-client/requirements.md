# 002 – ERP-Client: Anforderungen

## Ziel

Der Teil von `api-sync-service`, der genau **eine Seite** Produkte vom ERP holt (`GET /products?page&pageSize`) und dabei mit dessen Unzuverlässigkeit umgeht: Timeouts, Serverfehler, Rate Limits. Nach aussen ist es ein Methodenaufruf `fetchPage(page, pageSize)`: Er liefert entweder eine gültige Seite oder einen klar typisierten Fehler. Gegenüber im Test ist das Mock-ERP aus Spec 001.

## Nicht im Umfang

- Alle Seiten durchlaufen, Produkte speichern, Sync planen: Das ist Spec 003 (Sync-Job). Der Client kennt nur eine Seite.
- Circuit Breaker, client-seitige Drosselung paralleler Anfragen, Caching, Authentifizierung.

## Begriffe

- **Versuch:** ein einzelner HTTP-Request. Ein Aufruf von `fetchPage` besteht aus 1 bis `maxAttempts` Versuchen.
- **Retrybarer Fehler:** Ein Fehler, bei dem derselbe Request später gelingen kann (Timeout, Netzwerkfehler, 5xx, 408, 429).
- **Endgültiger Fehler:** Ein Fehler, bei dem derselbe Request wieder genauso scheitert (400 und übrige 4xx, ungültige Antwort).

## Anforderung 1 – Seite abrufen

Als Sync-Job möchte ich eine Seite mit einem Aufruf holen, damit ich mich nicht um HTTP-Details kümmern muss.

- **AK-1.1** Wenn `fetchPage(37, 100)` aufgerufen wird und das ERP beim ersten Versuch mit 200 antwortet, dann liefert der Client `{ items, page: 37, pageSize: 100, total }` nach genau einem Versuch und ohne zu warten.
- **AK-1.2** Wenn `fetchPage(37, 100)` aufgerufen wird, dann sendet der Client `GET <ERP_BASE_URL>/products?page=37&pageSize=100` mit dem Header `Accept: application/json`.
- **AK-1.3** Wenn die Antwort 200 ist und der Body **vollständig angekommen** ist, aber kein gültiges JSON ist oder nicht dem Schema entspricht (z. B. `items` fehlt, `priceCents` keine nicht-negative Ganzzahl, `updatedAt` kein ISO-Zeitstempel), dann wirft der Client einen `ErpError` mit `reason: 'invalidResponse'`, ohne Retry.
- **AK-1.4** Wenn die Verbindung abbricht, während der Body gelesen wird, dann ist das ein Netzwerkfehler (`reason: 'network'`) und wird nach AK-3.1 wiederholt, nicht als `invalidResponse` behandelt.
- **AK-1.5** Wenn `page` oder `pageSize` in der Antwort nicht den angefragten Werten entsprechen (z. B. Seite 36 statt 37) oder `items` mehr als `pageSize` Einträge hat, dann wirft der Client einen `ErpError` mit `reason: 'invalidResponse'`, ohne Retry, auch wenn das Schema sonst gültig ist.
- **AK-1.6** Wenn `page` oder `pageSize` keine positive Ganzzahl ist oder `pageSize` grösser als 1000 ist, dann wirft der Client einen `ErpError` mit `reason: 'invalidArgument'`, ohne einen Request zu senden.

## Anforderung 2 – Timeout pro Versuch

Als Sync-Job möchte ich, dass ein hängender Request abgebrochen wird, damit ein langsames ERP den Sync nicht blockiert.

- **AK-2.1** Wenn ein Versuch nach `timeoutMs` (Standard 2000) noch keine vollständige Antwort hat, dann bricht der Client den Request ab und behandelt das als retrybaren Fehler `timeout`.
- **AK-2.2** Wenn ein Versuch wiederholt wird, dann hat der neue Versuch wieder die vollen `timeoutMs`. Der Timeout gilt pro Versuch, nicht für den ganzen Aufruf.
- **AK-2.3** Wenn die Header rechtzeitig kommen, der Body aber nicht innerhalb von `timeoutMs` ab Versuchsbeginn fertig gelesen ist, dann gilt das ebenfalls als `timeout`.
- **AK-2.4** Wenn das Mock-ERP eine Antwort um 5 Sekunden verzögert, dann bricht der Client mit der Standardkonfiguration nach 2 Sekunden ab und versucht es erneut.

## Anforderung 3 – Retry mit exponentiellem Backoff und Jitter

Als Sync-Job möchte ich, dass vorübergehende Fehler automatisch wiederholt werden, damit einzelne Ausfälle den Sync nicht abbrechen.

- **AK-3.1** Wenn ein Versuch mit `timeout`, einem Netzwerkfehler (z. B. Verbindung abgelehnt oder zurückgesetzt), 408, 500, 502, 503 oder 504 endet und noch Versuche übrig sind, dann versucht der Client es erneut.
- **AK-3.2** Wenn nach Versuch `n` (1, 2, …) erneut versucht wird, dann wartet der Client vorher `random() × min(maxDelayMs, baseDelayMs × 2^(n−1))` Millisekunden (Full Jitter). Mit den Standardwerten `baseDelayMs=200`, `maxDelayMs=5000` sind die Obergrenzen 200, 400, 800, 1600 ms.
- **AK-3.3** Wenn `random()` immer 0.5 liefert und vier Versuche mit 500 scheitern, dann wartet der Client nacheinander genau 100, 200, 400 und 800 ms.
- **AK-3.4** Wenn `baseDelayMs × 2^(n−1)` grösser als `maxDelayMs` ist, dann ist die Obergrenze `maxDelayMs`.
- **AK-3.5** Wenn alle `maxAttempts` Versuche (Standard 5, inklusive des ersten) retrybar scheitern, dann wirft der Client einen `ErpError` mit dem Grund des letzten Versuchs, `attempts: 5` und `retryable: true`. Nach dem letzten Versuch wartet er nicht mehr.
- **AK-3.6** Wenn ein späterer Versuch gelingt, dann liefert der Client die Seite, als wäre nichts gewesen.
- **AK-3.7** Wenn der Client erneut versucht, dann loggt er eine Warnung mit `page`, Versuchsnummer, Grund und Wartezeit.

## Anforderung 4 – 429 und Retry-After respektieren

Als Sync-Job möchte ich die Vorgabe des ERP zum Warten einhalten, damit wir nicht gesperrt werden und das ERP nicht zusätzlich belasten.

- **AK-4.1** Wenn das ERP mit 429 und `Retry-After: 2` antwortet, dann wartet der Client genau 2000 ms statt des Backoffs und versucht es dann erneut.
- **AK-4.2** Wenn `Retry-After` ein HTTP-Datum im Format IMF-fixdate ist (z. B. `Wed, 21 Oct 2026 07:28:00 GMT`), dann wartet der Client bis zu diesem Zeitpunkt, gemessen mit `now()`. Liegt das Datum in der Vergangenheit, dann wartet er 0 ms.
- **AK-4.3** Wenn bei 429 der Header `Retry-After` fehlt oder ungültig ist (z. B. `abc`, `-1`, `1.5`, `5s`), dann wartet der Client den normalen Backoff aus AK-3.2.
- **AK-4.4** Wenn ein Versuch mit 429 endet, dann zählt er wie jeder andere Versuch gegen `maxAttempts`.
- **AK-4.5** Wenn `Retry-After` länger als `maxRetryAfterMs` (Standard 30000) ist, dann wartet der Client nicht, sondern wirft sofort einen `ErpError` mit `reason: 'rateLimited'`, `retryable: true` und `retryAfterMs`, damit der Aufrufer selbst planen kann.
- **AK-4.6** Wenn das ERP mit 503 und einem gültigen `Retry-After` antwortet, dann gelten AK-4.1 bis AK-4.5 genauso.
- **AK-4.7** Wenn der **letzte** Versuch mit 429 oder 503 und einem gültigen `Retry-After` endet, dann enthält der `ErpError` neben `reason: 'http'` und `status` auch `retryAfterMs`, damit der Aufrufer weiss, wann er die Seite frühestens erneut anfragen darf. Ohne gültigen Header fehlt `retryAfterMs`.

## Anforderung 5 – Kein Retry bei Client-Fehlern

Als Entwickler möchte ich, dass fehlerhafte Requests sofort scheitern, damit ein Programmierfehler schnell und deutlich sichtbar wird.

- **AK-5.1** Wenn das ERP mit 400 antwortet, dann wirft der Client sofort einen `ErpError` mit `reason: 'http'`, `status: 400`, `attempts: 1` und `retryable: false`, ohne zu warten.
- **AK-5.2** Wenn das ERP mit einem anderen 4xx-Status ausser 408 und 429 antwortet (z. B. 401, 403, 404, 422), dann gilt AK-5.1 genauso.
- **AK-5.3** Wenn der Client einen endgültigen Fehler wirft, dann enthält die Meldung den Status und, falls vorhanden, das Feld `error` aus dem Antwort-Body.

## Anforderung 6 – Abbruch durch den Aufrufer

Als Sync-Job möchte ich einen laufenden Abruf abbrechen können, damit der Service sauber herunterfährt.

- **AK-6.1** Wenn das übergebene `AbortSignal` ausgelöst wird, während ein Versuch läuft oder der Client zwischen zwei Versuchen wartet, dann bricht der Client sofort ab, wirft einen `ErpError` mit `reason: 'aborted'` und startet keinen weiteren Versuch.
- **AK-6.2** Wenn das Signal schon vor dem Aufruf ausgelöst ist, dann sendet der Client keinen Request.

## Anforderung 7 – Testbarkeit durch Injektion

Als Entwickler möchte ich Zufall, Zeit und Netzwerk im Test kontrollieren, damit Retry-Tests schnell und deterministisch sind.

- **AK-7.1** Wenn der Client erzeugt wird, dann können `fetch`, `sleep`, `random` und `now` übergeben werden. Standard sind `globalThis.fetch`, ein abbrechbares `setTimeout`-Sleep, `Math.random` und `Date.now`.
- **AK-7.2** Wenn ein Test eine `fetch`-Attrappe mit den Antworten 500, 500, 200, `random = () => 0.5` und eine `sleep`-Attrappe übergibt, dann liefert der Client die Seite, die `sleep`-Attrappe erhält genau `[100, 200]`, und der Test wartet nicht real.
- **AK-7.3** Der Client ruft `Math.random`, `Date.now` und `setTimeout` für Wartezeiten nie direkt auf, nur über die injizierten Funktionen.

## Anforderung 8 – Konfiguration

- **AK-8.1** Wenn keine Umgebungsvariablen gesetzt sind, dann gelten `ERP_BASE_URL=http://localhost:4000`, `ERP_TIMEOUT_MS=2000`, `ERP_MAX_ATTEMPTS=5`, `ERP_BASE_DELAY_MS=200`, `ERP_MAX_DELAY_MS=5000` und `ERP_MAX_RETRY_AFTER_MS=30000`.
- **AK-8.2** Wenn ein Wert ungültig ist (keine gültige `http(s)`-URL, keine positive Ganzzahl, `ERP_MAX_DELAY_MS < ERP_BASE_DELAY_MS`), dann startet der Service nicht und nennt jede ungültige Variable, wie in Spec 001 AK-6.4.

## Anforderung 9 – Zusammenspiel mit dem echten Mock-ERP

- **AK-9.1** Wenn das Mock-ERP mit allen Raten 0 läuft, dann liefert `fetchPage(37, 100)` die Produkte 3601 bis 3700 nach einem Versuch.
- **AK-9.2** Wenn das Mock-ERP mit `FAILURE_RATE=1` läuft, dann wirft der Client nach `maxAttempts` Versuchen einen `ErpError` mit `status: 500`.
- **AK-9.3** Wenn das Mock-ERP mit `RATE_LIMIT_RATE=1` läuft, dann wartet der Client zwischen den Versuchen jeweils 2000 ms (laut `Retry-After`) und wirft danach einen `ErpError` mit `status: 429`.
- **AK-9.4** Wenn das Mock-ERP mit `SLOW_RATE=1` und `SLOW_MS` grösser als `timeoutMs` läuft, dann endet jeder Versuch mit `timeout`.

## Anforderung 10 – Begrenzte Dauer

Als Sync-Job (Spec 003) möchte ich wissen, wie lange ein `fetchPage` höchstens dauert, damit ich Läufe planen und Überschneidungen ausschliessen kann.

- **AK-10.1** Wenn `fetchPage` aufgerufen wird, dann endet der Aufruf spätestens nach `maxAttempts × timeoutMs + (maxAttempts − 1) × max(maxDelayMs, maxRetryAfterMs)`, mit den Standardwerten 5 × 2 s + 4 × 30 s = **130 s**.
- **AK-10.2** Der Client bietet diese Obergrenze als `ErpClient.maxDurationMs(config)` an, damit Spec 003 sie nicht selbst nachrechnen muss.
