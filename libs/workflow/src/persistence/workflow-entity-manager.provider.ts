import { EntityManager } from 'typeorm';

export interface WorkflowEntityManagerProvider {
  manager(): EntityManager;
}
