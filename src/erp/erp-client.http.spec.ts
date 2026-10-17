import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ErpClient } from './erp-client.js';
import { ERP_CONFIG_DEFAULTS } from './erp-config.js';
import { ErpError } from './erp-error.js';

// AK-1.3 / AK-1.4 against real Node fetch and a real socket, not a fake:
// the distinction relies on where undici throws, so it is verified for real.

const validBody = JSON.stringify({
  items: [
    {
      id: 1,
      sku: 'SKU-00001',
      name: 'Product 1',
      priceCents: 8019,
      updatedAt: '2026-01-01T00:01:00.000Z',
    },
  ],
  page: 1,
  pageSize: 1,
  total: 10_000,
});

let server: Server;
let baseUrl: string;
let requests = 0;
let behaviour: 'dropThenOk' | 'brokenJson' = 'dropThenOk';

beforeAll(async () => {
  server = createServer((_req, res) => {
    requests++;
    if (behaviour === 'brokenJson') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"items": [oops');
    } else if (requests === 1) {
      // Promise 1000 bytes, send a few, then kill the socket mid-body.
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': '1000',
      });
      res.write('{"items":[');
      setTimeout(() => res.socket?.destroy(), 10);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(validBody);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests = 0;
});

const client = () =>
  new ErpClient(
    { ...ERP_CONFIG_DEFAULTS, baseUrl, timeoutMs: 1000 },
    { sleep: async () => {}, logger: { warn: () => {} } },
  );

it('AK-1.4 echter Verbindungsabbruch mitten im Body wird als network wiederholt', async () => {
  behaviour = 'dropThenOk';

  const page = await client().fetchPage(1, 1);

  expect(page.items[0].id).toBe(1);
  expect(requests).toBe(2);
});

it('AK-1.3 echter, vollständiger, aber kaputter JSON-Body ist invalidResponse ohne Retry', async () => {
  behaviour = 'brokenJson';

  const err = await client()
    .fetchPage(1, 1)
    .catch((e: unknown) => e);

  expect(err).toBeInstanceOf(ErpError);
  expect(err).toMatchObject({
    reason: 'invalidResponse',
    retryable: false,
    attempts: 1,
  });
  expect(requests).toBe(1);
});
