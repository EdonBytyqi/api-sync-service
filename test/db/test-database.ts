import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { inject } from 'vitest';

export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../migrations', import.meta.url),
);

export interface TestDatabase {
  /** Connection string scoped to this file's schema via search_path. */
  url: string;
  schema: string;
  pool: pg.Pool;
  drop: () => Promise<void>;
}

/** Appends `options=-c search_path=<schema>` so every connection lands in `schema`. */
export function withSearchPath(url: string, schema: string): string {
  const u = new URL(url);
  u.searchParams.set('options', `-c search_path=${schema}`);
  return u.toString();
}

export async function migrate(url: string, schema: string): Promise<void> {
  await runner({
    databaseUrl: url,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    schema,
    createSchema: true,
    // The advisory lock is database-wide and would serialise (and fail)
    // parallel test files, though each migrates its own schema and table.
    // `npm run migrate` keeps the lock: it guards concurrent deploys.
    noLock: true,
    log: () => {},
  });
}

/**
 * A fresh, migrated schema for one test file (AK-11.3), so files can run in
 * parallel against the same database without sharing tables.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const baseUrl = inject('databaseUrl');
  const schema = `test_${randomBytes(6).toString('hex')}`;
  await migrate(baseUrl, schema);

  const url = withSearchPath(baseUrl, schema);
  const pool = new pg.Pool({ connectionString: url, max: 5 });

  return {
    url,
    schema,
    pool,
    drop: async () => {
      await pool.end();
      const admin = new pg.Client({ connectionString: baseUrl });
      await admin.connect();
      try {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    },
  };
}
