# Woody Bambu

Nisa Nur Çakır ve Zeynep Ulusoy'un öneri raporuna göre geliştirilen, fotoğraf üzerinde 3D mobilya yerleştirmeli bahçe mobilyası e-ticaret uygulaması.

## Çalıştırma

Node.js 22+ ve Docker gerekir. MongoDB 7.0.24, Docker üzerinde çalışır; kayıtlar `.data/mongo-docker` dizininde kalıcıdır.

```bash
bash scripts/setup.sh
npm run dev
```

Uygulama 3000 portunda çalışır. Harici MongoDB kullanıyorsanız `MONGODB_URI` tanımlayın; Docker yerine kendi servisinizi başlatın ve `npm ci` çalıştırın. Geliştirmede MongoDB bulunamazsa bellek içi veritabanı açılır. Testler varsayılan olarak geçici bir bellek içi MongoDB kullanır; mevcut bir sunucuyu kullanmak için `MONGODB_TEST_URI=mongodb://127.0.0.1:27017` tanımlayın (her test dosyası ayrı veritabanı açar ve yalnızca onu siler).

```bash
npm test                    # API entegrasyon testleri
npx playwright test         # çalışan uygulama üzerinde tarayıcı testleri
npm run build               # React üretim derlemesi
```

Tarayıcı testleri varsayılan olarak `/usr/bin/chromium` kullanır; farklı yol için `CHROMIUM_PATH` ortam değişkenini verin. Test adlarındaki `TC-xx` kimlikleri SRS test senaryolarıdır; gereksinim → kod → test eşlemesi [Gereksinim izlenebilirlik matrisi](docs/GEREKSINIM_IZLENEBILIRLIK.md) dosyasındadır.

## Özellikler

- Türkçe ve mobil uyumlu katalog; kategori, arama, fiyat sıralaması, ürün detayı.
- Şifreleri bcrypt ile saklayan üyelik, MongoDB'de oturum; SRS'teki Üye (`customer`), Yönetici (`manager`) ve Admin (`admin`) rolleri. Eski `user/admin/superadmin` kayıtları ilk açılışta otomatik dönüştürülür.
- Sunucuda tutulan, stok kontrollü sepet; ara toplam, indirim kodu, kargo ve genel toplam sunucuda hesaplanır. Stok yalnızca doğrulanmış ödemeden sonra ve tek sefer düşer.
- Demo ödeme ile sipariş oluşturma; iyzico sandbox checkout entegrasyonu ve sunucu taraflı ödeme sorgulama.
- Adres defteri, mesafeli satış sözleşmesi onayı, sistem içi bildirimler ve kendi sipariş geçmişi.
- Yönetici: ürün/kategori/3D model/stok yönetimi, sırayla ilerleyen sipariş durumları (Ödendi → Hazırlanıyor → Kargolandı → Teslim Edildi), ürün etkileşim ve sepet terk raporları, CSV dışa aktarma.
- Admin: rol yönetimi, kargo/indirim/analitik/3D önizleme parametreleri, indirim kodları ve denetim kaydı.
- İzin tabanlı davranış analitiği (product_view, add_to_cart, remove_from_cart, checkout_start, purchase); izin verilmezse olay kaydedilmez.
- “Bahçede Gör” ziyaretçi dahil herkese açıktır; yerleşimi kaydetmek ve sepete eklemek için giriş gerekir. Three.js ile temsili model veya HTTPS GLB/GLTF dosyası; JPEG/PNG bahçe fotoğrafında fare/dokunmatik ile sürükleme, döndürme ve boyutlandırma; fotoğrafı yeniden yüklemeden başka ürün deneme ve önizlemeden sepete ekleme. Fotoğraf yalnızca kullanıcı “hesabıma kaydet” derse sunucuya gider; olaylara ve loglara hiçbir zaman yazılmaz.

## İlk admin oluşturma

Kendiliğinden admin hesabı açılmaz. Yerel terminalde e-posta ve şifreyi okuyun; şifre terminalde görünmez ve Git'e eklenmez:

```bash
read -r -p 'Admin e-posta: ' ADMIN_EMAIL
read -r -s -p 'Admin şifre (en az 12 karakter): ' ADMIN_PASSWORD
export ADMIN_EMAIL ADMIN_PASSWORD
node server/create-admin.js
unset ADMIN_EMAIL ADMIN_PASSWORD
```

