import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';
import type { SyncRun } from './models';
import { RunsStore } from './runs.store';
import { expectNoA11yViolations, run, running } from './testing';

describe('Dashboard', () => {
  let fixture: ComponentFixture<App>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(App);
    el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el); // real focus handling for AK-3.6
  });

  afterEach(() => {
    TestBed.inject(RunsStore).stop();
    el.remove();
  });

  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const loadRuns = async (runs: SyncRun[]) => {
    await render();
    http.expectOne((r) => r.url === '/api/sync/runs').flush(runs);
    await render();
  };
  const syncButton = () =>
    [...el.querySelectorAll('button')].find((b) => /synchronisieren|gestartet/.test(b.textContent!))!;
  const liveRegion = () => el.querySelector('[aria-live="polite"]')!;
  const rows = () => [...el.querySelectorAll('tbody[app-run-row] > tr:first-child')];
  /** Text as a screen reader reads it: aria-hidden content (icons) left out. */
  const readable = (node: Element) => {
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    return copy.textContent!.replace(/\s+/g, ' ').trim();
  };
  const cells = (row: Element) => [...row.children].map(readable);

  describe('Anforderung 1 und 2 – Liste und Status', () => {
    it('AK-1.1 / AK-1.2 / AK-1.3 Tabelle mit allen Spalten im Schweizer Format', async () => {
      await loadRuns([run({ id: 2, productsUnchanged: 9_995, productsDeactivated: 5, productsInserted: 0 }), run({ id: 1 })]);

      expect(rows()).toHaveLength(2);
      const ten = new Intl.NumberFormat('de-CH').format(10_000);
      expect(cells(rows()[1])).toEqual([
        'Details zu Lauf #1',
        'Manuell',
        'abgeschlossen',
        '17.10.2026, 15:05:58',
        '49 s',
        '100 / 100',
        ten,
        '0',
        '0',
        '0',
        '0',
      ]);
      expect(cells(rows()[0])[8]).toBe(new Intl.NumberFormat('de-CH').format(9_995));
    });

    it('AK-1.4 laufender Lauf: «läuft seit», Fortschrittsbalken; ohne pagesTotal «wird vorbereitet»', async () => {
      await loadRuns([running({ id: 2 }), running({ id: 1, pagesTotal: null, pagesOk: 0 })]);

      const progress = rows()[0].querySelector('progress')!;
      expect(progress.value).toBe(37);
      expect(progress.max).toBe(100);
      expect(progress.getAttribute('aria-label')).toBe('Seite 37 von 100'); // AK-5.5
      expect(cells(rows()[0])[4]).toMatch(/^läuft seit /);
      expect(cells(rows()[1])[5]).toBe('wird vorbereitet');
    });

    it('AK-1.5 ohne Läufe: «Noch keine Läufe»', async () => {
      await loadRuns([]);

      expect(el.textContent).toContain('Noch keine Läufe.');
      expect(el.querySelector('table')).toBeNull();
    });

    it('AK-1.6 API-Fehler: Meldung mit «Erneut versuchen», alte Daten bleiben mit Stand', async () => {
      await loadRuns([run({ id: 3 })]);
      TestBed.inject(RunsStore).refresh();
      http
        .expectOne((r) => r.url === '/api/sync/runs')
        .flush({ message: 'down' }, { status: 503, statusText: 'Unavailable' });
      await render();

      const alert = el.querySelector('[role="alert"]')!;
      expect(alert.textContent).toContain('Die Läufe konnten nicht geladen werden (HTTP 503: down)');
      expect(alert.textContent).toMatch(/Angezeigt ist der Stand von \d{2}:\d{2}:\d{2}/);
      expect(rows()).toHaveLength(1);

      alert.querySelector('button')!.click();
      http.expectOne((r) => r.url === '/api/sync/runs').flush([run({ id: 3 })]);
      await render();
      expect(el.querySelector('[role="alert"]')).toBeNull();
    });

    it('AK-2.1 Status als Text und Symbol, Symbol für Screenreader verborgen', async () => {
      await loadRuns([run({ status: 'failed', error: 'page 1 failed' })]);

      const badge = el.querySelector('.badge')!;
      expect(badge.textContent!.trim()).toBe('✕ fehlgeschlagen');
      expect(badge.querySelector('.icon')!.getAttribute('aria-hidden')).toBe('true');
    });

    it('AK-2.2 / AK-2.3 Fehlertext in der Zeile, Details mit gescheiterten Seiten', async () => {
      const failedPages = [
        { page: 7, reason: 'http', status: 429, attempts: 5, retryAfterMs: 2000, retryable: true, message: 'HTTP 429' },
        { page: 9, reason: 'invalidResponse', attempts: 1, retryable: false, message: 'bad body' },
      ];
      await loadRuns([run({ status: 'partial', error: '2 page(s) missing', failedPages, pagesOk: 98, pagesFailed: 2 })]);

      expect(rows()[0].querySelector('.error-line')!.textContent).toBe('2 page(s) missing');
      const details = el.querySelector('tr.details') as HTMLElement;
      expect(details.hidden).toBe(true);

      (rows()[0].querySelector('button.expander') as HTMLButtonElement).click();
      await render();

      expect(details.hidden).toBe(false);
      const pageRows = [...details.querySelectorAll('table.failed-pages > tbody > tr')].map(cells);
      expect(pageRows).toEqual([
        ['7', 'http', '429', '5', '2 s', 'HTTP 429'],
        ['9', 'invalidResponse', '–', '1', '–', 'bad body'],
      ]);
    });

    it('AK-2.3 ohne gescheiterte Seiten: «Keine gescheiterten Seiten»', async () => {
      await loadRuns([run()]);
      (el.querySelector('button.expander') as HTMLButtonElement).click();
      await render();

      expect(el.querySelector('tr.details')!.textContent).toContain('Keine gescheiterten Seiten');
    });
  });

  describe('Anforderung 3 – Jetzt synchronisieren', () => {
    it('AK-3.1 / AK-3.6 der Knopf wird gesperrt, nicht disabled, und behält den Fokus', async () => {
      await loadRuns([run()]);
      const button = syncButton();
      button.focus();

      button.click();
      await render();

      expect(button.disabled).toBe(false);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.textContent!.trim()).toBe('Wird gestartet …');
      expect(document.activeElement).toBe(button);

      http.expectOne('/api/sync').flush({ id: 2, status: 'running', trigger: 'manual' }, { status: 202, statusText: 'Accepted' });
      await render();
      http.expectOne((r) => r.url === '/api/sync/runs').flush([running({ id: 2 }), run()]);
      await render();

      expect(document.activeElement).toBe(button); // still here after the state changes
      expect(button.getAttribute('aria-disabled')).toBe('true'); // now locked by the running run
    });

    it('AK-3.2 202: «Lauf #id gestartet», Liste sofort neu, neuer Lauf hervorgehoben', async () => {
      await loadRuns([run()]);
      syncButton().click();
      http.expectOne('/api/sync').flush({ id: 2, status: 'running', trigger: 'manual' }, { status: 202, statusText: 'Accepted' });
      await render();

      expect(liveRegion().textContent!.trim()).toBe('Lauf #2 gestartet');
      http.expectOne((r) => r.url === '/api/sync/runs').flush([running({ id: 2 }), run()]);
      await render();
      expect(el.querySelector('tbody.highlight th')!.textContent).toContain('#2');
    });

    it('AK-3.3 409: «Lauf #x läuft bereits», neutral, kein Alarm', async () => {
      await loadRuns([run()]);
      syncButton().click();
      http
        .expectOne('/api/sync')
        .flush({ error: 'a sync run is already running', runningRunId: 4 }, { status: 409, statusText: 'Conflict' });
      await render();

      expect(liveRegion().textContent!.trim()).toBe('Lauf #4 läuft bereits');
      expect(el.querySelector('[role="alert"]')).toBeNull();
      http.expectOne((r) => r.url === '/api/sync/runs').flush([running({ id: 4 }), run()]);
      await render();
      expect(el.querySelector('tbody.highlight th')!.textContent).toContain('#4');
    });

    it('AK-3.4 anderer Fehler: Alarm mit Grund, Knopf wieder frei', async () => {
      await loadRuns([run()]);
      syncButton().click();
      http.expectOne('/api/sync').error(new ProgressEvent('error'), { status: 0 });
      await render();

      expect(el.querySelector('[role="alert"]')!.textContent).toContain(
        'Lauf konnte nicht gestartet werden: Server nicht erreichbar',
      );
      expect(syncButton().getAttribute('aria-disabled')).toBeNull();
    });

    it('AK-3.5 / AK-3.6 läuft ein Lauf: gesperrt mit Grund, fokussierbar, Klick ohne Wirkung', async () => {
      await loadRuns([running({ id: 6 })]);
      const button = syncButton();

      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.disabled).toBe(false);
      const reasonId = button.getAttribute('aria-describedby')!;
      expect(el.querySelector(`#${reasonId}`)!.textContent).toBe('Lauf #6 läuft');

      button.focus();
      button.click();
      await render();
      expect(document.activeElement).toBe(button);
      http.expectNone('/api/sync');
    });
  });

  describe('Anforderung 5 – Barrierefreiheit', () => {
    it('AK-5.2 Aufklappen per Button mit aria-expanded und aria-controls', async () => {
      await loadRuns([run({ id: 3 })]);
      const button = el.querySelector('button.expander') as HTMLButtonElement;

      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.getAttribute('aria-controls')).toBe('run-3-details');
      expect(el.querySelector('#run-3-details')).not.toBeNull();
      button.click();
      await render();
      expect(button.getAttribute('aria-expanded')).toBe('true');
    });

    it('AK-5.4 caption, scope="col", <time datetime>', async () => {
      await loadRuns([run()]);

      expect(el.querySelector('caption')!.textContent).toContain('Die letzten 20 Sync-Läufe, neueste zuerst');
      const heads = [...el.querySelectorAll('thead th')];
      expect(heads.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
      expect(el.querySelector('time')!.getAttribute('datetime')).toBe('2026-10-17T13:05:58.000Z');
    });

    it('AK-5.8 genau eine h1', async () => {
      await loadRuns([run()]);
      expect(el.querySelectorAll('h1')).toHaveLength(1);
    });

    it.each<[string, SyncRun[] | 'error']>([
      ['geladen', [run({ id: 2 }), run({ id: 1, status: 'partial', error: 'x', failedPages: [{ page: 3, reason: 'http', status: 500, attempts: 5, retryable: true, message: 'HTTP 500' }] })]],
      ['leer', []],
      ['laufend', [running({ id: 2 }), run()]],
      ['Fehler', 'error'],
    ])('AK-5.9 axe-core findet keine Verstösse: %s', async (_, data) => {
      await render();
      const req = http.expectOne((r) => r.url === '/api/sync/runs');
      if (data === 'error') req.flush({ message: 'down' }, { status: 503, statusText: 'Unavailable' });
      else req.flush(data);
      await render();

      await expectNoA11yViolations(el);
    });

    it('AK-5.9 axe-core: aufgeklappt', async () => {
      await loadRuns([run({ status: 'failed', error: 'page 1 failed', failedPages: [{ page: 1, reason: 'http', status: 503, attempts: 5, retryAfterMs: 2000, retryable: true, message: 'HTTP 503' }] })]);
      (el.querySelector('button.expander') as HTMLButtonElement).click();
      await render();

      await expectNoA11yViolations(el);
    });
  });
});
