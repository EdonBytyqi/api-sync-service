import pg from 'pg';
import { inject } from 'vitest';
import {
  createTestDatabase,
  migrate,
  type TestDatabase,
} from './test-database.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.drop();
});

const insertRun = (status = 'running', finishedAt: string | null = null) =>
  db.pool.query<{ id: string }>(
    `INSERT INTO sync_runs (trigger, status, page_size, finished_at)
     VALUES ('manual', $1, 100, $2) RETURNING id`,
    [status, finishedAt],
  );

const insertProduct = (
  runId: string,
  overrides: Record<string, unknown> = {},
) => {
  const p = {
    external_id: 1,
    sku: 'SKU-00001',
    name: 'Product 1',
    price_cents: 1990,
    active: true,
    deactivated_at: null,
    ...overrides,
  };
  return db.pool.query(
    `INSERT INTO products (external_id, sku, name, price_cents, erp_updated_at, active, deactivated_at, last_seen_run_id)
     VALUES ($1, $2, $3, $4, now(), $5, $6, $7)`,
    [
      p.external_id,
      p.sku,
      p.name,
      p.price_cents,
      p.active,
      p.deactivated_at,
      runId,
    ],
  );
};

describe('Migration 001_init', () => {
  afterEach(async () => {
    await db.pool.query('TRUNCATE products, sync_runs RESTART IDENTITY');
  });

  it('AK-1.1 legt sync_runs und products mit allen Spalten an', async () => {
    const { rows } = await db.pool.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = $1 ORDER BY table_name, ordinal_position`,
      [db.schema],
    );
    const columns = (table: string) =>
      rows.filter((r) => r.table_name === table).map((r) => r.column_name);

    expect(columns('products')).toEqual([
      'id',
      'external_id',
      'sku',
      'name',
      'price_cents',
      'erp_updated_at',
      'active',
      'deactivated_at',
      'first_seen_at',
      'last_seen_at',
      'last_seen_run_id',
      'updated_at',
    ]);
    expect(columns('sync_runs')).toEqual([
      'id',
      'trigger',
      'status',
      'started_at',
      'heartbeat_at',
      'finished_at',
      'page_size',
      'total_expected',
      'pages_total',
      'pages_ok',
      'pages_failed',
      'products_inserted',
      'products_updated',
      'products_unchanged',
      'products_reactivated',
      'products_deactivated',
      'failed_pages',
      'error',
    ]);
  });

  it('AK-1.2 ein zweites migrate ändert nichts und gelingt', async () => {
    await expect(
      migrate(inject('databaseUrl'), db.schema),
    ).resolves.toBeUndefined();

    const { rows } = await db.pool.query('SELECT name FROM pgmigrations');
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['001_init']);
  });

  it('AK-7.2 die Datenbank erlaubt höchstens einen laufenden Lauf', async () => {
    await insertRun();

    await expect(insertRun()).rejects.toMatchObject({
      code: '23505',
      constraint: 'sync_runs_one_running',
    });
    // Finished runs are not limited.
    await insertRun('completed', '2026-10-17T10:00:00Z');
    await insertRun('failed', '2026-10-17T11:00:00Z');
  });

  it.each<[string, string, string | null]>([
    ['running mit finished_at', 'running', '2026-10-17T10:00:00Z'],
    ['completed ohne finished_at', 'completed', null],
  ])('Lauf %s wird abgelehnt', async (_, status, finishedAt) => {
    await expect(insertRun(status, finishedAt)).rejects.toMatchObject({
      code: '23514',
      constraint: 'sync_runs_finished_iff_not_running',
    });
  });

  it('ein unbekannter Status wird abgelehnt', async () => {
    await expect(
      insertRun('done', '2026-10-17T10:00:00Z'),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['negativer Preis', { price_cents: -1 }, '23514'],
    ['fehlende sku', { sku: null }, '23502'],
    ['inaktiv ohne deactivated_at', { active: false }, '23514'],
    [
      'aktiv mit deactivated_at',
      { deactivated_at: '2026-10-17T10:00:00Z' },
      '23514',
    ],
  ])('AK-1.4 Produkt mit %s wird abgelehnt', async (_, overrides, code) => {
    const { rows } = await insertRun();

    await expect(insertProduct(rows[0].id, overrides)).rejects.toMatchObject({
      code,
    });
  });

  it('AK-1.4 Gratisartikel (price_cents = 0) ist erlaubt', async () => {
    const { rows } = await insertRun();

    await expect(
      insertProduct(rows[0].id, { price_cents: 0 }),
    ).resolves.toBeDefined();
  });

  it('external_id ist eindeutig', async () => {
    const { rows } = await insertRun();
    await insertProduct(rows[0].id);

    await expect(insertProduct(rows[0].id)).rejects.toMatchObject({
      code: '23505',
    });
  });
});

describe('Test-Infrastruktur', () => {
  it('AK-11.3 die Verbindung landet im eigenen Schema dieser Datei', async () => {
    const { rows } = await db.pool.query<{ schema: string }>(
      'SELECT current_schema() AS schema',
    );
    expect(rows[0].schema).toBe(db.schema);
  });

  it('withSearchPath funktioniert auch mit einem einzelnen pg.Client', async () => {
    const client = new pg.Client({ connectionString: db.url });
    await client.connect();
    try {
      const { rows } = await client.query<{ n: string }>(
        'SELECT count(*) AS n FROM sync_runs',
      );
      expect(rows[0].n).toBeDefined();
    } finally {
      await client.end();
    }
  });
});
