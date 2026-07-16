import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkflowModule } from './workflow.module';
import { WorkflowClient } from './api/workflow-client';
import { Workflow } from '../workflow/workflow.decorator';
import { Step } from '../steps/step.decorator';
import { createWorkflowStepId } from '../models/workflow-step-id';
import { RetriableWorkflowError } from '../errors/retriable-workflow.error';
import type { WorkflowStepHandler } from '../handlers/workflow-step-handler';
import type { WorkflowContext } from '../types/workflow-context';
import type { WorkflowStepResult } from '../models/workflow-step-result';
import { WORKFLOW_TYPEORM_ENTITIES } from '../persistence/adapters/typeorm/entities';

const ONLY_STEP = createWorkflowStepId('only-step');
const ATTEMPTS_BEFORE_SUCCESS = 2;

@Step({ workflow: 'retry-test-workflow', step: ONLY_STEP })
@Injectable()
class FlakyStep implements WorkflowStepHandler {
  attempts = 0;

  execute(_context: WorkflowContext): Promise<WorkflowStepResult> {
    this.attempts++;

    if (this.attempts <= ATTEMPTS_BEFORE_SUCCESS) {
      throw new RetriableWorkflowError(
        `simulated failure (attempt ${this.attempts})`,
      );
    }

    return Promise.resolve({});
  }
}

@Workflow({
  name: 'retry-test-workflow',
  version: 1,
  definition: {
    start: ONLY_STEP,
    transitions: { [ONLY_STEP]: [] },
  },
  retries: { maxAttempts: 3, strategy: 'fixed', delayMs: 1 },
})
@Injectable()
class RetryTestWorkflow {}

describe('WorkflowRunner — retries against real persisted state', () => {
  let moduleRef: TestingModule;
  let client: WorkflowClient;
  let step: FlakyStep;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [...WORKFLOW_TYPEORM_ENTITIES],
          synchronize: true,
          dropSchema: true,
        }),
        WorkflowModule.forRoot({ persistence: 'typeorm' }),
      ],
      providers: [RetryTestWorkflow, FlakyStep],
    }).compile();

    await moduleRef.init();

    client = moduleRef.get(WorkflowClient);
    step = moduleRef.get(FlakyStep);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('completes a workflow whose only step fails twice before succeeding', async () => {
    const result = await client.execute('retry-test-workflow', {});

    expect(result.status).toBe('completed');
    expect(step.attempts).toBe(ATTEMPTS_BEFORE_SUCCESS + 1);
  });
});
