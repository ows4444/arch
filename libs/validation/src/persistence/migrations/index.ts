import { CreateValidationRuleTable1753200000000 } from './1753200000000-CreateValidationRuleTable.migration';
import { AddCompareFieldToValidationRule1753300000000 } from './1753300000000-AddCompareFieldToValidationRule.migration';
import { MakeValidationRuleValueNullable1753400000000 } from './1753400000000-MakeValidationRuleValueNullable.migration';

export const VALIDATION_MIGRATIONS = [
  CreateValidationRuleTable1753200000000,
  AddCompareFieldToValidationRule1753300000000,
  MakeValidationRuleValueNullable1753400000000,
] as const;

export { CreateValidationRuleTable1753200000000 } from './1753200000000-CreateValidationRuleTable.migration';
export { AddCompareFieldToValidationRule1753300000000 } from './1753300000000-AddCompareFieldToValidationRule.migration';
export { MakeValidationRuleValueNullable1753400000000 } from './1753400000000-MakeValidationRuleValueNullable.migration';
