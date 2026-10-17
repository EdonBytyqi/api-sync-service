import type { Product } from '../erp/erp-client.js';
import { diffPage, type StoredProduct } from './page-diff.js';

const product = (id: number, overrides: Partial<Product> = {}): Product => ({
  id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  priceCents: 1990,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const stored = (
  id: number,
  overrides: Partial<StoredProduct> = {},
): StoredProduct => ({
  externalId: id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  priceCents: 1990,
  erpUpdatedAt: '2026-01-01T00:00:00.000Z',
  active: true,
  ...overrides,
});

const counts = (d: ReturnType<typeof diffPage>) => ({
  inserted: d.inserted,
  updated: d.updated,
  unchanged: d.unchanged,
  reactivated: d.reactivated,
});

describe('diffPage', () => {
  it('AK-3.1 neue external_id wird eingefügt', () => {
    const d = diffPage([], [product(1), product(2)]);

    expect(counts(d)).toEqual({
      inserted: 2,
      updated: 0,
      unchanged: 0,
      reactivated: 0,
    });
    expect(d.upserts.map((p) => p.id)).toEqual([1, 2]);
    expect(d.seenIds).toEqual([1, 2]);
  });

  it.each<[string, Partial<Product>]>([
    ['sku', { sku: 'NEW' }],
    ['name', { name: 'New name' }],
    ['priceCents', { priceCents: 2490 }],
    ['updatedAt', { updatedAt: '2026-02-01T00:00:00.000Z' }],
  ])('AK-3.2 geändertes Feld %s → updated', (_, change) => {
    const d = diffPage([stored(1)], [product(1, change)]);

    expect(counts(d)).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: 0,
      reactivated: 0,
    });
    expect(d.upserts).toEqual([product(1, change)]);
  });

  it('AK-3.3 unverändert → unchanged, kein Upsert, aber als gesehen markiert', () => {
    const d = diffPage([stored(1)], [product(1)]);

    expect(counts(d)).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 1,
      reactivated: 0,
    });
    expect(d.upserts).toEqual([]);
    expect(d.seenIds).toEqual([1]);
  });

  it('AK-3.3 derselbe Zeitpunkt in anderer Schreibweise ist unverändert', () => {
    const d = diffPage(
      [stored(1)],
      [product(1, { updatedAt: '2026-01-01T01:00:00+01:00' })],
    );

    expect(d.unchanged).toBe(1);
  });

  it('AK-3.4 inaktives Produkt kommt unverändert wieder → reactivated, nicht updated', () => {
    const d = diffPage([stored(1, { active: false })], [product(1)]);

    expect(counts(d)).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 0,
      reactivated: 1,
    });
    expect(d.upserts).toEqual([product(1)]);
  });

  it('AK-3.4 inaktives Produkt kommt geändert wieder → reactivated und updated', () => {
    const d = diffPage(
      [stored(1, { active: false })],
      [product(1, { priceCents: 0 })],
    );

    expect(counts(d)).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: 0,
      reactivated: 1,
    });
  });

  it('AK-3.9 doppelte ID in einer Seite: letzte gewinnt, einmal gezählt', () => {
    const d = diffPage(
      [],
      [product(1, { name: 'first' }), product(2), product(1, { name: 'last' })],
    );

    expect(d.upserts).toEqual([product(2), product(1, { name: 'last' })]);
    expect(d.seenIds).toEqual([2, 1]);
    expect(d.duplicateIds).toEqual([1]);
    expect(d.inserted).toBe(2);
  });

  it('AK-3.9 Duplikat eines bekannten Produkts: der letzte Wert entscheidet über updated', () => {
    const d = diffPage(
      [stored(1)],
      [product(1, { priceCents: 9999 }), product(1)], // last one equals stored
    );

    expect(counts(d)).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 1,
      reactivated: 0,
    });
    expect(d.upserts).toEqual([]);
  });

  it('gemischte Seite: jedes Produkt genau einmal gezählt', () => {
    const d = diffPage(
      [stored(1), stored(2), stored(3, { active: false })],
      [product(1), product(2, { name: 'x' }), product(3), product(4)],
    );

    expect(counts(d)).toEqual({
      inserted: 1,
      updated: 1,
      unchanged: 1,
      reactivated: 1,
    });
    expect(d.seenIds).toHaveLength(4);
  });

  it('leere Seite', () => {
    expect(diffPage([], [])).toMatchObject({
      upserts: [],
      seenIds: [],
      inserted: 0,
    });
  });
});
