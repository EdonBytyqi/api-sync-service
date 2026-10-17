import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

// The mock is an external system: started as its own process and spoken to
// over HTTP only. Requires `npm install` in mock-erp/ (see README).
const MOCK_SERVER = fileURLToPath(
  new URL('../mock-erp/server.js', import.meta.url),
);

export interface RunningMock {
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

export async function startMock(
  env: Record<string, string>,
): Promise<RunningMock> {
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
