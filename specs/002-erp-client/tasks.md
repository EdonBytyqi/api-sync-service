# 002 – ERP-Client: Aufgaben

> Status: Spec zur Review. Noch kein Code.

- [ ] **T1** `src/erp/erp-config.ts`: `loadErpConfig(env)` mit Standardwerten und Validierung, Unit-Tests. → AK-8.1, AK-8.2
- [ ] **T2** `src/erp/erp-error.ts`: `ErpError` mit `reason`, `retryable`, `attempts`, `status`, `retryAfterMs`, `cause`. → AK-3.5, AK-4.5, AK-5.1, AK-5.3
- [ ] **T3** `src/erp/retry-policy.ts` mit Unit-Tests ohne HTTP:
  - `classify`: Tabelle aus dem Design als `it.each`. → AK-3.1, AK-5.1, AK-5.2
  - `backoffDelay`: Obergrenzen, Deckel bei `maxDelayMs`, `random` 0 / 0.5 / 0.999. → AK-3.2–3.4
  - `parseRetryAfter`: Sekunden, HTTP-Datum mit festem `now`, Datum in der Vergangenheit, fehlend, ungültig. → AK-4.1–4.3
- [ ] **T4** `src/erp/erp-client.ts` mit Unit-Tests über `fetch`-, `sleep`-, `random`- und `now`-Attrappen:
  - Erfolg, Request-Form, ungültige Argumente, ungültige Antworten. → AK-1.1–1.4
  - Timeout mit hängender `fetch`-Attrappe und `timeoutMs: 20`, auch beim Body. → AK-2.1–2.3
  - Retry-Folgen mit exakten Wartezeiten, `maxAttempts`, kein Warten nach dem letzten Versuch, Log pro Retry. → AK-3.3, AK-3.5–3.7, AK-7.2
  - 429/503 mit `Retry-After`, Zählung, Obergrenze. → AK-4.1–4.6
  - 4xx ohne Retry. → AK-5.1–5.3
  - Abbruch während Versuch, während Pause, vor dem Aufruf. → AK-6.1, AK-6.2
- [ ] **T5** `src/erp/erp.module.ts`: Nest-Provider, Konfiguration beim Start laden, bei Fehler Start abbrechen. → AK-7.1, AK-8.2
- [ ] **T6** Integrationstests `test/erp-client.e2e-spec.ts` gegen das echte Mock-ERP: `mock-erp/server.js` pro Szenario als Kindprozess auf freiem Port starten, mit Raten 0 bzw. 1. → AK-2.4, AK-9.1–9.4
  - Kein Import aus `mock-erp/`, nur HTTP: Das Mock bleibt ein externes System.
  - Kleine Werte (`SLOW_MS=200`, `timeoutMs=50`), damit die Tests schnell bleiben. AK-9.3 nutzt das echte `Retry-After: 2` mit `maxAttempts: 2` (rund 2 s).
- [ ] **T7** README: Konfiguration des ERP-Clients und Verhalten bei Fehlern.
