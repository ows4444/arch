import { ReplacementPolicy } from './replacement-policy.interface';

interface Entry {
  frequency: number;
  sequence: number;
}

export class LfuPolicy<K> implements ReplacementPolicy<K> {
  private readonly entries = new Map<K, Entry>();

  private sequence = 0;

  onGet(key: K): void {
    const entry = this.entries.get(key);

    if (!entry) {
      return;
    }

    entry.frequency++;
  }

  onSet(key: K): void {
    const entry = this.entries.get(key);

    if (entry) {
      entry.frequency++;
      return;
    }

    this.entries.set(key, {
      frequency: 1,
      sequence: this.sequence++,
    });
  }

  onDelete(key: K): void {
    this.entries.delete(key);
  }

  onClear(): void {
    this.entries.clear();
    this.sequence = 0;
  }

  evict(): K | undefined {
    let victim: K | undefined;
    let lowestFrequency = Number.POSITIVE_INFINITY;
    let oldestSequence = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.entries) {
      if (
        entry.frequency < lowestFrequency ||
        (entry.frequency === lowestFrequency && entry.sequence < oldestSequence)
      ) {
        victim = key;
        lowestFrequency = entry.frequency;
        oldestSequence = entry.sequence;
      }
    }

    if (victim !== undefined) {
      this.entries.delete(victim);
    }

    return victim;
  }
}
