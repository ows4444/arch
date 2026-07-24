import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkflowModule } from './workflow.module';
import { WorkflowClient } from './api/workflow-client';
import { Workflow } from '../workflow/workflow.decorator';
import { Step } from '../steps/step.decorator';
import { createWorkflowStepId } from '../models/workflow-step-id';
import type { WorkflowStepHandler } from '../handlers/workflow-step-handler';
import type { WorkflowContext } from '../types/workflow-context';
import type { WorkflowStepResult } from '../models/workflow-step-result';
import { WORKFLOW_TYPEORM_ENTITIES } from '../persistence/adapters/typeorm/entities';

/**
 * Same regression as `workflow-retry.integration.spec.ts`'s "per-step
 * transaction scope" test (libs/workflow/LOOP.md Loop 019's High-severity
 * fix), but against real MySQL with a real, size-limited connection pool
 * instead of in-memory sqlite. sqlite's `better-sqlite3` driver has no
 * pool — every operation goes through the one connection regardless of
 * whether the per-step-commit fix is correct, so it can't detect the
 * "held connection across a whole multi-step pass" failure mode Loop 019
 * fixed. Running N workflow instances concurrently against a pool sized
 * smaller than N proves each step really does release its connection back
 * to the pool independently, rather than one instance's pass starving the
 * others by holding a connection open for its entire multi-step run.
 *
 * Requires `make compose-up` and a scratch database the `app` user can
 * create tables in. Skipped by default so `npm test` stays hermetic; run
 * explicitly with:
 *   RUN_MYSQL_INTEGRATION_TESTS=1 npx jest workflow-retry.mysql
 */
const describeIfMysql =
  process.env.RUN_MYSQL_INTEGRATION_TESTS === '1' ? describe : describe.skip;

const FIRST_STEP = createWorkflowStepId('first-step');
const SECOND_STEP = createWorkflowStepId('second-step');
const THIRD_STEP = createWorkflowStepId('third-step');

@Step({ workflow: 'mysql-multi-step-test-workflow', step: FIRST_STEP })
@Injectable()
class FirstStep implements WorkflowStepHandler {
  execute(): Promise<WorkflowStepResult> {
    return Promise.resolve({ nextStep: SECOND_STEP });
  }
}

@Step({ workflow: 'mysql-multi-step-test-workflow', step: SECOND_STEP })
@Injectable()
class SecondStep implements WorkflowStepHandler {
  execute(): Promise<WorkflowStepResult> {
    return Promise.resolve({ nextStep: THIRD_STEP });
  }
}

@Step({ workflow: 'mysql-multi-step-test-workflow', step: THIRD_STEP })
@Injectable()
class ThirdStep implements WorkflowStepHandler {
  execute(_context: WorkflowContext): Promise<WorkflowStepResult> {
    return Promise.resolve({});
  }
}

@Workflow({
  name: 'mysql-multi-step-test-workflow',
  version: 1,
  definition: {
    start: FIRST_STEP,
    transitions: {
      [FIRST_STEP]: [SECOND_STEP],
      [SECOND_STEP]: [THIRD_STEP],
      [THIRD_STEP]: [],
    },
  },
})
@Injectable()
class MultiStepTestWorkflow {}

describeIfMysql(
  'WorkflowRunner — per-step transaction scope against real MySQL under a constrained connection pool',
  () => {
    let moduleRef: TestingModule;
    let client: WorkflowClient;

    const POOL_SIZE = 3;
    const CONCURRENT_INSTANCES = 8;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: 'mysql',
            host: process.env.MYSQL_HOST ?? 'localhost',
            port: Number(process.env.MYSQL_PORT ?? 3307),
            username: process.env.MYSQL_USERNAME ?? 'app',
            password: process.env.MYSQL_PASSWORD ?? 'app',
            database: 'app_scratch',
            entities: [...WORKFLOW_TYPEORM_ENTITIES],
            synchronize: true,
            dropSchema: true,
            extra: { connectionLimit: POOL_SIZE },
          }),
          WorkflowModule.forRoot({ persistence: 'typeorm' }),
        ],
        providers: [MultiStepTestWorkflow, FirstStep, SecondStep, ThirdStep],
      }).compile();

      await moduleRef.init();

      client = moduleRef.get(WorkflowClient);
    }, 30_000);

    afterAll(async () => {
      await moduleRef.close();
    });

    it('completes more concurrent 3-step workflow instances than the connection pool has slots for', async () => {
      // If a step's write held its connection open for the rest of the
      // pass (Loop 019's bug), CONCURRENT_INSTANCES (8) each spanning 3
      // steps could deadlock/starve against a pool of only 3 connections.
      // Completing all of them proves connections are released back to
      // the pool between steps, not held for the whole run.
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_INSTANCES }, () =>
          client.execute('mysql-multi-step-test-workflow', {}),
        ),
      );

      expect(results).toHaveLength(CONCURRENT_INSTANCES);
      for (const result of results) {
        expect(result.status).toBe('completed');
      }
    }, 30_000);
  },
);
