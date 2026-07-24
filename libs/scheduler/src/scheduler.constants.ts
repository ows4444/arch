export const SCHEDULER_MODULE_OPTIONS = Symbol('SCHEDULER_MODULE_OPTIONS');

export const SCHEDULED_JOB_METADATA = Symbol('SCHEDULED_JOB_METADATA');

/**
 * Defaults mirror `libs/workflow`'s existing `DEFAULT_SCHEDULER_*` constants
 * (`libs/workflow/src/constants/workflow.constants.ts`) — same class of
 * poll-sweep primitive, same reasonable defaults, per
 * `libs/scheduler/ARCH.md` Design 001 (Section 17: prefer existing patterns
 * over inventing new ones).
 */
export const DEFAULT_SCHEDULER_SWEEP_INTERVAL_MS = 30 * 1000; // 30 seconds
export const DEFAULT_SCHEDULER_CLAIM_STALE_MS = 60 * 1000; // 1 minute
export const DEFAULT_SCHEDULER_BATCH_SIZE = 50;
