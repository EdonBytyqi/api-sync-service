import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, generateProducts, MAX_PAGE_SIZE, TOTAL } from '../app.js';
import { noSleep, sequence, stableConfig } from './helpers.js';

const app = createApp(stableConfig());
const ids = (body) => body.items.map((p) => p.id);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('Anforderung 1 – Produkte seitenweise abrufen', () => {
  it('AK-1.1 page=1&pageSize=100 liefert 200 und genau 100 Produkte, sortiert nach id', async () => {
    const res = await request(app).get('/products?page=1&pageSize=100');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(100);
    expect(ids(res.body)).toEqual(range(1, 100));
  });

  it('AK-1.2 page=37&pageSize=100 liefert die ids 3601 bis 3700', async () => {
    const res = await request(app).get('/products?page=37&pageSize=100');

    expect(ids(res.body)).toEqual(range(3601, 3700));
  });

  it('AK-1.3 Antwort enthält items, page, pageSize und total', async () => {
    const res = await request(app).get('/products?page=3&pageSize=25');

    expect(Object.keys(res.body).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
    expect(res.body).toMatchObject({ page: 3, pageSize: 25, total: TOTAL });
  });

  it('AK-1.4 jedes Produkt hat genau die spezifizierten Felder und Typen', () => {
    for (const p of generateProducts()) {
      expect(Object.keys(p).sort()).toEqual(['id', 'name', 'priceCents', 'sku', 'updatedAt']);
      expect(Number.isInteger(p.id)).toBe(true);
      expect(typeof p.sku).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(Number.isInteger(p.priceCents)).toBe(true);
      expect(p.priceCents).toBeGreaterThan(0);
      expect(new Date(p.updatedAt).toISOString()).toBe(p.updatedAt);
    }
  });

  it('AK-1.5 eine Seite hinter dem Ende liefert 200 mit leeren items', async () => {
    const res = await request(app).get('/products?page=101&pageSize=100');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], page: 101, pageSize: 100, total: TOTAL });
  });

  it('AK-1.6 ohne Parameter gilt page=1 und pageSize=100', async () => {
    const res = await request(app).get('/products');

    expect(res.body).toMatchObject({ page: 1, pageSize: 100 });
    expect(ids(res.body)).toEqual(range(1, 100));
  });

  it.each([
    ['page=0', 'page=0&pageSize=100'],
    ['negative page', 'page=-1'],
    ['decimal page', 'page=1.5'],
    ['non-numeric page', 'page=abc'],
    ['empty page', 'page='],
    ['repeated page', 'page=1&page=2'],
    ['pageSize=0', 'pageSize=0'],
    [`pageSize > ${MAX_PAGE_SIZE}`, `pageSize=${MAX_PAGE_SIZE + 1}`],
  ])('AK-1.7 %s liefert sofort 400, ohne Fehler oder Verzögerung zu simulieren', async (_, query) => {
    const random = sequence(); // throws if drawn at all
    const sleep = noSleep();
    const res = await request(createApp(stableConfig(), { random, sleep })).get(`/products?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integers/);
    expect(random).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it(`AK-1.7 pageSize=${MAX_PAGE_SIZE} ist noch gültig`, async () => {
    const res = await request(app).get(`/products?pageSize=${MAX_PAGE_SIZE}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(MAX_PAGE_SIZE);
  });
});

describe('Anforderung 2 – Stabile Reihenfolge', () => {
  it('AK-2.1 ein Neustart erzeugt dieselben Produkte in derselben Reihenfolge', async () => {
    expect(generateProducts()).toEqual(generateProducts());

    const before = await request(app).get('/products?page=37&pageSize=100');
    const after = await request(createApp(stableConfig())).get('/products?page=37&pageSize=100');
    expect(after.body).toEqual(before.body);
  });

  it('AK-2.2 die Seiten 1 bis 100 enthalten jede id von 1 bis 10000 genau einmal', async () => {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const res = await request(app).get(`/products?page=${page}&pageSize=100`);
      all.push(...ids(res.body));
    }

    expect(all).toEqual(range(1, TOTAL));
  });
});
