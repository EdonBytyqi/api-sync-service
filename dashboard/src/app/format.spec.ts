import {
  formatDateTime,
  formatDuration,
  formatNumber,
  runDurationMs,
  STATUS_ICON,
  STATUS_TEXT,
} from './format';
import { run, running } from './testing';

describe('format', () => {
  it('AK-1.3 Tausendertrennzeichen wie Intl de-CH, ohne ein festes Zeichen vorauszusetzen', () => {
    expect(formatNumber(10_000)).toBe(new Intl.NumberFormat('de-CH').format(10_000));
    expect(formatNumber(10_000)).toMatch(/^10['’]000$/);
    expect(formatNumber(0)).toBe('0');
  });

  it('AK-1.2 Datum und Uhrzeit in Europe/Zurich, unabhängig von der Zeitzone des Rechners', () => {
    // 13:05 UTC is 15:05 in Zurich during summer time.
    expect(formatDateTime('2026-10-17T13:05:58.000Z')).toBe('17.10.2026, 15:05:58');
  });

  it('AK-1.2 Sommerzeit-Wechsel (29.03.2026, 02:00 → 03:00)', () => {
    expect(formatDateTime('2026-03-29T00:30:00.000Z')).toBe('29.03.2026, 01:30:00'); // CET
    expect(formatDateTime('2026-03-29T01:30:00.000Z')).toBe('29.03.2026, 03:30:00'); // CEST
  });

  it.each([
    [0, '0 s'],
    [49_000, '49 s'],
    [125_000, '2 min 05 s'],
    [3_720_000, '1 h 02 min'],
    [-5_000, '0 s'],
  ])('formatDuration(%i) = %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it('Dauer: beendete Läufe aus Server-Zeiten, laufende gegen jetzt', () => {
    expect(runDurationMs(run(), new Date('2030-01-01'))).toBe(49_000);
    const r = running({ startedAt: '2026-10-17T13:00:00.000Z' });
    expect(runDurationMs(r, new Date('2026-10-17T13:00:42.000Z'))).toBe(42_000);
  });

  it('AK-2.1 jeder Status hat Text und Symbol', () => {
    expect(STATUS_TEXT).toEqual({
      running: 'läuft',
      completed: 'abgeschlossen',
      partial: 'teilweise',
      failed: 'fehlgeschlagen',
    });
    expect(Object.keys(STATUS_ICON).sort()).toEqual(Object.keys(STATUS_TEXT).sort());
  });
});
