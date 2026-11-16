# USR-T10 kalan dilim — gelişmiş davet yönetimi

Onaylı kaynak: `2026-10-28-user-management.md` Task 10 ve ilgili kullanıcı yönetimi spec'i. Mod: CRITICAL. Dal, PR #74'ün üzerinde; hedef dal `feature/usr-t9b-invitation-template`. A akışındaki #75 Excel işine dokunulmaz.

## Kapsam ve kararlar

- `GET /invitations?status=pending|expired|accepted|revoked`. Varsayılan mevcut bekleyenler listesini (süresi dolanlar işaretli) korur. Açık filtreler DB'de uygulanır, en çok 500 satır; token/hash dönmez.
- `POST /invitations/accept-as-current { token }`: JWT zorunlu, kaynak tenant'a davet yetkisi gerekmez; davet e-postasının güncel global hesabı JWT sub ile aynı olmalı. Yanlış hesap 403 INVITATION_EMAIL_MISMATCH. Mevcut kabul transaction'ı kullanılır; oturum/token veya mağaza değişimi yoktur.
- Pasif üyeliğe davet oluşturulabilir; create ve lookup `replacesInactiveMembership` gösterir. Kabulde eski atamalar eklenmez, değiştirilir; üyelik aktif olur, auth_version artar ve o tenant'ın eski refresh token'ları iptal edilir. Diğer tenant oturumları korunur.
- Owner'ın erişimi değiştirilemez. Pasif Admin'i yalnızca Owner değiştirebilir. Hem oluşturma hem kabulde kontrol edilir; davet eden ile hedef üyelikler sıralı kilitlenir. Arada aktifleşmiş üyelik 409 ALREADY_MEMBER olur; tüm yazılar geri alınır.
- Yeniden gönderim Redis'te davet başına 1/dk, tenant başına 50/saat; yetki kontrolünden sonra, token rotasyonundan önce; hata durumunda fail-closed.
- Yeni migration, bağımlılık veya dev deploy yok. BFF/UI USR-T12/T13 kapsamındadır.

## Adımlar

1. Durum IN-PROGRESS ve ilgili API/güvenlik notları; regresyon e2e ve rate-limit unit testleri (önce RED).
2. DTO, repository filtreleri, aynı hesapla kabul, pasif üyelik ve hız sınırlarını mevcut servislerle uygula.
3. Unit, lint, typecheck; izole CI'da tam e2e. Yerel dev DB'ye dokunulmaz.
4. CRITICAL: ayrı bağlamlı güvenlik incelemesi; bulgular kapanınca DONE-PR ve hazır PR. Merge/deploy ayrıca kullanıcı kararıdır.

## Kanıt ve karar kaydı

- Başlangıç: 712ae14; PR #74'ün kodu/testleri yeşil, henüz merge edilmedi. USR-T10 bağımlılığı stacked PR ile korunur.
- Scope mevcut onaylı plandır; owner değişmezliği daha sonraki kullanıcı kararına uyar. Sahiplik devri bu işin kapsamında değildir.

- RED kanıtı: CI 43750966675, test commit 1066d89 — 7 beklenen e2e başarısızlığı, 466 geçti, 1 Mailpit skip. Derleme/başlatma değil, eksik özellik assertion/HTTP sonuçları kırmızıydı.
- Yerel tam backend unit: 572/572 (41 dosya), t10-unit.log. Üretim kodu bu koşudan sonra değiştirilmedi; ek doküman güncellemeleri yapıldı.
- 2026-11-16 bağımsız CRITICAL inceleme: 712ae14 tabanına göre tam diff (commit edilmemiş uygulama dahil); engelleyici güvenlik/doğruluk bulgusu yok. İnceleme salt okunur; e2e/CI yeşil koşusu ayrıca gerekli.
- İnceleme önerileri: kabulün auth_version artırması ve eski refresh token iptali açık DB assertion'larıyla doğrulanır; eşzamanlı aktifleştirme testi kilit arkasında beklemeyi kanıtlar.
- GREEN: kod 5bf933c, CI 43816160375: unit 572/572; e2e 475 geçti + 1 Mailpit skip; frontend 198/198. Backend/frontend build ve lint başarılı. Yerel tsc --noEmit --incremental false ve type-aware lint çıkış kodu 0.
- PR #76, base #74; merge/deploy yapılmadı. BFF/UI USR-T12/T13 kapsamındadır.