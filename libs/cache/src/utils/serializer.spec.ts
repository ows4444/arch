import { JsonCacheSerializer, SafeJsonCacheSerializer } from './serializer';

describe.each([
  ['JsonCacheSerializer', new JsonCacheSerializer()],
  ['SafeJsonCacheSerializer', new SafeJsonCacheSerializer()],
])('%s', (_name, serializer) => {
  it('round-trips a plain value', () => {
    const serialized = serializer.serialize({ a: 1, b: 'two' });
    expect(serializer.deserialize(serialized)).toEqual({ a: 1, b: 'two' });
  });

  it('coerces an explicitly cached undefined to null on round-trip (documented behavior)', () => {
    const serialized = serializer.serialize(undefined);
    expect(serialized).toBe('null');
    expect(serializer.deserialize(serialized)).toBeNull();
  });

  it('returns undefined for a corrupted/unparseable payload', () => {
    expect(serializer.deserialize('{not valid json')).toBeUndefined();
  });
});

describe('SafeJsonCacheSerializer', () => {
  it('throws a descriptive error when serialization fails', () => {
    const serializer = new SafeJsonCacheSerializer();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => serializer.serialize(circular)).toThrow(
      /Failed to serialize cache value/,
    );
  });
});
