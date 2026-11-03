# Render + MongoDB Atlas ile yayınlama

Bu uygulama sunucu ve veritabanı gerektirir; GitHub Pages üzerinde çalışmaz. Depoya eklenen `render.yaml` Render kurulumu için hazırlanmıştır. Render hesabı, MongoDB Atlas hesabı ve bağlantı bilgisi sağlanmadan yayın gerçekleşmez.

## 1. Veritabanı — MongoDB Atlas

1. MongoDB Atlas'ta hesap açın: https://www.mongodb.com/cloud/atlas/register . Yeni bir proje ve uygun cluster oluşturun. Ücretsiz seçenek varsa ders demosu için seçebilirsiniz; ücretli planı ancak fiyatını kabul ediyorsanız seçin.
2. Database Access / Database Users bölümünden **veritabanı kullanıcısı** oluşturun. Bu hesabın web sitesindeki üyelikle ilgisi yoktur. Güçlü bir şifreyi güvenli şekilde saklayın; yalnızca uygulama veritabanı `bahceni` için readWrite yetkisi verin.
3. Cluster → Connect → Drivers → Node.js yolundan bağlantı dizesini kopyalayın. Paneldeki örnekte kullanıcı/şifre alanlarını kendi veritabanı hesabınızla değiştirin. Şifredeki özel karakterleri URL biçiminde kodlayın; örneğin `@` → `%40`, `#` → `%23`. Veritabanı adını `bahceni` yapın.
4. Biçimi şudur (bu bir gerçek bağlantı bilgisi değildir):

   ```text
   mongodb+srv://KULLANICI:URL_KODLU_SIFRE@ATLAS_PANELINDEKI_HOST/bahceni?retryWrites=true&w=majority
   ```

5. Network Access bölümüne Render servisinin Outbound / Egress IP adreslerini ekleyin. Render servisi oluşturulunca bu adresler panelde görüntülenir. `0.0.0.0/0` tüm İnternete erişim izni verir; bunu gerektiren bir varsayılan kullanmıyoruz. Render IP'leri eklenene kadar ilk deployment veritabanına bağlanamayabilir; ekledikten sonra yeniden deploy edin.

**Bağlantı dizesini sohbet, GitHub, ekran görüntüsü veya issue içine yapıştırmayın.** Yalnızca Render'ın Environment bölümüne girin.

## 2. Web servisi — Render

1. https://dashboard.render.com/ adresinde hesap açın ve GitHub hesabınızı bağlayın. Yalnızca gerekli depo erişimini verin.
2. New → Blueprint ile `nizanr/bahce_mobilya_satis` deposunun `main` dalını seçin. Render `render.yaml` dosyasını okuyacak.
3. Render'ın istediği `MONGODB_URI` değerine Atlas'tan aldığınız gerçek bağlantı dizesini girin. `SESSION_SECRET` otomatik oluşturulur; `PORT` Render tarafından verilir. Bunları elle üretmeniz gerekmez.
4. Blueprint ücretsiz web servisi planını belirtir. Panelde gösterilen planı/fiyatı kontrol edin; ücretsiz seçenek uygun değilse ücretli plana otomatik geçmeyin.
5. Servisi oluşturun, Outbound IP adreslerini Atlas Network Access'e ekleyin ve gerekirse Manual Deploy → Deploy latest commit seçin.
6. Başarılı deployment sonrası Render panelinde verilen HTTPS site adresini açın. Uygulama `/api/health` ile MongoDB bağlantısını da kontrol eder.

Render ücretsiz servisleri boşta kaldığında uyuyabilir; ilk açılış yavaş olabilir. Bu durumun 3D modülünün 5 saniye hedefinden ayrı ölçülmesi gerekir.

`APP_URL` Render üzerinde varsayılan olarak otomatik `RENDER_EXTERNAL_URL` değerinden alınır. Özel alan adı kullanıyorsanız `APP_URL` alanına tam HTTPS adresinizi, sonunda `/` olmadan yazın.

