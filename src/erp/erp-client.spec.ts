import { abortableSleep, ErpClient, type ErpClientDeps } from './erp-client.js';
import { type ErpConfig, ERP_CONFIG_DEFAULTS } from './erp-config.js';
import { ErpError } from './erp-error.js';

// ---------- helpers ----------

type Reply = Response | Error | 'hang' | 'hangBody' | 'dropBody';

const product = (id: number) => ({
  id,
  sku: `SKU-${String(id).padStart(5, '0')}`,
  name: `Product ${id}`,
  priceCents: 1990,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const pageBody = (page = 37, pageSize = 2) => ({
  items: Array.from({ length: pageSize }, (_, i) =>
    product((page - 1) * pageSize + i + 1),
  ),
  page,
  pageSize,
  total: 10_000,
});

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const ok = (page = 37, pageSize = 2) => json(200, pageBody(page, pageSize));
const status = (code: number, headers: Record<string, string> = {}) =>
  json(code, { error: `error ${code}` }, headers);

const waitForAbort = (signal: AbortSignal) =>
  new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    }),
  );

/** A fetch fake that answers with `replies` in order and honours the abort signal. */
function fakeFetch(...replies: Reply[]) {
  let i = 0;
  return vi.fn<typeof fetch>(async (_input, init) => {
    const signal = init!.signal!;
    const reply = replies[i++];
    if (reply === undefined)
      throw new Error(`fetch called more than ${replies.length} times`);
    if (reply instanceof Error) throw reply;
    if (reply === 'hang') return waitForAbort(signal);
    if (reply === 'hangBody' || reply === 'dropBody') {
      // Headers arrive, then the body stalls (and errors on abort) or drops.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"items":['));
          if (reply === 'dropBody')
            controller.error(new TypeError('terminated'));
          else
            signal.addEventListener('abort', () =>
              controller.error(signal.reason),
            );
        },
      });
      return new Response(body, { status: 200 });
    }
    return reply;
  });
}

function setup(
  replies: Reply[],
  {
    config = {},
    ...deps
  }: { config?: Partial<ErpConfig> } & Partial<ErpClientDeps> = {},
) {
  const fetch = fakeFetch(...replies);
  const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => {});
  const logger = { warn: vi.fn() };
  const client = new ErpClient(
    { ...ERP_CONFIG_DEFAULTS, ...config },
    { fetch, sleep, logger, random: () => 0.5, now: () => 0, ...deps },
  );
  const sleeps = () => sleep.mock.calls.map(([ms]) => ms);
  return { client, fetch, sleep, sleeps, logger };
}

async function failure(promise: Promise<unknown>): Promise<ErpError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ErpError);
    return err as ErpError;
  }
  throw new Error('expected fetchPage to reject');
}

// ---------- tests ----------

