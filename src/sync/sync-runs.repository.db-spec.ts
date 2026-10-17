import pg from 'pg';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../test/db/test-database.js';
import { ProductsRepository } from './products.repository.js';
import {
  FencedError,
  SyncRunsRepository,
  touchRun,
} from './sync-runs.repository.js';

const STALE_MS = 190_000;
let db: TestDatabase;
let runs: SyncRunsRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  runs = new SyncRunsRepository(db.pool);
});

afterAll(async () => {
  await db.drop();
});

afterEach(async () => {
  await db.pool.query('TRUNCATE products, sync_runs RESTART IDENTITY');
});

async function startOk(trigger: 'manual' | 'schedule' = 'manual') {
  const result = await runs.start(trigger, 100, STALE_MS);
  if (!result.started) throw new Error('expected run to start');
  return result.run;
}

const ageHeartbeat = (runId: number, interval: string) =>
  db.pool.query(
    `UPDATE sync_runs SET heartbeat_at = now() - $2::interval WHERE id = $1`,
    [runId, interval],
  );

describe('SyncRunsRepository.start', () => {
  it('AK-4.1 legt einen Lauf mit running, trigger, started_at und heartbeat_at an', async () => {
    const run = await startOk('schedule');

    expect(run).toMatchObject({
      id: 1,
      trigger: 'schedule',
      status: 'running',
      finishedAt: null,
      pageSize: 100,
      pagesOk: 0,
      failedPages: [],
      error: null,
    });
    expect(Date.parse(run.startedAt)).not.toBeNaN();
    expect(run.heartbeatAt).toBe(run.startedAt);
  });

  it('AK-7.1 ein zweiter Start während eines laufenden Laufs startet nichts', async () => {
    const first = await startOk();

    const second = await runs.start('manual', 100, STALE_MS);

    expect(second).toEqual({ started: false, runningRunId: first.id });
    const { rows } = await db.pool.query(
      'SELECT count(*)::int AS n FROM sync_runs',
    );
    expect(rows[0].n).toBe(1);
  });

  it('AK-7.2 zehn gleichzeitige Starts über eigene Verbindungen: genau einer gewinnt', async () => {
    // Separate pools behave like separate service instances.
    const pools = Array.from(
      { length: 10 },
      () => new pg.Pool({ connectionString: db.url, max: 1 }),
    );
    try {
      const results = await Promise.all(
        pools.map((p) =>
          new SyncRunsRepository(p).start('schedule', 100, STALE_MS),
        ),
      );

      const winners = results.filter((r) => r.started);
      expect(winners).toHaveLength(1);
      const winnerId = winners[0].started ? winners[0].run.id : -1;
      for (const loser of results.filter((r) => !r.started)) {
        expect(loser).toEqual({ started: false, runningRunId: winnerId });
      }
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
  });

  it('AK-7.2 endet der Gewinner zwischen 23505 und dem Nachlesen, versucht start es einmal neu', async () => {
    const winner = await startOk();
    // Simulate the race: the winner finishes right after our INSERT failed.
    const realFindRunning = runs.findRunning.bind(runs);
    const spy = vi
      .spyOn(runs, 'findRunning')
      .mockImplementationOnce(async () => {
        await runs.finish(winner.id, { status: 'completed', failedPages: [] });
        return realFindRunning(); // null: nothing runs any more
      });
    try {
      const result = await runs.start('manual', 100, STALE_MS);

      expect(result).toMatchObject({ started: true });
      expect(result.started && result.run.id).toBeGreaterThan(winner.id);
    } finally {
      spy.mockRestore();
    }
  });

  it('AK-7.1 nach dem Abschluss eines Laufs startet der nächste', async () => {
    const first = await startOk();
    await runs.finish(first.id, { status: 'completed', failedPages: [] });

    const second = await startOk();

    expect(second.id).toBe(first.id + 1);
  });

  it('AK-7.4 ein verwaister Lauf wird als failed markiert und der neue startet', async () => {
    const old = await startOk();
    await ageHeartbeat(old.id, '10 minutes');

    const result = await runs.start('manual', 100, STALE_MS);

    expect(result).toMatchObject({ started: true, abandonedRunIds: [old.id] });
    const closed = await runs.findById(old.id);
    expect(closed).toMatchObject({ status: 'failed' });
    expect(closed!.finishedAt).not.toBeNull();
    expect(closed!.error).toMatch(
      /^abandoned: no heartbeat since \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('AK-7.4 ein Heartbeat knapp innerhalb von staleAfterMs ist nicht verwaist', async () => {
    const old = await startOk();
    await ageHeartbeat(old.id, '189 seconds');

    expect(await runs.start('manual', 100, STALE_MS)).toEqual({
      started: false,
      runningRunId: old.id,
    });
  });
});

describe('Heartbeat und Fencing', () => {
  it('AK-7.3 / AK-7.6 heartbeat setzt heartbeat_at auf die Datenbank-Uhr', async () => {
    const run = await startOk();
    await ageHeartbeat(run.id, '1 minute');

    await runs.heartbeat(run.id);

    const { rows } = await db.pool.query<{ age: number }>(
      `SELECT extract(epoch FROM now() - heartbeat_at) AS age FROM sync_runs WHERE id = $1`,
      [run.id],
    );
    expect(Number(rows[0].age)).toBeLessThan(5);
  });

  it('AK-7.5 ein für verwaist erklärter Lauf wird beim Heartbeat abgewiesen', async () => {
    const old = await startOk();
    await ageHeartbeat(old.id, '10 minutes');
    const next = await startOk();

    await expect(runs.heartbeat(old.id)).rejects.toBeInstanceOf(FencedError);
    await expect(touchRun(db.pool, next.id)).resolves.toBeUndefined();
  });

  it('AK-7.5 der alte Lauf kann keine Seite mehr speichern und seine Zeile nicht ändern', async () => {
    const products = new ProductsRepository(db.pool);
    const old = await startOk();
    await ageHeartbeat(old.id, '10 minutes');
    await startOk();

    await expect(
      products.savePage(old.id, [
        {
          id: 1,
          sku: 'S',
          name: 'N',
          priceCents: 1,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]),
    ).rejects.toBeInstanceOf(FencedError);
    expect(
      await runs.finish(old.id, { status: 'completed', failedPages: [] }),
    ).toBe(false);

    const { rows } = await db.pool.query(
      'SELECT count(*)::int AS n FROM products',
    );
    expect(rows[0].n).toBe(0);
    expect(await runs.findById(old.id)).toMatchObject({
      status: 'failed',
      pagesOk: 0,
    });
  });
});

describe('Abschluss und Abfragen', () => {
  it('AK-4.2 finish speichert Status, Fehler, failed_pages und pages_failed', async () => {
    const run = await startOk();
    await runs.setPlan(run.id, 10_000, 100);
    const failedPages = [
      {
        page: 7,
        reason: 'http',
        status: 500,
        attempts: 5,
        retryable: true,
        message: 'HTTP 500',
      },
      {
        page: 9,
        reason: 'http',
        status: 429,
        attempts: 5,
        retryAfterMs: 2000,
        retryable: true,
        message: 'HTTP 429',
      },
    ];

    expect(
      await runs.finish(run.id, {
        status: 'partial',
        error: '2 page(s) missing',
        failedPages,
      }),
    ).toBe(true);

    const stored = await runs.findById(run.id);
    expect(stored).toMatchObject({
      status: 'partial',
      error: '2 page(s) missing',
      totalExpected: 10_000,
      pagesTotal: 100,
      pagesFailed: 2,
      failedPages,
    });
    expect(stored!.finishedAt).not.toBeNull();
  });

  it('AK-4.4 list liefert die neuesten zuerst, mit limit', async () => {
    for (let i = 0; i < 3; i++) {
      const run = await startOk();
      await runs.finish(run.id, { status: 'completed', failedPages: [] });
    }

    expect((await runs.list(2)).map((r) => r.id)).toEqual([3, 2]);
  });

  it('AK-4.4 findById liefert null für unbekannte IDs', async () => {
    expect(await runs.findById(999)).toBeNull();
  });
});
