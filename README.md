# Woody Bambu — Bahçe Mobilyası E-Ticaret Sitesi

Kocaeli Sağlık ve Teknoloji Üniversitesi, Yazılım Mühendisliği bölümü ders projesi.

**Hazırlayanlar:** Nisa Nur Çakır (230502011), Zeynep Ulusoy (230502065)
**Ders sorumlusu:** Dr. Öğr. Üyesi Fulya Akdeniz

## Proje ne yapıyor?

Bahçe mobilyası satan bir web sitesi. Sitenin farklı yanı **"Bahçede Gör"** özelliği: kullanıcı kendi bahçesinin fotoğrafını yüklüyor, seçtiği mobilyanın 3D modelini fotoğrafın üzerine koyuyor, taşıyor, döndürüyor ve büyütüp küçültüyor. Böylece ürünün bahçede nasıl duracağını satın almadan görebiliyor.

Önizleme fotoğraf üzerinde temsili bir görüntüdür. Telefonun kamerasıyla zemini algılayan gerçek AR değildir.

## Kullanılan teknolojiler

| Bölüm | Teknoloji |
| ----- | --------- |
| Arayüz | React + Vite |
| 3D önizleme | Three.js |
| Sunucu | Node.js + Express |
| Veritabanı | MongoDB (Mongoose) |
| Oturum ve şifre | express-session, connect-mongo, bcryptjs |
| Ödeme | iyzico sandbox (anahtar yoksa demo ödeme) |
| Test | Node test runner, Supertest, Playwright |
| Yayınlama | Render + MongoDB Atlas |

## Kullanıcı rolleri

| Rol | Neler yapabilir? |
| --- | ---------------- |
| Ziyaretçi | Ürünlere bakar, arar, filtreler, 3D önizlemeyi dener |
| Üye | Sepet, sipariş, adres defteri, yerleşimini kaydetme |
| Yönetici | Ürün, kategori, stok ve sipariş durumlarını yönetir, raporlara bakar |
| Admin | Yöneticinin yaptığı her şey + kullanıcı rolleri, site ayarları, denetim kaydı |

## Bilgisayarda çalıştırma

Node.js 22 veya üstü gerekiyor.

```bash
npm install
npm run dev
```

Tarayıcıda `http://localhost:3000` adresini açın.

Bilgisayarda MongoDB kurulu değilse uygulama kendi geçici veritabanını açar. Bu veritabanı sunucu kapanınca silinir. Kalıcı kayıt isterseniz `.env.example` dosyasını `.env` olarak kopyalayıp `MONGODB_URI` değerini yazın ve `node --env-file=.env server/index.js` ile başlatın. (Docker ile MongoDB açmak için `bash scripts/setup.sh` de kullanılabilir.)

## İlk admin hesabı

Hazır bir admin hesabı veya şifresi yoktur. İlk admini kendiniz oluşturursunuz:

```bash
read -r -p 'Admin e-posta: ' ADMIN_EMAIL
read -r -s -p 'Admin şifre (en az 12 karakter): ' ADMIN_PASSWORD
export ADMIN_EMAIL ADMIN_PASSWORD
node server/create-admin.js
unset ADMIN_EMAIL ADMIN_PASSWORD
```

Bu hesapla giriş yaptıktan sonra **Hesabım → Yönetim paneli → Kullanıcılar** bölümünden diğer kişileri yönetici yapabilirsiniz. Yönetici olacak kişi önce sitede normal üye olarak kayıt olmalıdır.

## Testler

```bash
npm test               # sunucu (API) testleri
npx playwright test    # tarayıcı testleri (önce npm run dev açık olmalı)
npm run build          # üretim derlemesi
```

Test adlarının başındaki `TC-01`, `TC-02` gibi kodlar gereksinim belgemizdeki test senaryolarıdır. Hangi gereksinimin hangi dosyada yapıldığını [docs/GEREKSINIM_IZLENEBILIRLIK.md](docs/GEREKSINIM_IZLENEBILIRLIK.md) dosyasında topladık.

Testler kendi geçici veritabanlarını açar. Tarayıcı testleri varsayılan olarak `/usr/bin/chromium` kullanır; tarayıcı başka bir yerdeyse `CHROMIUM_PATH` ile yolunu verin.

## Ödeme

- iyzico anahtarları girilmezse site **demo ödeme** kullanır. Gerçek para çekilmez.
- iyzico sandbox ile denemek için `.env` dosyasına `IYZICO_API_KEY`, `IYZICO_SECRET_KEY` ve `APP_URL` yazılır. Gerçek kart bilgisi girmeyin.
- Sipariş, ödeme sonucu sunucuda iyzico'ya sorulup doğrulanmadan "Ödendi" olmaz.
- Stok, ödeme doğrulandıktan sonra düşer.

## Klasörler

```
server/            Sunucu
  index.js         Sunucuyu başlatır
  app.js           Express kurulumu, tüm rotaları bağlar
  db.js            Veritabanı tabloları (Mongoose şemaları)
  rules.js         İş kuralları: hata mesajları, fiyat hesabı, sipariş durumları
  helpers.js       Ortak yardımcılar: giriş kontrolü, rol kontrolü, log, bildirim
  seed.js          Örnek ürünler ve eski verinin yeni yapıya taşınması
  routes/          Her konu için ayrı dosya (sepet, sipariş, rapor...)
src/               Arayüz (React)
  main.jsx         Ana sayfa, katalog, sepet, hesap pencereleri
  Studio.jsx       3D önizleme (Bahçede Gör)
  Admin.jsx        Yönetim paneli
  hooks.js         Sayfa animasyonları
  util.js          Ortak fonksiyonlar ve yazılar
tests/             Otomatik testler
docs/              Proje belgeleri
```

Kodun nasıl çalıştığını [docs/KOD_REHBERI.md](docs/KOD_REHBERI.md) dosyasında adım adım anlattık.

## Belgeler

- [Kod rehberi](docs/KOD_REHBERI.md)
- [Gereksinim izlenebilirlik tablosu](docs/GEREKSINIM_IZLENEBILIRLIK.md)
- [İş planı](docs/IS_PLANI.md)
- [Test planı](docs/TEST_PLANI.md) ve [test sonuçları](docs/TEST_SONUCLARI.md)
- [Hata raporu şablonu](docs/HATA_RAPORU.md)
- [Render'da yayınlama](docs/YAYINLAMA.md)

## Bilinen eksikler

- iyzico sandbox ile gerçek bir ödeme denemesi yapmadık, anahtarımız yok. Ödeme testleri sahte bir iyzico ile yapıldı.
- Yük testi ve gerçek telefonlarda 5 saniyelik yükleme ölçümü yapılmadı.
- İade ekranı ve e-posta bildirimi yok. Bildirimler yalnızca site içinde.
- 3D modeller temsilidir. Ürünlerin gerçek ölçülerini birebir yansıtmaz.

Ana sayfadaki bahçe görseli yapay zekâ ile üretildi. Ürün kartı görselleri projedeki Three.js modellerinden alındı.
