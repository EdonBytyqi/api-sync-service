# 001 – Mock-ERP: Aufgaben

> Hinweis: Eine erste Implementierung (Commit `3fddd30`) entstand vor dieser Spec. Die Spec wurde danach geschrieben und gegen den Code geprüft. Dabei kam eine Lücke ans Licht (T6). Erledigte Aufgaben sind manuell mit `curl` geprüft, automatische Tests fehlen noch (T7).

- [x] **T1** `mock-erp/` als eigenes Paket mit Express anlegen, Port aus `PORT` (Standard 4000). → AK-6.1, AK-6.5
- [x] **T2** 10'000 Produkte deterministisch erzeugen, Preise in Rappen. → AK-1.4, AK-2.1
- [x] **T3** `GET /products` mit Paginierung, Standardwerten und Antwortformat. → AK-1.1–1.6, AK-2.2
- [x] **T4** `page` und `pageSize` validieren, 400 vor jeder Simulation. → AK-1.7
- [x] **T5** Verzögerung, 500 und 429 mit `Retry-After` über `SLOW_RATE`, `FAILURE_RATE`, `RATE_LIMIT_RATE`. → AK-3.1, AK-4.1–4.2, AK-5.1, AK-5.3, AK-6.2–6.3
- [ ] **T6** Raten beim Start validieren: Zahl zwischen 0 und 1, `FAILURE_RATE + RATE_LIMIT_RATE <= 1`, sonst Abbruch mit Name der Variable. → AK-6.4
- [ ] **T7** Automatische Tests mit Vitest und Supertest:
  - Raten 0: Paginierung, Form, Randfälle, 400er. → AK-1.x, AK-2.x, AK-6.2
  - Rate 1 pro Verhalten: 500, 429 mit Header, Verzögerung (mit kleinem `SLOW_MS`). → AK-3.1, AK-4.1, AK-5.1, AK-6.3
  - Statistik über 1'000 Anfragen. → AK-3.2, AK-4.3, AK-5.2
  - Dafür `app` aus `server.js` exportieren und `listen` nur beim direkten Start aufrufen.
- [ ] **T8** `npm run start:stable` und Umgebungsvariablen im README dokumentieren (teilweise erledigt).
