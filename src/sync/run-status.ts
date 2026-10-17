export type RunStatus = 'running' | 'completed' | 'partial' | 'failed';
export type FinalStatus = Exclude<RunStatus, 'running'>;

/** Everything about a finished run that decides its status (AK-4.3). */
export interface RunOutcome {
  /** Run-ending problem: shutdown, DB error, page 1 failed, too many failures in a row. */
  fatalError?: string;
  /** Pages still missing after the second pass. */
  missingPages: number;
  /** `total` differed between pages (AK-2.4). */
  totalChanged: boolean;
  /** Set once deactivation was attempted and the ratio guard refused (AK-6.3). */
  deactivationBlocked?: string;
}

export interface StatusDecision {
  status: FinalStatus;
  /** Only a complete run may deactivate missing products (AK-6.1, AK-6.2). */
  deactivate: boolean;
  error?: string;
}

/** First matching rule wins; see the table in specs/003-sync-job/design.md. */
export function decideStatus(outcome: RunOutcome): StatusDecision {
  if (outcome.fatalError) {
    return { status: 'failed', deactivate: false, error: outcome.fatalError };
  }
  const reasons: string[] = [];
  if (outcome.missingPages > 0) {
    reasons.push(`${outcome.missingPages} page(s) missing after second pass`);
  }
  if (outcome.totalChanged) {
    reasons.push(
      'total changed during the run; pagination may have skipped products',
    );
  }
  if (outcome.deactivationBlocked) reasons.push(outcome.deactivationBlocked);
  if (reasons.length > 0) {
    return { status: 'partial', deactivate: false, error: reasons.join('; ') };
  }
  return { status: 'completed', deactivate: true };
}
