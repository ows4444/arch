import { InitialUsersSchema1753500000000 } from './1753500000000-InitialUsersSchema.migration';
import { SeedUsersManagePermission1753510000000 } from './1753510000000-SeedUsersManagePermission.migration';

export const USERS_MIGRATIONS = [
  InitialUsersSchema1753500000000,
  SeedUsersManagePermission1753510000000,
] as const;

export { InitialUsersSchema1753500000000 } from './1753500000000-InitialUsersSchema.migration';
export { SeedUsersManagePermission1753510000000 } from './1753510000000-SeedUsersManagePermission.migration';
