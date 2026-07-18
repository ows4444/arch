import { InitialWorkflowSchema1752000000000 } from './1752000000000-InitialWorkflowSchema.migration';
import { WorkflowSignalCompositeKey1752200000000 } from './1752200000000-WorkflowSignalCompositeKey.migration';
import { WorkflowSleepUntil1752300000000 } from './1752300000000-WorkflowSleepUntil.migration';
import { WorkflowSchedule1752400000000 } from './1752400000000-WorkflowSchedule.migration';
import { WorkflowJoin1752500000000 } from './1752500000000-WorkflowJoin.migration';

export const WORKFLOW_MIGRATIONS = [
  InitialWorkflowSchema1752000000000,
  WorkflowSignalCompositeKey1752200000000,
  WorkflowSleepUntil1752300000000,
  WorkflowSchedule1752400000000,
  WorkflowJoin1752500000000,
] as const;

export { InitialWorkflowSchema1752000000000 } from './1752000000000-InitialWorkflowSchema.migration';
export { WorkflowSignalCompositeKey1752200000000 } from './1752200000000-WorkflowSignalCompositeKey.migration';
export { WorkflowSleepUntil1752300000000 } from './1752300000000-WorkflowSleepUntil.migration';
export { WorkflowSchedule1752400000000 } from './1752400000000-WorkflowSchedule.migration';
export { WorkflowJoin1752500000000 } from './1752500000000-WorkflowJoin.migration';
