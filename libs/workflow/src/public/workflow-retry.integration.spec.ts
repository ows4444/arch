import { Inject, Injectable } from '@nestjs/common';
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
import { WORKFLOW_TRANSACTION_RUNNER } from '../constants/workflow.tokens';
import type { WorkflowTransactionRunner } from '../ports/workflow-transaction-runner';
import { WorkflowQueryService } from './api/workflow-query.service';

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

const FIRST_STEP = createWorkflowStepId('first-step');
const SECOND_STEP = createWorkflowStepId('second-step');

@Injectable()
class RecordingSecondStep implements WorkflowStepHandler {
  wasActiveDuringExecution: boolean | undefined;
  historyCountDuringExecution: number | undefined;

  constructor(
    @Inject(WORKFLOW_TRANSACTION_RUNNER)
    private readonly transactionRunner: WorkflowTransactionRunner,
    private readonly query: WorkflowQueryService,
  ) {}

  async execute(context: WorkflowContext): Promise<WorkflowStepResult> {
    // Proves the fix: while this (second) step's handler is running, no
    // transaction from the first step should still be open/straddling —
    // each step commits independently rather than the whole multi-step
    // pass sharing one transaction.
    this.wasActiveDuringExecution = this.transactionRunner.isActive();

    const details = await this.query.get(context.workflowId);
    this.historyCountDuringExecution = details.history.length;

    return {};
  }
}

@Step({ workflow: 'multi-step-test-workflow', step: FIRST_STEP })
@Injectable()
class FirstStep implements WorkflowStepHandler {
  execute(): Promise<WorkflowStepResult> {
    return Promise.resolve({ nextStep: SECOND_STEP });
  }
}

@Step({ workflow: 'multi-step-test-workflow', step: SECOND_STEP })
@Injectable()
class SecondStep extends RecordingSecondStep {}

@Workflow({
  name: 'multi-step-test-workflow',
  version: 1,
  definition: {
    start: FIRST_STEP,
    transitions: { [FIRST_STEP]: [SECOND_STEP], [SECOND_STEP]: [] },
  },
})
@Injectable()
class MultiStepTestWorkflow {}

describe('WorkflowRunner — per-step transaction scope against real persisted state', () => {
  let moduleRef: TestingModule;
  let client: WorkflowClient;
  let secondStep: RecordingSecondStep;

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
      providers: [MultiStepTestWorkflow, FirstStep, SecondStep],
    }).compile();

    await moduleRef.init();

    client = moduleRef.get(WorkflowClient);
    secondStep = moduleRef.get(SecondStep);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('commits each step independently rather than sharing one transaction across the whole run', async () => {
    const result = await client.execute('multi-step-test-workflow', {});

    expect(result.status).toBe('completed');
    expect(secondStep.wasActiveDuringExecution).toBe(false);
    // By the time the second step's handler runs, history already has 3
    // rows: first-step started + first-step completed + second-step
    // started. The first two are only durably visible here if the first
    // step's transaction actually committed rather than still being held
    // open by an outer wrapper spanning both steps.
    expect(secondStep.historyCountDuringExecution).toBe(3);
  });
});
