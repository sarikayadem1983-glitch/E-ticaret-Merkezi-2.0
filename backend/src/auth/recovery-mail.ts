const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const when = (d: Date) =>
  d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

export interface RecoveryMail {
  subject: string;
  html: string;
  text: string;
}

/** Password reset e-mail. The link is single-use and expires. */
export function passwordResetMail(url: string, expiresAt: Date): RecoveryMail {
  return {
    subject: 'Ticaret Merkezi şifre sıfırlama',
    text: [
      'Ticaret Merkezi hesabınız için şifre sıfırlama istendi.',
      '',
      `Yeni şifre belirlemek için: ${url}`,
      `Bağlantı ${when(expiresAt)} tarihine kadar geçerlidir ve tek kullanımlıktır.`,
      'Şifre değişince tüm cihazlardaki oturumlarınız kapanır.',
      'Bu isteği siz yapmadıysanız e-postayı yok sayın; şifreniz değişmez.',
    ].join('\n'),
    html: [
      '<p>Ticaret Merkezi hesabınız için şifre sıfırlama istendi.</p>',
      `<p><a href="${escapeHtml(url)}">Yeni şifre belirle</a></p>`,
      `<p>Bağlantı ${escapeHtml(when(expiresAt))} tarihine kadar geçerlidir ve tek kullanımlıktır. Şifre değişince tüm cihazlardaki oturumlarınız kapanır.</p>`,
      '<p>Bu isteği siz yapmadıysanız e-postayı yok sayın; şifreniz değişmez.</p>',
    ].join('\n'),
  };
}

/** E-mail verification message. */
export function emailVerifyMail(url: string, expiresAt: Date): RecoveryMail {
  return {
    subject: 'Ticaret Merkezi e-posta doğrulama',
    text: [
      'E-posta adresinizi doğrulamak için bağlantıyı açın:',
      url,
      `Bağlantı ${when(expiresAt)} tarihine kadar geçerlidir ve tek kullanımlıktır.`,
    ].join('\n'),
    html: [
      '<p>E-posta adresinizi doğrulamak için bağlantıyı açın:</p>',
      `<p><a href="${escapeHtml(url)}">E-postamı doğrula</a></p>`,
      `<p>Bağlantı ${escapeHtml(when(expiresAt))} tarihine kadar geçerlidir ve tek kullanımlıktır.</p>`,
    ].join('\n'),
  };
}
