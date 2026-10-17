import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import type { SyncRun } from './models';
import { POLL_IDLE_MS, POLL_RUNNING_MS, RunsStore } from './runs.store';
import { run, running } from './testing';

describe('RunsStore', () => {
  let store: RunsStore;
  let http: HttpTestingController;
  let visibility: DocumentVisibilityState;

  const pending = () => http.match((r) => r.url === '/api/sync/runs');
  const expectList = (): TestRequest => {
    const reqs = pending();
    expect(reqs).toHaveLength(1);
    return reqs[0];
  };
  const respond = (runs: SyncRun[]) => expectList().flush(runs);

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const doc = TestBed.inject(DOCUMENT);
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => visibility });
    store = TestBed.inject(RunsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    store.stop();
    vi.useRealTimers();
  });

  const setVisibility = (state: DocumentVisibilityState) => {
    visibility = state;
    TestBed.inject(DOCUMENT).dispatchEvent(new Event('visibilitychange'));
  };

  it('AK-1.1 lädt beim Start die 20 neuesten Läufe', () => {
    store.start();
    const req = expectList();
    expect(req.request.params.get('limit')).toBe('20');
    req.flush([run({ id: 2 }), run({ id: 1 })]);

    expect(store.runs().map((r) => r.id)).toEqual([2, 1]);
    expect(store.loaded()).toBe(true);
    expect(store.lastUpdated()).toBeInstanceOf(Date);
  });

  it('AK-4.1 läuft ein Lauf, wird alle 3 s neu geladen', () => {
    store.start();
    respond([running()]);

    vi.advanceTimersByTime(POLL_RUNNING_MS - 1);
    expect(pending()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    respond([running()]);
  });

  it('AK-4.1 ohne laufenden Lauf alle 30 s', () => {
    store.start();
    respond([run()]);

    vi.advanceTimersByTime(POLL_IDLE_MS - 1);
    expect(pending()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    respond([run()]);
  });

  it('AK-4.3 solange eine Anfrage läuft, startet das Polling keine zweite', () => {
    store.start();
    vi.advanceTimersByTime(10 * POLL_IDLE_MS);

    expect(pending()).toHaveLength(1); // the timer is only armed after a response
  });

  it('AK-4.3 eine ältere Antwort, die nach einer neueren ankommt, wird verworfen', () => {
    store.start();
    const older = expectList(); // match() takes it off the pending list
    store.refresh(); // e.g. after "Jetzt synchronisieren"
    const newer = expectList();

    newer.flush([running({ id: 9 })]);
    older.flush([run({ id: 8 })]);

    expect(store.runs().map((r) => r.id)).toEqual([9]);
  });

  it('AK-4.2 bei verstecktem Tab pausiert das Polling, beim Zurückkehren wird sofort geladen', () => {
    store.start();
    respond([running()]);

    setVisibility('hidden');
    vi.advanceTimersByTime(10 * POLL_IDLE_MS);
    expect(pending()).toHaveLength(0);

    setVisibility('visible');
    respond([run()]);
  });

  it('AK-1.6 Fehler beim Laden: Fehlermeldung, alte Läufe bleiben stehen', () => {
    store.start();
    respond([run({ id: 3 })]);
    vi.advanceTimersByTime(POLL_IDLE_MS);
    expectList().flush({ message: 'down' }, { status: 503, statusText: 'Unavailable' });

    expect(store.error()).toBe('HTTP 503: down');
    expect(store.runs().map((r) => r.id)).toEqual([3]);
  });

  it('AK-4.4 / AK-5.3 Übergang running → Endstatus wird einmal angekündigt', () => {
    store.start();
    respond([running({ id: 5 })]);
    expect(store.announcement()).toBe('');

    vi.advanceTimersByTime(POLL_RUNNING_MS);
    respond([running({ id: 5, pagesOk: 60 })]);
    expect(store.announcement()).toBe(''); // polling itself is silent

    vi.advanceTimersByTime(POLL_RUNNING_MS);
    respond([run({ id: 5, status: 'partial' })]);
    expect(store.announcement()).toBe('Lauf #5 teilweise');
  });

  it('AK-4.4 beim ersten Laden wird nichts angekündigt', () => {
    store.start();
    respond([run({ id: 5, status: 'failed' })]);

    expect(store.announcement()).toBe('');
  });
});
