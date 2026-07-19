import { NotFoundException } from '@nestjs/common';

export class RoleNotFoundError extends NotFoundException {
  constructor(name: string) {
    super(`Role '${name}' does not exist.`);
  }
}
