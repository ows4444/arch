import { Inject } from '@nestjs/common';

import { DatabaseRole } from '../constants/database-role.enum';
import { getDatabaseAccessorToken } from '../repository/datasource.tokens';

export function InjectDatabase(role: DatabaseRole = DatabaseRole.WRITE) {
  return Inject(getDatabaseAccessorToken(role));
}
