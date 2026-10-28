# Kullanıcı Yönetimi ve Çoklu Tenant Üyeliği — Tasarım

Tarih: 2026-10-28 · Durum: Taslak (kullanıcı onayı bekleniyor) · Kararlar: Yaklaşım A, firma başına rol, firma rollerinde en az 1 firma

## Amaç ve neden

Ticaret Merkezi bugün tek kişilik bir hesap gibi çalışıyor: kayıt olan kişi `owner` olur, başka kullanıcı eklenemez. Hedef, mağaza sahibinin ekibini e-posta davetiyle ekleyebildiği, rol ve firma bazında yetki verebildiği, profesyonel ve güvenli çok kullanıcılı bir SaaS altyapısı.

Uzun vadeli hedef: **bir kişi tek e-posta ve tek şifreyle birden fazla mağazada (tenant) görev alabilir.** Bu yüzden kullanıcı kimliği tenant'tan ayrılır (Yaklaşım A).

## Hedefler / Hedef dışı / Başarısızlık sayılır

**Hedefler**
- Global kullanıcı kimliği + tenant üyeliği veri modeli; kayıpsız, iki aşamalı migration.
- Login'de mağaza seçimi ve oturum içinde mağaza değiştirme.
- E-posta ile davet: gönderme, bekleyenler, iptal, yeniden gönderme, süre dolması, kabul (yeni hesap veya mevcut hesapla).
- Yapılandırılabilir e-posta altyapısı (SMTP); geliştirmede Mailpit.
- Kullanıcı listesi, rol atama, firma atama, üyeliği pasife alma.
- Sabit sistem rolleri ve yetki matrisi: Owner, Admin, Operasyon, Muhasebe, Görüntüleyici.
- Tüm yetki ve üyelik değişiklikleri Audit Log'a.

**Hedef dışı (sonraki aşamalar)**
- Özel (kullanıcı tanımlı) roller ve rol düzenleme ekranı.
- Şifre sıfırlama, e-posta doğrulama (davet kabulü e-postayı zaten doğrular; kayıt akışı değişmez).
- Sahipliği devretme (owner transfer), tenant silme.
- 2FA, SSO.

**Başarısızlık sayılır (çalışsa bile)**
- Davet token'ının veritabanında veya loglarda düz metin durması.
- Davet kabul edilmeden firma erişimi verilmesi.
- Bir mağazanın, başka mağazadaki üyeliği veya kullanıcının şifresini/adını değiştirebilmesi.
- Bir mağazadan pasife alınan kişinin o mağazaya giriş yapabilmesi ya da diğer mağazalarına girememesi.
- Mevcut kullanıcı, şifre, rol veya tenant verisinin kaybı.
- Davet uç noktalarıyla e-posta adresinin sistemde kayıtlı olup olmadığının öğrenilebilmesi.

## Yaklaşımlar

| | Yaklaşım | Değerlendirme |
|---|---|---|
| **A** | Global `users` + `tenant_memberships`; roller ve firma atamaları üyeliğe bağlı | **Seçildi.** Tek hesapla çoklu mağaza, doğal "mevcut hesapla kabul", pasife alma mağaza bazında. Maliyet: auth, tenant eklentisi, BFF oturumu ve testlerde geniş değişiklik. |
| B | Tenant başına ayrı kullanıcı, `(tenant_id, email)` tekil | Reddedildi: her mağazada ayrı şifre, login'de mağaza sorma, mağaza değiştirme yok. Uzun vadeli hedefe ters. |
| C | Önce mevcut modelle davet, global kimlik sonra | Reddedildi: başka mağazada hesabı olan davet edilemez; davet akışı sonradan yeniden yazılır. |

## Veri modeli

### Değişen ve yeni tablolar

