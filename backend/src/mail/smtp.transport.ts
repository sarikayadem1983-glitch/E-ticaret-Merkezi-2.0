import nodemailer, { type Transporter } from 'nodemailer';
import type { SmtpConfig } from './mail.config.js';
import { type MailDeliveryCode, MailDeliveryError } from './mail.errors.js';
import type { MailTransport, OutgoingMail } from './mail.transport.js';

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ETIMEOUT']);
const REJECT_CODES = new Set(['EENVELOPE', 'EMESSAGE']);

/** Maps a nodemailer error to a short code; the raw server reply is dropped. */
export function deliveryCode(error: unknown): MailDeliveryCode {
  const e = error as { code?: string; responseCode?: number };
  if (e?.code && TIMEOUT_CODES.has(e.code)) return 'SMTP_TIMEOUT';
  if (
    (e?.code && REJECT_CODES.has(e.code)) ||
    (typeof e?.responseCode === 'number' && e.responseCode >= 500)
  ) {
    return 'SMTP_REJECTED';
  }
  return 'SMTP_UNAVAILABLE';
}

/** SMTP over nodemailer. One connection per message; no pooling or retries. */
export class SmtpTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTls,
      auth: config.auth,
      connectionTimeout: config.timeoutMs,
      greetingTimeout: config.timeoutMs,
      socketTimeout: config.timeoutMs,
      // Certificates are always verified (nodemailer default); no override.
      logger: false,
      debug: false,
    });
  }

  async send(mail: OutgoingMail): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new MailDeliveryError('SMTP_TIMEOUT')),
        this.config.timeoutMs,
      );
    });
    try {
      await Promise.race([
        this.transporter.sendMail(mail).catch((error: unknown) => {
          throw new MailDeliveryError(deliveryCode(error));
        }),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
