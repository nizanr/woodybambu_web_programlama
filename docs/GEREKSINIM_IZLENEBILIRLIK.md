# Gereksinim izlenebilirlik matrisi

Kaynak: *Woody Bambu — Yazılım Gereksinim Analizi ve Test Spesifikasyonu* (25.10.2026).
Her satır SRS kimliğini, uygulandığı yeri ve otomatik testini gösterir.
Test adları `tests/api.test.js` (API) ve `tests/browser.spec.js` (tarayıcı) içinde SRS kimliğiyle başlar.

## Roller (SRS 1.3, 2.1)

| SRS rolü  | `users.role` | Not |
| --------- | ------------ | --- |
| Ziyaretçi | (oturum yok) | Katalog, arama, analitik izin tercihi, 3D önizleme (kaydetmeden) |
| Üye       | `customer`   | Sepet, ödeme, adres, kendi sipariş/yerleşimi |
| Yönetici  | `manager`    | Ürün/kategori/3D model/stok, sipariş durumu, toplu raporlar |
| Admin     | `admin`      | Tüm yetkiler + rol, parametre, denetim kaydı |

Eski kayıtlar sunucu açılışında bir kez dönüştürülür: `user→customer`, `admin→manager`, `superadmin→admin` (`migrate()` — `server/seed.js`).

## Fonksiyonel gereksinimler

| Kimlik | Uygulama | Test |
| ------ | -------- | ---- |
| FR-001 | `GET /api/products` yalnızca `status: published`; stok etiketi ve `num_page_size` ile sayfalama (`main.jsx`) | TC-01 |
| FR-002 | `?q=` / `?category=` filtreleri; arayüzde boş durum mesajı | TC-01 |
| FR-003 | `GET /api/products/:id`: taslak 404, pasif ürün görünür ama `isActive:false` | TC-02 |
| FR-004 | Kayıt/giriş, bcrypt özeti, benzersiz e-posta | TC-03, VAL-001 |
| FR-005 | `POST /api/cart/items` sunucuda stok/durum kontrolü | TC-04 |
| FR-006 | `PATCH /api/cart/items/:id`, ara/genel toplam yeniden hesaplanır | TC-05 |
| FR-007 | `DELETE /api/cart/items/:id`; boş sepette ödeme düğmesi pasif | TC-07 |
| FR-008 | `/api/addresses` (yalnızca sahibine) ve “Adreslerim” | FR-008 testi |
| FR-009 | Stok 0 → sepete ekle pasif; boş sepet → ödeme pasif; kupon kapalı → kod alanı gizli | tarayıcı testi |
| FR-010 | Sepet özeti: ara toplam, indirim, kargo, genel toplam (sunucu `priceSummary`) | TC-06, BR-002 testi |
| FR-011 | `POST /api/orders`: adres, sözleşme, stok, tutar sunucuda; iyzico başlatma | TC-21, TC-11 |
| FR-012 | `finalizeOrder`: iyzico `retrieve` + tutar eşleşmesi olmadan “Ödendi” yok; callback de sorgular | TC-09, TC-11 |
| FR-013 | Sipariş sahiplenme (`pending→processing`) + `payments.providerRef` benzersiz | TC-10 |
| FR-014 | `GET /api/orders`, `GET /api/orders/:id` sahibine; yönetici tümünü | TC-08 |
| FR-015 | `PATCH /api/admin/orders/:id` yalnızca BR-009 geçişleri; denetim kaydı | TC-13 |
| FR-016 | Ürün/kategori CRUD, yayın durumu, denetim kaydı | TC-14, FR-016 testi |
| FR-017 | Ödeme başlatmada stok kontrolü; doğrulanmış ödemede koşullu atomik düşüm | TC-12 |
| FR-018 | `auth` + `roles()` her korumalı uçta; yetkisiz erişim denetim kaydına | TC-15, FR-018 testi |
| FR-019 | `product_view`, `add_to_cart`, `remove_from_cart`, `checkout_start`, `purchase` olayları | TC-16 |
| FR-020 | `GET /api/reports/summary` ürün bazında metrikler | TC-16 |
| FR-021 | Sepet terk oranı (BR-013) | TC-17 |
| FR-022 | Raporlar yönetici/admin; denetim yalnızca admin | TC-19 |
| FR-023 | `notifications` koleksiyonu; ödeme, durum, yeni sipariş, kritik stok, stok çakışması | bildirim testi |
| FR-024 | `PUT /api/admin/settings` (yalnızca admin) | TC-22 |
| FR-025 | `GET /api/reports/summary.csv` yalnızca toplu veri | FR-025 testi |
| FR-026 | Sağlayıcı hatasında anlaşılır mesaj; belirsiz sonuç `VAL-008`, başarılı sayılmaz | FR-026 testi |
| FR-027 | “Bahçede Gör” ziyaretçi dahil herkese açık; kaydetme/sepet giriş ister (VAL-019); JPEG/PNG + boyut + okunabilirlik | TC-23, TC-24, TC-31 |
| FR-028 | `model3dUrl`: `builtin:*` temsili model veya HTTPS GLB/GLTF; yoksa VAL-018 | TC-25, TC-26 |
| FR-029 | Fare sürükleme, tekerlek ölçek, dokunmatik tek parmak taşıma, iki parmak ölçek/döndürme, ok tuşları | TC-25 |
| FR-030 | Stüdyoda ürün seçici; fotoğraf korunur | tarayıcı testi |
| FR-031 | Stüdyoda “Satın al · Sepete ekle” → FR-005 | TC-27 |
| FR-032 | `/api/designs` kaydet/listele/aç/sil, yalnızca sahibine | TC-28 |
| FR-033 | Fotoğraf yalnızca istenirse `DesignPhoto`'ya; olay/log/rapora girmez | TC-30 |

