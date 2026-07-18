import { Injectable } from '@nestjs/common';
import { WorkflowQueryService } from './workflow-query.service';
import {
  WorkflowExecutionOptions,
  WorkflowExecutor,
} from '../../engine/executor/executor';
import { WorkflowQueryDispatchService } from '../../engine/query/query-dispatch.service';
import {
  CreateWorkflowScheduleOptions,
  WorkflowScheduleRegistrationService,
} from '../../engine/scheduling/schedule-registration.service';
import { WorkflowExecutionResult } from '../../models/workflow-execution-result';
import { WorkflowSchedule } from '../../models/workflow-schedule';
import { WorkflowSignal } from '../../models/workflow-signal';
import { WorkflowDetails } from '../../types/workflow-details';

@Injectable()
export class WorkflowClient {
  constructor(
    private readonly executor: WorkflowExecutor,
    private readonly queryService: WorkflowQueryService,
    private readonly queryDispatch: WorkflowQueryDispatchService,
    private readonly scheduleRegistration: WorkflowScheduleRegistrationService,
  ) {}

  execute(
    workflowName: string,
    data: Record<string, unknown> = {},
    options?: WorkflowExecutionOptions,
  ): Promise<WorkflowExecutionResult> {
    return this.executor.execute(workflowName, data, options);
  }

  active(workflowName?: string) {
    return this.queryService.active(workflowName);
  }

  correlation(correlationId: string) {
    return this.queryService.correlation(correlationId);
  }

  resume(workflowId: string): Promise<WorkflowExecutionResult> {
    return this.executor.resume(workflowId);
  }

  wake(workflowId: string): Promise<WorkflowExecutionResult> {
    return this.executor.wake(workflowId);
  }

  signal(
    workflowId: string,
    signal: WorkflowSignal,
  ): Promise<WorkflowExecutionResult> {
    return this.executor.signal(workflowId, signal);
  }

  cancel(
    workflowId: string,
    expired = false,
  ): Promise<WorkflowExecutionResult> {
    return this.executor.cancel(workflowId, expired);
  }

  get(workflowId: string): Promise<WorkflowDetails> {
    return this.queryService.get(workflowId);
  }

  exists(workflowId: string): Promise<boolean> {
    return this.queryService.exists(workflowId);
  }

  running() {
    return this.queryService.running();
  }

  waiting() {
    return this.queryService.waiting();
  }

  failed() {
    return this.queryService.failed();
  }

  query<TResult = unknown>(
    workflowId: string,
    name: string,
    args?: unknown,
  ): Promise<TResult> {
    return this.queryDispatch.query<TResult>(workflowId, name, args);
  }

  schedule(options: CreateWorkflowScheduleOptions): Promise<WorkflowSchedule> {
    return this.scheduleRegistration.create(options);
  }

  unschedule(scheduleId: string): Promise<void> {
    return this.scheduleRegistration.remove(scheduleId);
  }

  schedules(): Promise<WorkflowSchedule[]> {
    return this.scheduleRegistration.list();
  }
}
