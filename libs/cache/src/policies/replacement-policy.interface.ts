export interface ReplacementPolicy<K> {
  onGet(key: K): void;

  onSet(key: K): void;

  onDelete(key: K): void;

  onClear(): void;

  evict(): K | undefined;
}
