# USR-T11 kalan dilim: kullanıcı detayı ve son giriş zamanı

Onaylı kaynak: `2026-10-28-user-management.md` Task 11; `TASK_REGISTER.md` USR-T11. Mod: CRITICAL.
Başlangıç: `origin/main` f9b1fea. Dal: `feature/usr-t11b-user-details`.

## Tasarım ve sınırlar

- `GET /users/:userId`: JWT + users:read; yalnız mevcut tenant'ın üyeliği. Aktif/pasif üyeler aynı sınırlı profil ve tenant erişim bilgisiyle döner.
- Kullanıcı listesindeki profile `lastLoginAt` eklenir; detay ile liste aynı alanları üretir. Değer mevcut global users.last_login_at alanıdır; hiç giriş yoksa null. Kaynak mağaza/IP/oturum bilgisi dönmez.
- MembershipsRepository tenant membership üzerinden profil okur; UsersService kullanıcı/rol/firma tablolarına doğrudan erişmez. Detay önce üyeliği bulur; yabancı veya olmayan kullanıcı aynı 404 NOT_FOUND.
- Mevcut global guard izin kontrolünü kullanıcı sorgusundan önce yapar; yetkisiz kişi hedefin varlığını 403/404 farkıyla öğrenemez.
- Şifre/hash/token/auth_version veya başka tenant'taki roller döndürülmez. Yeni migration, yazma davranışı, bağımlılık, BFF/UI, merge/deploy yok.
- Task 11b mevcut T10a/T11a servislerini kullanır; gelişmiş davet API'sini tüketmez. Bu yüzden main üzerinde bağımsız PR olur. PR #76 ile #79 aynı davet kapsamına sahip; bu dal onlara yeni bir davet uygulaması eklemez.

## Uygulama ve kanıt

1. Görev IN-PROGRESS; API/mimari notu; e2e regresyonları önce RED (izole CI).
2. Tenant kapsamlı detay sorgusu, ortak profil eşleme, lastLoginAt; ilgili unit ve typecheck/lint.
3. Tam izole CI ve bağlamı devralmayan CRITICAL inceleme. Sonuçlar yeşil olunca DONE-PR, hazır PR.

## Koordinasyon

Claude PR #79 ile T10b/T12b/T13b üzerinde çalışıyor. Biz yalnız T11b (kullanıcı detay/lastLoginAt) üzerinde çalışırız. Birleşim öncesi #76/#79 uzlaştırılmalıdır; hiçbir PR bu işte merge edilmez.

- RED: test commit dd07458, CI 43842927769: 4 beklenen e2e başarısızlığı, 467 geçti + 1 Mailpit skip (eksik detay endpoint'i). Yerelde lastLoginAt/null sözleşme testleri 2/2 başarısız, uygulamadan sonra 2/2 geçti.
- Bağımsız CRITICAL inceleme: f9b1fea tabanına göre tam çalışma ağacı diff'i; engelleyici/aksiyon gerektiren bulgu yok. İnceleme salt okunur; tam e2e/CI ayrıca gerekli.