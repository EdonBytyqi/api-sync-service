# 004 – Dashboard: Anforderungen

## Ziel

Eine kleine Angular-Oberfläche für den Betrieb: Sie zeigt die letzten Sync-Läufe mit Status, Zählern und gescheiterten Seiten und startet mit «Jetzt synchronisieren» einen Lauf. Sie spricht nur mit der bestehenden API aus Spec 003 (`POST /sync`, `GET /sync/runs`, `GET /sync/runs/:id`) und ist ohne Maus und mit Screenreader vollständig bedienbar.

## Nicht im Umfang

- Anmeldung und Rollen. Wie in Spec 003 (T14) vor produktivem Einsatz nötig: Der Knopf erzeugt Last auf dem ERP.
- Produktliste, Suche, Bearbeiten von Produkten; Diagramme; Push-Updates (WebSocket/SSE). Aktualisiert wird per Polling.
- Mehrsprachigkeit: Die Oberfläche ist deutsch (`de-CH`).

## Anforderung 1 – Liste der Läufe

- **AK-1.1** Wenn das Dashboard geladen wird, dann zeigt es die 20 neuesten Läufe aus `GET /sync/runs?limit=20` als Tabelle, neueste zuerst.
- **AK-1.2** Wenn ein Lauf angezeigt wird, dann zeigt seine Zeile: Nummer, Auslöser (`Zeitplan`/`Manuell`), Status, Start (Datum und Uhrzeit in Europe/Zurich), Dauer, Seiten `ok / total`, und die Zähler `neu`, `geändert`, `unverändert`, `reaktiviert`, `deaktiviert`.
- **AK-1.3** Wenn Zahlen angezeigt werden, dann im Schweizer Format mit Apostroph als Tausendertrennzeichen, so wie `Intl.NumberFormat('de-CH')` es liefert. Ob das ein gerades (`10'000`) oder typografisches Apostroph (`10’000`) ist, hängt von der ICU-Version ab (Node 22 liefert das gerade); Tests vergleichen deshalb mit `Intl`, nicht mit einem festen Zeichen.
- **AK-1.4** Wenn ein Lauf noch `running` ist, dann zeigt er statt der Dauer «läuft seit …» und einen Fortschrittsbalken `pagesOk / pagesTotal`; ist `pagesTotal` noch unbekannt, dann «wird vorbereitet».
- **AK-1.5** Wenn noch kein Lauf existiert, dann zeigt das Dashboard «Noch keine Läufe» statt einer leeren Tabelle.
- **AK-1.6** Wenn die API nicht erreichbar ist oder einen Fehler liefert, dann zeigt das Dashboard eine Fehlermeldung mit «Erneut versuchen»; bereits angezeigte Läufe bleiben stehen und sind als «Stand: <Uhrzeit>» gekennzeichnet.

## Anforderung 2 – Status

- **AK-2.1** Wenn ein Status angezeigt wird, dann als Text **und** Symbol, nie nur als Farbe: `läuft`, `abgeschlossen`, `teilweise`, `fehlgeschlagen`.
- **AK-2.2** Wenn ein Lauf `partial` oder `failed` ist, dann ist der Text aus `error` in der Zeile sichtbar (gekürzt auf eine Zeile, vollständig in den Details).
- **AK-2.3** Wenn ein Lauf aufgeklappt wird, dann zeigen die Details die gescheiterten Seiten als Liste: Seite, Grund, HTTP-Status, Versuche, `Retry-After` (falls vorhanden) und Meldung. Ohne gescheiterte Seiten: «Keine gescheiterten Seiten».

## Anforderung 3 – «Jetzt synchronisieren»

