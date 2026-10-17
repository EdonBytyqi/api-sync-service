import {
  createTestDatabase,
  type TestDatabase,
} from '../../test/db/test-database.js';
import type { Product, ProductPage } from '../erp/erp-client.js';
import { ErpError, type ErpErrorDetails } from '../erp/erp-error.js';
import { ProductsRepository } from './products.repository.js';
import {
  type ProductSource,
  SyncRunner,
  type SyncRunnerDeps,
  type SyncRunnerSettings,
} from './sync-runner.js';
import { SyncRunsRepository } from './sync-runs.repository.js';

const STALE_MS = 190_000;
let db: TestDatabase;
let runs: SyncRunsRepository;
let products: ProductsRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  runs = new SyncRunsRepository(db.pool);
  products = new ProductsRepository(db.pool);
});

afterAll(async () => {
  await db.drop();
});

afterEach(async () => {
  await db.pool.query('TRUNCATE products, sync_runs RESTART IDENTITY');
});

// ---------- fake ERP ----------

const PAGE_SIZE = 10;

const product = (id: number): Product => ({
  id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  priceCents: 100 + id,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** Page `page` of a catalogue with `total` products. */
const catalogPage = (page: number, total: number): ProductPage => {
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return {
    items: Array.from({ length: Math.max(0, to - from + 1) }, (_, i) =>
      product(from + i),
    ),
    page,
    pageSize: PAGE_SIZE,
    total,
  };
};

const erpError = (details: Partial<ErpErrorDetails> = {}) =>
  new ErpError(`ERP failed (${details.status ?? details.reason ?? 'http'})`, {
    reason: 'http',
    status: 500,
    retryable: true,
    attempts: 5,
    ...details,
  });

type Reply =
  | ProductPage
  | ErpError
  | 'hang'
  | ((signal?: AbortSignal) => Promise<ProductPage>);

/**
 * Serves a `total`-product catalogue; `script[page]` overrides the replies
 * for that page, one entry per call (the last entry repeats).
 */
function fakeSource(total: number, script: Record<number, Reply[]> = {}) {
  const calls: number[] = [];
  const counts = new Map<number, number>();
  const source: ProductSource = {
    fetchPage: async (page, pageSize, signal) => {
      expect(pageSize).toBe(PAGE_SIZE);
      calls.push(page);
      events.push(`fetch:${page}`);
      const n = counts.get(page) ?? 0;
      counts.set(page, n + 1);
      const replies = script[page];
      const reply = replies
        ? replies[Math.min(n, replies.length - 1)]
        : catalogPage(page, total);
      if (reply === 'hang') {
        return new Promise<never>((_, reject) =>
          signal!.addEventListener('abort', () =>
            reject(
              new ErpError('aborted', {
                reason: 'aborted',
                retryable: false,
                attempts: 1,
              }),
            ),
          ),
        );
      }
      if (typeof reply === 'function') return reply(signal);
      if (reply instanceof ErpError) throw reply;
      return reply;
    },
  };
  return { source, calls };
}

let events: string[] = [];

function setup(
  source: ProductSource,
  {
    settings = {},
    deps = {},
  }: {
    settings?: Partial<SyncRunnerSettings>;
    deps?: Partial<SyncRunnerDeps>;
  } = {},
) {
  events = [];
  const sleep = vi.fn(async (ms: number) => {
    events.push(`sleep:${ms}`);
  });
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const tracedRuns = {
    heartbeat: async (id: number) => {
      events.push('heartbeat');
      return runs.heartbeat(id);
    },
    setPlan: runs.setPlan.bind(runs),
    finish: runs.finish.bind(runs),
  };
  const runner = new SyncRunner(
    {
      pageSize: PAGE_SIZE,
      maxConsecutiveFailures: 3,
      maxDeactivateRatio: 0.1,
      ...settings,
    },
    { source, runs: tracedRuns, products, sleep, logger, ...deps },
  );
  return { runner, sleep, logger };
}

async function startRun() {
  const started = await runs.start('manual', PAGE_SIZE, STALE_MS);
  if (!started.started) throw new Error('run did not start');
  return started.run.id;
}

async function runOnce(
  source: ProductSource,
  options: Parameters<typeof setup>[1] = {},
) {
  const ctx = setup(source, options);
  const runId = await startRun();
  const result = await ctx.runner.run(runId, new AbortController().signal);
  return { ...ctx, runId, result, run: (await runs.findById(runId))! };
}

const productCount = async (where = 'true') =>
  Number(
    (await db.pool.query(`SELECT count(*) AS n FROM products WHERE ${where}`))
      .rows[0].n,
  );

// ---------- tests ----------

describe('Anforderung 2 – alle Seiten', () => {
  it('AK-2.1 holt alle Seiten nacheinander und endet completed', async () => {
    const { source, calls } = fakeSource(95);

    const { run, result } = await runOnce(source);

    expect(calls).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result).toMatchObject({ status: 'completed' });
    expect(run).toMatchObject({
      status: 'completed',
      totalExpected: 95,
      pagesTotal: 10,
      pagesOk: 10,
      pagesFailed: 0,
      productsInserted: 95,
      failedPages: [],
      error: null,
    });
    expect(await productCount()).toBe(95);
  });

  it('AK-2.2 Seite 1 scheitert einmal: wartet retryAfterMs und versucht es erneut', async () => {
    const { source, calls } = fakeSource(20, {
      1: [erpError({ status: 429, retryAfterMs: 2000 }), catalogPage(1, 20)],
    });

    const { run, sleep } = await runOnce(source);

    expect(calls).toEqual([1, 1, 2]);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(
      2000,
      expect.any(AbortSignal),
    );
    expect(run.status).toBe('completed');
  });

  it.each<[string, ErpError[]]>([
    ['zweimal retrybar', [erpError(), erpError()]],
    [
      'endgültig',
      [
        erpError({
          reason: 'invalidResponse',
          status: undefined,
          retryable: false,
        }),
      ],
    ],
    [
      'rateLimited',
      [
        erpError({
          reason: 'rateLimited',
          status: 429,
          retryAfterMs: 3_600_000,
        }),
      ],
    ],
  ])('AK-2.2 Seite 1 scheitert %s → failed', async (_, replies) => {
    const { source, calls } = fakeSource(20, { 1: replies });

    const { run } = await runOnce(source);

    expect(calls).toEqual(replies.length === 2 ? [1, 1] : [1]);
    expect(run).toMatchObject({ status: 'failed' });
    expect(run.error).toMatch(/^page 1 failed, total unknown/);
    expect(await productCount()).toBe(0);
  });

  it('AK-2.3 total = 0: keine weiteren Seiten, ein leerer Katalog deaktiviert nichts', async () => {
    await runOnce(fakeSource(20).source);
    const { source, calls } = fakeSource(0);

    const { run } = await runOnce(source);

    expect(calls).toEqual([1]);
    expect(run).toMatchObject({ status: 'partial', productsDeactivated: 0 });
    expect(run.error).toContain('deactivation blocked');
    expect(await productCount('active')).toBe(20);
  });

  it('AK-2.4 total ändert sich: Seite gespeichert, höchstens partial, keine Deaktivierung', async () => {
    await runOnce(fakeSource(30).source);
    const { source } = fakeSource(30, {
      2: [{ ...catalogPage(2, 30), total: 31 }],
      3: [{ items: [], page: 3, pageSize: PAGE_SIZE, total: 31 }],
    });

    const { run, logger } = await runOnce(source);

    expect(run).toMatchObject({
      status: 'partial',
      pagesOk: 3,
      productsDeactivated: 0,
    });
    expect(run.error).toContain('total changed');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('total changed from 30 to 31 at page 2'),
    );
    expect(await productCount('active')).toBe(30);
  });

  it('AK-2.5 der Lauf übergibt sein AbortSignal an fetchPage', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const source: ProductSource = {
      fetchPage: async (page, _size, signal) => {
        signals.push(signal);
        return catalogPage(page, 15);
      },
    };
    const ctx = setup(source);
    const controller = new AbortController();

    await ctx.runner.run(await startRun(), controller.signal);

    expect(signals).toEqual([controller.signal, controller.signal]);
  });
});

