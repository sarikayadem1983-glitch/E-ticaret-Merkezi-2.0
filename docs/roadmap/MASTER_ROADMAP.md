# Ana Geliştirme Yol Haritası (Master Development Roadmap)

Ticaret Merkezi 2.0 — çok kiracılı (multi-tenant) e-ticaret yönetim SaaS'ı.
Hazırlanma: 2026-10-29, kaynak kod `feature/user-management` @ `946dec0` incelenerek.

| Doküman | İçerik |
|---|---|
| [TASK_REGISTER.md](TASK_REGISTER.md) | Tüm EPIC ve görevler: ID, öncelik, bağımlılık, tahmin, mod, sürüm, durum, kabul kriteri, test, risk |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | Anlık durum, PR #6, deploy durumu, riskler, sıradaki görevler |
| [MVP_PLAN.md](MVP_PLAN.md) | Sürüm A ayrıntılı planı |
| [RELEASE_PLAN.md](RELEASE_PLAN.md) | Sürüm A/B/C kapsamı, çıkış kriterleri, takvim |
| [DEPENDENCIES.md](DEPENDENCIES.md) | Bağımlılık grafiği ve kritik yol |

Görev numaraları kalıcıdır; kullanıcı yönetimi planının Task 1–16'sı `USR-T1` … `USR-T16` olarak korunur (Task 7–8 tanımları plandaki gibidir).

## 1. Mevcut durum (doğrulanmış)

