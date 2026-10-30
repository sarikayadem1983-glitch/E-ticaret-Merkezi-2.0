import { Logger } from '@nestjs/common';
import { LogTransport } from './log.transport.js';

describe('LogTransport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never logs the invitation URL, the body or the full address', async () => {
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    const token = 'secret-token-abc123';
    await new LogTransport().send({
      from: 'no-reply@example.com',
      to: 'ayse.yilmaz@example.com',
      subject: 'Davet',
      html: `<a href="http://localhost:3000/invite/${token}">Kabul et</a>`,
      text: `http://localhost:3000/invite/${token}`,
    });
    const output = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(output).not.toContain(token);
    expect(output).not.toContain('/invite/');
    expect(output).not.toContain('ayse.yilmaz');
    expect(output).toContain('Davet');
  });
});
