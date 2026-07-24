import { InitialOrganizationsSchema1753700000000 } from './1753700000000-InitialOrganizationsSchema.migration';
import { SeedOrganizationsManagePermission1753710000000 } from './1753710000000-SeedOrganizationsManagePermission.migration';

export const ORGANIZATIONS_MIGRATIONS = [
  InitialOrganizationsSchema1753700000000,
  SeedOrganizationsManagePermission1753710000000,
] as const;

export { InitialOrganizationsSchema1753700000000 } from './1753700000000-InitialOrganizationsSchema.migration';
export { SeedOrganizationsManagePermission1753710000000 } from './1753710000000-SeedOrganizationsManagePermission.migration';
