export function isDatabaseConnectivityError(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.some((e) => isDatabaseConnectivityError(e));
  }

  const code = (error as { code?: string } | undefined)?.code;

  switch (code) {
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'PROTOCOL_CONNECTION_LOST':
    case 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR':
    case 'PROTOCOL_ENQUEUE_AFTER_QUIT':
    case 'ETIMEDOUT':
    case 'ER_CON_COUNT_ERROR':
    case 'PROTOCOL_SEQUENCE_TIMEOUT':
    case 'PROTOCOL_PACKETS_OUT_OF_ORDER':
    case 'ENOTFOUND':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EPIPE':
    case 'ER_SERVER_SHUTDOWN':
      return true;

    default:
      return false;
  }
}
