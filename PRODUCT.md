# DubKanka: ürün notu

**Ne:** Bir dizi ya da film sahnesini arkadaşlarla dublajlayıp TikTok'a atmak için Windows masaüstü uygulaması (Electron kabuk + yerel FastAPI sunucu + Preact arayüz, Türkçe). GitHub sürümlerinden tek bir kurulum dosyasıyla kurulur, kendini günceller.

**İlk açılış:** sadece stüdyo iner (~200 MB). Ardından tek soru: "ne yapmak istiyorsun?" Yapay zeka parçaları isteğe bağlı özelliklerdir (yazıya dökme ve çeviri, müziği koruma, arkadaşlarla oda, kayıt temizleme); seçilenler arka planda iner, gerisi Ayarlar → Özellikler'den eklenir. Kullanıcının isteği (31 Ekim 2026): "Her şeyi en başta indirmeyelim." 

**Kimin için:** Amatör arkadaş grupları. Keyfine troll dublaj yapıyorlar, örneğin "Sıfır Bir"den bir kesitin İngilizce versiyonu. Akşamları evde, kulaklıkla çalışıyorlar. Uygulamayı kuran herkes kendi odasını açabiliyor; diğerleri oda linkiyle telefondan ya da tarayıcıdan katılıyor.

**Ana işler:**
- Videoyu bırakınca her şeyi kendisi hazırlamak: konuşmaları ayırmak (müzik, efekt ve ortam seslerini korumak), yazıya dökmek, kişilere bölmek, çevirmek.
- Her repliği zamanında kaydetmek (akış çizgisi, bip sesleri, büyük ritim şeridi, otomatik hizalama), işlenmemiş temiz mikrofon sesiyle.
- Miksi yapıp altyazılı 9:16 video ya da görüntüsü yeniden kodlanmamış bir kopya olarak dışa aktarmak.

**Ücret:** Hiçbir şey ücretli değil. Oda Cloudflare'in ücretsiz geçici tüneli, yapay zeka yerel, çeviri varsayılan olarak ücretsiz Google. Anahtarlı dil modelleri isteğe bağlı.

## Marka kararı

- **Görünüm:** "Kayıt Masası" (DESIGN.md): stüdyo konsolu ve senaryo kâğıdı. Sıcak grafit paneller, tek marka rengi sinyal sarısı, IBM Plex. Klasik editör düzeni korunuyor (kullanıcı 31 Ekim 2026'da editör düzenini seçmişti). Aynı gün kullanıcı keskin köşeleri sevmedi ve Apple tarzı, ödüllü uygulamalar kadar yumuşak bir görünüm istedi: paneller yüzer, köşeler iç içe yuvarlanır, ayarlar sayfalara bölünür, paylaşım adım adım ilerler, teknik ayarlar kapalı gelir.
- **Kaçınılanlar:** AI slop işaretleri. Degrade ya da cam efekti yok, neon parlama yok, ikon yerine emoji yok, başlık üstü küçük etiket yok, aynı boy ikonlu kart ızgarası yok, renkli kalın sol kenarlık yok, hap biçimli durum rozeti yok.
- **Hareket:** Bol animasyon, her biri bir durumu anlatıyor. Ayarlardan Tam / Azaltılmış / Kapalı seçilebiliyor.
- **Çalışma şekli:** Kullanıcının isteğiyle tek ajan olarak geliştiriliyor ve test ediliyor.
