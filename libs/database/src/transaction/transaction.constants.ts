import { IsolationLevel } from './isolation-level';

export const TRANSACTION_METADATA = Symbol('TRANSACTION_METADATA');

export enum TransactionPropagation {
  REQUIRED = 'REQUIRED',
  REQUIRES_NEW = 'REQUIRES_NEW',
  SUPPORTS = 'SUPPORTS',
  MANDATORY = 'MANDATORY',
  NEVER = 'NEVER',
  NOT_SUPPORTED = 'NOT_SUPPORTED',
  NESTED = 'NESTED',
}

export interface TransactionMetadata {
  isolationLevel?: IsolationLevel;
  propagation?: TransactionPropagation;
  timeoutMs?: number;
}
