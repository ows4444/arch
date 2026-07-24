import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_SENDER } from '../notification.constants';
import type { EmailSender } from '../ports/email-sender.interface';
import type { EmailMessage } from '../ports/email-message.interface';

@Injectable()
export class NotificationService {
  constructor(
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSender,
  ) {}

  sendEmail(message: EmailMessage): Promise<void> {
    return this.emailSender.send(message);
  }
}