describe('Anforderung 5 – gescheiterte Seiten', () => {
  it('AK-5.1 / AK-5.2 / AK-5.5 Seite scheitert, zweiter Durchgang nach grösstem retryAfterMs gelingt', async () => {
    const { source, calls } = fakeSource(50, {
      2: [erpError({ status: 429, retryAfterMs: 2000 }), catalogPage(2, 50)],
      4: [erpError({ status: 503, retryAfterMs: 5000 }), catalogPage(4, 50)],
    });

    const { run, sleep } = await runOnce(source);

    expect(calls).toEqual([1, 2, 3, 4, 5, 2, 4]);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(
      5000,
      expect.any(AbortSignal),
    );
    expect(run).toMatchObject({
      status: 'completed',
      pagesOk: 5,
      pagesFailed: 0,
      failedPages: [],
      productsInserted: 50,
    });
  });

  it('AK-5.2 ohne retryAfterMs wartet der zweite Durchgang nicht', async () => {
    const { source } = fakeSource(30, { 2: [erpError(), catalogPage(2, 30)] });

    const { sleep, run } = await runOnce(source);

    expect(sleep).not.toHaveBeenCalled();
    expect(run.status).toBe('completed');
  });

  it('AK-5.2 / AK-4.2 scheitert die Seite auch im zweiten Durchgang: partial mit Details', async () => {
    const { source } = fakeSource(30, {
      2: [
        erpError({ status: 500 }),
        erpError({ status: 429, retryAfterMs: 2000 }),
      ],
    });

    const { run } = await runOnce(source);

    expect(run).toMatchObject({
      status: 'partial',
      pagesOk: 2,
      pagesFailed: 1,
      error: '1 page(s) missing after second pass',
      failedPages: [
        {
          page: 2,
          reason: 'http',
          status: 429,
          attempts: 5,
          retryAfterMs: 2000,
          retryable: true,
          message: 'ERP failed (429)',
        },
      ],
    });
  });

  it.each<[string, ErpError]>([
    [
      'endgültig (invalidResponse)',
      erpError({
        reason: 'invalidResponse',
        status: undefined,
        retryable: false,
      }),
    ],
    ['endgültig (400)', erpError({ status: 400, retryable: false })],
    [
      'rateLimited',
      erpError({ reason: 'rateLimited', status: 429, retryAfterMs: 3_600_000 }),
    ],
  ])(
    'AK-5.3 / AK-5.4 %s: kein zweiter Durchgang für diese Seite',
    async (_, err) => {
      const { source, calls } = fakeSource(30, {
        2: [err, catalogPage(2, 30)],
      });

      const { run, sleep, logger } = await runOnce(source);

      expect(calls).toEqual([1, 2, 3]);
      expect(sleep).not.toHaveBeenCalled();
      expect(run).toMatchObject({ status: 'partial', pagesFailed: 1 });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('page 2 missing'),
      ); // AK-5.7
    },
  );

  it('AK-5.6 drei Seiten in Folge scheitern: Abbruch mit failed', async () => {
    const { source, calls } = fakeSource(100, {
      3: [erpError()],
      4: [erpError()],
      5: [erpError()],
    });

    const { run } = await runOnce(source);

    expect(calls).toEqual([1, 2, 3, 4, 5]);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(
      /^3 consecutive pages failed, ERP considered unavailable/,
    );
    expect(run.failedPages.map((f) => f.page)).toEqual([3, 4, 5]);
    expect(await productCount()).toBe(20); // pages 1 and 2 are kept
  });

  it('AK-5.6 zwei Fehler, ein Erfolg, zwei Fehler: kein Abbruch', async () => {
    const { source } = fakeSource(60, {
      2: [erpError(), catalogPage(2, 60)],
      3: [erpError(), catalogPage(3, 60)],
      5: [erpError(), catalogPage(5, 60)],
      6: [erpError(), catalogPage(6, 60)],
    });

    const { run } = await runOnce(source);

    expect(run.status).toBe('completed');
  });
});

