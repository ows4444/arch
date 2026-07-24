import type { EmailMessage } from './email-message.interface';

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
