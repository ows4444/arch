import { applyDecorators, SetMetadata } from '@nestjs/common';
import {
  TRANSACTION_METADATA,
  TransactionMetadata,
  TransactionPropagation,
} from './transaction.constants';

export function Transactional(
  options: TransactionMetadata = {
    propagation: TransactionPropagation.REQUIRED,
  },
): MethodDecorator {
  return applyDecorators(SetMetadata(TRANSACTION_METADATA, options));
}
