export type WorkflowStatus =
  | 'running'
  | 'waiting'
  | 'sleeping'
  | 'waiting-children'
  | 'completed'
  | 'failed'
  | 'cancelled';
