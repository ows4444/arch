const MAX_INTEGER_HEADER_LENGTH = 16;

export function parseIntegerHeader(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : undefined;
  }

  const text = Buffer.isBuffer(value)
    ? value.toString('utf8')
    : typeof value === 'string'
      ? value
      : undefined;

  if (text === undefined) {
    return undefined;
  }

  if (text.length > MAX_INTEGER_HEADER_LENGTH) {
    return undefined;
  }

  if (!/^\d+$/.test(text)) {
    return undefined;
  }

  const parsed = Number(text);

  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
