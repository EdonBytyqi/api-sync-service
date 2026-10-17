import {
  createTestDatabase,
  type TestDatabase,
} from '../../test/db/test-database.js';
import type { Product } from '../erp/erp-client.js';
import { ProductsRepository } from './products.repository.js';
import { SyncRunsRepository } from './sync-runs.repository.js';

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

const product = (id: number, overrides: Partial<Product> = {}): Product => ({
  id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  priceCents: 1000 + id,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => product(from + i));

/** Runs `fn` inside a fresh run and closes it, like one sync run would. */
async function inRun<T>(
  fn: (runId: number) => Promise<T>,
): Promise<{ runId: number; result: T }> {
  const started = await runs.start('manual', 100, 190_000);
  if (!started.started) throw new Error('run did not start');
  const result = await fn(started.run.id);
  await runs.finish(started.run.id, { status: 'completed', failedPages: [] });
  return { runId: started.run.id, result };
}

interface Row {
  external_id: string;
  sku: string;
  price_cents: number;
  active: boolean;
  deactivated_at: Date | null;
  last_seen_run_id: string;
  updated_at: Date;
}
const rows = async () =>
  (await db.pool.query<Row>('SELECT * FROM products ORDER BY external_id'))
    .rows;
const row = async (id: number) =>
  (await rows()).find((r) => Number(r.external_id) === id)!;

describe('ProductsRepository.savePage', () => {
  it('AK-3.1 neue Produkte werden aktiv eingefügt und gezählt', async () => {
    const { runId, result } = await inRun((id) =>
      products.savePage(id, range(1, 3)),
    );

    expect(result).toMatchObject({ inserted: 3, updated: 0, unchanged: 0 });
    expect(await rows()).toHaveLength(3);
    expect(await row(2)).toMatchObject({
      sku: 'SKU-2',
      price_cents: 1002,
      active: true,
      deactivated_at: null,
    });
    expect(await runs.findById(runId)).toMatchObject({
      pagesOk: 1,
      productsInserted: 3,
    });
  });

  it('AK-3.2 / AK-3.3 geänderte Produkte werden aktualisiert, unveränderte nicht angefasst', async () => {
    await inRun((id) => products.savePage(id, range(1, 2)));
    const before = await row(1);

    const { runId, result } = await inRun((id) =>
      products.savePage(id, [product(1), product(2, { priceCents: 0 })]),
    );

    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 1 });
    const unchanged = await row(1);
    expect(unchanged.updated_at).toEqual(before.updated_at);
    expect(Number(unchanged.last_seen_run_id)).toBe(runId); // AK-3.3: still marked as seen
    expect((await row(2)).price_cents).toBe(0);
    expect(await runs.findById(runId)).toMatchObject({
      productsUpdated: 1,
      productsUnchanged: 1,
    });
  });

  it('AK-3.6 derselbe Lauf mit unveränderten Daten: alles unchanged', async () => {
    await inRun((id) => products.savePage(id, range(1, 100)));

    const { result } = await inRun((id) =>
      products.savePage(id, range(1, 100)),
    );

    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 100 });
  });

  it('AK-3.5 ein Fehler mitten in der Seite speichert nichts davon', async () => {
    const { runId } = await inRun(async (id) => {
      // The client would reject this, but the DB CHECK is the last line of defence.
      const page = [...range(1, 5), product(6, { priceCents: -1 })];
      await expect(products.savePage(id, page)).rejects.toMatchObject({
        code: '23514',
      });
    });

    expect(await rows()).toHaveLength(0);
    expect(await runs.findById(runId)).toMatchObject({
      pagesOk: 0,
      productsInserted: 0,
    });
  });

  it('AK-3.9 doppelte ID in einer Seite: kein DB-Fehler, letzte gewinnt, einmal gezählt', async () => {
    const page = [
      product(1, { name: 'first' }),
      product(2),
      product(1, { name: 'last' }),
    ];

    const { result } = await inRun((id) => products.savePage(id, page));

    expect(result).toMatchObject({ inserted: 2, duplicateIds: [1] });
    expect(await rows()).toHaveLength(2);
    const { rows: named } = await db.pool.query(
      'SELECT name FROM products WHERE external_id = 1',
    );
    expect(named[0].name).toBe('last');
  });

  it('AK-3.7 dieselbe ID auf zwei Seiten eines Laufs: die zuletzt gelesene gewinnt', async () => {
    await inRun(async (id) => {
      await products.savePage(id, [product(1, { name: 'page 1' })]);
      await products.savePage(id, [product(1, { name: 'page 2' })]);
    });

    const { rows: named } = await db.pool.query(
      'SELECT name FROM products WHERE external_id = 1',
    );
    expect(named[0].name).toBe('page 2');
  });
});

describe('ProductsRepository.deactivateMissing', () => {
  it('AK-6.1 / AK-6.4 nicht gesehene aktive Produkte werden deaktiviert, nicht gelöscht', async () => {
    await inRun((id) => products.savePage(id, range(1, 10)));

    const { runId, result } = await inRun(async (id) => {
      await products.savePage(id, range(1, 9));
      return products.deactivateMissing(id, 0.1);
    });

    expect(result).toEqual({ blocked: false, deactivated: 1 });
    expect(await rows()).toHaveLength(10);
    const gone = await row(10);
    expect(gone.active).toBe(false);
    expect(gone.deactivated_at).not.toBeNull();
    expect(await runs.findById(runId)).toMatchObject({
      productsDeactivated: 1,
    });
  });

  it('AK-3.4 ein deaktiviertes Produkt wird beim Wiederauftauchen reaktiviert', async () => {
    await inRun((id) => products.savePage(id, range(1, 10)));
    await inRun(async (id) => {
      await products.savePage(id, range(1, 9));
      await products.deactivateMissing(id, 0.1);
    });

    const { runId, result } = await inRun((id) =>
      products.savePage(id, range(1, 10)),
    );

    expect(result).toMatchObject({ reactivated: 1, unchanged: 9 });
    expect(await row(10)).toMatchObject({ active: true, deactivated_at: null });
    expect(await runs.findById(runId)).toMatchObject({
      productsReactivated: 1,
    });
  });

  it('AK-6.3 mehr als SYNC_MAX_DEACTIVATE_RATIO würde deaktiviert: nichts passiert', async () => {
    await inRun((id) => products.savePage(id, range(1, 10)));

    const { result } = await inRun(async (id) => {
      await products.savePage(id, range(1, 8)); // 2 of 10 = 20 % missing
      return products.deactivateMissing(id, 0.1);
    });

    expect(result).toEqual({
      blocked: true,
      reason:
        'deactivation blocked: 2 of 10 active products (20.0 %) missing, limit 10.0 %',
    });
    expect((await rows()).every((r) => r.active)).toBe(true);
  });

  it('AK-2.3 / AK-6.3 ein leerer Katalog deaktiviert nicht alles', async () => {
    await inRun((id) => products.savePage(id, range(1, 10)));

    const { result } = await inRun((id) => products.deactivateMissing(id, 0.1));

    expect(result).toMatchObject({ blocked: true });
    expect((await rows()).every((r) => r.active)).toBe(true);
  });

  it('erster Lauf überhaupt: nichts zu deaktivieren', async () => {
    const { result } = await inRun(async (id) => {
      await products.savePage(id, range(1, 5));
      return products.deactivateMissing(id, 0.1);
    });

    expect(result).toEqual({ blocked: false, deactivated: 0 });
  });
});
