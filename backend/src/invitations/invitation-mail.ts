const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

export interface InvitationMailInput {
  tenantName: string;
  inviterName: string;
  roleSummary: string;
  url: string;
  expiresAt: Date;
}

/**
 * Plain invitation e-mail. User input (store and inviter names) is escaped.
 * The branded template (renderInvitation) replaces this in USR-T9b.
 */
export function invitationMail(input: InvitationMailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const tenant = oneLine(input.tenantName);
  const inviter = oneLine(input.inviterName);
  const role = oneLine(input.roleSummary);
  const expires = input.expiresAt.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
  });
  return {
    subject: `${tenant} mağazasına davet edildiniz`,
    text: [
      `${inviter} sizi Ticaret Merkezi'nde ${tenant} mağazasına davet etti.`,
      `Rol: ${role}`,
      '',
      `Daveti kabul etmek için: ${input.url}`,
      `Bağlantı ${expires} tarihine kadar geçerlidir ve tek kullanımlıktır.`,
      'Bu daveti beklemiyorsanız e-postayı yok sayabilirsiniz.',
    ].join('\n'),
    html: [
      `<p>${escapeHtml(inviter)} sizi Ticaret Merkezi'nde <strong>${escapeHtml(tenant)}</strong> mağazasına davet etti.</p>`,
      `<p>Rol: ${escapeHtml(role)}</p>`,
      `<p><a href="${escapeHtml(input.url)}">Daveti kabul et</a></p>`,
      `<p>Bağlantı ${escapeHtml(expires)} tarihine kadar geçerlidir ve tek kullanımlıktır. Bu daveti beklemiyorsanız e-postayı yok sayabilirsiniz.</p>`,
    ].join('\n'),
  };
}
