# 004 – Dashboard: Aufgaben

> Status: umgesetzt. 44 Tests (`npm test` in `dashboard/`), inkl. `axe-core` für fünf Zustände. Gegenprobe: Mit echtem `disabled` statt `aria-disabled` scheitern die beiden Fokus-Tests (AK-3.6); ein Knopf ohne Namen lässt axe mit `button-name` scheitern. Offen ist nur die Handprüfung (T8), die nicht automatisierbar ist.

- [x] **T1** `dashboard/` mit Angular CLI 21 anlegen (Standalone, Vitest), `lang="de-CH"`, `proxy.conf.json`. Root: `dashboard/**` aus `vitest.config*.ts` und `tsconfig.json` ausschliessen und prüfen, dass `npm test`, `npm run test:db` und `tsc` im Root es nicht anfassen. → AK-5.8, AK-6.1, AK-6.2
- [x] **T2** `format.ts` mit Unit-Tests: Tausendertrennzeichen (gegen `Intl` geprüft, AK-1.3), Datum Europe/Zurich (auch bei Sommerzeit-Wechsel), Dauer, Statustexte. → AK-1.2, AK-1.3, AK-2.1
- [x] **T3** `sync-api.service.ts` mit `HttpTestingController`: 202, 409, 500, Netzwerkfehler. → AK-3.2–3.4
- [x] **T4** `runs.store.ts` mit Fake-Timern: 3 s/30 s, keine parallele Anfrage, veraltete Antwort verworfen, Tab unsichtbar/sichtbar, Ankündigung nur bei `running` → Endstatus. → AK-4.1–4.4, AK-5.3
- [x] **T5** `status-badge`, `run-row` (Aufklappen, gescheiterte Seiten, Fortschritt), `runs-page` (Knopf mit `aria-disabled`, Klick-Sperre, Fokus bleibt, Zustände und Grund, Live-Region, Fehler mit «Erneut versuchen», leerer Zustand, Stand-Anzeige). → AK-1.1, AK-1.2, AK-1.4–1.6, AK-2.1–2.3, AK-3.1–3.6, AK-5.1–5.5
- [x] **T6** CSS: Farben für hell/dunkel, Kontraste mit `scripts/contrast.mjs` gemessen (42 Paare, alle AA; Tabelle im README), sichtbarer Fokus, `prefers-reduced-motion`. → AK-5.6, AK-5.7
- [x] **T7** `axe-core` in den Komponententests für die Zustände geladen, leer, Fehler, laufend, aufgeklappt. → AK-5.9
- [ ] **T8** Handprüfung mit Checkliste im README: nur Tastatur, NVDA unter Windows, 200 % Zoom, dunkles Farbschema. → AK-5.1, AK-5.3, AK-5.6
- [x] **T9** README des Dashboards: Start mit Proxy, Tests, Barrierefreiheits-Checkliste.
