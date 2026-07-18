import { WorkflowSchedule } from '../models/workflow-schedule';

export interface WorkflowScheduleStore {
  insert(schedule: WorkflowSchedule): Promise<void>;

  load(scheduleId: string): Promise<WorkflowSchedule | null>;

  findAll(): Promise<WorkflowSchedule[]>;

  setEnabled(scheduleId: string, enabled: boolean): Promise<void>;

  delete(scheduleId: string): Promise<void>;

  /**
   * Atomically claims up to `limit` due-and-unclaimed (or stale-claimed)
   * schedules for `owner`, so multiple replicas polling concurrently each
   * fire a disjoint set. Mirrors `libs/queue`'s outbox `claimBatch`
   * select-candidates-then-conditional-UPDATE shape.
   */
  claimDue(
    owner: string,
    now: Date,
    claimStaleAfterMs: number,
    limit?: number,
  ): Promise<WorkflowSchedule[]>;

  /** Marks a claimed schedule as fired and advances it to its next occurrence. */
  recordFired(
    scheduleId: string,
    firedAt: Date,
    nextFireAt: Date,
  ): Promise<void>;

  /** Releases a claim without firing (e.g. the fire attempt threw). */
  release(scheduleId: string): Promise<void>;
}
