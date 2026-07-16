import { DataSource } from 'typeorm';
import { WorkflowExecutor } from './executor';
import { TypeOrmWorkflowTransactionRunner } from '../../persistence/adapters/typeorm/stores/typeorm-workflow-transaction-runner';
import { TypeOrmWorkflowTransactionContext } from '../../persistence/adapters/typeorm/stores/typeorm-workflow-transaction-context';
import { TypeOrmWorkflowStateStore } from '../../persistence/adapters/typeorm/stores/typeorm-workflow-state.store';
import { TypeOrmWorkflowEntityManagerProvider } from '../../persistence/adapters/typeorm/typeorm-workflow-entity-manager.provider';
import { createTestDataSource } from '../../testing/typeorm-test-datasource';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';

describe('WorkflowExecutor — failure state survives the transaction that reports it', () => {
  let dataSource: DataSource;
  let context: TypeOrmWorkflowTransactionContext;
  let transactionRunner: TypeOrmWorkflowTransactionRunner;
  let stateStore: TypeOrmWorkflowStateStore;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    context = new TypeOrmWorkflowTransactionContext();
    transactionRunner = new TypeOrmWorkflowTransactionRunner(
      dataSource,
      context,
    );
    stateStore = new TypeOrmWorkflowStateStore(
      new TypeOrmWorkflowEntityManagerProvider(context, dataSource),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  function buildExecutor(options: {
    initialState: WorkflowExecutionState;
    error: Error;
  }) {
    const workflow = { metadata: { name: 'test-workflow' } };

    const registry = {
      getLatest: jest.fn().mockReturnValue(workflow),
      get: jest.fn().mockReturnValue(workflow),
    };
    const completionService = {
      completeIfFinished: jest.fn((state: WorkflowExecutionState) =>
        Promise.resolve({ state, completed: false }),
      ),
    };
    const logger = { started: jest.fn(), signalReceived: jest.fn() };
    const lifecycle = {
      create: jest.fn(async () => {
        await stateStore.insert(options.initialState);
        return { workflow, state: options.initialState };
      }),
      resume: jest.fn(async () => ({
        workflow,
        state: (await stateStore.load(options.initialState.workflowId))!,
      })),
    };
    const runner = { run: jest.fn().mockRejectedValue(options.error) };
    const leaseService = { acquire: jest.fn(), release: jest.fn() };
    const failureService = {
      handleFailure: jest.fn(async (state: WorkflowExecutionState) => {
        await stateStore.save(state, { ...state, status: 'failed' });
      }),
      failExecution: jest.fn(async (state: WorkflowExecutionState) => {
        await stateStore.save(state, { ...state, status: 'failed' });
      }),
    };

    const executor = new WorkflowExecutor(
      registry as never,
      {} as never,
      completionService as never,
      {} as never,
      logger as never,
      lifecycle as never,
      runner as never,
      transactionRunner,
      leaseService as never,
      stateStore as never,
      failureService as never,
      {} as never,
      {} as never,
    );

    return executor;
  }

  it('execute(): persists the failed workflow instead of rolling back the entire attempt', async () => {
    const initialState = createWorkflowExecutionState({
      workflowId: 'exec-fail-1',
    });
    const error = new Error('step blew up');
    const executor = buildExecutor({ initialState, error });

    await expect(executor.execute('test-workflow', {})).rejects.toThrow(
      'step blew up',
    );

    const persisted = await stateStore.load('exec-fail-1');

    expect(persisted).not.toBeNull();
    expect(persisted?.status).toBe('failed');
  });

  it('resume(): persists the failed workflow instead of rolling back the attempt', async () => {
    const initialState = createWorkflowExecutionState({
      workflowId: 'resume-fail-1',
      status: 'running',
    });
    const error = new Error('step blew up');
    const executor = buildExecutor({ initialState, error });

    await stateStore.insert(initialState);

    await expect(executor.resume('resume-fail-1')).rejects.toThrow(
      'step blew up',
    );

    const persisted = await stateStore.load('resume-fail-1');

    expect(persisted?.status).toBe('failed');
  });
});
