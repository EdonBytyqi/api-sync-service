# 002 – ERP-Client: Aufgaben

> Status: umgesetzt. Spec vor dem Code reviewt; Änderungen aus der Review: Netzwerkfehler beim Lesen des Body ≠ ungültige Antwort (AK-1.3, AK-1.4), Antwort muss zur Anfrage passen (AK-1.5), Höchstdauer 130 s statt 18 s (AK-10).
>
> Tests: 124 Unit-Tests (`npm test`), 6 Integrationstests gegen das echte Mock-ERP (`npm run test:e2e`, rund 5 s). Gegenprobe: sechs absichtlich eingebaute Fehler (kaputter Body wird wiederholt, abgebrochener Body gilt als `invalidResponse`, keine Seitenprüfung, Retry bei 400, `Retry-After` ignoriert, 429 zählt nicht) lassen jeweils Tests fehlschlagen.

- [x] **T1** `src/erp/erp-config.ts`: `loadErpConfig(env)` mit Standardwerten und Validierung, Unit-Tests. → AK-8.1, AK-8.2
- [x] **T2** `src/erp/erp-error.ts`: `ErpError` mit `reason`, `retryable`, `attempts`, `status`, `retryAfterMs`, `cause`. → AK-3.5, AK-4.5, AK-5.1, AK-5.3
- [x] **T3** `src/erp/retry-policy.ts` mit Unit-Tests ohne HTTP:
  - `classify`: Tabelle aus dem Design als `it.each`. → AK-3.1, AK-5.1, AK-5.2
  - `backoffDelay`: Obergrenzen, Deckel bei `maxDelayMs`, `random` 0 / 0.5 / 1. → AK-3.2–3.4
  - `parseRetryAfter`: Sekunden, HTTP-Datum mit festem `now`, Datum in der Vergangenheit, fehlend, ungültig (auch `-1`, ISO, RFC 850). → AK-4.1–4.3
- [x] **T4** `src/erp/erp-client.ts` mit Unit-Tests über `fetch`-, `sleep`-, `random`- und `now`-Attrappen:
  - Erfolg, Request-Form, ungültige Argumente, ungültige Antworten, falsche Seite. → AK-1.1–1.3, AK-1.5, AK-1.6
  - Echter `node:http`-Server (`erp-client.http.spec.ts`): Verbindungsabbruch mitten im Body wird wiederholt, vollständiger aber kaputter Body nicht. → AK-1.3, AK-1.4
  - `maxDurationMs`. → AK-10.1, AK-10.2
  - Timeout mit hängender `fetch`-Attrappe und `timeoutMs: 20`, auch beim Body. → AK-2.1–2.3
  - Retry-Folgen mit exakten Wartezeiten, `maxAttempts`, kein Warten nach dem letzten Versuch, Log pro Retry. → AK-3.3, AK-3.5–3.7, AK-7.2
  - 429/503 mit `Retry-After`, Zählung, Obergrenze. → AK-4.1–4.6
  - 4xx ohne Retry. → AK-5.1–5.3
  - Abbruch während Versuch, während Pause, vor dem Aufruf; Timeout ≠ Abbruch. → AK-6.1, AK-6.2
  - `Math.random`, `Date.now`, `setTimeout` werden mit Injektion nicht aufgerufen. → AK-7.3
- [x] **T5** `src/erp/erp.module.ts`: Nest-Provider, Konfiguration beim Start laden, bei Fehler Start abbrechen; in `AppModule` eingebunden. → AK-7.1, AK-8.2
- [x] **T6** Integrationstests `test/erp-client.e2e-spec.ts` gegen das echte Mock-ERP: `mock-erp/server.js` pro Szenario als Kindprozess auf freiem Port, mit Raten 0 bzw. 1. → AK-2.4, AK-5.1, AK-9.1–9.4
  - Kein Import aus `mock-erp/`, nur HTTP: Das Mock bleibt ein externes System.
  - Kleine Werte (`SLOW_MS=500`, `timeoutMs=50`), damit die Tests schnell bleiben. AK-9.3 nutzt das echte `Retry-After: 2` mit `maxAttempts: 2` (rund 2 s), AK-2.4 die echten Standardwerte (rund 2 s).
  - AK-5.1 mit einem echten 400 des Mocks: Eine `fetch`-Hülle verfälscht die URL zu `page=1e2`, weil der Client selbst nie ungültige Parameter sendet.
- [x] **T7** README: Konfiguration des ERP-Clients, Verhalten bei Fehlern, Tests.
- [ ] **T8** CI muss vor `npm run test:e2e` auch `npm install` in `mock-erp/` ausführen (zu Spec 001 T11).
- [x] **T9** Review-Befund: Endete der letzte Versuch mit 429 + `Retry-After`, ging `retryAfterMs` verloren. Jetzt trägt der `ErpError` den Wert, sobald der letzte Versuch einen gültigen Header hatte; `retryAfterOf` als reine Funktion. 7 neue Tests. → AK-4.7
- [x] **T10** Review-Befund: `priceCents >= 0` im Client vs. `> 0` im Mock als Entscheidung dokumentiert (Design). → AK-1.3
