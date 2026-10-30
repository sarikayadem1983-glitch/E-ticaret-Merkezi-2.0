export type MailDeliveryCode =
  'SMTP_TIMEOUT' | 'SMTP_REJECTED' | 'SMTP_UNAVAILABLE';

/**
 * A message could not be delivered. `code` is short and safe to store (e.g.
 * invitations.last_send_error); the raw SMTP reply is never kept.
 */
export class MailDeliveryError extends Error {
  constructor(readonly code: MailDeliveryCode) {
    super(`E-posta gönderilemedi (${code})`);
    this.name = 'MailDeliveryError';
  }
}
