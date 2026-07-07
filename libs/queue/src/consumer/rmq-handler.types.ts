import type { RMQContext } from '../queue.types';

export type RMQHandler<TPayload = unknown> = (
  payload: TPayload,
  context: RMQContext,
) => void | Promise<void>;
