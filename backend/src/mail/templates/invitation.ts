export interface InvitationMailInput {
  tenantName: string;
  inviterName: string;
  roleSummary: string;
  url: string;
  expiresAt: Date;
}

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

/** Pure renderer; the invitation service supplies the trusted APP_ORIGIN URL. */
export function renderInvitation(input: InvitationMailInput): {
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
  const subject = `${tenant} mağazasına davet edildiniz`;
  const expiry = `Bağlantı ${expires} (İstanbul saati) tarihine kadar geçerlidir ve tek kullanımlıktır.`;
  const ignore = 'Bu daveti beklemiyorsanız e-postayı yok sayabilirsiniz.';
  const link = escapeHtml(input.url);
  return {
    subject,
    text: [
      'Ticaret Merkezi',
      '',
      `${inviter} sizi Ticaret Merkezi'nde ${tenant} mağazasına davet etti.`,
      `Rol: ${role}`,
      '',
      `Daveti kabul etmek için: ${input.url}`,
      expiry,
      ignore,
    ].join('\n'),
    html: `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px 12px;background-color:#f1f5f9;color:#0f172a;font-family:Arial,sans-serif;line-height:1.6;">
  <table role="presentation" style="width:100%;max-width:600px;margin:0 auto;border-collapse:collapse;background-color:#ffffff;">
    <tr><td style="padding:24px;background-color:#0f172a;color:#ffffff;font-size:20px;font-weight:bold;">Ticaret Merkezi</td></tr>
    <tr><td style="padding:24px;">
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;">Mağazanıza davetlisiniz</h1>
      <p>${escapeHtml(inviter)} sizi Ticaret Merkezi'nde <strong>${escapeHtml(tenant)}</strong> mağazasına davet etti.</p>
      <p><strong>Rol:</strong> ${escapeHtml(role)}</p>
      <p style="margin:24px 0;"><a href="${link}" style="display:inline-block;padding:12px 24px;background-color:#1d4ed8;color:#ffffff;text-decoration:underline;border-radius:6px;font-weight:bold;">Daveti kabul et</a></p>
      <p>${escapeHtml(expiry)}</p>
      <p style="font-size:14px;">Düğme açılmıyorsa bu bağlantıyı tarayıcınıza kopyalayın:<br><a href="${link}" style="color:#1d4ed8;word-break:break-all;">${link}</a></p>
      <p style="margin-top:24px;font-size:14px;color:#475569;">${ignore}</p>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
