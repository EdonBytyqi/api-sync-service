# Dashboard

Angular 21 dashboard for the sync runs (spec: [`specs/004-dashboard`](../specs/004-dashboard/requirements.md)). It only talks to the service's API under `/api/…`.

```bash
npm install
npm start      # http://localhost:4200, proxies /api → http://localhost:3000 (proxy.conf.json)
npm test       # Vitest + jsdom, incl. axe-core checks
npm run build  # production build into dist/dashboard/browser
```

The service must run on `:3000` (see the root README), or use `docker compose up` for everything.

## Accessibility (WCAG 2.2 AA)

- Status as text and icon, never colour alone. Icons are `aria-hidden`.
- "Jetzt synchronisieren" is locked with `aria-disabled="true"` and a click guard, **never** `disabled`: a disabled button drops focus to `<body>`, and a screen-reader user loses their place exactly while waiting for feedback. The reason for the lock is linked via `aria-describedby`.
- One polite live region announces only what the user needs to know: started, already running, a run finished. Polling itself is silent. Errors use `role="alert"`.
- Expanding a run is a `<button>` with `aria-expanded` and `aria-controls`. The details row is always rendered and toggled with `hidden`, so `aria-controls` never points nowhere.
- One `<tbody>` per run keeps the table semantics intact. There is a `<caption>`, `scope="col"`, `<time datetime>`, and `<progress>` with a label ("Seite 37 von 100").
- The scrollable table region is focusable (`tabindex="0"`) and labelled, so keyboard users can scroll it.
- `prefers-reduced-motion` turns off animations, and `lang="de-CH"`.

### Contrast

`node scripts/contrast.mjs` checks every colour pair in `src/styles.css` against WCAG 2.2: text 4.5:1, focus ring and borders 3:1, in light and dark mode. All 42 pairs pass. Lowest values:

| Pair                                      | Light  | Dark   |
| ----------------------------------------- | ------ | ------ |
| Body text / background                    | 16.9:1 | 15.3:1 |
| Weakest status text (failed on highlight) | 5.9:1  | 5.4:1  |
| Locked button text                        | 6.0:1  | 8.6:1  |
| Focus ring / background                   | 6.7:1  | 8.9:1  |
| Table borders / background                | 3.1:1  | 3.9:1  |

The axe tests skip `color-contrast`, because jsdom does not compute styles. The script covers contrast instead.

### Manual check (not automatable)

Before a release, with the service running:

- [ ] Keyboard only: Tab reaches the sync button, every "Details zu Lauf #…" button and "Erneut versuchen", in that order. The focus ring is always visible.
- [ ] Press the sync button with Enter, then Space: focus stays on the button while it shows "Wird gestartet …" and afterwards.
- [ ] NVDA + Firefox/Chrome on Windows: the locked button reads as "nicht verfügbar" with its reason, "Lauf #… gestartet" is announced once, the end of a run is announced once, and polling is silent.
- [ ] 200 % zoom: no content is cut off, the table scrolls horizontally inside its region.
- [ ] Dark mode (OS setting): all text readable, the status colours are distinguishable.
