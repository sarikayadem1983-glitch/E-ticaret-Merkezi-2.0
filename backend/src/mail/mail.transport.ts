export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface OutgoingMail extends MailMessage {
  from: string;
}

/** Delivers one message or throws MailDeliveryError. */
export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
export const MAIL_OPTIONS = Symbol('MAIL_OPTIONS');

export interface MailOptions {
  from: string;
}
