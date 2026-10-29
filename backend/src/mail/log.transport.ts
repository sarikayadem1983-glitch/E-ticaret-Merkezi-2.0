import { Logger } from '@nestjs/common';
import type { MailTransport, OutgoingMail } from './mail.transport.js';

/** `ayse@example.com` → `a***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Development and tests only (refused in production by mail.config). Logs that
 * a message was "sent" without its body: bodies carry invitation links.
 */
export class LogTransport implements MailTransport {
  private readonly logger = new Logger('MailLog');

  send(mail: OutgoingMail): Promise<void> {
    this.logger.log(
      `E-posta (gönderilmedi, log transport): alıcı=${maskEmail(mail.to)} konu="${mail.subject}"`,
    );
    return Promise.resolve();
  }
}
