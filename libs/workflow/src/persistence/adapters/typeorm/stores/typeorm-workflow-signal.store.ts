import { Inject, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { WorkflowSignalEntity } from '../entities/workflow-signal.entity';
import { isDuplicateKeyError } from '../utils/is-duplicate-query-error';
import { WorkflowSignalRecord } from '../../../../models/workflow-signal-record';
import { WorkflowSignalStore } from '../../../../ports/workflow-signal.store';
import type { WorkflowEntityManagerProvider } from '../../../workflow-entity-manager.provider';
import { WORKFLOW_ENTITY_MANAGER_PROVIDER } from '../../../../constants/workflow.tokens';

@Injectable()
export class TypeOrmWorkflowSignalStore implements WorkflowSignalStore {
  constructor(
    @Inject(WORKFLOW_ENTITY_MANAGER_PROVIDER)
    private readonly managerProvider: WorkflowEntityManagerProvider,
  ) {}

  private get repository(): Repository<WorkflowSignalEntity> {
    return this.managerProvider.manager().getRepository(WorkflowSignalEntity);
  }

  async load(signalId: string): Promise<WorkflowSignalRecord | null> {
    const entity = await this.repository.findOne({
      where: {
        signalId,
      },
    });

    if (!entity) {
      return null;
    }

    return {
      signalId: entity.signalId,
      workflowId: entity.workflowId,
      processed: entity.processed,
      createdAt: entity.createdAt,
      processedAt: entity.processedAt,
      signal: {
        signalId: entity.signalId,
        name: entity.signalName,
        payload: entity.payload,
      },
    };
  }

  async insert(record: WorkflowSignalRecord): Promise<boolean> {
    try {
      await this.repository.insert({
        signalId: record.signalId,
        workflowId: record.workflowId,
        signalName: record.signal.name,
        ...(record.signal.payload !== undefined
          ? { payload: record.signal.payload as Record<string, unknown> }
          : {}),
        processed: record.processed,
        createdAt: record.createdAt,
        processedAt: record.processedAt,
      });

      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return false; // idempotent — signal already persisted
      }

      throw error;
    }
  }

  async exists(signalId: string): Promise<boolean> {
    return this.repository.exists({
      where: {
        signalId,
      },
    });
  }

  async markProcessed(signalId: string): Promise<void> {
    await this.repository.update(
      { signalId },
      {
        processed: true,
        processedAt: new Date(),
      },
    );
  }

  async findPending(
    workflowId: string,
  ): Promise<readonly WorkflowSignalRecord[]> {
    const entities = await this.repository.find({
      where: {
        workflowId,
        processed: false,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    return entities.map((entity) => ({
      signalId: entity.signalId,
      workflowId: entity.workflowId,
      processed: entity.processed,
      createdAt: entity.createdAt,
      processedAt: entity.processedAt,
      signal: {
        signalId: entity.signalId,
        name: entity.signalName,
        payload: entity.payload,
      },
    }));
  }

  async deleteByWorkflowId(workflowId: string): Promise<void> {
    await this.repository.delete({
      workflowId,
    });
  }
}
