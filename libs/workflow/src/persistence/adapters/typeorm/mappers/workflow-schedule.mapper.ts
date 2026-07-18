import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { WorkflowSchedule } from '../../../../models/workflow-schedule';
import { WorkflowScheduleEntity } from '../entities/workflow-schedule.entity';

export class WorkflowScheduleMapper {
  static toPersistence(
    schedule: WorkflowSchedule,
  ): QueryDeepPartialEntity<WorkflowScheduleEntity> {
    return {
      scheduleId: schedule.scheduleId,
      workflowName: schedule.workflowName,
      workflowVersion: schedule.workflowVersion ?? null,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone ?? null,
      inputTemplate: schedule.inputTemplate as QueryDeepPartialEntity<
        Record<string, unknown>
      >,
      enabled: schedule.enabled,
      nextFireAt: schedule.nextFireAt,
      misfirePolicy: schedule.misfirePolicy,
      lastFiredAt: schedule.lastFiredAt ?? null,
      claimedBy: schedule.claimedBy ?? null,
      claimedAt: schedule.claimedAt ?? null,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
    };
  }

  static toDomain(entity: WorkflowScheduleEntity): WorkflowSchedule {
    return {
      scheduleId: entity.scheduleId,
      workflowName: entity.workflowName,
      workflowVersion: entity.workflowVersion ?? undefined,
      cronExpression: entity.cronExpression,
      timezone: entity.timezone ?? undefined,
      inputTemplate: entity.inputTemplate,
      enabled: entity.enabled,
      nextFireAt: entity.nextFireAt,
      misfirePolicy: entity.misfirePolicy,
      lastFiredAt: entity.lastFiredAt ?? undefined,
      claimedBy: entity.claimedBy ?? undefined,
      claimedAt: entity.claimedAt ?? undefined,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
