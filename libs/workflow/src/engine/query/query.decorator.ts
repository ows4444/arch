import { applyDecorators, Injectable, SetMetadata } from '@nestjs/common';

import { WORKFLOW_QUERY_METADATA } from '../../constants/workflow.constants';
import { WorkflowQueryMetadata } from '../../definition/workflow-query-metadata';

export function Query(metadata: WorkflowQueryMetadata): ClassDecorator {
  return applyDecorators(
    Injectable(),
    SetMetadata(WORKFLOW_QUERY_METADATA, Object.freeze({ ...metadata })),
  );
}