**`users` (global kimlik)**
- Kalır: `id`, `name`, `email` (global tekil, küçük harfe normalize), `password_hash`, `last_login_at`, `created_at`, `updated_at`, `deleted_at`.
- Eklenir: `last_tenant_id` (nullable; login'de varsayılan mağaza).
- Kaldırılır (Aşama 2): `tenant_id`, `is_active`. `is_active` anlamı üyeliğe taşınır.
- Global hesap kilidi gerekirse ileride `users.disabled_at` eklenir (bu aşamada yok).

**`tenant_memberships` (yeni)**
- `tenant_id`, `user_id`, `status` (`active` | `inactive`), `joined_at`, `deactivated_at`, `created_at`, `updated_at`.
- PK `(tenant_id, user_id)`; `user_id` indeksli. FK `user_id → users.id`, `tenant_id → tenants.id`.

**`user_roles`, `user_company_roles`**
- Kolonlar aynı. Composite FK `(tenant_id, user_id) → users(tenant_id, id)` yerine `(tenant_id, user_id) → tenant_memberships(tenant_id, user_id)`. Böylece üyeliği olmayan birine rol/firma atanamaz (veritabanı seviyesinde garanti).

**`refresh_tokens`**
- `tenant_id` zaten var; anlamı netleşir: refresh token **bir üyeliğe** bağlıdır. FK `(tenant_id, user_id) → tenant_memberships`. Mağaza değiştirmek yeni refresh token üretir.

**`roles`**
- Eklenir: `key` (`owner`, `admin`, `operations`, `accounting`, `viewer`), `is_system` (bool). Sistem rolleri her tenant için oluşturulur; izinleri koddaki matristen gelir ve kullanıcı değiştiremez.

**`invitations` (yeni, tenant'a ait)**
- `id`, `tenant_id`, `email` (normalize), `tenant_role_id` (nullable; Admin daveti), `company_roles` (jsonb `[{ companyId, roleId }]`; firma rolleri daveti), `token_hash` (SHA-256, tekil), `status` (`pending` | `accepted` | `revoked` | `expired`), `expires_at`, `invited_by_user_id`, `accepted_by_user_id`, `accepted_at`, `revoked_at`, `last_sent_at`, `send_attempts`, `last_send_error` (kısa kod, ham hata değil), `created_at`, `updated_at`.
- Aynı tenant'ta aynı e-postaya en fazla bir `pending` davet: kısmi tekil indeks `(tenant_id, email) WHERE status = 'pending'`.
- `expired` durumu okuma sırasında `expires_at`'ten türetilir; ayrıca yazılmaz (cron gerekmez).

### Migration planı (kayıpsız)

**Aşama 1 — ekleme ve doldurma (geri alınabilir)**
1. `tenant_memberships` oluştur; her `users` satırı için `(tenant_id, id, is_active ? 'active' : 'inactive')` ekle.
2. `roles.key`, `roles.is_system` ekle. Mevcut `owner` rolleri `key='owner', is_system=true` olur. Her tenant için eksik sistem rolleri oluşturulur.
3. `users.last_tenant_id = tenant_id` doldur; e-postaları `lower()` ile normalize et (önce çakışma kontrolü: çakışma varsa migration durur, veri değişmez).
4. `user_roles`, `user_company_roles`, `refresh_tokens` FK'lerini üyeliğe taşı (yeni FK eklenir, eski FK kaldırılır; veri aynı kalır).
5. `invitations` oluştur.
6. `users.tenant_id` ve `users.is_active` bu aşamada **kalır** ama `tenant_id` nullable yapılır ve `users(tenant_id)` FK'si kaldırılır (mevcut değerler silinmez; davetle oluşan yeni kullanıcılarda `NULL`). Kod artık okumaz. *(Builder kararı: geri dönüşte değerler yerinde durur.)*
7. Postgres `AuditAction` enum'una yeni değerler eklenir. Uygulama DB rolünün yetkileri (`app_role_privileges` migration'ı ve `database/roles/setup-roles.sql`) yeni tablolar için güncellenir.

**Aşama 2 — temizlik (ayrı migration, ayrı onay)**
- `users.tenant_id`, `users.is_active` ve ilgili indeks/FK'ler kaldırılır. Aşama 1 kodu canlıda doğrulandıktan sonra çalışır.

Her iki migration da önce mevcut geliştirme veritabanının yedeği (`pg_dump`) alınarak çalıştırılır; satır sayıları migration öncesi/sonrası karşılaştırılır (kullanıcı, rol, rol ataması, firma ataması, refresh token, audit log).

## Tenant izolasyonu

- `User` **global model** olur: tenant eklentisi onu tenant ile filtrelemez. Kötüye kullanımı önlemek için eklentiye kural eklenir: global modellere (`User`) **yalnızca system context'te** erişilebilir; tenant context'inde `User` sorgusu reddedilir. Tenant içinden kullanıcı bilgisi yalnızca `TenantMembership` üzerinden (`include: { user: { select: { id, name, email } } }`) okunur.
  - Builder: Prisma `include` ile iç içe okumalar eklentiden geçmediği için bu okuma tenant'ın üyelik sorgusuyla sınırlıdır; yazma (`user` adı/şifresi) tenant context'inden yapılamaz.
- `TenantMembership`, `Invitation` normal tenant modelleridir.
- `runAsSystem` izin listesine yalnızca gerekenler eklenir: davet kabulü (token → davet çözümü, kullanıcı oluşturma) ve mağaza listesi (kullanıcının üyelikleri). İzin listesi testi güncellenir.

## Kimlik doğrulama ve oturum

**Login**
1. E-posta + şifre global kullanıcıyla doğrulanır (mevcut zamanlama korumaları korunur).
2. Aktif üyelikleri (aktif tenant'larda) alınır.
   - 0 üyelik → genel `Email veya şifre hatalı` (bilgi sızdırmaz).
   - 1 → o tenant.
   - Birden fazla → `last_tenant_id` aktifse o, değilse ilk üyelik (ada göre). Kullanıcı arayüzden değiştirir.
3. JWT yapısı aynı: `sub`, `tid`, `perms`. `perms` o üyeliğin rollerinden hesaplanır.

**Mağaza değiştirme**
- Backend: `POST /auth/switch-tenant { tenantId }` (oturum açık kullanıcı). Hedef üyelik aktif değilse `404`. Mevcut refresh token iptal edilir, hedef tenant için yeni çift üretilir, `last_tenant_id` güncellenir. Her iki tenant'a audit: `TENANT_SWITCH`.
- BFF: `POST /api/session/tenant`. Yeni token'larla **yeni session id** oluşturur, eskisini siler (fixation koruması), seçili firma sıfırlanır, istemci tam sayfa yenileme yapar (bellekte başka mağaza verisi kalmaz).
- `GET /auth/memberships`: kullanıcının aktif mağazaları (id, ad, slug). Üst bardaki mağaza seçicide gösterilir; tek mağaza varsa seçici gizlenir.

**Üyelik pasife alındığında**
- O üyeliğin tüm refresh token'ları iptal edilir. Kalan access token en fazla mevcut ömrü kadar (15 dk) geçerlidir; BFF bir sonraki refresh'te oturumu düşürür. Diğer mağazalardaki oturumlar etkilenmez.

**Kayıt (register)** değişmez görünür: global kullanıcı + tenant + owner üyeliği + sistem rolleri tek transaction'da. E-posta zaten kayıtlıysa mevcut davranış korunur (aynı genel hata).
- Builder: register transaction'ı bugün yük altında 5 sn Prisma sınırını aşabiliyor; sistem rolleri eklenince iş artar. Rol oluşturma `createMany` ile tek sorguya indirilir ve transaction'a açık `timeout` verilir.

## Davet akışı

**Gönderme** — `POST /invitations { email, tenantRole: 'admin' } | { email, companyRoles: [{ companyId, roleKey }] }`, izin `users:invite`.
1. Kurallar: `owner` rolüne davet edilemez; Admin'i yalnızca Owner davet eder; Admin firma rollerini verebilir. Firma rollerinde en az bir firma zorunlu; firmalar tenant'a ait ve aktif olmalı.
2. E-posta zaten bu tenant'ta aktif üyeyse `409 ALREADY_MEMBER` (yalnızca davet eden yetkiliye, tenant içi bilgi). Başka tenant'ta hesabı olup olmadığı **hiçbir yanıtta açığa çıkmaz**.
3. Aynı e-postaya bekleyen davet varsa `409 INVITATION_PENDING` (yeniden gönder kullanılır).
4. 32 bayt rastgele token üretilir, yalnızca SHA-256 hash'i saklanır. Süre: 7 gün (yapılandırılabilir `INVITATION_TTL_HOURS`).
5. Davet transaction'da kaydedilir, audit `INVITATION_CREATED`. **E-posta commit'ten sonra** gönderilir.
6. Gönderim başarısızsa davet `pending` kalır, `send_attempts` ve `last_send_error` güncellenir; yanıt `201` ama `delivery: 'failed'` içerir, arayüz "E-posta gönderilemedi, yeniden gönderin" gösterir. Token düz metni hiçbir yerde saklanmadığından yeniden gönderme **yeni token** üretir.

**Yeniden gönderme** — `POST /invitations/:id/resend`: yeni token, süre yeniden başlar, eski bağlantı geçersiz. Hız sınırı: davet başına 1/dk, tenant başına saatte 50.

**İptal** — `POST /invitations/:id/revoke`: `revoked`, bağlantı geçersiz. Audit `INVITATION_REVOKED`.

**Kabul** — bağlantı `APP_ORIGIN/invite/<token>` (token yalnızca URL path'inde; sayfa `Referrer-Policy: no-referrer` gönderir).
1. `POST /invitations/lookup` (BFF üzerinden, token gövdede): geçerliyse mağaza adı, davet edenin adı, rol, maskeli e-posta ve `accountExists` döner. Geçersiz/iptal/süresi dolmuş/kullanılmış → tek tip `404 INVITATION_INVALID`. Hız sınırlı (IP başına).
   - `accountExists` yalnızca geçerli token sahibine döner (token e-postaya gittiği için sahibi e-postanın sahibidir); token olmadan sorgulanamaz.
2. **Hesap yoksa:** ad + şifre (mevcut şifre kuralları) → global kullanıcı oluşturulur, e-posta davetteki e-postadır (değiştirilemez).
3. **Hesap varsa:** kişi şifresiyle doğrulanır (`/invitations/accept { token, password }`). BFF'de oturum açıksa BFF access token'ı ekler; backend oturumdaki kullanıcının e-postası davetle aynıysa şifre istemez (`/invitations/accept-as-current { token }`, oturum gerekli). Farklı hesapla açıksa "Bu davet başka bir e-posta için" uyarısı, kabul yok. *(Builder kararı.)*
4. Tek transaction: davet `pending` ve süresi dolmamış mı yeniden kontrol (`UPDATE ... WHERE status='pending' AND expires_at > now()`; 0 satır → geçersiz) → **davet hâlâ geçerli mi yeniden doğrula**: davet eden aktif üye ve bu rolü hâlâ verebiliyor, firmalar hâlâ aktif (pasif firmalar atlanır; firma rolünde hiç aktif firma kalmazsa `INVITATION_INVALID`) → üyelik oluştur (veya pasif üyeliği aktifleştir; eski rol/firma atamaları **davettekilerle değiştirilir**) → rol ve firma atamaları → davet `accepted`. *(Builder kararı.)* Audit `INVITATION_ACCEPTED`, `MEMBERSHIP_CREATED`, `ROLE_ASSIGNED`.
5. Kabul sonrası o tenant'a oturum açılır (BFF yeni session id; açık oturum varsa yeni mağazaya geçer).
- Davet eden pasife alınır veya yetkisini kaybederse bekleyen davetleri silinmez; 4. adımdaki yeniden doğrulama kabulü engeller. Kullanıcılar ekranında bu davetler "Geçersiz" etiketiyle gösterilir.

Firma erişimi yalnızca 4. adımda verilir; davet beklerken hiçbir atama yoktur.

## E-posta altyapısı

- `mail` modülü: `MailService.send({ to, subject, html, text })`. Taşıyıcı arayüzü arkasında `SmtpTransport` (nodemailer). Diğer modüller şablonu değil, `MailService`'i kullanır.
- Yapılandırma (`security.config.ts` tarzı doğrulanmış): `MAIL_TRANSPORT` (`smtp` | `log`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`. Production'da `log` reddedilir, TLS zorunlu.
- Geliştirme ve testler: `docker-compose`'a **Mailpit** (`axllent/mailpit`) eklenir; e2e testler bağlantıyı Mailpit API'sinden okur. Gerçek e-posta gitmez.
- Şablon: Türkçe, kurumsal renkler, düz metin alternatifi. İçerikte kullanıcı girdisi (mağaza adı, davet eden adı) HTML-escape edilir.
- Loglara alıcı adresi maskeli yazılır; token ve bağlantı **asla** loglanmaz.
- Builder: bu aşamada kuyruk/outbox yok; gönderim istek içinde ve zaman aşımlı (10 sn). Başarısızlık davet satırında izlenir. Outbox ileride eklenebilir.

## Roller ve yetki matrisi

Sistem rolleri sabit. İzinlerin tek kaynağı koddaki `roles.catalog.ts`'tir; çalışma anında izinler `roles.key` ile katalogdan okunur, `roles.permissions` kolonu sistem rolleri için kullanılmaz (senkron işi gerekmez). Bugün kodda yalnızca `owner` rolü oluşturuluyor; başka rol yok. *(Builder kararı.)*

**Rol kapsamı (kullanıcı kararı: firma başına farklı rol)**
- **Mağaza rolleri** (`user_roles`): Owner, Admin. Tüm firmalarda geçerli. Bir üyenin en fazla bir mağaza rolü olur.
- **Firma rolleri** (`user_company_roles`): Operasyon, Muhasebe, Görüntüleyici. Her firma için ayrı rol; aynı firmada en fazla bir rol (`(tenant_id, user_id, company_id)` tekil). Örnek: Ayşe A firmasında Muhasebe, B firmasında Operasyon.
- Bir üyenin ya mağaza rolü ya da **en az bir** firma rolü vardır (kullanıcı kararı: firmasız kullanıcı olmaz). Admin'den firma rollerine düşürmek en az bir firma ataması ister; firma rollerinden Admin'e yükseltmek firma atamalarını kaldırır.
- **Yetki hesabı:** JWT'deki `perms` = mağaza rolünün izinleri ∪ tüm firma rollerinin izinleri (kaba kontrol, `PermissionsGuard`). Firma kapsamlı her işlemde servis, kullanıcının **o firmadaki** rolünü veritabanından okur ve izni onunla doğrular. Böylece A'da Muhasebe, B'de Operasyon olan biri A'da Operasyon işlemi yapamaz. `companies` modülünün mevcut erişim kontrolü bu kurala genişletilir.
- **Ayrım:** tenant üyeliği (`tenant_memberships`: kişi bu mağazada mı, aktif mi), mağaza rolleri (Owner/Admin, tenant geneli yönetim) ve firma rolleri ayrı tablolarda ve ayrı kod yollarında tutulur. Firma rolleri hiçbir zaman `users:*`, `audit:read` veya `companies:all` içermez.
- **Backend'de uygulama:** firma kapsamlı uç noktalar firma kimliğini yoldan alır ve `CompanyAccessGuard`/servis kontrolü her istekte o firmadaki rolü veritabanından okur. Tarayıcıdaki "seçili firma" yalnızca arayüz tercihidir, yetki kaynağı değildir.
- **Firma değiştirildiğinde** ayrı bir yetki durumu tutulmaz: her istek hedef firmadaki role göre yeniden değerlendirilir. Rol veya firma ataması değişince etki bir sonraki istekte başlar (JWT'deki birleşik `perms` en geç token yenilemede güncellenir; firma kontrolü zaten anlık).
- **Bir firmadaki rol başka firmaya erişim sağlamaz:** ataması olmayan firma `404`; başka firmadaki rolün izni bu firmada sayılmaz.
- **Arayüz sade:** kullanıcıya izin listesi gösterilmez; yalnızca "Admin" ya da "Firma — Rol" satırları. Menü öğeleri ve butonlar, BFF'nin `auth/me` üzerinden verdiği basit bayraklarla (ör. `canManageUsers`, seçili firmada `canWrite`) gösterilir/gizlenir; asıl karar backend'dedir.
- `audit:read` tenant genelidir; firma rolüyle verilmez (bir firmadaki Muhasebe tüm mağazanın kayıtlarını görmesin). Bu aşamada yalnızca Owner ve Admin. *(Builder kararı.)*

| İzin | Owner | Admin | Operasyon | Muhasebe | Görüntüleyici |
|---|:-:|:-:|:-:|:-:|:-:|
| `companies:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `companies:write` | ✓ | ✓ | – | – | – |
| `companies:all` (tüm firmalar) | ✓ | ✓ | – | – | – |
| `users:read` | ✓ | ✓ | – | – | – |
| `users:invite` | ✓ | ✓ | – | – | – |
| `users:manage` (rol/firma atama, pasife alma) | ✓ | ✓ | – | – | – |
| `audit:read` | ✓ | ✓ | – | – | – |
| Gelecek: `catalog:*`, `inventory:*`, `orders:*` | ✓ | ✓ | ✓ | okuma | okuma |
| Gelecek: `invoices:*`, `reports:read` | ✓ | ✓ | okuma | ✓ | okuma |

- Owner `*` iznini korur (mevcut davranış).
- Firma rolleri yalnızca atandıkları firmaları görür ve orada o firmadaki rolün izinleriyle çalışır. Admin ve Owner tüm firmaları görür.
- Kurallar: Owner rolü yalnızca kayıtta verilir; tenant'ın son aktif Owner'ı pasife alınamaz ve rolü düşürülemez. Admin'i yalnızca Owner atar/kaldırır. Admin, Owner'ı ve başka Admin'i değiştiremez; kendini pasife alamaz. Kimse kendi rolünü değiştiremez.
- **Pasife alma** üyeliği `inactive` yapar, rol ve firma atamalarını **korur**; aktifleştirme onları geri getirir. Son Owner kontrolü yalnızca aktif üyelikleri sayar. *(Builder kararı.)*

## Kullanıcı yönetimi API'si ve ekranları

Backend (`users` modülü; üyelik, rol ve davet işlemleri):

| Metot | Yol | İzin |
|---|---|---|
| GET | `/users` (üyeler: ad, e-posta, rol, firmalar, durum, son giriş) | `users:read` |
| GET | `/users/:userId` | `users:read` |
| PUT | `/users/:userId/access` `{ tenantRole: 'admin' }` veya `{ companyRoles: [{ companyId, roleKey }] }` (tamamını değiştirir) | `users:manage` |
| POST | `/users/:userId/deactivate`, `/activate` | `users:manage` |
| GET | `/invitations?status=` | `users:read` |
| POST | `/invitations`, `/invitations/:id/resend`, `/invitations/:id/revoke` | `users:invite` |
| POST | `/invitations/lookup`, `/invitations/accept` | herkese açık, hız sınırlı |
| POST | `/invitations/accept-as-current` | oturum (e-posta davetle aynı olmalı) |
| GET | `/auth/memberships`, POST `/auth/switch-tenant` | oturum |

- Tenant'a ait olmayan veya üye olmayan kullanıcı `404`.
- Her değişiklik audit'e: `ROLE_CHANGED` (önce/sonra), `COMPANY_ACCESS_CHANGED` (eklenen/çıkarılan firmalar), `MEMBERSHIP_DEACTIVATED`/`ACTIVATED`, davet olayları. `before/after` içinde token veya şifre yok.
- BFF izin listesine (`bff-routes.ts`) yalnızca bu uç noktalar eklenir; `lookup`/`accept` için oturumsuz ayrı BFF route'ları (CSRF kontrolü dahil).

Frontend:
- **Kullanıcılar** sayfası (sol menü, yalnızca `users:read` olanlara): üyeler tablosu (mobilde kart; "Admin" veya "3 firma" özeti), "Kullanıcı davet et" diyaloğu (e-posta; "Admin" ya da firma-rol satırları: firma + rol, satır ekle/çıkar, en az bir satır), satır menüsü (erişimi düzenle, pasife al/aktifleştir).
- **Bekleyen davetler** sekmesi: e-posta, rol, gönderen, süre bitişi, gönderim durumu; "Yeniden gönder", "İptal et".
- **Davet kabul** sayfası `/invite/[token]`: mağaza ve rol bilgisi; hesap yoksa ad + şifre formu, varsa şifre ile giriş.
- **Mağaza seçici**: üst barda (birden fazla üyelik varsa).
- Builder: görsel dil mevcut firma ekranlarını izler (shadcn, kurumsal renkler, boş durumlar).

## Testler

- Backend unit: yetki matrisi, rol kuralları (son owner, admin sınırları), token üretimi/hash, e-posta şablonu escape, tenant eklentisinin global model kuralı.
- Backend e2e: firma başına rol (A'da Muhasebe, B'de Operasyon olan kullanıcı A'da Operasyon işlemi yapamaz); firmasız firma rolü reddedilir; davet eden yetkisini kaybedince davet kabul edilemez; migration sonrası eski owner'ın girişi; davet → kabul (yeni ve mevcut hesap); süresi dolmuş/iptal/kullanılmış token; yeniden gönderme eski token'ı geçersiz kılar; e-posta hatasında davet durumu; iki mağazalı kullanıcı login ve switch; pasife alınan üyelik refresh alamaz ama diğer mağaza çalışır; tenant izolasyonu (A'nın davet/üyelik/kullanıcısı B'den `404`); kayıtlı e-posta bilgisinin sızmaması; audit kayıtları.
- **Yetki yükseltme testleri:** firma rolündeki kullanıcı `users:*`/davet uç noktalarına `403`; Admin, Owner veya Admin atayamaz/değiştiremez; kimse kendi erişimini değiştiremez; davette ya da `PUT /access`'te başka tenant'ın firma veya rol kimliği `404`; sahte/eski JWT `perms` ile firma kontrolü atlatılamaz (rol kaldırıldıktan sonra eski token ile o firmada yazma reddedilir); pasif üyelikle `switch-tenant` `404`.
- Migration testi: Aşama 1'i örnek veriyle (2 tenant, pasif kullanıcı, firma ataması, refresh token) çalıştırıp satır sayılarını ve FK'leri doğrulayan test.
- Playwright: davet gönder → Mailpit'ten bağlantı → kabul → yalnızca atanan firmayı görme; mağaza değiştirme; mobil kullanıcı listesi.
- Mevcut testler: `User` artık tenant modeli değil — `tenant-prisma.extension.spec.ts` ve auth/companies e2e'lerindeki kullanıcı kurulumları güncellenir; davranış testleri silinmez.

## Doküman güncellemeleri

`ARCHITECTURE.md` (kullanıcı/üyelik modeli, roller), `DATABASE.md` (yeni tablolar, migration aşamaları), `API_DOCUMENTATION.md` (yeni uç noktalar), `SECURITY.md` (davet token'ı, e-posta, mağaza değiştirme).

## Builder'a bırakılanlar

- Dosya/klasör yerleşimi modül kurallarına göre (`users`, `invitations`, `mail` modülleri veya `users` altında alt klasörler).
- Hız sınırı anahtarlarının adları (mevcut `rl:` düzeni).
- E-posta şablonunun görsel ayrıntıları.
