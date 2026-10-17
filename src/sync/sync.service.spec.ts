import type { RunResult } from './sync-runner.js';
import type { StartResult, SyncRun } from './sync-runs.repository.js';
import { SyncService } from './sync.service.js';

const run = { id: 7, status: 'running' } as SyncRun;
const logger = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

function setup(
  startResult: StartResult,
  runImpl?: (id: number, signal: AbortSignal) => Promise<RunResult>,
) {
  const runs = { start: vi.fn(async () => startResult) };
  const runner = {
    run: vi.fn(
      runImpl ??
        (async (_id: number, signal: AbortSignal) =>
          new Promise<RunResult>((resolve) =>
            signal.addEventListener('abort', () =>
              resolve({
                status: 'failed',
                deactivate: false,
                error: `aborted: ${(signal.reason as Error).message}`,
                fenced: false,
              }),
            ),
          )),
    ),
  };
  const log = logger();
  const service = new SyncService(
    { pageSize: 100, staleAfterMs: 190_000 },
    runs,
    runner,
    log,
  );
  return { service, runs, runner, log };
}

describe('SyncService', () => {
  it('AK-8.2 start kehrt sofort zurück, der Lauf läuft im Hintergrund weiter', async () => {
    const { service, runs, runner } = setup({
      started: true,
      run,
      abandonedRunIds: [],
    });

    const result = await service.start('manual');

    expect(result).toMatchObject({ started: true, run: { id: 7 } });
    expect(runs.start).toHaveBeenCalledWith('manual', 100, 190_000);
    expect(runner.run).toHaveBeenCalledWith(7, expect.any(AbortSignal));
    await service.stopAll();
  });

  it('AK-7.1 läuft schon ein Lauf, startet der Runner nicht', async () => {
    const { service, runner } = setup({ started: false, runningRunId: 3 });

    expect(await service.start('schedule')).toEqual({
      started: false,
      runningRunId: 3,
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('AK-7.4 übernommene verwaiste Läufe werden geloggt', async () => {
    const { service, log } = setup({
      started: true,
      run,
      abandonedRunIds: [5],
    });

    await service.start('manual');

    expect(log.warn).toHaveBeenCalledWith(
      'sync run 5 marked failed: abandoned (no heartbeat)',
    );
    await service.stopAll();
  });

  it('AK-8.4 stopAll bricht laufende Läufe mit Grund ab und wartet auf ihr Ende', async () => {
    let finished: RunResult | undefined;
    const { service } = setup(
      { started: true, run, abandonedRunIds: [] },
      (_id, signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => {
            setTimeout(() => {
              finished = {
                status: 'failed',
                deactivate: false,
                error: `aborted: ${(signal.reason as Error).message}`,
                fenced: false,
              };
              resolve(finished);
            }, 10);
          }),
        ),
    );
    await service.start('manual');

    await service.stopAll('shutdown');

    expect(finished).toMatchObject({ error: 'aborted: shutdown' });
  });

  it('ein unerwarteter Absturz des Runners wird geloggt und hinterlässt keinen aktiven Lauf', async () => {
    const { service, log } = setup(
      { started: true, run, abandonedRunIds: [] },
      async () => {
        throw new Error('boom');
      },
    );

    await service.start('manual');
    await service.whenIdle();

    expect(log.error).toHaveBeenCalledWith('sync run 7 crashed: boom');
  });
});
