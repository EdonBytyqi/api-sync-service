import type pg from 'pg';
import { withTransaction } from '../db/transaction.js';
import type { Product } from '../erp/erp-client.js';
import { diffPage, type PageDiff, type StoredProduct } from './page-diff.js';
import { touchRun } from './sync-runs.repository.js';

export type DeactivationResult =
  { blocked: false; deactivated: number } | { blocked: true; reason: string };

interface StoredRow {
  external_id: string;
  sku: string;
  name: string;
  price_cents: number;
  erp_updated_at: Date;
  active: boolean;
}

export class ProductsRepository {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Saves one page in one transaction (AK-3.5): fence, lock existing rows,
   * diff, upsert new/changed/reactivated, mark all as seen, bump counters.
   */
  async savePage(runId: number, items: Product[]): Promise<PageDiff> {
    return withTransaction(this.pool, async (client) => {
      await touchRun(client, runId);

      const ids = [...new Set(items.map((p) => p.id))];
      const { rows } = await client.query<StoredRow>(
        `SELECT external_id, sku, name, price_cents, erp_updated_at, active
           FROM products WHERE external_id = ANY($1::bigint[]) FOR UPDATE`,
        [ids],
      );
      const existing: StoredProduct[] = rows.map((r) => ({
        externalId: Number(r.external_id),
        sku: r.sku,
        name: r.name,
        priceCents: r.price_cents,
        erpUpdatedAt: r.erp_updated_at.toISOString(),
        active: r.active,
      }));

      const diff = diffPage(existing, items);

      if (diff.upserts.length > 0) {
        const u = diff.upserts;
        await client.query(
          `INSERT INTO products (external_id, sku, name, price_cents, erp_updated_at, last_seen_run_id)
           SELECT t.*, $6::bigint
             FROM unnest($1::bigint[], $2::text[], $3::text[], $4::integer[], $5::timestamptz[])
                  AS t(external_id, sku, name, price_cents, erp_updated_at)
           ON CONFLICT (external_id) DO UPDATE
              SET sku = EXCLUDED.sku,
                  name = EXCLUDED.name,
                  price_cents = EXCLUDED.price_cents,
                  erp_updated_at = EXCLUDED.erp_updated_at,
                  active = true,
                  deactivated_at = NULL,
                  updated_at = now()`,
          [
            u.map((p) => p.id),
            u.map((p) => p.sku),
            u.map((p) => p.name),
            u.map((p) => p.priceCents),
            u.map((p) => p.updatedAt),
            runId,
          ],
        );
      }

      await client.query(
        `UPDATE products SET last_seen_run_id = $1, last_seen_at = now()
          WHERE external_id = ANY($2::bigint[])`,
        [runId, diff.seenIds],
      );

      await client.query(
        `UPDATE sync_runs
            SET pages_ok = pages_ok + 1,
                products_inserted = products_inserted + $2,
                products_updated = products_updated + $3,
                products_unchanged = products_unchanged + $4,
                products_reactivated = products_reactivated + $5
          WHERE id = $1`,
        [runId, diff.inserted, diff.updated, diff.unchanged, diff.reactivated],
      );
      return diff;
    });
  }

  /**
   * Deactivates active products not seen in this run (AK-6.1), unless that
   * would hit more than maxRatio of all active products (AK-6.3).
   */
  async deactivateMissing(
    runId: number,
    maxRatio: number,
  ): Promise<DeactivationResult> {
    return withTransaction(this.pool, async (client) => {
      await touchRun(client, runId);

      const { rows } = await client.query<{
        candidates: string;
        active: string;
      }>(
        `SELECT count(*) FILTER (WHERE last_seen_run_id <> $1) AS candidates,
                count(*) AS active
           FROM products WHERE active`,
        [runId],
      );
      const candidates = Number(rows[0].candidates);
      const active = Number(rows[0].active);
      if (candidates === 0) return { blocked: false, deactivated: 0 };

      const ratio = candidates / active;
      if (ratio > maxRatio) {
        return {
          blocked: true,
          reason: `deactivation blocked: ${candidates} of ${active} active products (${(ratio * 100).toFixed(1)} %) missing, limit ${(maxRatio * 100).toFixed(1)} %`,
        };
      }

      const result = await client.query(
        `UPDATE products SET active = false, deactivated_at = now(), updated_at = now()
          WHERE active AND last_seen_run_id <> $1`,
        [runId],
      );
      const deactivated = result.rowCount ?? 0;
      await client.query(
        'UPDATE sync_runs SET products_deactivated = $2 WHERE id = $1',
        [runId, deactivated],
      );
      return { blocked: false, deactivated };
    });
  }
}
