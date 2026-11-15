# USR-T9 kalan dilim: davet e-postası

Kaynak: onaylı `2026-10-28-user-management.md`, Task 9. Mod: STANDARD.
Başlangıç: `f2cd4a4`; dal: `feature/usr-t9b-invitation-template`.

## Kapsam ve kabul

- `mail/templates/invitation.ts`: saf `renderInvitation({ tenantName, inviterName, roleSummary, url, expiresAt })` → `{ subject, html, text }`.
- Türkçe, Ticaret Merkezi markalı, mobilde okunabilir HTML; düz metin alternatifi, kabul bağlantısı, İstanbul saatinde süre ve tek kullanım bilgisi.
- Tüm dinamik HTML değerleri kaçışlanır; konu tek satırdır. Dış görsel, izleme, loglama veya gönderim yan etkisi yoktur.
- Mevcut `invitationMail` arayüzü uyumlu kalır ve aynı şablonu kullanır. Auth, davet yaşam döngüsü ve SMTP davranışı değişmez.
- Migration, yeni bağımlılık, dev deploy ve merge yok.

## Uygulama

1. Görevi IN-PROGRESS yap; mimari notunu güncelle.
2. Mevcut davet testlerini çalıştır; yeni şablon testlerinin eksik uygulama nedeniyle başarısız olduğunu doğrula.
3. Şablonu ve uyumlu çağrıyı uygula; ilgili testleri çalıştır.
4. Backend unit, lint ve typecheck; STANDARD öz-inceleme; PR ve durum kaydı. Veritabanlı e2e için CI sonucu ayrıca kaydedilir.

## Kararlar ve kanıt

- Native çalışma alanı oluşturma yanıtı gelmediği için ana depoya yazmayan ayrı yerel Git kopyası kullanıldı. Nesneler hardlink ile paylaşılmıyor.
- Tek görev, mevcut `invitationMail` tüketicisi korunur; yeni servis arayüzü veya modül bağımlılığı yoktur.

- RED: üç yeni şablon testi boş uygulamada assertion hatasıyla başarısız oldu.
- GREEN: ilgili mail/davet testleri 30/30; tam backend unit 572/572 (41 dosya). Typecheck (	sc --noEmit --incremental false) ve type-aware lint çıkış kodu 0.
- STANDARD öz-inceleme: tüm dinamik HTML değerleri ve link attribute kaçışlı; URL mevcut güvenilir APP_ORIGIN üzerinden üretilir; konu CR/LF içermez. Servis arayüzü korunur; veri erişimi, SMTP, loglama ve bağımlılıklar değişmez.
- Yerel e2e çalıştırılmadı; dev DB kullanılmadı. Tam e2e CI'da doğrulanacak.