## 3. İlk admin

Render servisinin Environment bölümüne geçici olarak şunları ekleyin ve yeniden deploy edin:

| Ad               | Değer                                                     |
| ---------------- | --------------------------------------------------------- |
| `ADMIN_EMAIL`    | Daha önce sitede kaydolmamış, sizin kullandığınız e-posta |
| `ADMIN_PASSWORD` | Sizin belirlediğiniz 12–128 karakterli güçlü şifre        |

Hesap ilk başlangıçta şifre hash'lenerek oluşturulur. Siteye bu hesapla giriş yapıp Hesabım → Yönetim paneli üzerinden kontrol edin. Ardından **iki bootstrap değişkenini Render'dan silin ve yeniden deploy edin**; veritabanındaki hesap silinmez. Mevcut kullanıcıların rolü veya şifresi bu mekanizmayla değiştirilmez; başka yönetici/admin hesapları panelden (Kullanıcılar sekmesi) atanır.

## 4. iyzico sandbox (isteğe bağlı)

Başlangıçta anahtar eklemeyin; uygulama açıkça etiketlenmiş demo ödeme kullanır. iyzico sandbox hesabınız hazır olduğunda Render Environment bölümüne `IYZICO_API_KEY` ve `IYZICO_SECRET_KEY` değerlerini güvenli şekilde ekleyin. Uygulama yalnızca sandbox API'ye bağlanır; canlı anahtar kullanılmaz. Özel alan adı yoksa `APP_URL` için Render adresi otomatik alınır.

Başarılı ve reddedilen test ödemelerini sağlayıcının resmi test kartlarıyla kontrol edin. Gerçek kart kullanmayın. HTTPS dönüş adresi, tutar doğrulaması, stok ve oturumun korunmasını ayrıca doğrulayın. Sandbox anahtarları olmadan bu testlerin geçtiği iddia edilmez.

## 5. Yayın sonrası kontrol

- Ana sayfa, yerel görseller, kategori ve arama açılıyor mu?
- Üyelik, giriş ve çıkış HTTPS üzerinde çalışıyor mu?
- Fotoğraf + 3D stüdyo mobil tarayıcıda açılıyor mu?
- Demo sipariş ve yönetim paneli çalışıyor mu?
- Kullanıcı rolüyle admin API'si engelleniyor mu?
- Yeniden deployment sonrası kullanıcı ve sipariş kayıtları korunuyor mu?
- Yönetim paneli → Ayarlar ekranında kargo, ücretsiz kargo eşiği, olay saklama süresi ve fotoğraf boyutu iş sahibinin onayladığı değerlerle girildi mi (SRS DEC-02/04/08)?

## 6. Yedekleme ve geri yükleme (NFR-08)

1. Atlas → Cluster → **Backup** bölümünden ücretli planlarda bulut yedeğini açın; ücretsiz M0 kümede otomatik yedek yoktur, bu durumda yerel makinede düzenli `mongodump` alın:
   `mongodump --uri "$MONGODB_URI" --out ./yedek-$(date +%F)`
2. Geri yükleme testini **ayrı, boş bir test veritabanına** yapın, canlı veritabanının üzerine yazmayın:
   `mongorestore --uri "<test-veritabanı-uri>" --nsFrom 'bahceni.*' --nsTo 'bahceni_restore.*' ./yedek-YYYY-AA-GG`
3. Geri yüklenen veritabanında kullanıcı, sipariş, ödeme ve `auditlogs` sayılarını kaynakla karşılaştırın; sonucu `docs/TEST_SONUCLARI.md` dosyasına tarih ve kanıtla yazın.

Yedek dosyaları kişisel veri içerir; depoya eklemeyin ve erişimi kısıtlı bir yerde saklayın.

Depoya dosya eklemek veya Render yapılandırması hazırlamak, başarılı canlı yayın kanıtı değildir. Yayın durumu Render logları ve dış HTTPS adresinden yapılan işlev kontrolleriyle doğrulanmalıdır.
