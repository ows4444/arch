import { FifoPolicy } from './fifo.policy';
import { LfuPolicy } from './lfu.policy';
import { LruPolicy } from './lru.policy';
import { MruPolicy } from './mru.policy';
import { ReplacementPolicy } from './replacement-policy.interface';

export type ReplacementPolicyType = 'lru' | 'lfu' | 'fifo' | 'mru';

export class ReplacementPolicyFactory {
  static create<K>(type: ReplacementPolicyType = 'lru'): ReplacementPolicy<K> {
    switch (type) {
      case 'lru':
        return new LruPolicy<K>();

      case 'fifo':
        return new FifoPolicy<K>();

      case 'mru':
        return new MruPolicy<K>();

      case 'lfu':
        return new LfuPolicy<K>();

      default: {
        const exhaustive: never = type;
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Unsupported replacement policy '${exhaustive}'.`);
      }
    }
  }
}
