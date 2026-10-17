import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { SyncRun } from '../src/sync/sync-runs.repository.js';
import { createTestDatabase, type TestDatabase } from './db/test-database.js';
import { type RunningMock, startMock } from './mock-erp.js';

// Whole service (AppModule) against the real mock-erp and a real PostgreSQL.

let db: TestDatabase;
let mock: RunningMock | undefined;
let app: INestApplication<App> | undefined;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.drop();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await mock?.stop();
  mock = undefined;
  vi.unstubAllEnvs();
  await db.pool.query('TRUNCATE products, sync_runs RESTART IDENTITY');
});

async function startApp(
  mockEnv: Record<string, string>,
  env: Record<string, string> = {},
) {
  mock = await startMock(mockEnv);
  const vars = {
    DATABASE_URL: db.url,
    ERP_BASE_URL: mock.baseUrl,
    SYNC_SCHEDULE_ENABLED: 'false',
    ...env,
  };
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return request(app.getHttpServer());
}

async function waitForRun(
  http: ReturnType<typeof request>,
  id: number,
): Promise<SyncRun> {
  let run: SyncRun | undefined;
  await vi.waitFor(
    async () => {
      run = (await http.get(`/sync/runs/${id}`).expect(200)).body as SyncRun;
      expect(run.status).not.toBe('running');
    },
    { timeout: 50_000, interval: 100 },
  );
  return run!;
}

const productCount = async () =>
  Number((await db.pool.query('SELECT count(*) AS n FROM products')).rows[0].n);

describe('Sync-Job gegen Mock-ERP und PostgreSQL', () => {
  it('AK-10.1 / AK-8.2 / AK-8.3 / AK-3.6 voller Lauf, 409 während des Laufs, zweiter Lauf unverändert', async () => {
    const http = await startApp({});

    const started = await http.post('/sync').expect(202);
    expect(started.body).toEqual({
      id: 1,
      status: 'running',
      trigger: 'manual',
    });
    expect(started.headers.location).toBe('/sync/runs/1');

    const conflict = await http.post('/sync').expect(409);
    expect(conflict.body).toEqual({
      error: 'a sync run is already running',
      runningRunId: 1,
    });

    const first = await waitForRun(http, 1);
    expect(first).toMatchObject({
      status: 'completed',
      trigger: 'manual',
      totalExpected: 10_000,
      pagesTotal: 100,
      pagesOk: 100,
      pagesFailed: 0,
      productsInserted: 10_000,
      productsDeactivated: 0,
      error: null,
    });
    expect(await productCount()).toBe(10_000);

    // Use the returned id: the 409 above was a rejected INSERT, and identity
    // values consumed by a failed INSERT are not rolled back, so this is 3.
    const again = await http.post('/sync').expect(202);
    expect(again.body.id).toBe(3);
    const second = await waitForRun(http, again.body.id as number);
    expect(second).toMatchObject({
      status: 'completed',
      productsInserted: 0,
      productsUpdated: 0,
      productsUnchanged: 10_000,
    });
  });

  it('AK-4.4 GET /sync/runs und /sync/runs/:id', async () => {
    const http = await startApp({});
    await http.post('/sync').expect(202);
    await waitForRun(http, 1);
    await http.post('/sync').expect(202);
    await waitForRun(http, 2);

    const list = await http.get('/sync/runs').expect(200);
    expect((list.body as SyncRun[]).map((r) => r.id)).toEqual([2, 1]);
    const limited = await http.get('/sync/runs?limit=1').expect(200);
    expect((limited.body as SyncRun[]).map((r) => r.id)).toEqual([2]);

    await http.get('/sync/runs?limit=0').expect(400);
    await http.get('/sync/runs?limit=101').expect(400);
    await http.get('/sync/runs/999').expect(404);
    await http.get('/sync/runs/abc').expect(400);
  });

  it('AK-10.2 Standardraten: completed oder partial, alle gelesenen Seiten gespeichert', async () => {
    // Page size 1000 keeps the run short (10 pages); mock rates are the defaults.
    const http = await startApp(
      {
        FAILURE_RATE: '0.2',
        SLOW_RATE: '0.1',
        RATE_LIMIT_RATE: '0.05',
        SLOW_MS: '300',
      },
      {
        SYNC_PAGE_SIZE: '1000',
        ERP_TIMEOUT_MS: '150',
        ERP_BASE_DELAY_MS: '10',
        ERP_MAX_DELAY_MS: '50',
      },
    );

    await http.post('/sync').expect(202);
    const run = await waitForRun(http, 1);

    expect(['completed', 'partial']).toContain(run.status);
    expect(run.pagesOk + run.pagesFailed).toBe(10);
    expect(await productCount()).toBe(run.pagesOk * 1000);
    expect(run.productsInserted).toBe(run.pagesOk * 1000);
  });

  it('AK-8.4 Herunterfahren bricht einen laufenden Lauf innerhalb von Sekunden ab', async () => {
    // Every response is delayed 60 s and the client would wait for it.
    const http = await startApp(
      { SLOW_RATE: '1', SLOW_MS: '60000' },
      { ERP_TIMEOUT_MS: '60000' },
    );
    await http.post('/sync').expect(202);
    await new Promise((r) => setTimeout(r, 200)); // the run is now waiting on page 1

    const start = performance.now();
    await app!.close();
    app = undefined;
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5000);
    const { rows } = await db.pool.query(
      'SELECT status, error, finished_at FROM sync_runs WHERE id = 1',
    );
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error: 'aborted: shutdown',
    });
    expect(rows[0].finished_at).not.toBeNull();
  });

  it('Spec 005 AK-1.1 / AK-1.2 GET /health ist 200, auch wenn das ERP nicht erreichbar ist', async () => {
    const http = await startApp({}, { ERP_BASE_URL: 'http://127.0.0.1:1' });

    const res = await http.get('/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('AK-9.2 ungültige Konfiguration: der Service startet nicht', async () => {
    await expect(startApp({}, { SYNC_PAGE_SIZE: '0' })).rejects.toThrow(
      'SYNC_PAGE_SIZE="0"',
    );
  });
});
