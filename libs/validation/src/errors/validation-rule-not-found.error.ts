import { NotFoundException } from '@nestjs/common';

export class ValidationRuleNotFoundError extends NotFoundException {
  constructor(id: number) {
    super(`Validation rule #${id} not found`);
  }
}
