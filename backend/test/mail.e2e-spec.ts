import { randomUUID } from 'node:crypto';
import { loadMailConfig } from './../src/mail/mail.config.js';
import { MailService } from './../src/mail/mail.service.js';
import { SmtpTransport } from './../src/mail/smtp.transport.js';

/**
 * Runs only against a local Mailpit (MAILPIT_URL, e.g. http://127.0.0.1:8025,
 * and MAILPIT_SMTP_PORT). Never against a real SMTP server.
 */
const MAILPIT_URL = process.env.MAILPIT_URL;
const SMTP_PORT = process.env.MAILPIT_SMTP_PORT ?? '1025';

describe.skipIf(!MAILPIT_URL)('Mail via Mailpit (e2e)', () => {
  it('delivers a message over SMTP', async () => {
    const config = loadMailConfig({
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT,
    });
    if (!config.smtp) throw new Error('smtp expected');
    const mail = new MailService(new SmtpTransport(config.smtp), {
      from: config.from,
    });
    const subject = `Test ${randomUUID()}`;
    await mail.send({
      to: 'davetli@test.local',
      subject,
      html: '<p>Merhaba</p>',
      text: 'Merhaba',
    });
    const res = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`,
    );
    const body = (await res.json()) as {
      messages: { Subject: string; To: { Address: string }[] }[];
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].To[0].Address).toBe('davetli@test.local');
  });
});
