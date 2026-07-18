import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowRegistry } from '../registry/registry';
import { WorkflowStateService } from '../state/service';

@Injectable()
export class WorkflowQueryDispatchService {
  private readonly logger = new Logger(WorkflowQueryDispatchService.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly registry: WorkflowRegistry,
    private readonly stateService: WorkflowStateService,
  ) {}

  async query<TResult = unknown>(
    workflowId: string,
    name: string,
    args?: unknown,
  ): Promise<TResult> {
    const state = await this.stateService.load(workflowId);

    if (!state) {
      throw new WorkflowExecutionError(`Workflow '${workflowId}' not found`);
    }

    const workflow = this.registry.get(
      state.workflowName,
      state.workflowVersion,
    );

    const handlerType = workflow.queries.get(name);

    if (!handlerType) {
      throw new WorkflowExecutionError(
        `Workflow '${workflow.metadata.name}' has no query handler named '${name}'`,
      );
    }

    const instance = this.moduleRef.get(handlerType, { strict: false });

    if (!instance) {
      this.logger.warn(
        `Query handler instance not found for '${name}' on workflow '${workflow.metadata.name}'`,
      );
      throw new WorkflowExecutionError(
        `Query handler instance not found for '${name}' on workflow '${workflow.metadata.name}'`,
      );
    }

    return (await instance.handle(state, args)) as TResult;
  }
}
