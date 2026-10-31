# DubKanka 🎙️ — Arkadaşlarınla dublaj stüdyosu

Bir dizi ya da film sahnesini arkadaşlarınla dublajlamak için hazırlanmış bir uygulama. Videoyu atıyorsun, sonra:

- konuşmalar müzik ve efektlerden **ayrılıyor** (fon müziği, kuş, rüzgar, kalabalık gibi ortam sesleri kalıyor, sadece eski konuşmalar gidiyor),
- kimin **ne zaman** konuştuğu bulunup her replik ayrı bir satıra yazılıyor,
- satırlar istediğin dile **çevriliyor** (Google ücretsiz, ya da Claude ile dublaja uygun/troll çeviri),
- herkes kendi repliğini **bip sesleriyle tam zamanında** kaydediyor (linkle telefondan bile),
- en sonda **altyazılı TikTok videosu (9:16)** tek tıkla hazırlanıyor.

## Başlatma

1. **`Baslat.bat`** dosyasına çift tıkla. Siyah bir pencere açılır ve tarayıcıda uygulama gelir (`http://127.0.0.1:8765`).
2. Kapatmak için siyah pencereyi kapatman yeterli.

> Bu bilgisayarda kurulum yapıldı. Başka bir bilgisayara kopyalarsan önce **`Kurulum.bat`**'ı çalıştır (internet gerekir, ilk sefer 5-10 dk).

## 5 adımda dublaj

| Adım | Ne yapıyorsun |
|---|---|
| **1. Sahne** | Videoyu sürükle bırak ya da YouTube vb. linki yapıştır. Dublajlayacağın kısmı seç, videodaki dili, dublaj dilini ve (biliyorsan) kaç kişinin konuştuğunu seç → **Sahneyi hazırla**. İlk seferde yapay zeka modelleri iner (~2 GB), sonrakiler 20-30 sn sürer. |
| **2. Senaryo** | Her satır: kim söylüyor, orijinal metin, dublaj metni. Metni değiştir; yanındaki **uygun / uzun / kısa** rozeti repliğin ağıza sığıp sığmadığını hece sayısına göre söyler. Zaman çizelgesinde kutuların kenarını sürükleyerek başlangıç/bitişi düzelt. Yanlış ayrılmış karakterleri ⋯ menüsünden birleştir, seslendiren arkadaşın adını yaz. **Çevir** ile tekrar çevirt. |
| **3. Kayıt** | Kayıt kabini: karakterini seç, **Boşluk** tuşuna bas → video satırdan 2 sn önce başlar, **3 bip** sesinden sonra konuş. Üstteki çubuk satırın süresini, alttaki kelimeler orijinal ritmi gösterir. Kayıt otomatik durur, sessizlikler kesilir, konuşman orijinal başlangıca **otomatik hizalanır** ve ses seviyesi orijinale eşitlenir, ardından hemen dinletilir. Beğenmezsen tekrar kaydet; en iyisini seç. |
| **4. Mikser** | Fon müziği, **ortam sesleri** (kuş, rüzgar, kalabalık: kendi sürgüsüyle kısıp açabilirsin), her karakterin sesi ve kayıtlar tek ekranda. Eski bir projede ortam izi yoksa izin yanındaki **Geri getir** düğmesine bas. Kayıt kutularını sürükleyerek kaydır; bir kayda tıklayıp ses, **süreye sığdır**, **troll efekti** (sincap, dev, robot, telefon, telsiz, megafon, yankı…) ayarla. **Dublaj / Orijinal** düğmesiyle anında karşılaştır. Kaydı olmayan satırlar ya orijinal sesle çalar ya da **yapay zeka sesiyle** doldurulur. Meme sesi gibi ekstra ses dosyaları da eklenebilir. |
| **5. Paylaş** | TikTok/Reels 9:16 (bulanık arka plan ya da ekranı doldur), kare veya orijinal boyut; altyazı yazı tipi/boyut/renk; sonda "Seslendirenler" jeneriği → **Videoyu oluştur**. Videolar `Videolar` klasörüne kaydedilir. |

**Kısayollar (kayıt kabini):** `Boşluk` kaydet/durdur · `P` orijinali dinle · `L` kaydımı dinle · `Enter` sonraki satır · `↑` önceki satır · `Esc` iptal

## Arkadaşlarla birlikte

