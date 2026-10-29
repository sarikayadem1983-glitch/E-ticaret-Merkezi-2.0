import { MailService } from './mail.service.js';
import type { MailTransport } from './mail.transport.js';

const service = (send = vi.fn().mockResolvedValue(undefined)) => ({
  send,
  mail: new MailService({ send } as MailTransport, {
    from: 'TM <no-reply@example.com>',
  }),
});

describe('MailService', () => {
  it('sends with the configured sender', async () => {
    const { send, mail } = service();
    await mail.send({
      to: 'a@example.com',
      subject: 's',
      html: 'h',
      text: 't',
    });
    expect(send).toHaveBeenCalledWith({
      from: 'TM <no-reply@example.com>',
      to: 'a@example.com',
      subject: 's',
      html: 'h',
      text: 't',
    });
  });

  it.each(['', 'not-an-email', 'a@b.com\r\nBcc: x@y.com', 'a@b.com, c@d.com'])(
    'refuses the recipient %j',
    async (to) => {
      const { send, mail } = service();
      await expect(
        mail.send({ to, subject: 's', html: 'h', text: 't' }),
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('refuses a line break in the subject (header injection)', async () => {
    const { send, mail } = service();
    await expect(
      mail.send({
        to: 'a@b.co',
        subject: 'x\r\nBcc: e@f.g',
        html: 'h',
        text: 't',
      }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
