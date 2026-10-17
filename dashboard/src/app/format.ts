import type { RunStatus, SyncRun, SyncTrigger } from './models';

const numberFormat = new Intl.NumberFormat('de-CH');
const dateTimeFormat = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const timeFormat = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Swiss thousands separator, exactly as Intl renders it (AK-1.3). */
export const formatNumber = (n: number): string => numberFormat.format(n);

/** Date and time in Europe/Zurich, independent of the machine's time zone (AK-1.2). */
export const formatDateTime = (iso: string): string => dateTimeFormat.format(new Date(iso));

export const formatTime = (date: Date): string => timeFormat.format(date);

/** 49 s · 2 min 05 s · 1 h 02 min */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h} h ${pad(m)} min`;
  if (m > 0) return `${m} min ${pad(s)} s`;
  return `${s} s`;
}

/** Finished runs use server times only; running runs measure against `now`. */
export const runDurationMs = (run: SyncRun, now: Date): number =>
  (run.finishedAt ? Date.parse(run.finishedAt) : now.getTime()) - Date.parse(run.startedAt);

export const STATUS_TEXT: Record<RunStatus, string> = {
  running: 'läuft',
  completed: 'abgeschlossen',
  partial: 'teilweise',
  failed: 'fehlgeschlagen',
};

export const STATUS_ICON: Record<RunStatus, string> = {
  running: '⟳',
  completed: '✓',
  partial: '⚠',
  failed: '✕',
};

export const TRIGGER_TEXT: Record<SyncTrigger, string> = {
  schedule: 'Zeitplan',
  manual: 'Manuell',
};
