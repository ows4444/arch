import { Clock } from '../interfaces/clock.interface';

export class FakeClock implements Clock {
  constructor(private currentTime = 0) {}

  now(): number {
    return this.currentTime;
  }

  set(time: number): void {
    this.currentTime = time;
  }

  advance(milliseconds: number): void {
    this.currentTime += milliseconds;
  }
}
