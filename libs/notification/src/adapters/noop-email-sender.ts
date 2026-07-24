import { Injectable } from '@nestjs/common';
import type { EmailSender } from '../ports/email-sender.interface';
import type { EmailMessage } from '../ports/email-message.interface';

@Injectable()
export class NoopEmailSender implements EmailSender {
  send(_message: EmailMessage): Promise<void> {
    return Promise.resolve();
  }
}
