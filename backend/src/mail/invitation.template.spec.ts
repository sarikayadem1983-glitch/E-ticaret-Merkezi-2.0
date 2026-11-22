import { renderInvitation } from './templates/invitation.js';

const base = {
  tenantName: 'Örnek Mağaza',
  inviterName: 'Ayşe',
  roleSummary: 'Admin',
  url: 'http://localhost:3000/invite/abc?source=mail&lang=tr',
  expiresAt: new Date('2026-11-15T10:00:00Z'),
};

describe('renderInvitation', () => {
  it('provides a Turkish branded document and a complete plain-text alternative', () => {
    const mail = renderInvitation(base);
    expect(mail.html).toContain('<html lang="tr">');
    expect(mail.html).toContain('E-Ticaret Merkezi 2.0');
    expect(mail.html).toContain('name="viewport"');
    expect(mail.html).toContain('Daveti kabul et');
    for (const value of [base.tenantName, base.inviterName, base.roleSummary]) {
      expect(mail.html).toContain(value);
      expect(mail.text).toContain(value);
    }
    expect(mail.text).toContain(base.url);
    expect(mail.html).toContain(
      'href="http://localhost:3000/invite/abc?source=mail&amp;lang=tr"',
    );
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain('15.11.2026 13:00:00');
      expect(part).toContain('tek kullanımlıktır');
      expect(part).toContain('yok sayabilirsiniz');
    }
    expect(mail.html).not.toMatch(/<script|<img|<link|<iframe/i);
  });

  it('escapes every dynamic HTML value, including the link attribute', () => {
    const mail = renderInvitation({
      ...base,
      tenantName: '<script>tenant</script>',
      inviterName: '<img src=x onerror="alert(1)">',
      roleSummary: '<b>Owner & Admin</b>',
      url: 'http://localhost:3000/invite/abc?x=" onclick="alert(1)',
    });
    expect(mail.html).not.toMatch(/<script|<img|<b>Owner|" onclick="/);
    expect(mail.html).toContain('&lt;script&gt;tenant&lt;/script&gt;');
    expect(mail.html).toContain(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
    expect(mail.html).toContain('&lt;b&gt;Owner &amp; Admin&lt;/b&gt;');
    expect(mail.html).toContain('x=&quot; onclick=&quot;alert(1)');
    expect(mail.text).toContain('<b>Owner & Admin</b>');
  });

  it('keeps the subject on one line and does not HTML-encode it', () => {
    const mail = renderInvitation({
      ...base,
      tenantName: '  A & B\r\nMağazası  ',
    });
    expect(mail.subject).toBe('A & B Mağazası mağazasına davet edildiniz');
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});
