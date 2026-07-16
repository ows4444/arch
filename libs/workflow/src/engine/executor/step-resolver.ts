import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { WorkflowCompensationHandler } from '../../handlers/workflow-compensation-handler';
import { WorkflowStepHandler } from '../../handlers/workflow-step-handler';

@Injectable()
export class WorkflowStepResolver {
  constructor(private readonly moduleRef: ModuleRef) {}

  resolve(
    type: new (...args: never[]) => WorkflowStepHandler,
  ): WorkflowStepHandler {
    return this.moduleRef.get(type, {
      strict: false,
    });
  }

  resolveCompensation(
    type: new (...args: never[]) => WorkflowCompensationHandler,
  ): WorkflowCompensationHandler {
    return this.moduleRef.get(type, {
      strict: false,
    });
  }
}
