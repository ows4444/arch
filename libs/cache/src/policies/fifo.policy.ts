import { ReplacementPolicy } from './replacement-policy.interface';

export class FifoPolicy<K> implements ReplacementPolicy<K> {
  private readonly queue: K[] = [];
  private readonly keys = new Set<K>();

  onGet(_key: K): void {
    // FIFO does not change insertion order on reads.
  }

  onSet(key: K): void {
    if (this.keys.has(key)) {
      return;
    }

    this.keys.add(key);
    this.queue.push(key);
  }

  onDelete(key: K): void {
    if (!this.keys.delete(key)) {
      return;
    }

    const index = this.queue.indexOf(key);

    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }

  onClear(): void {
    this.queue.length = 0;
    this.keys.clear();
  }

  evict(): K | undefined {
    const key = this.queue.shift();

    if (key === undefined) {
      return undefined;
    }

    this.keys.delete(key);

    return key;
  }
}
