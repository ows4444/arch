export function buildSignalIdempotencyKey(
  workflowId: string,
  signalId: string,
): string {
  return `signal:${workflowId}:${signalId}`;
}
