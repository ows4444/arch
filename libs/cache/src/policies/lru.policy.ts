import { ReplacementPolicy } from './replacement-policy.interface';

class LruNode<K> {
  constructor(
    public readonly key: K,
    public prev: LruNode<K> | null = null,
    public next: LruNode<K> | null = null,
  ) {}
}

export class LruPolicy<K> implements ReplacementPolicy<K> {
  private readonly nodes = new Map<K, LruNode<K>>();

  private readonly head = new LruNode<K>(null as never);
  private readonly tail = new LruNode<K>(null as never);

  constructor() {
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  onGet(key: K): void {
    const node = this.nodes.get(key);

    if (!node) {
      return;
    }

    this.remove(node);
    this.append(node);
  }

  onSet(key: K): void {
    const existing = this.nodes.get(key);

    if (existing) {
      this.remove(existing);
      this.append(existing);
      return;
    }

    const node = new LruNode(key);

    this.nodes.set(key, node);
    this.append(node);
  }

  onDelete(key: K): void {
    const node = this.nodes.get(key);

    if (!node) {
      return;
    }

    this.remove(node);
    this.nodes.delete(key);
  }

  onClear(): void {
    this.nodes.clear();

    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  evict(): K | undefined {
    const node = this.head.next;

    if (!node || node === this.tail) {
      return undefined;
    }

    this.remove(node);
    this.nodes.delete(node.key);

    return node.key;
  }

  private append(node: LruNode<K>): void {
    const previous = this.tail.prev!;

    previous.next = node;
    node.prev = previous;

    node.next = this.tail;
    this.tail.prev = node;
  }

  private remove(node: LruNode<K>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }
}
