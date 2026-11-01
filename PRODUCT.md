# DubKanka: ürün notu

**Ne:** Bir dizi ya da film sahnesini arkadaşlarla dublajlayıp paylaşmak için Windows masaüstü uygulaması (Electron kabuk + yerel FastAPI sunucu + Preact arayüz, Türkçe ve İngilizce; dil Ayarlar → Genel'den, ilk açılışta karşılama ekranından, arkadaşlar için katılma ekranından seçilir). GitHub sürümlerinden tek bir kurulum dosyasıyla kurulur; her açılışta yeni sürüm var mı bakar, varsa indirip kurar ve yeni sürümle açılır.

**İlk açılış:** sadece stüdyo iner (~200 MB). Ardından tek soru: "ne yapmak istiyorsun?" Temel stüdyo seçili gelir; yapay zeka parçaları boş gelen ek özelliklerdir (yazıya dökme ve çeviri, müziği koruma, arkadaşlarla oda, kayıt temizleme). Seçilenler arka planda iner; seçilmeyenler kullanılmak istendiği yerde "İndir · boyut" düğmesiyle çıkar, hepsi Ayarlar → Özellikler'de de durur. Kullanıcının isteği (31 Ekim 2026): "Her şeyi en başta indirmeyelim; isteyen sonradan, kullanırken indirsin." 

**Kimin için:** Amatör arkadaş grupları. Keyfine troll dublaj yapıyorlar, örneğin "Sıfır Bir"den bir kesitin İngilizce versiyonu. Akşamları evde, kulaklıkla çalışıyorlar. Uygulamayı kuran herkes kendi odasını açabiliyor; diğerleri oda linkiyle telefondan ya da tarayıcıdan katılıyor.

**Ana işler:**
- Videoyu bırakınca önce dublajlanacak sahneyi seçtirmek, sonra her şeyi kendisi hazırlamak: konuşmaları ayırmak (müzik, efekt ve ortam seslerini korumak), yazıya dökmek, kişilere bölmek, çevirmek.
- Her repliği zamanında kaydetmek (akış çizgisi, bip sesleri, büyük ritim şeridi, otomatik hizalama), temiz sesle: yankı engelleme ve gürültü bastırma açık gelir; gürültü engelleme Discord'daki gibi seçilir (Standart, canlı RNNoise, kayıttan sonra DPDFNet, Kapalı). Krisp ücretli ve kapalı kaynak olduğu için yok; yerine ücretsiz ve açık kaynak olanlar var.
- Konuşma ortam sesine ya da fona karışmışsa onu ayırmak: ayırma, satırların yerini ve birkaç ipucunu birlikte kullanır; kalanı Mikser'de o bölgeyi sürükleyip "Sustur"la ya da satırın altında "Ortam sesini sustur"la kapatmak.
- Miksi yapıp dışa aktarmak: varsayılan, görüntüsü yeniden kodlanmamış bir kaynak kopyası; isteyen altyazılı 9:16 ya da kare video için başka bir kaliteye geçer.

**Ücret:** Hiçbir şey ücretli değil. Oda Cloudflare'in ücretsiz geçici tüneli, yapay zeka yerel, çeviri varsayılan olarak ücretsiz Google. Anahtarlı dil modelleri isteğe bağlı.

## Marka kararı

- **Görünüm:** "Kayıt Masası" (DESIGN.md): stüdyo konsolu ve senaryo kâğıdı. Sıcak grafit paneller, tek marka rengi sinyal sarısı, IBM Plex. Klasik editör düzeni korunuyor (kullanıcı 31 Ekim 2026'da editör düzenini seçmişti). Aynı gün kullanıcı keskin köşeleri sevmedi ve Apple tarzı, ödüllü uygulamalar kadar yumuşak bir görünüm istedi: paneller yüzer, köşeler iç içe yuvarlanır, ayarlar sayfalara bölünür, paylaşım adım adım ilerler, teknik ayarlar kapalı gelir.
- **Kaçınılanlar:** AI slop işaretleri. Degrade ya da cam efekti yok, neon parlama yok, ikon yerine emoji yok, başlık üstü küçük etiket yok, aynı boy ikonlu kart ızgarası yok, renkli kalın sol kenarlık yok, hap biçimli durum rozeti yok.
- **Hareket:** Bol animasyon, her biri bir durumu anlatıyor; geçişler gözle görülür olmalı (kullanıcı animasyonun kaldırılmasından da, tutarsız olmasından da şikâyet etti). Ayarlardan Tam / Azaltılmış / Kapalı seçilebiliyor.
- **Sade:** Ekranda açıklama paragrafı, gereksiz bilgi, platform önerisi yok; kullanıcı "gereksiz bilgilerin hepsini kaldır" dedi. Kararsız kalınca kaldır.
- **Sağlam:** Bir panelin içeriğinin kaybolması, bir bölümün kaydırılamaması gibi hatalar "kabul edilemez"; her değişiklik gerçek pencerede denenir.
- **Çalışma şekli:** Kullanıcının isteğiyle tek ajan olarak geliştiriliyor ve test ediliyor.
