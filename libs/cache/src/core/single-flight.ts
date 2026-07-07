export class SingleFlight<K> {
  private readonly inflight = new Map<K, Promise<unknown>>();

  async do<T>(key: K, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);

    if (existing) {
      return existing as Promise<T>;
    }

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);

    return promise;
  }

  size(): number {
    return this.inflight.size;
  }
}