describe('Anforderung 1 – Seite abrufen', () => {
  it('AK-1.1 liefert die Seite nach einem Versuch, ohne zu warten', async () => {
    const { client, fetch, sleep } = setup([ok(37, 100)]);

    const page = await client.fetchPage(37, 100);

    expect(page).toEqual(pageBody(37, 100));
    expect(page.items).toHaveLength(100);
    expect(fetch).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('AK-1.2 sendet GET <baseUrl>/products?page&pageSize mit Accept: application/json', async () => {
    const { client, fetch } = setup([ok()], {
      config: { baseUrl: 'http://erp.test' },
    });

    await client.fetchPage(37, 2);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://erp.test/products?page=37&pageSize=2');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.headers).toEqual({ Accept: 'application/json' });
  });

  it('gibt nur bekannte Felder zurück', async () => {
    const body = pageBody();
    const { client } = setup([
      json(200, {
        ...body,
        extra: 1,
        items: body.items.map((p) => ({ ...p, secret: 'x' })),
      }),
    ]);

    const page = await client.fetchPage(37, 2);

    expect(page).toEqual(pageBody());
  });

  it('AK-1.3 vollständiger, aber ungültiger JSON-Body → invalidResponse ohne Retry', async () => {
    const { client, sleep } = setup([
      new Response('{"items": [oops', { status: 200 }),
    ]);

    const err = await failure(client.fetchPage(37, 2));

    expect(err).toMatchObject({
      reason: 'invalidResponse',
      retryable: false,
      attempts: 1,
    });
    expect(err.message).toContain('not valid JSON');
    expect(sleep).not.toHaveBeenCalled();
  });

  const broken = (patch: (b: ReturnType<typeof pageBody>) => unknown) =>
    patch(pageBody());
  it.each<[string, unknown, string]>([
    ['Body ist ein Array', [], 'not a JSON object'],
    [
      'items fehlt',
      broken((b) => ({ ...b, items: undefined })),
      'items must be an array',
    ],
    ['total fehlt', broken((b) => ({ ...b, total: undefined })), 'total'],
    [
      'Produkt ist null',
      broken((b) => ({ ...b, items: [null] })),
      'items[0] is not an object',
    ],
    [
      'id ist 0',
      broken((b) => ({ ...b, items: [{ ...b.items[0], id: 0 }] })),
      'items[0].id',
    ],
    [
      'sku fehlt',
      broken((b) => ({ ...b, items: [{ ...b.items[0], sku: undefined }] })),
      'items[0].sku',
    ],
    [
      'priceCents als Franken (19.9)',
      broken((b) => ({ ...b, items: [{ ...b.items[0], priceCents: 19.9 }] })),
      'items[0].priceCents',
    ],
    [
      'priceCents als String',
      broken((b) => ({ ...b, items: [{ ...b.items[0], priceCents: '1990' }] })),
      'items[0].priceCents',
    ],
    [
      'updatedAt kein ISO',
      broken((b) => ({
        ...b,
        items: [b.items[0], { ...b.items[1], updatedAt: 'yesterday' }],
      })),
      'items[1].updatedAt',
    ],
  ])(
    'AK-1.3 Schema verletzt: %s → invalidResponse',
    async (_, body, message) => {
      const { client, sleep } = setup([json(200, body)]);

      const err = await failure(client.fetchPage(37, 2));

      expect(err).toMatchObject({
        reason: 'invalidResponse',
        retryable: false,
        attempts: 1,
      });
      expect(err.message).toContain(message);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it('AK-1.4 Verbindungsabbruch beim Lesen des Body ist ein Netzwerkfehler und wird wiederholt', async () => {
    const { client, fetch, sleeps } = setup(['dropBody', ok()]);

    await expect(client.fetchPage(37, 2)).resolves.toEqual(pageBody());

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleeps()).toEqual([100]);
  });

  it('AK-1.4 bleibt der Body kaputt, endet es mit reason network, nicht invalidResponse', async () => {
    const { client } = setup(['dropBody'], { config: { maxAttempts: 1 } });

    const err = await failure(client.fetchPage(37, 2));

    expect(err).toMatchObject({ reason: 'network', retryable: true });
    expect(err.message).toContain('terminated');
  });

  it.each<[string, unknown, string]>([
    [
      'Seite 36 statt 37',
      pageBody(36, 2),
      'response page 36 does not match requested page 37',
    ],
    [
      'pageSize 3 statt 2',
      { ...pageBody(37, 2), pageSize: 3 },
      'response pageSize 3 does not match',
    ],
    [
      'mehr items als pageSize',
      { ...pageBody(37, 3), pageSize: 2 },
      'items has 3 entries, more than pageSize 2',
    ],
  ])('AK-1.5 %s → invalidResponse ohne Retry', async (_, body, message) => {
    const { client, sleep } = setup([json(200, body)]);

    const err = await failure(client.fetchPage(37, 2));

    expect(err).toMatchObject({
      reason: 'invalidResponse',
      retryable: false,
      attempts: 1,
    });
    expect(err.message).toContain(message);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('AK-1.5 weniger items als pageSize (letzte Seite) ist gültig', async () => {
    const { client } = setup([
      json(200, { ...pageBody(100, 1), pageSize: 2, page: 100 }),
    ]);

    await expect(client.fetchPage(100, 2)).resolves.toMatchObject({
      page: 100,
      pageSize: 2,
    });
  });

  it.each([
    [0, 100],
    [-1, 100],
    [1.5, 100],
    [NaN, 100],
    [1, 0],
    [1, 1001],
  ])(
    'AK-1.6 fetchPage(%s, %s) → invalidArgument ohne Request',
    async (page, pageSize) => {
      const { client, fetch } = setup([]);

      const err = await failure(client.fetchPage(page, pageSize));

      expect(err).toMatchObject({
        reason: 'invalidArgument',
        retryable: false,
        attempts: 0,
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe('Anforderung 2 – Timeout pro Versuch', () => {
  // The timeout is a real AbortSignal.timeout; a small timeoutMs keeps it fast.
  const config = { timeoutMs: 20 };

  it('AK-2.1 ein hängender Versuch wird nach timeoutMs abgebrochen', async () => {
    const { client } = setup(['hang'], {
      config: { ...config, maxAttempts: 1 },
    });

    const err = await failure(client.fetchPage(37, 2));

    expect(err).toMatchObject({
      reason: 'timeout',
      retryable: true,
      attempts: 1,
    });
    expect(err.message).toContain('timed out after 20 ms');
  });

  it('AK-2.2 jeder Versuch bekommt ein eigenes, frisches Timeout', async () => {
    const { client, fetch } = setup(['hang', 'hang', ok()], { config });

    await expect(client.fetchPage(37, 2)).resolves.toEqual(pageBody());

    const signals = fetch.mock.calls.map(([, init]) => init!.signal!);
    expect(new Set(signals).size).toBe(3);
    expect(signals.map((s) => s.aborted)).toEqual([true, true, false]);
  });

  it('AK-2.3 hängt der Body nach rechtzeitigen Headern, gilt das als timeout', async () => {
    const { client } = setup(['hangBody'], {
      config: { ...config, maxAttempts: 1 },
    });

    const err = await failure(client.fetchPage(37, 2));

    expect(err).toMatchObject({ reason: 'timeout', retryable: true });
  });
});

describe('Anforderung 3 – Retry mit Backoff und Jitter', () => {
  it.each<[string, Reply]>([
    ['408', status(408)],
    ['500', status(500)],
    ['502', status(502)],
    ['503 ohne Retry-After', status(503)],
    ['504', status(504)],
    ['Netzwerkfehler', new TypeError('fetch failed')],
  ])('AK-3.1 %s wird wiederholt', async (_, reply) => {
    const { client, fetch, sleeps } = setup([reply, ok()]);

    await expect(client.fetchPage(37, 2)).resolves.toEqual(pageBody());

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleeps()).toEqual([100]);
  });

  it('AK-3.3 mit random() = 0.5 wartet der Client 100, 200, 400, 800 ms', async () => {
    const { client, sleeps } = setup([
      status(500),
      status(500),
      status(500),
      status(500),
      ok(),
    ]);

    await client.fetchPage(37, 2);

    expect(sleeps()).toEqual([100, 200, 400, 800]);
  });

  it('AK-3.4 die Pause ist durch maxDelayMs gedeckelt', async () => {
    const { client, sleeps } = setup(
      [status(500), status(500), status(500), ok()],
      {
        config: { baseDelayMs: 200, maxDelayMs: 300 },
        random: () => 1,
      },
    );

    await client.fetchPage(37, 2);

    expect(sleeps()).toEqual([200, 300, 300]);
  });

  it('AK-3.5 nach maxAttempts retrybaren Fehlern: ErpError mit letztem Grund, ohne Pause danach', async () => {
    const { client, fetch, sleep } = setup([
      status(500),
      status(502),
      status(500),
      status(504),
      status(500),
    ]);

    const err = await failure(client.fetchPage(37, 2));

    expect(err).toMatchObject({
      reason: 'http',
      status: 500,
      attempts: 5,
      retryable: true,
    });
    expect(err.message).toBe(
      'ERP GET /products?page=37&pageSize=2 failed after 5 attempts: HTTP 500 (error 500)',
    );
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it('AK-3.6 gelingt ein späterer Versuch, kommt die Seite normal zurück', async () => {
    const { client } = setup([
      new TypeError('fetch failed'),
      status(503),
      ok(),
    ]);

    await expect(client.fetchPage(37, 2)).resolves.toEqual(pageBody());
  });

  it('AK-3.7 jeder Retry wird mit page, Versuch, Grund und Wartezeit geloggt', async () => {
    const { client, logger } = setup([
      status(500),
      status(429, { 'Retry-After': '2' }),
      ok(),
    ]);

    await client.fetchPage(37, 2);

    expect(logger.warn.mock.calls).toEqual([
      [
        'Retrying ERP request',
        {
          page: 37,
          attempt: 1,
          reason: 'HTTP 500 (error 500)',
          delayMs: 100,
          delaySource: 'backoff',
        },
      ],
      [
        'Retrying ERP request',
        {
          page: 37,
          attempt: 2,
          reason: 'HTTP 429 (error 429)',
          delayMs: 2000,
          delaySource: 'retryAfter',
        },
      ],
    ]);
  });

  it('AK-3.7 nach dem letzten Versuch wird kein Retry geloggt', async () => {
    const { client, logger } = setup([status(500)], {
      config: { maxAttempts: 1 },
    });

    await failure(client.fetchPage(37, 2));

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('Anforderung 4 – 429 und Retry-After', () => {
  const now = Date.parse('2026-10-21T07:28:00Z');

  it('AK-4.1 429 mit Retry-After: 2 wartet genau 2000 ms statt Backoff', async () => {
    const random = vi.fn(() => 0.5);
    const { client, sleeps } = setup(
      [status(429, { 'Retry-After': '2' }), ok()],
      { random },
    );

    await client.fetchPage(37, 2);

    expect(sleeps()).toEqual([2000]);
    expect(random).not.toHaveBeenCalled();
  });

  it('AK-4.2 Retry-After als HTTP-Datum wartet bis zu diesem Zeitpunkt', async () => {
    const { client, sleeps } = setup(
      [status(429, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:03 GMT' }), ok()],
      {
        now: () => now,
      },
    );

    await client.fetchPage(37, 2);

    expect(sleeps()).toEqual([3000]);
  });

  it('AK-4.2 ein HTTP-Datum in der Vergangenheit ergibt 0 ms', async () => {
    const { client, sleeps } = setup(
      [status(429, { 'Retry-After': 'Wed, 21 Oct 2026 07:00:00 GMT' }), ok()],
      {
        now: () => now,
      },
    );

    await client.fetchPage(37, 2);

    expect(sleeps()).toEqual([0]);
  });

  it.each([
    ['fehlt', {}],
    ['ungültig', { 'Retry-After': 'abc' }],
    ['negativ', { 'Retry-After': '-1' }],
  ])('AK-4.3 429 mit Retry-After %s nutzt den Backoff', async (_, headers) => {
    const { client, sleeps } = setup([status(429, headers), ok()]);

    await client.fetchPage(37, 2);

    expect(sleeps()).toEqual([100]);
  });

  it('AK-4.4 429 zählt gegen maxAttempts', async () => {
    const replies = Array.from({ length: 5 }, () =>
      status(429, { 'Retry-After': '2' }),
    );
    const { client, fetch, sleeps } = setup(replies);

    const err = await failure(client.fetchPage(37, 2));

    expect(err).toMatchObject({
      reason: 'http',
      status: 429,
      attempts: 5,
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(sleeps()).toEqual([2000, 2000, 2000, 2000]);
  });

  it('AK-4.5 Retry-After über maxRetryAfterMs: sofort rateLimited mit retryAfterMs', async () => {
    const { client, sleep } = setup([status(429, { 'Retry-After': '31' })]);

    const err = await failure(client.fetchPage(37, 2));

    expect(err).toMatchObject({
      reason: 'rateLimited',
      retryable: true,
      attempts: 1,
      status: 429,
      retryAfterMs: 31_000,
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('AK-4.5 Retry-After genau maxRetryAfterMs wird noch abgewartet', async () => {
    const { client, sleeps } = setup([
      status(429, { 'Retry-After': '30' }),
      ok(),
    ]);

    await client.fetchPage(37, 2);

    expect(sleeps()).toEqual([30_000]);
  });

  it('AK-4.6 503 mit Retry-After wird wie 429 behandelt', async () => {
    const { client, sleeps } = setup([
      status(503, { 'Retry-After': '2' }),
      ok(),
    ]);

    await client.fetchPage(37, 2);

    expect(sleeps()).toEqual([2000]);
  });
});

describe('Anforderung 5 – Kein Retry bei Client-Fehlern', () => {
  it('AK-5.1 / AK-5.3 400 scheitert sofort, mit Status und error aus dem Body', async () => {
    const reply = json(400, {
      error: 'page and pageSize must be positive integers',
    });
    const { client, fetch, sleep } = setup([reply]);

    const err = await failure(client.fetchPage(37, 2));

    expect(err).toMatchObject({
      reason: 'http',
      status: 400,
      attempts: 1,
      retryable: false,
    });
    expect(err.message).toBe(
      'ERP GET /products?page=37&pageSize=2 failed after 1 attempt: HTTP 400 (page and pageSize must be positive integers)',
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 422, 501])(
    'AK-5.2 %i scheitert sofort ohne Retry',
    async (code) => {
      const { client, fetch } = setup([status(code)]);

      const err = await failure(client.fetchPage(37, 2));

      expect(err).toMatchObject({
        reason: 'http',
        status: code,
        attempts: 1,
        retryable: false,
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it('AK-5.3 ohne JSON-Body enthält die Meldung nur den Status', async () => {
    const { client } = setup([new Response('Bad Request', { status: 400 })]);

    const err = await failure(client.fetchPage(37, 2));

    expect(err.message).toMatch(/HTTP 400$/);
  });
});

describe('Anforderung 6 – Abbruch durch den Aufrufer', () => {
  it('AK-6.1 Abbruch während eines Versuchs: aborted, kein weiterer Versuch', async () => {
    const { client, fetch } = setup(['hang', ok()], {
      config: { timeoutMs: 60_000 },
    });
    const controller = new AbortController();

    const promise = client.fetchPage(37, 2, controller.signal);
    setTimeout(() => controller.abort(), 5);
    const err = await failure(promise);

    expect(err).toMatchObject({
      reason: 'aborted',
      retryable: false,
      attempts: 1,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('AK-6.1 Abbruch während der Pause: aborted, kein weiterer Versuch', async () => {
    // Real abortableSleep with a long pause, so only the abort can end it.
    const { client, fetch } = setup(
      [status(429, { 'Retry-After': '20' }), ok()],
      { sleep: abortableSleep },
    );
    const controller = new AbortController();

    const promise = client.fetchPage(37, 2, controller.signal);
    setTimeout(() => controller.abort(), 5);
    const err = await failure(promise);

    expect(err).toMatchObject({ reason: 'aborted', attempts: 1 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('AK-6.2 ein schon abgebrochenes Signal sendet keinen Request', async () => {
    const { client, fetch } = setup([ok()]);

    const err = await failure(client.fetchPage(37, 2, AbortSignal.abort()));

    expect(err).toMatchObject({ reason: 'aborted', attempts: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ein Timeout wird nicht mit einem Abbruch des Aufrufers verwechselt', async () => {
    const controller = new AbortController();
    const { client } = setup(['hang'], {
      config: { timeoutMs: 20, maxAttempts: 1 },
    });

    const err = await failure(client.fetchPage(37, 2, controller.signal));

    expect(err.reason).toBe('timeout');
  });
});

describe('Anforderung 7 – Testbarkeit durch Injektion', () => {
  it('AK-7.2 500, 500, 200 mit random 0.5: Pausen genau [100, 200], ohne echte Wartezeit', async () => {
    const { client, sleeps } = setup([status(500), status(500), ok()]);
    const start = performance.now();

    await expect(client.fetchPage(37, 2)).resolves.toEqual(pageBody());

    expect(sleeps()).toEqual([100, 200]);
    // Sanity only: without injection this would take >= 300 ms.
    expect(performance.now() - start).toBeLessThan(300);
  });

  it('AK-7.3 mit injizierten Funktionen werden Math.random, Date.now und setTimeout nicht direkt genutzt', async () => {
    const mathRandom = vi.spyOn(Math, 'random');
    const dateNow = vi.spyOn(Date, 'now');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      const { client } = setup(
        [
          status(500),
          status(429),
          status(429, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:03 GMT' }),
          ok(),
        ],
        { now: () => Date.UTC(2026, 9, 21, 7, 28, 0) },
      ); // injected clock
      await client.fetchPage(37, 2);

      expect(mathRandom).not.toHaveBeenCalled();
      expect(dateNow).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('abortableSleep wartet ms und bricht bei Abbruch sofort ab', async () => {
    const start = performance.now();
    await abortableSleep(15);
    expect(performance.now() - start).toBeGreaterThanOrEqual(14);

    await expect(
      abortableSleep(10_000, AbortSignal.abort('stop')),
    ).rejects.toBe('stop');

    const controller = new AbortController();
    const pending = abortableSleep(10_000, controller.signal);
    controller.abort('later');
    await expect(pending).rejects.toBe('later');
  });
});

describe('Anforderung 10 – Begrenzte Dauer', () => {
  it('AK-10.1 / AK-10.2 Standardwerte: 5 × 2 s + 4 × 30 s = 130 s', () => {
    expect(ErpClient.maxDurationMs(ERP_CONFIG_DEFAULTS)).toBe(130_000);
  });

  it('AK-10.1 nimmt die längere der beiden Pausen-Obergrenzen', () => {
    const config = {
      ...ERP_CONFIG_DEFAULTS,
      maxAttempts: 3,
      timeoutMs: 100,
      maxDelayMs: 9000,
      maxRetryAfterMs: 1000,
    };
    expect(ErpClient.maxDurationMs(config)).toBe(3 * 100 + 2 * 9000);
  });

  it('AK-10.1 die Summe der Pausen eines echten Laufs bleibt unter der Obergrenze', async () => {
    const replies = Array.from({ length: 5 }, () =>
      status(429, { 'Retry-After': '30' }),
    );
    const { client, sleeps } = setup(replies);

    await failure(client.fetchPage(37, 2));

    const paused = sleeps().reduce((a, b) => a + b, 0);
    expect(paused).toBe(120_000);
    expect(paused + 5 * ERP_CONFIG_DEFAULTS.timeoutMs).toBeLessThanOrEqual(
      ErpClient.maxDurationMs(ERP_CONFIG_DEFAULTS),
    );
  });
});