**Merge edilmiş (PR #1–#5, `origin/main` @ `78e5f8d`):** Docker dev ortamı; NestJS + Prisma iskeleti ve Prisma tenant izolasyon eklentisi; append-only audit log; en az yetkili DB rolü `tm_app`; HTTP sertleştirme; Redis tabanlı rate limiting; firma (company) API'si; Next.js BFF (Redis oturumu, CSRF, açık proxy koruması, güvenlik başlıkları); firma ekranları; dashboard iskeleti; yetkisiz erişim/oturum e2e testleri.

**PR #6'da, merge edilmemiş, deploy edilmemiş (`feature/user-management` → `main`):** kullanıcı yönetimi planının Task 1, 2, 3, 4, 5, 6'sı ve pasif/silinmiş kullanıcı güvenlik düzeltmesi (`946dec0`'a kadar). Ayrıntı: `PROJECT_STATUS.md` §2.

- Task 3 yalnızca rapor üretti (onay kapısı); Aşama 1 migration'ı dev DB'ye sonradan kullanıcı onayıyla uygulandı.
- Dev backend (`:4000`) ve dev DB `eda38da` (Task 4) kodunu çalıştırır; Task 5–6 ve güvenlik düzeltmesi dev'de değildir.
- Son test sonuçları: backend unit 184/184, backend e2e 165/165, frontend 81/81.

**Kodda henüz olmayanlar:** katalog, stok, sipariş, kanal entegrasyonları, fatura, rapor, ai-engine, abonelik, kuyruk altyapısı, CI, staging. Prisma şemasında 10 model var (`Tenant, User, Role, UserRole, RefreshToken, Company, TenantMembership, Invitation, UserCompanyRole, AuditLog`), 6 uygulanmış migration ve 1 bekleyen (`migrations-pending/phase2_drop_legacy_user_columns`).

## 2. Modüller ve EPIC'ler

| # | Modül | Önek | EPIC'ler | Görev | Tamamlanan | Sürümler |
|---|---|---|---|---|---|---|
| M01 | SaaS altyapısı ve güvenlik | INF | Temel altyapı · Arka plan işleri/CI/ortamlar · Canlı öncesi sertleştirme | 20 | 8 | A, B |
| M02 | Kullanıcılar, firmalar, roller | USR | Firma yönetimi · Kullanıcı yönetimi ve çoklu tenant · Hesap güvenliği | 22 | 9 | A, B |
| M03 | Dashboard | DSH | Dashboard | 3 | 1 | A, B |
| M04 | Ürün kataloğu | CAT | Katalog çekirdeği · Kanal kategori eşleme | 6 | 0 | A |
| M05 | AI destekli ürün yükleme | AIU | AI ile ürün içeriği | 3 | 0 | C |
| M06 | Excel/CSV ve URL ile toplu yükleme | IMP | Toplu içe/dışa aktarma | 4 | 0 | A, B |
| M07 | Ürün görsel yönetimi | IMG | Görseller | 3 | 0 | A, C |
| M08 | Pazaryeri entegrasyonları | INT | Ortak çerçeve · Trendyol · Hepsiburada · Amazon TR · n11 · Pazarama · ÇiçekSepeti · Temu | 25 | 0 | A, B, C |
| M09 | Siparişler | ORD | Sipariş yönetimi | 4 | 0 | A, B |
| M10 | Stok ve depo | INV | Stok yönetimi | 4 | 0 | A, B |
| M11 | Kargo, iptal ve iade | SHP | Kargo ve iade | 3 | 0 | A, B |
| M12 | e-Fatura / e-Arşiv ve muhasebe | EFT | e-Belge | 5 | 0 | B, C |
| M13 | Müşteriler ve tedarikçiler | CRM | Müşteri ve tedarikçi | 3 | 0 | A, B |
| M14 | Kampanya ve reklam | CMP | Kampanya ve reklam | 3 | 0 | B, C |
| M15 | Kârlılık ve gider | PRF | Kârlılık | 3 | 0 | B |
| M16 | Hakediş ve mutabakat | STL | Hakediş | 3 | 0 | B |
| M17 | Raporlama | RPT | Raporlar | 4 | 0 | A, B, C |
| M18 | AI asistan ve otomasyonlar | AIE | AI motoru ve otomasyon | 4 | 0 | C |
| M19 | Abonelik ve ödeme | SUB | Abonelik | 4 | 0 | B |
| M20 | Sistem yönetimi, izleme, güvenlik | OPS | İzleme/yedek/performans · Yönetim ve uyum | 7 | 0 | A, B |
| | **Toplam** | | **33 EPIC** | **133** | **18** | |

Mimari kurallar her modül için geçerlidir: tenant'a ait her sorgu `tenant_id` ile filtrelenir; modüller birbirinin tablosuna doğrudan erişmez (servis arayüzü); `ai-engine` diğer modüllerden bağımsızdır (kendi tabloları, açık veri sözleşmesi, yalnızca öneri). Pazaryerleri ortak `ChannelAdapter` arayüzünü uygular ve senkronlar kuyrukta çalışır (`ARCHITECTURE.md`).

## 3. Sürümler (özet)

| Sürüm | Amaç | Görev | Tahmin (iş günü) | Hedef tarih |
|---|---|---|---|---|
| A — MVP | İlk çalışan e-ticaret operasyon platformu (Trendyol + Hepsiburada, katalog, stok, sipariş, iade) | 69 (18 tamam + 51 kalan) | 149 | 2027-03-19 |
| B — Ticari SaaS | Ücretli müşteriye satılabilir: abonelik, e-Fatura, kârlılık, hakediş, 4 pazaryeri, prod güvenliği | 43 | 149 | 2027-07-30 |
| C — Gelişmiş SaaS | AI otomasyonları, kampanya optimizasyonu, gelişmiş analitik, 7 pazaryeri | 21 | 87 | 2027-10-15 |

Ayrıntı ve çıkış kriterleri: `RELEASE_PLAN.md`.

## 4. Kritik yol

PR #6 merge → USR-T7 → USR-T8 → CAT-01 → CAT-02 → CAT-03 → CAT-06 → INT-TY-01 → INT-TY-03 → SHP-02 → MVP kabul. Paralel önkoşullar: INF-09 (kuyruk) → INT-02; INT-01; ORD-01 → ORD-02; INV-01 → INV-02. Ayrıntı: `DEPENDENCIES.md`.

## 5. Çalışma modları

Her görevin modu `TASK_REGISTER.md`'de yazılıdır; kurallar `AGENTS.md`'dedir.

| Mod | Ne zaman | İnceleme |
|---|---|---|
| FAST | Düşük risk: UI listesi, dışa aktarma, doküman | Tek uygulayıcı, ek inceleme yok; CI yeşil yeterli |
| STANDARD | Normal özellik | Uygulayıcı öz-incelemesi + PR kontrolü |
| CRITICAL | Güvenlik, tenant izolasyonu, yetki, ödeme, kimlik bilgisi, veri migration'ı | Bağımsız inceleyici zorunlu; migration'da prova + kullanıcı onayı |

Dağılım: 51 CRITICAL, 75 STANDARD, 7 FAST.

## 6. Tahmin varsayımları

- **Ekip:** bu AI-ajan iş akışı (uygulayıcı ajan + CRITICAL görevlerde bağımsız inceleyici ajan) ve tek insan onaylayıcı. Aynı anda en fazla **2 paralel iş akışı** (onaylayıcının takip kapasitesi ve çakışan migration'lar nedeniyle).
- **Birim:** iş günü; spec/plan yazımı, TDD uygulama, test, inceleme ve düzeltme döngüsünü kapsar. Kalibrasyon: kullanıcı yönetimi Task 1–6 hazır ve ayrıntılı bir planla ~2 takvim gününde bitti; yeni modüller önce spec + plan gerektirir ve dış sistemlere bağlıdır, bu nedenle tahminler bu hızın altında tutuldu.
- **Onay gecikmesi:** her onay kapısı (migration, merge, deploy, sürüm) ortalama 0,5–1 iş günü; takvimde %15 tampon olarak yer alır.
- **Dış erişim:** pazaryeri satıcı hesapları ve API anahtarları/sandbox (Trendyol, Hepsiburada MVP öncesi; Amazon SP-API geliştirici kaydı, n11 B öncesi; Pazarama, ÇiçekSepeti, Temu C öncesi), e-Fatura özel entegratör sözleşmesi + test hesabı, ödeme sağlayıcı (iyzico/PayTR) üye işyeri hesabı kullanıcı tarafından sağlanır. Erişim gelmezse ilgili görev `BLOCKED` olur ve takvim kayar. Temu'nun Türkiye satıcı API erişimi doğrulanmadı.
- **Altyapı:** staging/prod barındırma sağlayıcısı ve alan adı B sürümü öncesinde kullanıcı tarafından seçilir.
- **Hariç:** pazarlama sitesi, mobil uygulama, hukuki metinlerin içeriği (KVKK aydınlatma, sözleşmeler), bağımsız sızma testinin dış firma süresi.

## 7. Riskler (özet)

Tam liste ve "canlıdan önce mutlaka düzeltilecekler": `PROJECT_STATUS.md` §5. Öne çıkanlar: mağaza değiştirmede Redis hatasının sahte token hırsızlığı ve tüm cihazlardan çıkışa yol açması (INF-18), BFF `forceRefresh` yarışı (INF-19), kayıtta `409` ile hesap varlığı sızıntısı (INF-20), firma rolü yetki sınırlarının henüz uygulanmaması (USR-T7/T8), Aşama 2 öncesi `users.is_active` bağımlılığı (USR-18), prod öncesi yedek/izleme/güvenlik/performans eksikleri (OPS-*, INF-11..17).
