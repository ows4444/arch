export type WorkflowScheduleMisfirePolicy = 'skip' | 'fire-once';

export interface WorkflowSchedule {
  readonly scheduleId: string;

  readonly workflowName: string;

  readonly workflowVersion?: number | undefined;

  readonly cronExpression: string;

  readonly timezone?: string | undefined;

  readonly inputTemplate: Record<string, unknown>;

  readonly enabled: boolean;

  readonly nextFireAt: Date;

  readonly misfirePolicy: WorkflowScheduleMisfirePolicy;

  readonly lastFiredAt?: Date | undefined;

  readonly claimedBy?: string | undefined;

  readonly claimedAt?: Date | undefined;

  readonly createdAt: Date;

  readonly updatedAt: Date;
}
