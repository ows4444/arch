import { Type } from '@nestjs/common';

export interface WorkflowChildSpawnSpec {
  readonly workflow: Type<unknown>;

  readonly input?: Record<string, unknown>;
}
