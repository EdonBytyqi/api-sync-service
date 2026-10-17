import type pg from 'pg';

/** Runs `fn` in a transaction on one pooled connection; rolls back on any error. */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const isUniqueViolation = (err: unknown, constraint?: string): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: string }).code === '23505' &&
  (constraint === undefined ||
    (err as { constraint?: string }).constraint === constraint);