## İş kuralları

| Kimlik | Uygulama |
| ------ | -------- |
| BR-001 | `status`: published / draft / inactive; sipariş satırları ad/fiyatı sabitler |
| BR-002 | İstemci toplamı yok sayılır, tutar sunucuda |
| BR-003 | `priceSummary` kuruş cinsinden tam sayı; `max(0, ara − indirim) + kargo` |
| BR-004 | Adet pozitif tam sayı ve ≤ stok |
| BR-005 | Stok yalnızca doğrulanmış ödemeden sonra düşer; yarışta `stock_conflict`/iptal |
| BR-006 | `payments.status`: pending / success / failed; belirsiz yanıt beklemede kalır |
| BR-007 | `providerRef` benzersiz indeks |
| BR-008 | Ödeme ↔ sipariş ↔ referans ilişkisi `payments` koleksiyonunda |
| BR-009 | `ORDER_TRANSITIONS` (`server/rules.js`) |
| BR-010 | Tüm üye verisi sorguları `user: currentUser._id` ile |
| BR-011 | `stock_price_change` denetim kaydı; geçmiş sipariş değişmez |
| BR-012 | `events`: eventId, eventType, productId, sessionId, occurredAt, userId, orderId, consentState |
| BR-013 | Tekil oturumun ilk `checkout_start` anından itibaren `num_abandonment_hours` penceresi; payda 0 → “Veri yok” |
| BR-014 | Dönüşüm = satın alan ∩ görüntüleyen tekil oturum / görüntüleyen tekil oturum |
| BR-015 | `POST /api/consent`; izin yoksa olay yazılmaz (VAL-015) |
| BR-016 | Raporda “Son güncelleme” zamanı |
| BR-017 | Siparişte `settingsVersion`; ödenmiş tutar değişmez |
| BR-018 | Sunucu UTC; rapor tarihleri `cmb_report_timezone` ile gün başlangıcına çevrilir; arayüz Europe/Istanbul |
| BR-019 | Stüdyoda “temsili” uyarısı; önizleme fiyat/stok/siparişi etkilemez |
| BR-020 | İstemci + sunucu (MIME + imza baytları + `num_max_photo_mb`) |
| BR-021 | Fotoğraf yalnızca “hesabıma kaydet” seçilirse saklanır; loglara yazılmaz |
| BR-022 | Yerleşim ve fotoğraf uçları sahiplik filtresiyle |
| BR-023 | Stüdyodan sepete ekleme aynı `/api/cart/items` ucunu kullanır |
| BR-024 | *(SRS güncellemesi gerekir)* Önizleme herkese açık; `/api/designs*` ve `/api/cart*` sunucuda oturum ister |
| BR-T01 | `settings.version` her güncellemede artar; sipariş oluşturulduğu sürümü saklar |
| BR-T02 | Ayarlar yalnızca admin; önce/sonra değerleriyle `settings_update` kaydı |

## Validasyonlar

Tüm mesajlar `server/rules.js` → `MSG` içinde SRS metniyle birebir tutulur (VAL-001 … VAL-020). İstisna: VAL-019 artık “Yerleşimi kaydetmek veya satın almak için hesap oluşturup giriş yapınız.” (önizleme herkese açıldı).

## Fonksiyonel olmayan gereksinimler

