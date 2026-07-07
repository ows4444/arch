import { Inject } from '@nestjs/common';
import { DatabaseRole } from '../constants/database-role.enum';
import { RepositoryClass } from '../interfaces/repository-class.interface';
import { getRepositoryToken } from '../repository/repository.tokens';

export function InjectRepository<T>(
  repository: RepositoryClass<T>,
  role: DatabaseRole = DatabaseRole.WRITE,
): ParameterDecorator & PropertyDecorator {
  return Inject(getRepositoryToken(repository, role));
}
