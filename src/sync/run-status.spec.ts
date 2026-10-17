import {
  decideStatus,
  type RunOutcome,
  type StatusDecision,
} from './run-status.js';

const ok: RunOutcome = { missingPages: 0, totalChanged: false };

describe('decideStatus (Tabelle aus design.md)', () => {
  it.each<[string, RunOutcome, Partial<StatusDecision>]>([
    ['vollständig', ok, { status: 'completed', deactivate: true }],
    [
      'fataler Fehler',
      { ...ok, fatalError: 'aborted: shutdown' },
      { status: 'failed', deactivate: false, error: 'aborted: shutdown' },
    ],
    [
      'fataler Fehler schlägt fehlende Seiten',
      { ...ok, missingPages: 3, fatalError: 'db down' },
      { status: 'failed', error: 'db down' },
    ],
    [
      'fehlende Seiten',
      { ...ok, missingPages: 2 },
      {
        status: 'partial',
        deactivate: false,
        error: '2 page(s) missing after second pass',
      },
    ],
    [
      'total geändert',
      { ...ok, totalChanged: true },
      { status: 'partial', deactivate: false },
    ],
    [
      'Deaktivierungs-Sperre',
      { ...ok, deactivationBlocked: 'deactivation blocked: …' },
      {
        status: 'partial',
        deactivate: false,
        error: 'deactivation blocked: …',
      },
    ],
  ])('AK-4.3 %s', (_, outcome, expected) => {
    expect(decideStatus(outcome)).toMatchObject(expected);
  });

  it('AK-4.3 mehrere Gründe für partial werden alle genannt', () => {
    const { error } = decideStatus({ missingPages: 1, totalChanged: true });

    expect(error).toContain('1 page(s) missing');
    expect(error).toContain('total changed');
  });

  it('AK-6.1 / AK-6.2 nur completed deaktiviert', () => {
    expect(decideStatus(ok).deactivate).toBe(true);
    expect(decideStatus({ ...ok, missingPages: 1 }).deactivate).toBe(false);
    expect(decideStatus({ ...ok, fatalError: 'x' }).deactivate).toBe(false);
  });
});
