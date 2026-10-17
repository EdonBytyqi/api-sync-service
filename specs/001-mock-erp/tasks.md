# 001 – Mock-ERP: Aufgaben

> Hinweis: Eine erste Implementierung (Commit `3fddd30`) entstand vor dieser Spec. Die Spec wurde danach geschrieben und gegen den Code geprüft. Dabei kamen zwei Lücken ans Licht: fehlende Validierung der Konfiguration (T6) und fehlende automatische Tests (T7). Beide sind jetzt erledigt.

- [x] **T1** `mock-erp/` als eigenes Paket mit Express anlegen, Port aus `PORT` (Standard 4000). → AK-6.1, AK-6.5
- [x] **T2** 10'000 Produkte deterministisch erzeugen, Preise in Rappen. → AK-1.4, AK-2.1
- [x] **T3** `GET /products` mit Paginierung, Standardwerten und Antwortformat. → AK-1.1–1.6, AK-2.2
- [x] **T4** `page` und `pageSize` validieren, 400 vor jeder Simulation. → AK-1.7
- [x] **T5** Verzögerung, 500 und 429 mit `Retry-After` über `SLOW_RATE`, `FAILURE_RATE`, `RATE_LIMIT_RATE`. → AK-3.1, AK-4.1–4.2, AK-5.1, AK-5.3, AK-6.2–6.3
- [x] **T6** Konfiguration beim Start validieren. → AK-6.4
  - `config.js` mit `loadConfig(env)`: Raten in [0, 1], `SLOW_MS` ≥ 0 ganzzahlig, `PORT` 1–65535, `FAILURE_RATE + RATE_LIMIT_RATE <= 1`.
  - Alle Fehler gesammelt in einer Meldung, `server.js` beendet sich mit Exit-Code 1.
- [x] **T7** Automatische Tests mit Vitest und Supertest (`npm test` in `mock-erp/`, 54 Tests).
  - Code aufgeteilt: `createApp(config, { random, sleep })` in `app.js`, `listen` nur in `server.js`.
  - Raten-Logik als reine Funktion `rollChaos(config, random)`.
  - `test/products.test.js`: Paginierung, Form, Randfälle, 400er ohne Zufall/Verzögerung. → AK-1.x, AK-2.x
  - `test/chaos.test.js`: einzelne Anfragen mit fester Zufallsfolge (500, 429, langsam, langsam + Fehler), exakte Raten mit 1'000 gleichverteilten Werten, Grenzwerte, Raten 0 und 1. → AK-3.x, AK-4.x, AK-5.x, AK-6.2–6.3
  - `test/config.test.js`: Standardwerte, ungültige Werte, Summe > 1, Start von `server.js` mit `FAILURE_RATE=abc` endet mit Exit-Code 1. → AK-6.1, AK-6.4
  - Gegenprobe: drei absichtlich eingebaute Fehler (überlappende Raten, Chaos vor Validierung, keine Konfig-Prüfung) lassen jeweils Tests fehlschlagen.
- [x] **T8** README: Start, Tests, Umgebungsvariablen und Validierung dokumentieren.
- [ ] **T9** AK-6.5 (Startmeldung) automatisch testen. Bisher nur manuell geprüft.
- [x] **T10** `mock-erp/**` in `vitest.config.ts` und `vitest.config.e2e.ts` im Root ausschliessen, mit `...configDefaults.exclude`.
- [ ] **T11** CI mit zwei Schritten: `npm test` im Root, `npm test` in `mock-erp/`. (Kommt mit der CI-Spec.)
