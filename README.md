# DubKanka: arkadaşlarınla dublaj stüdyosu

Bir dizi ya da film sahnesini arkadaşlarınla dublajlayıp paylaşmak için Windows uygulaması. Videoyu bırakıp sahneyi seçiyorsun:

- konuşmalar müzikten, efektten ve ortam seslerinden (kuş, rüzgar, kalabalık) **ayrılıyor**,
- kimin ne zaman konuştuğu bulunup her replik ayrı bir satıra yazılıyor ve **çevriliyor**,
- herkes kendi repliğini **akış çizgisi ve bip sesleriyle tam zamanında** kaydediyor, linkle telefondan bile,
- en sonda **altyazılı dikey video** ya da görüntüsü hiç yeniden kodlanmamış bir kopya çıkıyor.

## İndir ve kur

1. [Sürümler](https://github.com/unsalable/dubkanka/releases/latest) sayfasından **`DubKanka-Setup-x.y.z.exe`** dosyasını indir ve çalıştır. Yönetici izni istemez.
2. Windows "Bilgisayarınız korundu" derse: **Ek bilgi → Yine de çalıştır**. (Uygulama imzalı değil, o yüzden çıkıyor.)
3. İlk açılışta DubKanka sadece stüdyonun kendisini kurar: Python, stüdyo paketleri ve ffmpeg. Yaklaşık **200 MB, birkaç dakika**.
4. Sonra tek bir soru sorar: **ne yapmak istiyorsun?** Temel stüdyo seçili gelir; ek özellikler boş gelir, boyutlarıyla yazar. İşaretlediklerin arka planda iner, sen beklemeden başlarsın. Hiçbirini seçmesen de dublaj yaparsın: bir özelliği kullanmak istediğinde ekran orada **İndir · boyut** düğmesi çıkarır; hepsi **Ayarlar → Özellikler**'de de durur.

| Özellik | Ne kazandırır | İndirme |
|---|---|---|
| Kendi sesinle dublaj | Sahneyi kes, replikleri yaz, kaydet (canlı gürültü engelleme RNNoise dahil), miksle, altyazılı videoyu paylaş | dahil |
| Yazıya dökme ve çeviri | Kim ne zaman ne diyor bulunur; satırlar kendiliğinden yazılır, kişilere bölünür, çevrilir (Whisper, konuşmacı ayrımı) | ~1.7 GB (hızlı model 0.6 GB) |
| Müziği ve efektleri koru | Orijinal konuşmalar çıkar; müzik, efekt ve ortam sesleri dublajın altında kalır (Demucs, PyTorch) | ~2.8 GB NVIDIA ile, ~0.4 GB işlemciyle |
| Arkadaşlarla oda | Arkadaşların linkle telefondan katılıp kendi rolünü kaydeder (cloudflared) | 60 MB |
| Kayıt temizleme (DPDFNet) | Kayıtlardaki oda gürültüsü ve fan sesi kayıttan sonra silinir | 30 MB |

Bir özellik yokken de akış durmaz: yazıya dökme yoksa satırları Senaryo'da kendin eklersin; müzik ayrılmamışsa orijinal ses dublajın altında kısılarak çalar ve özelliği ekleyince Mikser'den **Konuşmaları fondan ayır** ile sahneyi sonradan ayırırsın (satırlar ve kayıtlar kalır).

| Gereken | |
|---|---|
| Sistem | Windows 10 / 11, 64 bit |
| Ekran kartı | Şart değil. NVIDIA varsa Müziği koru onu kullanır (RTX 20 ve sonrası CUDA 12.8, GTX 900/10 serisi CUDA 12.6). |
| Disk | Stüdyo için 1 GB; bütün özelliklerle 7 GB |

**Güncellemeler kendiliğinden gelir.** Her açılışta DubKanka önce yeni sürüm var mı diye bakar; varsa indirir, kurar ve yeni sürümle açılır (beklemek istemezsen **Şimdilik atla**: kapanırken kurulur). İnternet yoksa birkaç saniyede vazgeçip açılır. Projeler, ayarlar, özellikler ve modeller olduğu gibi kalır. Ayarlar → Güncellemeler → **Otomatik güncelle** ile kapatılabilir.

## Ücretli mi, nasıl çalışıyor?

- **Oda:** Arkadaşlarına verilen link Cloudflare'in ücretsiz geçici tüneliyle (`cloudflared`, hesap gerekmez) senin bilgisayarına bağlanır. Link sadece DubKanka açıkken çalışır, 4 haneli PIN ister.
- **Yapay zeka:** Ses ayırma (Demucs), yazıya dökme (Whisper), konuşmacı ayrımı ve gürültü temizleme bilgisayarında çalışır (varsa ekran kartında). Bulut yok, ücret yok. Hepsi isteğe bağlı özellik.
- **Çeviri:** Google Çeviri ücretsiz ve varsayılan. Ayarlar'a anahtar girersen Claude, OpenAI, Gemini, Groq, OpenRouter, DeepSeek, Mistral ya da DeepL kullanılabilir; bunlar kendi hesabından ücretlendirilir. Ollama ve LM Studio bilgisayarında ücretsiz çalışır.
- **Yapay zeka sesi** (boş satırları doldurmak için): Microsoft Edge'in ücretsiz sesleri.

DubKanka'yı kuran her arkadaş kendi projesini ve odasını açabilir, kimsenin bilgisayarına bağlı değil.

## Dublaj adım adım

| Adım | Ne oluyor |
|---|---|
| **Video** | Ana sayfaya videoyu bırak ya da YouTube vb. linki yapıştır. Video okununca **Sahne** ekranı açılır: dublajlayacağın kısmı seç, dili ve konuşan kişi sayısını ayarla, **Sahneyi hazırla**. Bitince senaryo açılır. Dublaj dili ve çeviri servisi bir sonraki sahne için hatırlanır. İndirilmemiş bir özelliği ekran orada, boyutuyla birlikte teklif eder. |
| **Senaryo** | Her satır sadece gerekeni gösterir: kim söylüyor (renkli nokta ve ad), orijinal metin, dublaj metni. Dublaj orijinalden belirgin uzunsa yanında **uzun** yazar; kaydı olan satırda yeşil tik durur. Zamanlama alttaki zaman çizelgesinde: satırları sürükle, kenarlarından uzat. Oyuncular listesinde karakteri yeniden adlandır, rengini değiştir, `⋯` menüsünden başka karakterle birleştir. **Çevir** ile istediğin servisle yeniden çevirt. |
| **Kayıt** | Rolünü seç, **Boşluk**'a bas: video satırdan önce başlar, akış çizgisi ekranın sağına ulaştığında ve üçüncü bipten sonra konuş. Altta orijinal repliğin dalga biçimi ve kelimeleri gerçek zamanlarıyla durur; dublaj metni kelime kelime yanar. Kayıt sessizlikleri kesilip orijinal girişe hizalanır ve hemen dinletilir. |
| **Mikser** | Fon, ortam sesleri, karakterler ve ekstra sesler ayrı izlerde. Kayıtları sürükleyerek kaydır, **kenarlarından tutup baştan ya da sondan kırp**. Kaydı olmayan satırlar karakterin izinde boş kutu olarak durur; onları da uzatıp kısaltabilirsin. Dublaj / Orijinal / Konuşmasız arasında oynatırken geçiş yap. |
| **Paylaş** | Sırayla dört adım: **1 Biçim** (9:16, kare, orijinal), **2 Ses** (dublaj, konuşmasız, orijinal), **3 Altyazı**, **4 Kalite** (Standart, Yüksek kalite, Küçük dosya, Kaynak kopyası; kalite biçimi değiştirmez). Teknik ayarlar kapalı gelir; isteyen açıp kendisi yapar: H.264 / H.265 / AV1, NVENC / Quick Sync / AMF / işlemci kodlayıcı, CRF-CQ / VBR / CBR, preset, kare hızı, çözünürlük, 8/10-bit, GOP, AAC / Opus / FLAC / PCM, EBU R128 ses yüksekliği, MP4 / MKV / MOV. Sağdaki önizleme kadrajı, altyazıyı ve gerçek miksi oynatır. |

**Kaynak kopyası:** Görüntü yeniden kodlanmaz (`-c:v copy`), sadece yeni ses eklenir; kaynak dosyanın kalitesi bit bit korunur. Kesim bir anahtar kareye denk gelmiyorsa kopya en yakın önceki anahtar kareden başlar ve o birkaç karede orijinal ses çalar; ekran bunu önceden söyler.

**Kısayollar (kayıt):** `Boşluk` kaydet / durdur · `K` sahneyi bu satırdan oynat / durdur · `P` orijinali dinle · `L` kaydımı dinle · `Enter` sonraki · `↑` önceki · `Esc` durdur (düğmelerin üzerine gelince de yazar)

## Kabin ve mikrofon

- **Dinleme şeridi** (kayıt düğmesinin hemen altında): mikrofonu buradan değiştirirsin ve seviyesini görürsün. Yanında **Ses** (dinleme sesi; hoparlöre basınca sessiz), **Fon** (müzik, efekt ve ortam sesi; sıfırlarsan hiç çalmaz) ve **Orijinal** (kayıt sırasında kulağına gelen orijinal konuşma) sürgüleri. Çalarken sürgüyü oynatınca hemen duyulur.
- **Durdurmak:** her oynat düğmesi basınca **Durdur** olur; videoya tıklamak ve `Esc` de durdurur. Dinleme sesi Senaryo, Mikser ve Paylaş'taki oynatıcılarda da aynı; çıkan videonun sesini değiştirmez.
- **Gürültü engelleme**, sesli sohbet uygulamalarındaki gibi bir sekmeden seçilir:
  - **Standart:** tarayıcının kendi gürültü bastırması (varsayılan).
  - **RNNoise:** açık kaynak yapay zeka, kayıt sırasında canlı çalışır; fan ve uğultuyu siler. Uygulamanın içinde, ek indirme yok.
  - **DPDFNet:** en temiz sonuç; kayıt bitince yapay zekayla temizlenir. Kayıt temizleme özelliğini ister (30 MB); seçince indirme düğmesi orada çıkar.
  - **Kapalı:** ses olduğu gibi kaydedilir.
- **Yankı engelleme** varsayılan olarak açık; **otomatik kazanç** kapalı. **Alçak kesme 80 Hz** kayıttan sonra uygulanır; mikserde her kayıt için DPDFNet temizleme ayrıca açılıp kapanır.
- **Mikrofonu test et** ile seviyeyi gör, **Kendimi duy** ile sesini kulaklıktan dinle, **5 sn deneme kaydı** ile nasıl kaydettiğini duy.
- Bluetooth kulaklığın mikrofonu telefon kalitesinde kaydeder; uygulama bunu fark edince uyarır.

## Arkadaşlarla

**Oda** düğmesi → **Odayı aç** (ilk seferde Arkadaşlarla oda özelliği 60 MB iner). Oda düğmesine yeniden basınca geldiğin ekrana dönersin. Çıkan link ve PIN'i (ya da QR kodu) WhatsApp'tan gönder. Arkadaşın adını ve PIN'i yazar, rolünü seçer, kaydeder; kayıtlar anında projene düşer. Oda ekranında kimin hangi rolde ve hangi satırda olduğu görünür; sen de kayıt ekranında bir rol seçince herkes görür.

Odaya giremeyen arkadaş için: Senaryo → **Gönder** ile replikleri gönder. Gelen ses dosyalarını Kayıt → **Toplu yükle** ile at; dosya adındaki numara satırı bulur, WhatsApp sesli mesajlarının satırını listeden seçersin.

## Ayarlar

Sağ üstteki dişliyle açılır; ayarlardayken dişli × olur ve geldiğin ekrana döner (Esc de aynısını yapar). Her konu ayrı bir sayfada:

- **Genel:** **Animasyonlar** (Tam, Azaltılmış ya da Kapalı; zayıf bilgisayarlarda Kapalı).
- **Özellikler:** indirilebilen her şey: yazıya dökme, müziği koruma, oda ve kayıt temizlemeyi indir ya da kaldır; inerken ilerleme burada ve üst çubukta görünür. Yazıya dökme modeli, ses ayırma modeli ve yapay zekanın ekran kartında mı işlemcide mi çalışacağı da burada.
- **Çeviri:** varsayılan servis, servis başına anahtar, model listesi ve **Dene** düğmesi. **Otomatik bul** bilgisayarda çalışan Ollama / LM Studio'yu ve ortam değişkenlerindeki API anahtarlarını bulup ayarlar.
- **Klasörler:** videoların, projelerin ve modellerin yeri.
- **Güncellemeler:** sürüm, durum, **Otomatik güncelle**. **Sistem:** günlükler, **Kurulumu onar**.

Silme gibi geri alınamayan işler uygulamanın içinde küçük bir pencereyle sorulur (Windows'un kendi kutusu çıkmaz); Esc ya da **Vazgeç** iptal eder.

## Klasörler

| Nerede | Ne var |
|---|---|
| `Videolar\DubKanka` | Oluşturduğun videolar |
| `%LOCALAPPDATA%\DubKanka\projeler` | Projeler (kesilen sahne, ayrılmış sesler, kayıtlar) |
| `%LOCALAPPDATA%\DubKanka\models` | Yapay zeka modelleri (eklediğin özelliklerin) |
| `%LOCALAPPDATA%\DubKanka\runtime` | Python ve paketler |
| `%LOCALAPPDATA%\DubKanka\logs` | Günlükler (sorun bildirirken bunları gönder) |

Uygulamayı kaldırmak projelere dokunmaz. Her şeyi silmek için kaldırdıktan sonra `%LOCALAPPDATA%\DubKanka` klasörünü de sil.

## Sorun giderme

- **İlk kurulum yarıda kaldı:** internet bağlantısını kontrol edip **Tekrar dene**. Kaldığı yerden devam eder.
- **Bir özellik inmedi:** Ayarlar → Özellikler'de **Tekrar dene**. Kullanımdaki bir özelliği kaldırınca uygulama yeniden açılınca silinir.
- **Mikrofon çalışmıyor:** Kabin → doğru mikrofon seçili mi, **Mikrofonu test et** seviye gösteriyor mu? Başka bir uygulama mikrofonu kullanıyor olabilir.
- **Kayıtlar hep geç oturuyor:** Kabin → *Gecikme düzeltme* (Bluetooth için 150-250 ms).
- **Arka planda fan / uğultu var:** Kabin → Gürültü engelleme → **RNNoise** ya da **DPDFNet**.
- **Bir şeyler bozuldu:** Ayarlar → Sistem → **Kurulumu onar**.

## Yeni sürüm yayınlamak

```powershell
.\scripts\release.ps1 1.2.0 "Kayıt ekranında yeni kısayollar"
```

Sürümü `desktop/package.json`'a yazar, commit'ler, notu `v1.2.0` etiketine koyup gönderir. GitHub Actions `DubKanka-Setup-1.2.0.exe`'yi derleyip sürüm olarak yayınlar; kurulu uygulamalar kendini günceller.

## Geliştirme

- **Kaynaktan çalıştırma:** `Kurulum.bat` (bir kere), sonra `Baslat.bat`. Tarayıcıda `http://127.0.0.1:8765` açılır.
- **Masaüstü uygulaması:** `cd desktop`, `npm install`, sonra mevcut Python ile: `$env:DUBKANKA_PYTHON = "..\.venv\Scripts\python.exe"; npm start`. Kurulum dosyası: `npm run dist`.
- **Yapı:** Python (FastAPI) sunucu + tarayıcı arayüzü (Preact, derleme adımı yok) + Electron kabuğu. İlk kurulum `requirements-core.txt`'yi kurar; özellikler (`dubkanka/features.py`) paketlerini `requirements.lock` sürümleriyle, uygulama açıkken uv ile ekler. Ses ayırma Demucs `htdemucs_ft`, ortam sesleri ve gürültü DPDFNet (sherpa-onnx), canlı gürültü engelleme RNNoise (WebAssembly, `web/vendor/noise`), yazıya dökme faster-whisper, konuşmacı ayrımı sherpa-onnx (pyannote + WeSpeaker), hizalama Silero VAD, video ffmpeg (NVENC, rubberband, libass), yapay zeka sesi edge-tts. Tasarım dili: `DESIGN.md`.
