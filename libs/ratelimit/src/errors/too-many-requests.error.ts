import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManyRequestsError extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
