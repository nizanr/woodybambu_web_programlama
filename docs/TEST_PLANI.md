# Test planı — 100 senaryo

Bu liste planlı kontrollerdir, bulunan hatalar değildir. Otomatik test sonuçları `TEST_SONUCLARI.md` içinde ayrıca kaydedilir. Manuel ve sağlayıcı testleri bu tabloda başlangıçta bekliyor olarak tutulur. Her yürütmede beklenen sonucu gereksinimle eşleştirin, gerçek sonucu ve kanıtı kaydedin.

| ID   | Modül         | Senaryo                                 | Durum    | Sonuç / hata kaydı |
| ---- | ------------- | --------------------------------------- | -------- | ------------------ |
| T001 | Üyelik        | Geçerli kayıt                           | Bekliyor | —                  |
| T002 | Üyelik        | Eksik ad                                | Bekliyor | —                  |
| T003 | Üyelik        | Geçersiz e-posta                        | Bekliyor | —                  |
| T004 | Üyelik        | Kısa şifre                              | Bekliyor | —                  |
| T005 | Üyelik        | Uzun şifre                              | Bekliyor | —                  |
| T006 | Üyelik        | Tekrarlanan e-posta                     | Bekliyor | —                  |
| T007 | Üyelik        | Büyük harf e-posta                      | Bekliyor | —                  |
| T008 | Üyelik        | Rol enjeksiyonu                         | Bekliyor | —                  |
| T009 | Üyelik        | Boşluklu ad                             | Bekliyor | —                  |
| T010 | Üyelik        | Unicode ad                              | Bekliyor | —                  |
| T011 | Oturum        | Doğru giriş                             | Bekliyor | —                  |
| T012 | Oturum        | Yanlış şifre                            | Bekliyor | —                  |
| T013 | Oturum        | Olmayan hesap                           | Bekliyor | —                  |
| T014 | Oturum        | Çıkış                                   | Bekliyor | —                  |
| T015 | Oturum        | Çıkış sonrası özel uç                   | Bekliyor | —                  |
| T016 | Oturum        | Oturum yenileme                         | Bekliyor | —                  |
| T017 | Oturum        | Oturum süresi                           | Bekliyor | —                  |
| T018 | Oturum        | Çoklu tarayıcı                          | Bekliyor | —                  |
| T019 | Oturum        | Deneme sınırı                           | Bekliyor | —                  |
| T020 | Oturum        | Çerez HttpOnly                          | Bekliyor | —                  |
| T021 | Yetkilendirme | Anonim admin erişimi                    | Bekliyor | —                  |
| T022 | Yetkilendirme | Kullanıcı admin erişimi                 | Bekliyor | —                  |
| T023 | Yetkilendirme | Admin ürün ekleme                       | Bekliyor | —                  |
| T024 | Yetkilendirme | Admin ürün düzenleme                    | Bekliyor | —                  |
| T025 | Yetkilendirme | Yönetici rol değişikliği reddi          | Bekliyor | —                  |
| T026 | Yetkilendirme | Admin rol değişikliği                   | Bekliyor | —                  |
| T027 | Yetkilendirme | Kendi rolünü düşürme reddi              | Bekliyor | —                  |
| T028 | Yetkilendirme | Rol değişince eski oturum               | Bekliyor | —                  |
| T029 | Yetkilendirme | Başkasının siparişini ödeme             | Bekliyor | —                  |
| T030 | Yetkilendirme | Başkasının tasarımını listeleme         | Bekliyor | —                  |
| T031 | Katalog       | Tüm ürünler                             | Bekliyor | —                  |
| T032 | Katalog       | Her kategori                            | Bekliyor | —                  |
| T033 | Katalog       | İsim arama                              | Bekliyor | —                  |
| T034 | Katalog       | Türkçe harf arama                       | Bekliyor | —                  |
| T035 | Katalog       | Boş sonuç                               | Bekliyor | —                  |
| T036 | Katalog       | Düşük fiyat sırası                      | Bekliyor | —                  |
| T037 | Katalog       | Yüksek fiyat sırası                     | Bekliyor | —                  |
| T038 | Katalog       | Ürün detayları                          | Bekliyor | —                  |
| T039 | Katalog       | Stoksuz ürün                            | Bekliyor | —                  |
| T040 | Katalog       | Görsel yükleme hatası                   | Bekliyor | —                  |
| T041 | Sepet         | İlk ürün                                | Bekliyor | —                  |
| T042 | Sepet         | Tekrarlanan ürün                        | Bekliyor | —                  |
| T043 | Sepet         | Adet artırma                            | Bekliyor | —                  |
| T044 | Sepet         | Adet azaltma                            | Bekliyor | —                  |
| T045 | Sepet         | Sıfır adedi kaldırma                    | Bekliyor | —                  |
| T046 | Sepet         | Ürünü kaldırma                          | Bekliyor | —                  |
| T047 | Sepet         | Sayfa yenileme                          | Bekliyor | —                  |
| T048 | Sepet         | Bozuk yerel kayıt                       | Bekliyor | —                  |
| T049 | Sepet         | Stok sınırı                             | Bekliyor | —                  |
| T050 | Sepet         | Birden çok ürün toplamı                 | Bekliyor | —                  |
| T051 | Sipariş       | Anonim sipariş reddi                    | Bekliyor | —                  |
| T052 | Sipariş       | Kısa adres reddi                        | Bekliyor | —                  |
| T053 | Sipariş       | Boş sepet reddi                         | Bekliyor | —                  |
| T054 | Sipariş       | Negatif adet reddi                      | Bekliyor | —                  |
| T055 | Sipariş       | Kesirli adet reddi                      | Bekliyor | —                  |
| T056 | Sipariş       | Yinelenen ürün satırı                   | Bekliyor | —                  |
| T057 | Sipariş       | İstemci fiyat sahteciliği               | Bekliyor | —                  |
| T058 | Sipariş       | Eşzamanlı son stok                      | Bekliyor | —                  |
| T059 | Sipariş       | Çok ürünlü rezervasyon geri alma        | Bekliyor | —                  |
| T060 | Sipariş       | İptalde stok iadesi                     | Bekliyor | —                  |
| T061 | Ödeme         | Demo etiketi                            | Bekliyor | —                  |
| T062 | Ödeme         | Demo durum ayrımı                       | Bekliyor | —                  |
| T063 | Ödeme         | iyzico checkout başlatma                | Bekliyor | —                  |
| T064 | Ödeme         | Başarılı sandbox kartı                  | Bekliyor | —                  |
| T065 | Ödeme         | Reddedilen sandbox kartı                | Bekliyor | —                  |
| T066 | Ödeme         | Ödemeden dönüş URL ziyaret etme         | Bekliyor | —                  |
| T067 | Ödeme         | Sağlayıcı tutar uyuşmazlığı             | Bekliyor | —                  |
| T068 | Ödeme         | Tekrarlanan ödeme sorgusu               | Bekliyor | —                  |
| T069 | Ödeme         | Sağlayıcı ağ kesintisi                  | Bekliyor | —                  |
| T070 | Ödeme         | Dönüşte oturum kaybı                    | Bekliyor | —                  |
| T071 | 3D Stüdyo     | JPEG yükleme                            | Bekliyor | —                  |
| T072 | 3D Stüdyo     | PNG yükleme                             | Bekliyor | —                  |
| T073 | 3D Stüdyo     | Yanlış format reddi                     | Bekliyor | —                  |
| T074 | 3D Stüdyo     | 8 MB üzeri reddi                        | Bekliyor | —                  |
| T075 | 3D Stüdyo     | Model sürükleme                         | Bekliyor | —                  |
| T076 | 3D Stüdyo     | 360 derece dönüş                        | Bekliyor | —                  |
| T077 | 3D Stüdyo     | Min/max boyut                           | Bekliyor | —                  |
| T078 | 3D Stüdyo     | Sıfırlama                               | Bekliyor | —                  |
| T079 | 3D Stüdyo     | Tasarım kaydet/yükle                    | Bekliyor | —                  |
| T080 | 3D Stüdyo     | WebGL olmayan tarayıcı                  | Bekliyor | —                  |
| T081 | Yönetim       | Ürün kalıcılığı                         | Bekliyor | —                  |
| T082 | Yönetim       | Negatif fiyat reddi                     | Bekliyor | —                  |
| T083 | Yönetim       | Geçersiz stok reddi                     | Bekliyor | —                  |
| T084 | Yönetim       | Geçersiz görsel adresi                  | Bekliyor | —                  |
| T085 | Yönetim       | Kategori doğrulama                      | Bekliyor | —                  |
| T086 | Yönetim       | Ödenmemiş sipariş sevk reddi            | Bekliyor | —                  |
| T087 | Yönetim       | Hazırlanıyor durumu                     | Bekliyor | —                  |
| T088 | Yönetim       | Kargoda durumu                          | Bekliyor | —                  |
| T089 | Yönetim       | Kullanıcı listesinde şifre yok          | Bekliyor | —                  |
| T090 | Yönetim       | Geçersiz rol reddi                      | Bekliyor | —                  |
| T091 | Kalite        | 390 px taşma                            | Bekliyor | —                  |
| T092 | Kalite        | 768 px görünüm                          | Bekliyor | —                  |
| T093 | Kalite        | 1280 px görünüm                         | Bekliyor | —                  |
| T094 | Kalite        | Klavye ile gezinme                      | Bekliyor | —                  |
| T095 | Kalite        | Odak görünürlüğü                        | Bekliyor | —                  |
| T096 | Kalite        | Ekran okuyucu etiketleri                | Bekliyor | —                  |
| T097 | Kalite        | CSRF kaynak reddi                       | Bekliyor | —                  |
| T098 | Kalite        | XSS metin gösterimi                     | Bekliyor | —                  |
| T099 | Kalite        | Fotoğraf/3D 5 saniye hedefi             | Bekliyor | —                  |
| T100 | Kalite        | Veritabanı ve uygulama yeniden başlatma | Bekliyor | —                  |
