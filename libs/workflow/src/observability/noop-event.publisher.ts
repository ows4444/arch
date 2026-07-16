import { Injectable } from '@nestjs/common';
import {
  WorkflowEventPublisher,
  WorkflowLifecycleEvent,
} from '../ports/workflow-event-publisher';

@Injectable()
export class NoopWorkflowEventPublisher implements WorkflowEventPublisher {
  async publish(_event: WorkflowLifecycleEvent): Promise<void> {}
}