- **AK-3.1** Wenn der Knopf gedrückt wird, dann sendet das Dashboard `POST /sync`, und der Knopf ist bis zur Antwort deaktiviert und zeigt «Wird gestartet …».
- **AK-3.2** Wenn die Antwort 202 ist, dann meldet das Dashboard «Lauf #<id> gestartet», lädt die Liste sofort neu und zeigt den neuen Lauf oben.
- **AK-3.3** Wenn die Antwort 409 ist, dann meldet das Dashboard «Lauf #<runningRunId> läuft bereits» und hebt diesen Lauf hervor. Das ist kein Fehler, sondern ein normaler Zustand.
- **AK-3.4** Wenn die Antwort ein anderer Fehler ist oder das Netzwerk fehlt, dann meldet das Dashboard «Lauf konnte nicht gestartet werden» mit dem Grund, und der Knopf ist wieder aktiv.
- **AK-3.5** Wenn laut Liste ein Lauf `running` ist, dann ist der Knopf deaktiviert, mit sichtbarem Grund («Lauf #<id> läuft»). Die API bleibt trotzdem die Quelle der Wahrheit (AK-3.3), weil ein anderer Nutzer oder der Zeitplan gleichzeitig starten kann.

## Anforderung 4 – Aktualisierung

- **AK-4.1** Wenn ein Lauf `running` ist, dann lädt das Dashboard die Liste alle 3 Sekunden neu, sonst alle 30 Sekunden.
- **AK-4.2** Wenn der Browser-Tab nicht sichtbar ist, dann pausiert das Polling; wird er wieder sichtbar, dann lädt das Dashboard sofort neu.
- **AK-4.3** Wenn eine Anfrage noch läuft, dann startet das Polling keine zweite; Antworten kommen nie in falscher Reihenfolge an (die neueste Anfrage gewinnt).
- **AK-4.4** Wenn ein Lauf von `running` in einen Endstatus wechselt, dann wird das einmal angekündigt (Anforderung 5), nicht bei jedem Polling.

## Anforderung 5 – Barrierefreiheit

Ziel ist WCAG 2.2 Stufe AA.

- **AK-5.1** Wenn das Dashboard nur mit der Tastatur bedient wird, dann sind Knopf, «Erneut versuchen» und das Aufklappen jedes Laufs erreichbar und auslösbar, in sinnvoller Reihenfolge und mit sichtbarem Fokus.
- **AK-5.2** Wenn ein Lauf aufgeklappt werden kann, dann ist das ein `<button>` mit `aria-expanded` und `aria-controls`, kein klickbares `<tr>`.
- **AK-5.3** Wenn sich etwas ändert, das der Nutzer wissen muss (Lauf gestartet, läuft bereits, Lauf beendet mit Status), dann wird es über eine `aria-live="polite"`-Region angekündigt; Fehler über `role="alert"`. Das Polling selbst kündigt nichts an.
- **AK-5.4** Wenn die Tabelle gelesen wird, dann hat sie eine `<caption>`, Spaltenköpfe mit `scope="col"` und Zeitangaben als `<time datetime="…">`.
- **AK-5.5** Wenn der Fortschritt angezeigt wird, dann als `<progress>` bzw. `role="progressbar"` mit `aria-valuenow`, `aria-valuemax` und einer Beschriftung («Seite 37 von 100»).
- **AK-5.6** Wenn Texte und Status-Farben angezeigt werden, dann mit einem Kontrast von mindestens 4.5:1 (Text) bzw. 3:1 (Symbole, Fokusrahmen), in hellem und dunklem Farbschema.
- **AK-5.7** Wenn `prefers-reduced-motion` gesetzt ist, dann gibt es keine Animationen (Spinner, Balken).
- **AK-5.8** Wenn das Dokument geladen wird, dann hat es `lang="de-CH"`, einen Titel und genau eine `<h1>`.
- **AK-5.9** Wenn die automatische Prüfung mit `axe-core` über die gerenderten Zustände läuft (geladen, leer, Fehler, laufend, aufgeklappt), dann meldet sie keine Verstösse.

## Anforderung 6 – Betrieb und Abgrenzung

- **AK-6.1** Wenn das Dashboard die API anspricht, dann über den relativen Pfad `/api/…` (gleiche Herkunft, kein CORS). In der Entwicklung leitet ein Proxy `/api` an `http://localhost:3000` weiter, im Container nginx (Spec 005).
- **AK-6.2** Wenn `npm test` oder `npm run test:db` im Root läuft, dann werden keine Dateien aus `dashboard/` ausgeführt oder typgeprüft; das Dashboard hat wie `mock-erp/` eigene Abhängigkeiten und eigene Tests.
