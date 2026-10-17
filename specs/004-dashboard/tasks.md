# 004 – Dashboard: Aufgaben

> Status: Spec zur Review. Noch kein Code.

- [ ] **T1** `dashboard/` mit Angular CLI 21 anlegen (Standalone, Vitest), `lang="de-CH"`, `proxy.conf.json`. Root: `dashboard/**` aus `vitest.config*.ts` und `tsconfig.json` ausschliessen und prüfen, dass `npm test`, `npm run test:db` und `tsc` im Root es nicht anfassen. → AK-5.8, AK-6.1, AK-6.2
- [ ] **T2** `format.ts` mit Unit-Tests: `10’000`, Datum Europe/Zurich (auch bei Sommerzeit-Wechsel), Dauer, Statustexte. → AK-1.2, AK-1.3, AK-2.1
- [ ] **T3** `sync-api.service.ts` mit `HttpTestingController`: 202, 409, 500, Netzwerkfehler. → AK-3.2–3.4
- [ ] **T4** `runs.store.ts` mit Fake-Timern: 3 s/30 s, keine parallele Anfrage, veraltete Antwort verworfen, Tab unsichtbar/sichtbar, Ankündigung nur bei `running` → Endstatus. → AK-4.1–4.4, AK-5.3
- [ ] **T5** `status-badge`, `run-row` (Aufklappen, gescheiterte Seiten, Fortschritt), `runs-page` (Knopf mit Zuständen und Grund, Live-Region, Fehler mit «Erneut versuchen», leerer Zustand, Stand-Anzeige). → AK-1.1, AK-1.2, AK-1.4–1.6, AK-2.1–2.3, AK-3.1–3.5, AK-5.1–5.5
- [ ] **T6** CSS: Farben für hell/dunkel mit gemessenen Kontrasten (Tabelle im README), sichtbarer Fokus, `prefers-reduced-motion`. → AK-5.6, AK-5.7
- [ ] **T7** `axe-core` in den Komponententests für die Zustände geladen, leer, Fehler, laufend, aufgeklappt. → AK-5.9
- [ ] **T8** Handprüfung mit Checkliste im README: nur Tastatur, NVDA unter Windows, 200 % Zoom, dunkles Farbschema. → AK-5.1, AK-5.3, AK-5.6
- [ ] **T9** README des Dashboards: Start mit Proxy, Tests, Barrierefreiheits-Checkliste.
