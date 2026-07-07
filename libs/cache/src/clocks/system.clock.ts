import { Clock } from '../interfaces/clock.interface';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
