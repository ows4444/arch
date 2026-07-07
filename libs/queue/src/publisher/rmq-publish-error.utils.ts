const ERROR_PATTERNS = {
  timeout: 'timeout',
  closed: 'closed',
  rejected: 'reject-publish',
} as const;

export function classifyPublishError(error: Error) {
  const message = error.message.toLowerCase();

  return {
    timeout: message.includes(ERROR_PATTERNS.timeout),
    connectionClosed: message.includes(ERROR_PATTERNS.closed),
    rejected: message.includes(ERROR_PATTERNS.rejected),
  };
}
