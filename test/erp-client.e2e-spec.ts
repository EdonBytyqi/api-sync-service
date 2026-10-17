import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  abortableSleep,
  ErpClient,
  type ErpClientDeps,
} from '../src/erp/erp-client.js';
import { type ErpConfig, ERP_CONFIG_DEFAULTS } from '../src/erp/erp-config.js';
import { ErpError } from '../src/erp/erp-error.js';

// The mock is an external system: started as its own process and spoken to
// over HTTP only. Requires `npm install` in mock-erp/ (see README).
const MOCK_SERVER = fileURLToPath(
  new URL('../mock-erp/server.js', import.meta.url),
);

interface RunningMock {
  baseUrl: string;
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  server.close();
  await once(server, 'close');
  return port;
}

async function startMock(env: Record<string, string>): Promise<RunningMock> {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, [MOCK_SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      FAILURE_RATE: '0',
      SLOW_RATE: '0',
      RATE_LIMIT_RATE: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    let stderr = '';
    child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('mock-erp on')) resolve();
    });
    child.once('exit', (code) =>
      reject(new Error(`mock-erp exited with ${code}: ${stderr}`)),
    );
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill();
      await once(child, 'exit');
    },
  };
}

function clientFor(
  mock: RunningMock,
  config: Partial<ErpConfig>,
  deps: Partial<ErpClientDeps> = {},
) {
  const realFetch = deps.fetch ?? fetch;
  const fetchSpy = vi.fn<typeof fetch>((input, init) => realFetch(input, init));
  const sleeps: number[] = [];
  const client = new ErpClient(
    { ...ERP_CONFIG_DEFAULTS, baseUrl: mock.baseUrl, ...config },
    {
      // Real sleep, recorded, so we see the waits the client actually chose.
      sleep: (ms, signal) => {
        sleeps.push(ms);
        return abortableSleep(ms, signal);
      },
      logger: { warn: () => {} },
      ...deps,
      fetch: fetchSpy,
    },
  );
  return { client, fetchSpy, sleeps };
}

const fast = { baseDelayMs: 1, maxDelayMs: 1 };

async function failure(promise: Promise<unknown>): Promise<ErpError> {
  const err = await promise.then(
    () => {
      throw new Error('expected fetchPage to reject');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ErpError);
  return err as ErpError;
}

describe('ErpClient gegen das echte Mock-ERP', () => {
  let mock: RunningMock | undefined;

  afterEach(async () => {
    await mock?.stop();
    mock = undefined;
  });

  it('AK-9.1 alle Raten 0: Seite 37 liefert die ids 3601 bis 3700 nach einem Versuch', async () => {
    mock = await startMock({});
    const { client, fetchSpy } = clientFor(mock, {});

    const page = await client.fetchPage(37, 100);

    expect(page.items.map((p) => p.id)).toEqual(
      Array.from({ length: 100 }, (_, i) => 3601 + i),
    );
    expect(page).toMatchObject({ page: 37, pageSize: 100, total: 10_000 });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('AK-9.2 FAILURE_RATE=1: nach maxAttempts ein ErpError mit status 500', async () => {
    mock = await startMock({ FAILURE_RATE: '1' });
    const { client, fetchSpy } = clientFor(mock, { ...fast, maxAttempts: 3 });

    const err = await failure(client.fetchPage(1, 10));

    expect(err).toMatchObject({
      reason: 'http',
      status: 500,
      attempts: 3,
      retryable: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('AK-9.3 RATE_LIMIT_RATE=1: wartet laut Retry-After 2000 ms, dann ErpError mit status 429', async () => {
    mock = await startMock({ RATE_LIMIT_RATE: '1' });
    const { client, sleeps } = clientFor(mock, { maxAttempts: 2 });
    const start = performance.now();

    const err = await failure(client.fetchPage(1, 10));

    expect(err).toMatchObject({ reason: 'http', status: 429, attempts: 2 });
    expect(sleeps).toEqual([2000]);
    expect(performance.now() - start).toBeGreaterThanOrEqual(1990);
  }, 10_000);

  it('AK-9.4 SLOW_RATE=1 mit SLOW_MS > timeoutMs: jeder Versuch endet mit timeout', async () => {
    mock = await startMock({ SLOW_RATE: '1', SLOW_MS: '500' });
    const { client, fetchSpy } = clientFor(mock, {
      ...fast,
      timeoutMs: 50,
      maxAttempts: 3,
    });

    const err = await failure(client.fetchPage(1, 10));

    expect(err).toMatchObject({
      reason: 'timeout',
      attempts: 3,
      retryable: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('AK-2.4 Standard-Timeout 2 s schneidet die 5-s-Verzögerung des Mocks ab', async () => {
    mock = await startMock({ SLOW_RATE: '1' }); // SLOW_MS default 5000
    const { client } = clientFor(mock, { maxAttempts: 1 }); // timeoutMs default 2000
    const start = performance.now();

    const err = await failure(client.fetchPage(1, 10));
    const elapsed = performance.now() - start;

    expect(err.reason).toBe('timeout');
    // Loose bounds on purpose: proves "about 2 s, clearly not 5 s".
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(4500);
  }, 10_000);

  it('AK-5.1 ein echter 400 des Mocks wird nicht wiederholt', async () => {
    // FAILURE_RATE=1 would turn every retry into a 500; the mock validates
    // before simulating chaos, so the 400 is deterministic (spec 001).
    mock = await startMock({ FAILURE_RATE: '1' });
    // The client never sends invalid parameters itself, so corrupt the URL
    // on the way out to provoke a real 400 from the ERP.
    const corrupting: typeof fetch = (input, init) =>
      fetch((input as string).replace('page=1&', 'page=1e2&'), init); // client passes a string URL
    const { client, fetchSpy } = clientFor(mock, {}, { fetch: corrupting });

    const err = await failure(client.fetchPage(1, 10));

    expect(err).toMatchObject({
      reason: 'http',
      status: 400,
      attempts: 1,
      retryable: false,
    });
    expect(err.message).toContain(
      'page and pageSize must be positive integers',
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