describe('Anforderung 6 – Deaktivierung', () => {
  it('AK-6.1 nach vollständigem Lauf werden verschwundene Produkte deaktiviert', async () => {
    await runOnce(fakeSource(100).source);

    const { run } = await runOnce(fakeSource(95).source);

    expect(run).toMatchObject({
      status: 'completed',
      productsDeactivated: 5,
      productsUnchanged: 95,
    });
    expect(await productCount('NOT active')).toBe(5);
  });

  it('AK-6.2 partial deaktiviert nichts, obwohl Produkte fehlen', async () => {
    await runOnce(fakeSource(100).source);

    const { run } = await runOnce(
      fakeSource(100, { 4: [erpError({ retryable: false, status: 400 })] })
        .source,
    );

    expect(run).toMatchObject({ status: 'partial', productsDeactivated: 0 });
    expect(await productCount('NOT active')).toBe(0);
  });

  it('AK-6.3 die Sperre greift: partial mit Grund', async () => {
    await runOnce(fakeSource(100).source);

    const { run } = await runOnce(fakeSource(50).source);

    expect(run).toMatchObject({ status: 'partial', productsDeactivated: 0 });
    expect(run.error).toBe(
      'deactivation blocked: 50 of 100 active products (50.0 %) missing, limit 10.0 %',
    );
  });
});

