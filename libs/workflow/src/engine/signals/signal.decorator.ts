import { SetMetadata } from '@nestjs/common';
import { WorkflowSignalMetadata } from './signal.metadata';
import { WORKFLOW_SIGNAL_METADATA } from '../../constants/workflow.constants';

export function WorkflowSignals(
  metadata: WorkflowSignalMetadata,
): ClassDecorator {
  return SetMetadata(
    WORKFLOW_SIGNAL_METADATA,
    Object.freeze({
      ...metadata,
    }),
  );
}
