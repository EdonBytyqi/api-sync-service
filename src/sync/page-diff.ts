import type { Product } from '../erp/erp-client.js';

/** What the database already holds for a product, as far as the diff cares. */
export interface StoredProduct {
  externalId: number;
  sku: string;
  name: string;
  priceCents: number;
  erpUpdatedAt: string;
  active: boolean;
}

export interface PageDiff {
  /** New, changed or reactivated products to write. */
  upserts: Product[];
  /** Every distinct external id on the page, for last_seen_run_id. */
  seenIds: number[];
  /** External ids that appeared more than once on the page (AK-3.9). */
  duplicateIds: number[];
  inserted: number;
  updated: number;
  unchanged: number;
  reactivated: number;
}

const sameInstant = (a: string, b: string) =>
  new Date(a).getTime() === new Date(b).getTime();

function hasChanged(stored: StoredProduct, incoming: Product): boolean {
  return (
    stored.sku !== incoming.sku ||
    stored.name !== incoming.name ||
    stored.priceCents !== incoming.priceCents ||
    !sameInstant(stored.erpUpdatedAt, incoming.updatedAt)
  );
}

/**
 * Decides per product what saving a page means (requirement 3). Pure, so
 * the rules are testable without a database.
 */
export function diffPage(
  existing: StoredProduct[],
  incoming: Product[],
): PageDiff {
  // Last occurrence wins: a single INSERT ... ON CONFLICT must not touch the
  // same row twice ("command cannot affect row a second time").
  const latest = new Map<number, Product>();
  const duplicateIds = new Set<number>();
  for (const product of incoming) {
    if (latest.has(product.id)) {
      duplicateIds.add(product.id);
      latest.delete(product.id); // re-insert so Map order follows the last occurrence
    }
    latest.set(product.id, product);
  }

  const stored = new Map(existing.map((p) => [p.externalId, p]));
  const diff: PageDiff = {
    upserts: [],
    seenIds: [...latest.keys()],
    duplicateIds: [...duplicateIds],
    inserted: 0,
    updated: 0,
    unchanged: 0,
    reactivated: 0,
  };

  for (const product of latest.values()) {
    const current = stored.get(product.id);
    if (!current) {
      diff.inserted++;
      diff.upserts.push(product);
      continue;
    }
    const changed = hasChanged(current, product);
    if (!current.active) diff.reactivated++;
    if (changed) diff.updated++;
    if (changed || !current.active) diff.upserts.push(product);
    else diff.unchanged++;
  }
  return diff;
}