describe('Anforderung 7 – Heartbeat und Fencing', () => {
  it('AK-7.3 Heartbeat vor jedem fetchPage, auch nach gescheiterten Seiten, und vor jeder Pause', async () => {
    const { source } = fakeSource(30, {
      2: [erpError({ retryAfterMs: 2000 }), catalogPage(2, 30)],
    });

    await runOnce(source);

    const beforeFetch = events.flatMap((e, i) =>
      e.startsWith('fetch:') ? [events[i - 1]] : [],
    );
    expect(beforeFetch.every((e) => e === 'heartbeat')).toBe(true);
    expect(events.slice(0, 6)).toEqual([
      'heartbeat',
      'fetch:1',
      'heartbeat',
      'fetch:2',
      'heartbeat',
      'fetch:3',
    ]);
    // Second pass: heartbeat, pause, heartbeat, retry of page 2.
    const pause = events.indexOf('sleep:2000');
    expect(events.slice(pause - 1)).toEqual([
      'heartbeat',
      'sleep:2000',
      'heartbeat',
      'fetch:2',
    ]);
  });

  it('AK-7.3a zwei langsam scheiternde Seiten machen einen lebenden Lauf nicht verwaist', async () => {
    // Each failing fetch "takes" 130 s: we age the heartbeat by 130 s on the
    // database clock. A heartbeat only in savePage would leave 260 s > 190 s.
    const slowFailure = async (): Promise<ProductPage> => {
      await db.pool.query(
        `UPDATE sync_runs SET heartbeat_at = heartbeat_at - interval '130 seconds' WHERE status = 'running'`,
      );
      throw erpError();
    };
    let competitor:
      Awaited<ReturnType<SyncRunsRepository['start']>> | undefined;
    const { source } = fakeSource(50, {
      3: [slowFailure, catalogPage(3, 50)],
      4: [slowFailure, catalogPage(4, 50)],
      5: [
        async () => {
          competitor = await runs.start('manual', PAGE_SIZE, STALE_MS); // e.g. POST /sync now
          return catalogPage(5, 50);
        },
      ],
    });

    const { run, runId } = await runOnce(source);

    expect(competitor).toEqual({ started: false, runningRunId: runId });
    expect(run.status).toBe('completed');
  });

  it('AK-7.5 ein übernommener Lauf ruft keine weitere Seite ab und lässt seine Zeile in Ruhe', async () => {
    const { source, calls } = fakeSource(50, {
      2: [
        async () => {
          await db.pool.query(
            `UPDATE sync_runs SET status = 'failed', finished_at = now(), error = 'abandoned: test' WHERE status = 'running'`,
          );
          return catalogPage(2, 50);
        },
      ],
    });

    const { run, result } = await runOnce(source);

    expect(result).toEqual({ fenced: true });
    expect(calls).toEqual([1, 2]); // page 2 fetched, but neither saved nor followed by page 3
    expect(run).toMatchObject({
      status: 'failed',
      error: 'abandoned: test',
      pagesOk: 1,
    });
    expect(await productCount()).toBe(10);
  });
});

describe('Fatale Fehler', () => {
  it('AK-3.8 ein Datenbankfehler beim Speichern beendet den Lauf mit failed', async () => {
    const { source } = fakeSource(50);
    const failingProducts = {
      savePage: async (runId: number, items: Product[]) => {
        if (items[0]?.id === 21)
          throw new Error('connection terminated unexpectedly');
        return products.savePage(runId, items);
      },
      deactivateMissing: products.deactivateMissing.bind(products),
    };

    const { run } = await runOnce(source, {
      deps: { products: failingProducts },
    });

    expect(run).toMatchObject({
      status: 'failed',
      error: 'database error: connection terminated unexpectedly',
      pagesOk: 2,
    });
  });

  it('AK-8.4 Abbruch über das AbortSignal: failed mit Grund, ohne weitere Seiten', async () => {
    const { source, calls } = fakeSource(50, { 3: ['hang'] });
    const ctx = setup(source);
    const runId = await startRun();
    const controller = new AbortController();

    const pending = ctx.runner.run(runId, controller.signal);
    await vi.waitFor(() => expect(calls).toContain(3));
    controller.abort(new Error('shutdown'));
    const result = await pending;

    expect(result).toMatchObject({
      status: 'failed',
      error: 'aborted: shutdown',
    });
    expect(calls).toEqual([1, 2, 3]);
    expect(await runs.findById(runId)).toMatchObject({
      status: 'failed',
      error: 'aborted: shutdown',
      pagesOk: 2,
    });
  });
});
