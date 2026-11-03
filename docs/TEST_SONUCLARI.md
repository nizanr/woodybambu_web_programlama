# Doğrulama sonuçları

Son otomatik yürütme: 03.11.2026 (SRS eklemelerinden sonra). Test adlarındaki `TC-xx` kimlikleri SRS 6. bölümdeki senaryolardır.

- API entegrasyonu (`npm test`): 55 API + 6 ilk admin kurulum testi, toplam **61 test geçti**. Bellek içi MongoDB kullanıldı.
  - Kapsanan SRS senaryoları: TC-01…TC-28, TC-30, TC-31 API düzeyinde; ayrıca VAL-001/002/005/006/009/010/013/015, FR-008/016/018/025/026, BR-T02 ve rol geçişi (migrate) testleri.
  - iyzico adaptörü taklit sağlayıcıyla denetlendi: başarısız ödeme (VAL-007), taklit dönüş adresi, tutar uyuşmazlığı (VAL-008), tekrarlı callback, başarılı ödeme ve başlatma hatası. Canlı sandbox servisi çağrılmadı.
- Tarayıcı (`npx playwright test`): **3 test geçti** — katalog filtresi/stok etiketi, ziyaretçinin sepet ve 3D önizlemede girişe yönlendirilmesi (TC-31), 390 px mobil taşma, üyelik, WebGL çizim, döndürme, geçersiz dosya reddi (VAL-016), fotoğraf yükleme (TC-23), fotoğrafı koruyarak ürün değiştirme (FR-030), fotoğraflı yerleşim kaydı (TC-28), önizlemeden sepete ekleme (TC-27), sözleşme onayı olmadan ödeme reddi (TC-21) ve demo sipariş tamamlama.
- React üretim derlemesi (`npm run build`) başarılı.

**Yürütülmeyen kontroller:** TC-29 (gerçek cihazlarda 5 sn performans ölçümü; stüdyo ölçülen süreyi gösterir), NFR-02 yük testi, gerçek iyzico sandbox checkout (anahtarlar yok), tam WCAG 2.1 AA denetimi, NFR-08 yedekten geri yükleme testi, tüm manuel 100 senaryo, canlı dağıtım.

Bu dosya bir hata bulgusu listesi değildir. Manuel test planındaki bekleyen durumlar otomatik olarak geçti sayılmaz.

## Yayın hazırlığı kontrolleri

- İlk admin kurulumu: mevcut üyeler yükseltilmiyor, şifre yeniden başlatmada değişmiyor.
- Üretim modunda HTTPS proxy arkasında Secure/HttpOnly oturum çerezi, Render kaynak adresi ve güçlü oturum anahtarı gereksinimi denetlendi.
- Render/Atlas üzerinde canlı deployment henüz yapılmadı; hosting hesapları ve Atlas bağlantısı gerekiyor.
