import { parseIntegerHeader } from './header-utils';

describe('parseIntegerHeader', () => {
  it('returns the value as-is for an integer number', () => {
    expect(parseIntegerHeader(5)).toBe(5);
  });

  it('returns undefined for a non-integer number', () => {
    expect(parseIntegerHeader(5.5)).toBeUndefined();
  });

  it('parses a numeric string', () => {
    expect(parseIntegerHeader('42')).toBe(42);
  });

  it('parses a numeric Buffer', () => {
    expect(parseIntegerHeader(Buffer.from('7'))).toBe(7);
  });

  it('returns undefined for a non-numeric string', () => {
    expect(parseIntegerHeader('abc')).toBeUndefined();
  });

  it('returns undefined for a negative-looking string (non-digit characters)', () => {
    expect(parseIntegerHeader('-1')).toBeUndefined();
  });

  it('returns undefined for a string exceeding the max length', () => {
    expect(parseIntegerHeader('1'.repeat(17))).toBeUndefined();
  });

  it('returns undefined for null/undefined/object values', () => {
    expect(parseIntegerHeader(null)).toBeUndefined();
    expect(parseIntegerHeader(undefined)).toBeUndefined();
    expect(parseIntegerHeader({})).toBeUndefined();
  });

  it('returns undefined for a value exceeding Number.isSafeInteger', () => {
    expect(parseIntegerHeader('9'.repeat(16))).toBeUndefined();
  });
});
