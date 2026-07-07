export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('Operation aborted');
  }
}

export function abortError(): Error {
  return new Error('Operation aborted');
}
