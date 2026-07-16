import { Injectable } from '@nestjs/common';
import { WorkflowQueryService } from './workflow-query.service';
import {
  WorkflowExecutionOptions,
  WorkflowExecutor,
} from '../../engine/executor/executor';
import { WorkflowExecutionResult } from '../../models/workflow-execution-result';
import { WorkflowSignal } from '../../models/workflow-signal';
import { WorkflowDetails } from '../../types/workflow-details';

@Injectable()
export class WorkflowClient {
  constructor(
    private readonly executor: WorkflowExecutor,
    private readonly query: WorkflowQueryService,
  ) {}

  execute(
    workflowName: string,
    data: Record<string, unknown> = {},
    options?: WorkflowExecutionOptions,
  ): Promise<WorkflowExecutionResult> {
    return this.executor.execute(workflowName, data, options);
  }

  active(workflowName?: string) {
    return this.query.active(workflowName);
  }

  correlation(correlationId: string) {
    return this.query.correlation(correlationId);
  }

  resume(workflowId: string): Promise<WorkflowExecutionResult> {
    return this.executor.resume(workflowId);
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
    return this.query.get(workflowId);
  }

  exists(workflowId: string): Promise<boolean> {
    return this.query.exists(workflowId);
  }

  running() {
    return this.query.running();
  }

  waiting() {
    return this.query.waiting();
  }

  failed() {
    return this.query.failed();
  }
}
