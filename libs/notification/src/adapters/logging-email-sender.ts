import { Injectable, Logger } from '@nestjs/common';
import type { EmailSender } from '../ports/email-sender.interface';
import type { EmailMessage } from '../ports/email-message.interface';

/**
 * Logs the would-be email at INFO level — the closest thing to a "real"
 * adapter available without an actual SMTP/SendGrid/SES dependency, which
 * doesn't exist anywhere in this monorepo. Logs the full message body
 * (including any token `text`/`html` carries), so only wire this where
 * that's acceptable — see `libs/notification/ARCH.md`, Security
 * Architecture.
 */
@Injectable()
export class LoggingEmailSender implements EmailSender {
  private readonly logger = new Logger(LoggingEmailSender.name);

  send(message: EmailMessage): Promise<void> {
    this.logger.log({
      message: 'Email send (logging adapter — no real provider wired)',
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html !== undefined && { html: message.html }),
    });

    return Promise.resolve();
  }
}