| Kimlik | Durum |
| ------ | ----- |
| NFR-01 | bcrypt (12 tur), sunucu tarafı rol kontrolü; üretimde Secure çerez, HTTPS Render tarafından sonlandırılır |
| NFR-02 | Yük testi yapılmadı (manuel/ayrı araç gerekir) |
| NFR-03 | Etiketli form alanları, modal odak tuzağı, klavyeyle taşınabilir sahne; tam WCAG denetimi yapılmadı |
| NFR-04 | Mobil 390 px taşma testi (tarayıcı testi) |
| NFR-05 | `auditlogs`: actorId, rol, eventType, targetId, önce/sonra, sonuç, correlationId |
| NFR-06 | Kart verisi uygulamaya hiç gelmez (iyzico checkout formu) |
| NFR-07 | Ödeme başlatma hatasında sipariş iptal, stok etkilenmez; doğrulama tekrar denenebilir |
| NFR-08 | `docs/YAYINLAMA.md` — Atlas yedekleme adımları; geri yükleme testi canlı öncesi yapılmalı |
| NFR-09 | Gizli değerler ortam değişkenlerinde (`render.yaml`, `.env.example`) |
| NFR-10 | `eventId` benzersiz indeks; rapor etiketleri olay/oturum/sipariş ayrımını belirtir |
| NFR-11 | Stüdyoda ölçülen model yükleme süresi `num_preview_load_sec` hedefiyle gösterilir |
| NFR-12 | WebGL yoksa bilgilendirme; satın alma düğmesi çalışmaya devam eder |
| NFR-13 | Fotoğraf imza baytı kontrolü, `nosniff`, `default-src 'none'` CSP ile yalnızca görüntü olarak sunulur |

## SRS'ten bilinçli sapma: önizleme herkese açık

Ekip kararıyla 3D önizleme ziyaretçilere de açıldı; yerleşimi kaydetme ve sepete ekleme hâlâ hesap gerektirir. SRS'in bir sonraki sürümünde şu maddeler güncellenmelidir:

| Madde | Yeni ifade önerisi |
| ----- | ------------------ |
| 1.2 Kapsam | “3D önizleme tüm ziyaretçilere açıktır; yerleşimi kaydetmek ve satın almak için hesap gerekir.” |
| 1.3 Roller | Ziyaretçi: “… fotoğraf üzerinde 3D önizleme (kaydetmeden)”; Üye: “yerleşimini hesabına kaydetme” |
| 1.5 Adım 2 | Aktör: “Ziyaretçi / Üye” |
| FR-027 | İlk cümle: “3D önizleme ziyaretçi dahil herkese sunulur; yerleşimi kaydetmek veya sepete eklemek isteyen oturumsuz kullanıcı giriş/kayıt sayfasına yönlendirilir (VAL-019).” |
| BR-024 | “3D önizleme herkese açıktır; yerleşim kaydı ve satın alma yalnızca oturum açmış kullanıcıya sunulur ve sunucuda doğrulanır.” |
| VAL-019 | Koşul: “Oturumsuz yerleşim kaydı / satın alma isteği”; Mesaj: “Yerleşimi kaydetmek veya satın almak için hesap oluşturup giriş yapınız.” |
| 4. Yetki matrisi | “Fotoğraf üzerinde 3D önizleme kullanma”: Ziyaretçi ✓ (“hesap gerekir” notu kaldırılır) |
| TC-31 | “Oturumsuz kullanıcı önizlemeyi açar ve modeli yerleştirir; ‘Yerleşimi kaydet’ seçince VAL-019 gösterilir ve giriş sayfasına yönlendirilir; kayıt API isteği reddedilir.” |
| 10.2 Use-case | “Ziyaretçi / Üye → Bahçe fotoğrafında 3D önizleme yap” |

## Açık kararlar (SRS 10.7) — kodda uygulanan varsayımlar

| Karar | Varsayılan |
| ----- | ---------- |
| DEC-01 | Misafir ödeme yok; sepet ve sipariş için üyelik gerekir |
| DEC-02 | Kargo 300 TL, 15.000 TL üzeri ücretsiz, kupon kapalı — Ayarlar ekranından değiştirilebilir |
| DEC-03 | Üye yalnızca ödenmemiş demo siparişini iptal edebilir; iade akışı yok |
| DEC-04 | Ham olay saklama 180 gün, açık rıza bandı |
| DEC-06 | Bildirimler sistem içi; e-posta sağlayıcısı seçilmedi |
| DEC-07 | Fotoğraf yalnızca üye “hesabıma kaydet” derse MongoDB'de, yerleşimle birlikte silinir |
| DEC-08 | Fotoğraf üst sınırı 8 MB; 3D model `.glb` / `.gltf` (HTTPS) veya temsili yerleşik model |
