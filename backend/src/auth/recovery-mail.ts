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
    subject: 'E-Ticaret Merkezi 2.0 şifre sıfırlama',
    text: [
      'E-Ticaret Merkezi 2.0 hesabınız için şifre sıfırlama istendi.',
      '',
      `Yeni şifre belirlemek için: ${url}`,
      `Bağlantı ${when(expiresAt)} tarihine kadar geçerlidir ve tek kullanımlıktır.`,
      'Şifre değişince tüm cihazlardaki oturumlarınız kapanır.',
      'Bu isteği siz yapmadıysanız e-postayı yok sayın; şifreniz değişmez.',
    ].join('\n'),
    html: [
      '<p>E-Ticaret Merkezi 2.0 hesabınız için şifre sıfırlama istendi.</p>',
      `<p><a href="${escapeHtml(url)}">Yeni şifre belirle</a></p>`,
      `<p>Bağlantı ${escapeHtml(when(expiresAt))} tarihine kadar geçerlidir ve tek kullanımlıktır. Şifre değişince tüm cihazlardaki oturumlarınız kapanır.</p>`,
      '<p>Bu isteği siz yapmadıysanız e-postayı yok sayın; şifreniz değişmez.</p>',
    ].join('\n'),
  };
}

/**
 * INF-20: someone registered with an address that already has an account. Sent
 * to the owner instead of an error on the page, so the page reveals nothing.
 */
export function accountExistsMail(
  loginUrl: string,
  resetUrl: string,
): RecoveryMail {
  return {
    subject: 'E-Ticaret Merkezi 2.0 kayıt denemesi',
    text: [
      'Bu e-posta adresiyle E-Ticaret Merkezi 2.0’a yeniden kayıt olunmaya çalışıldı.',
      'Adresinizin zaten bir hesabı var; yeni hesap veya mağaza açılmadı.',
      '',
      `Giriş yapmak için: ${loginUrl}`,
      `Şifrenizi unuttuysanız: ${resetUrl}`,
      'Bu denemeyi siz yapmadıysanız e-postayı yok sayın; hesabınızda bir şey değişmedi.',
    ].join('\n'),
    html: [
      '<p>Bu e-posta adresiyle E-Ticaret Merkezi 2.0’a yeniden kayıt olunmaya çalışıldı.</p>',
      '<p>Adresinizin zaten bir hesabı var; yeni hesap veya mağaza açılmadı.</p>',
      `<p><a href="${escapeHtml(loginUrl)}">Giriş yap</a> · <a href="${escapeHtml(resetUrl)}">Şifremi unuttum</a></p>`,
      '<p>Bu denemeyi siz yapmadıysanız e-postayı yok sayın; hesabınızda bir şey değişmedi.</p>',
    ].join('\n'),
  };
}

/** E-mail verification message. */
export function emailVerifyMail(url: string, expiresAt: Date): RecoveryMail {
  return {
    subject: 'E-Ticaret Merkezi 2.0 e-posta doğrulama',
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
