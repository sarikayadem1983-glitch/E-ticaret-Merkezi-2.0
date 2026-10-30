import { invitationMail } from './invitation-mail.js';

const base = {
  tenantName: 'Mağaza',
  inviterName: 'Ayşe',
  roleSummary: 'Admin',
  url: 'http://localhost:3000/invite/abc',
  expiresAt: new Date('2026-11-05T10:00:00Z'),
};

describe('invitationMail', () => {
  it('escapes tenant and inviter names in HTML', () => {
    const mail = invitationMail({
      ...base,
      tenantName: '<script>x</script>',
      inviterName: '"><img src=x onerror=alert(1)>',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('puts the link in both parts and no line break in the subject', () => {
    const mail = invitationMail({ ...base, tenantName: 'A\r\nBcc: x@y.z' });
    expect(mail.text).toContain(base.url);
    expect(mail.html).toContain(base.url);
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});
