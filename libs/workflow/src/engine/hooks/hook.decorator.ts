import { SetMetadata } from '@nestjs/common';
import { WorkflowHookMetadata } from './hook.metadata';
import { WORKFLOW_HOOK_METADATA } from '../../constants/workflow.constants';

export function WorkflowHooks(metadata: WorkflowHookMetadata): ClassDecorator {
  return SetMetadata(
    WORKFLOW_HOOK_METADATA,
    Object.freeze({
      ...metadata,
    }),
  );
}