**Canlı oda (önerilen):** **Arkadaşlar** sekmesi → bir kerelik *bağlantı aracını indir* (Cloudflare, ücretsiz, hesap gerekmez) → **Odayı aç**. Çıkan link + 4 haneli PIN'i (veya QR kodu) WhatsApp'tan gönder. Arkadaşın linke telefonundan ya da bilgisayarından girer, adını ve PIN'i yazar, karakterini seçer ve kaydeder. Kayıtları anında senin projene düşer, kimin hangi satırda olduğunu görürsün. Link sadece uygulama açıkken çalışır; PIN 5 kez yanlış girilirse o kişi bir süre bekletilir.

**Odaya giremeyen arkadaş için:** Senaryo ekranında, satır listesinin üstündeki **Paylaş** ile repliklerini gönder. Her repliği ayrı kaydedip dosya adını satır numarası yapsın (`3.m4a` gibi, WhatsApp sesli mesajı da olur). Gelen dosyaları Kayıt ekranındaki **Toplu ses yükle** ile at. Sessizlikler kesilir ve her kayıt kendi yerine hizalanır.

## İpuçları

- 🎧 **Kulaklık kullanın.** Hoparlörden gelen fon müziği mikrofona girmez, kayıt tertemiz olur.
- Sahnede kaç kişi konuştuğunu biliyorsan seç; konuşmacı ayrımı daha isabetli olur.
- Bluetooth kulaklıkta kayıtlar hep biraz geç oturuyorsa: Kayıt → Kabin ayarları → *Gecikme düzeltme*.
- Türkçe → Türkçe troll dublaj için dublaj dilini de Türkçe seç (çeviri yapılmaz), sonra Claude ile **Komik / troll** tarzında yeniden yazdırabilirsin.

## Claude ile dublaja uygun çeviri (isteğe bağlı)

**Ayarlar**'a Anthropic API anahtarını gir ([console.anthropic.com](https://console.anthropic.com/)). Claude her satırı süresine sığacak şekilde, doğal konuşma diliyle çevirir. *Troll* tarzında ise sahneyi koruyup replikleri komik hale getirir. Varsayılan model Claude Opus 5.5'tir. Model bir isteği reddederse Anthropic'in sunucu tarafı yedek modeli (`fallbacks: "default"`) devreye girer. Anahtar sadece bu bilgisayarda (`settings.json`) saklanır.

## Klasörler

| Klasör | İçerik |
|---|---|
| `Videolar/` | Oluşturduğun videolar |
| `projeler/` | Projeler (kesilen sahne, ayrılmış sesler, kayıtlar) |
| `models/` | İndirilen yapay zeka modelleri (~2 GB) |
| `bin/` | Oda için bağlantı aracı (cloudflared) |

## Sorun giderme

- **Tarayıcı açılmadı:** adres çubuğuna `http://127.0.0.1:8765` yaz.
- **Mikrofon çalışmıyor:** adres çubuğundaki kilit simgesinden mikrofon iznini ver; Kabin ayarları → *Mikrofonu dene*.
- **Kayıtta ses yok uyarısı:** doğru mikrofon seçili mi, sessize alınmış mı kontrol et.
- **Google Çeviri hatası:** internet bağlantısını kontrol edip Senaryo → Çevir ile tekrar dene.
- **Link ile video inmedi:** videoyu bilgisayara indirip dosya olarak sürükle.

## Teknik özet

Python (FastAPI) sunucu + tarayıcı arayüzü (Preact). Ses ayırma: Demucs `htdemucs_ft` (sadece vokal uzmanı modeli, ekran kartında); Demucs'un "ses" sanıp aldığı kuş/rüzgar gibi ortam sesleri DPDFNet (48 kHz konuşma iyileştirme, sherpa-onnx) ile konuşmadan ayrılıp ayrı bir ize geri konur. Yazıya dökme: faster-whisper `large-v3-turbo` (kelime zamanlamalı). Konuşmacı ayrımı: sherpa-onnx (pyannote segmentasyon + WeSpeaker ResNet34). Hizalama: Silero VAD. Efekt/hız: ffmpeg (rubberband, NVENC, libass altyazı). Yapay zeka sesi: edge-tts. Oda: Cloudflare quick tunnel + PIN. Mikser önizlemesi tarayıcıda Web Audio ile, son video sunucuda aynı kurallarla üretilir.