Script mevcut hesapların rolünü veya şifresini değiştirmez. Oluşturduğunuz hesapla giriş yapıp Hesabım → Yönetim paneli yolunu kullanın. Yönetici ürün, kategori, stok, sipariş ve raporları yönetir; Admin ayrıca rolleri, parametreleri ve denetim kaydını yönetir.

## iyzico sandbox

`.env.example` alanlarını kendi `.env` dosyanıza doldurun ve `node --env-file=.env server/index.js` ile başlatın. Anahtarlar sohbet, Git veya iş planına yazılmamalıdır. Gerekli alanlar `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `APP_URL`. Servis yalnızca `https://sandbox-api.iyzipay.com` adresine bağlanır. `APP_URL` sandbox tarafından ulaşılabilen HTTPS uygulama adresi olmalıdır.

Sandbox örneği sabit test telefon/kimlik ve şehir verisi kullanır; gerçek kart veya kişisel kimlik bilgisi girmeyin. İki anahtar tanımlı değilse uygulama **demo ödeme** gösterir, gerçek para çekmez ve siparişi `demo_paid` olarak kaydeder. Demo işlem, iyzico üzerinden yapılmış ödeme değildir.

Ödeme başarılı sayfasına dönmek tek başına ödeme kanıtı değildir: API sağlayıcıdan `paymentStatus` ve tutarı kontrol eder. Giriş oturumunun korunmadığı dönüşte tekrar giriş yapıp Siparişlerim → Ödeme durumunu doğrula seçeneğini kullanın.

Sandbox anahtarları sağlanmadığı için sağlayıcıyla uçtan uca ödeme henüz doğrulanmadı. Bu bir ders projesi test entegrasyonudur; canlı ödeme kullanımına hazır olduğu iddia edilmez. Stok, SRS BR-005 gereği ödeme başlatılırken yalnızca kontrol edilir ve sağlayıcı doğrulamasından sonra düşer. Aynı son ürün için iki ödeme aynı anda doğrulanırsa ikincisi `stock_conflict` (iade gerekli) olarak işaretlenir ve yöneticilere bildirim düşer; iade/mutabakat akışı canlı kullanım öncesi ayrıca geliştirilmelidir.

## Mimari ve ders teslimleri

- [Gereksinim izlenebilirlik matrisi](docs/GEREKSINIM_IZLENEBILIRLIK.md): SRS FR/BR/VAL/NFR/TC kimliklerinin uygulandığı yer, testleri ve açık kararlar için kullanılan varsayımlar.
- [Kod rehberi](docs/KOD_REHBERI.md): dosyalar, veri akışı ve canlı kodlama örnekleri.
- [İş planı](docs/IS_PLANI.md): 8 iş paketi, sorumlular, 8 hafta ve 3 sunum.
- [Test planı](docs/TEST_PLANI.md): 100 planlı test senaryosu; hata raporu değildir.
- [Hata raporu şablonu](docs/HATA_RAPORU.md): test ekibinin gerçek bulguları için.

Ürün görselleri/3D modeller temsilidir; üreticiye ait hassas ölçülü GLB dosyaları değildir. Fotoğraf üstündeki yerleştirme, öneride tarif edilen fotoğraf tabanlı önizlemedir; yüzey algılayan cihaz AR'si değildir. 5 saniye performans hedefi farklı cihazlarda ölçülmelidir.

Üretim için `SESSION_SECRET` zorunlu; `npm run build` ardından `npm start`. HTTPS sonlandırma, ödeme mutabakatı, yedekleme, sipariş rezervasyon süreleri ve yasal metinler canlı yayın öncesi hazırlanmalıdır. Hazırlanan bulut yapılandırması yayınlama işlemi değildir.

Görsel kaynakları: ana bahçe görseli bu proje için AI ile üretildi; ürün kartları projedeki Three.js modellerinden çizildi. Görseller `public/images` içinde yereldir; harici görsel/font servisine ihtiyaç yoktur.

## İnternette yayınlama

[Render + MongoDB Atlas yayınlama rehberi](docs/YAYINLAMA.md) ve `render.yaml` hazır. Render otomatik oturum anahtarı üretir; sizin yalnızca kendi Atlas bağlantı dizesini güvenli panelde girmeniz gerekir. Hosting hesabı/bağlantısı olmadan bu depo kendiliğinden yayınlanmaz.
