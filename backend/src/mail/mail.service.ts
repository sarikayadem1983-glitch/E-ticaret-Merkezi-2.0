import { Inject, Injectable } from '@nestjs/common';
import {
  MAIL_OPTIONS,
  MAIL_TRANSPORT,
  type MailMessage,
  type MailOptions,
  type MailTransport,
} from './mail.transport.js';

/** One plain address, no display name, no list, no line breaks. */
const RECIPIENT = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/**
 * Public API of the mail module. Other modules build their own content and
 * call `send`; they never touch the transport. Throws MailDeliveryError
 * (SMTP_TIMEOUT | SMTP_REJECTED | SMTP_UNAVAILABLE) within 10 s.
 */
@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(MAIL_OPTIONS) private readonly options: MailOptions,
  ) {}

  async send(msg: MailMessage): Promise<void> {
    if (!RECIPIENT.test(msg.to)) {
      throw new Error('MailService.send: geçersiz alıcı');
    }
    if (/[\r\n]/.test(msg.subject)) {
      throw new Error('MailService.send: konu satır sonu içeremez');
    }
    await this.transport.send({
      from: this.options.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  }
}
