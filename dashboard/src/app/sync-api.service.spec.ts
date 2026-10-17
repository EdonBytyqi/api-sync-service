import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { SyncApi } from './sync-api.service';

describe('SyncApi', () => {
  let api: SyncApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(SyncApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('AK-6.1 listRuns nutzt den relativen Pfad /api/sync/runs mit limit', async () => {
    const result = firstValueFrom(api.listRuns(20));
    const req = http.expectOne((r) => r.url === '/api/sync/runs');
    expect(req.request.params.get('limit')).toBe('20');
    req.flush([]);
    expect(await result).toEqual([]);
  });

  it('AK-3.2 202 → started mit id', async () => {
    const result = firstValueFrom(api.startSync());
    const req = http.expectOne('/api/sync');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 7, status: 'running', trigger: 'manual' }, { status: 202, statusText: 'Accepted' });
    expect(await result).toEqual({ kind: 'started', id: 7 });
  });

  it('AK-3.3 409 → running mit runningRunId, kein Fehler', async () => {
    const result = firstValueFrom(api.startSync());
    http
      .expectOne('/api/sync')
      .flush({ error: 'a sync run is already running', runningRunId: 4 }, { status: 409, statusText: 'Conflict' });
    expect(await result).toEqual({ kind: 'running', id: 4 });
  });

  it('AK-3.4 500 → error mit Grund aus dem Body', async () => {
    const result = firstValueFrom(api.startSync());
    http
      .expectOne('/api/sync')
      .flush({ statusCode: 500, message: 'Internal server error' }, { status: 500, statusText: 'Error' });
    expect(await result).toEqual({ kind: 'error', message: 'HTTP 500: Internal server error' });
  });

  it('AK-3.4 Netzwerkfehler → error «Server nicht erreichbar»', async () => {
    const result = firstValueFrom(api.startSync());
    http.expectOne('/api/sync').error(new ProgressEvent('error'), { status: 0 });
    expect(await result).toEqual({ kind: 'error', message: 'Server nicht erreichbar' });
  });
});
