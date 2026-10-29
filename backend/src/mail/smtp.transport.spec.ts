import { createServer, type Server, type Socket } from 'node:net';
import { MailDeliveryError } from './mail.errors.js';
import { SmtpTransport } from './smtp.transport.js';

const msg = {
  from: 'no-reply@example.com',
  to: 'a@example.com',
  subject: 's',
  html: '<p>x</p>',
  text: 'x',
};

/** A local fake SMTP peer; `onConnect` decides how it behaves. */
async function fakeServer(
  onConnect: (socket: Socket) => void,
): Promise<{ server: Server; port: number; close: () => void }> {
  const sockets: Socket[] = [];
  const server = createServer((s) => {
    sockets.push(s);
    s.on('error', () => {});
    onConnect(s);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return {
    server,
    port: address.port,
    close: () => {
      sockets.forEach((s) => s.destroy());
      server.close();
    },
  };
}

/** Answers every command with 250, except RCPT TO with `rcptReply`. */
function scripted(rcptReply: string) {
  return (s: Socket) => {
    s.write('220 fake ESMTP\r\n');
    s.on('data', (chunk) => {
      for (const line of chunk.toString().split('\r\n').filter(Boolean)) {
        if (/^RCPT TO/i.test(line)) s.write(`${rcptReply}\r\n`);
        else if (/^QUIT/i.test(line)) s.end('221 bye\r\n');
        else s.write('250 OK\r\n');
      }
    });
  };
}

function transport(port: number, timeoutMs = 300) {
  return new SmtpTransport({
    host: '127.0.0.1',
    port,
    secure: false,
    requireTls: false,
    auth: undefined,
    timeoutMs,
  });
}

async function failure(p: Promise<unknown>): Promise<MailDeliveryError> {
  try {
    await p;
  } catch (error) {
    expect(error).toBeInstanceOf(MailDeliveryError);
    return error as MailDeliveryError;
  }
  throw new Error('expected a MailDeliveryError');
}

describe('SmtpTransport', () => {
  it('maps a silent server to SMTP_TIMEOUT', async () => {
    const fake = await fakeServer(() => {});
    try {
      expect((await failure(transport(fake.port).send(msg))).code).toBe(
        'SMTP_TIMEOUT',
      );
    } finally {
      fake.close();
    }
  });

  it('maps a refused connection to SMTP_UNAVAILABLE', async () => {
    const fake = await fakeServer(() => {});
    fake.close();
    expect((await failure(transport(fake.port).send(msg))).code).toBe(
      'SMTP_UNAVAILABLE',
    );
  });

  it('maps a rejected recipient to SMTP_REJECTED without the raw reply', async () => {
    const fake = await fakeServer(scripted('550 secret-banner no such user'));
    try {
      const error = await failure(transport(fake.port, 2000).send(msg));
      expect(error.code).toBe('SMTP_REJECTED');
      expect(error.message).not.toContain('secret-banner');
    } finally {
      fake.close();
    }
  });

  it('delivers through a server that accepts the message', async () => {
    const fake = await fakeServer((s) => {
      s.write('220 fake ESMTP\r\n');
      let data = false;
      s.on('data', (chunk) => {
        for (const line of chunk.toString().split('\r\n')) {
          if (data) {
            if (line === '.') {
              data = false;
              s.write('250 queued\r\n');
            }
          } else if (/^DATA/i.test(line)) {
            data = true;
            s.write('354 go\r\n');
          } else if (/^QUIT/i.test(line)) s.end('221 bye\r\n');
          else if (line) s.write('250 OK\r\n');
        }
      });
    });
    try {
      await expect(
        transport(fake.port, 2000).send(msg),
      ).resolves.toBeUndefined();
    } finally {
      fake.close();
    }
  });
});
