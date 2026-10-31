# DubKanka: arkadaşlarınla dublaj stüdyosu

Bir dizi ya da film sahnesini arkadaşlarınla dublajlayıp TikTok'a atmak için Windows uygulaması. Videoyu bırakıyorsun:

- konuşmalar müzikten, efektten ve ortam seslerinden (kuş, rüzgar, kalabalık) **ayrılıyor**,
- kimin ne zaman konuştuğu bulunup her replik ayrı bir satıra yazılıyor ve **çevriliyor**,
- herkes kendi repliğini **akış çizgisi ve bip sesleriyle tam zamanında** kaydediyor, linkle telefondan bile,
- en sonda **altyazılı TikTok videosu** ya da görüntüsü hiç yeniden kodlanmamış bir kopya çıkıyor.

## İndir ve kur

1. [Sürümler](https://github.com/unsalable/dubkanka/releases/latest) sayfasından **`DubKanka-Setup-x.y.z.exe`** dosyasını indir ve çalıştır. Yönetici izni istemez.
2. Windows "Bilgisayarınız korundu" derse: **Ek bilgi → Yine de çalıştır**. (Uygulama imzalı değil, o yüzden çıkıyor.)
3. İlk açılışta DubKanka sadece stüdyonun kendisini kurar: Python, stüdyo paketleri ve ffmpeg. Yaklaşık **200 MB, birkaç dakika**.
4. Sonra tek bir soru sorar: **ne yapmak istiyorsun?** İşaretlediğin özellikler arka planda iner, sen beklemeden başlarsın. Hiçbirini seçmesen de dublaj yaparsın; istediğini sonra **Ayarlar → Özellikler**'den ekler ya da kaldırırsın.

| Özellik | Ne kazandırır | İndirme |
|---|---|---|
| Kendi sesinle dublaj | Sahneyi kes, replikleri yaz, kaydet, miksle, altyazılı videoyu paylaş | dahil |
| Yazıya dökme ve çeviri | Kim ne zaman ne diyor bulunur; satırlar kendiliğinden yazılır, kişilere bölünür, çevrilir (Whisper, konuşmacı ayrımı) | ~1.7 GB (hızlı model 0.6 GB) |
| Müziği ve efektleri koru | Orijinal konuşmalar çıkar; müzik, efekt ve ortam sesleri dublajın altında kalır (Demucs, PyTorch) | ~2.8 GB NVIDIA ile, ~0.4 GB işlemciyle |
| Arkadaşlarla oda | Arkadaşların linkle telefondan katılıp kendi rolünü kaydeder (cloudflared) | 60 MB |
| Kayıt temizleme | Kayıtlardaki oda gürültüsü ve fan sesi silinir (DPDFNet) | 30 MB |

Bir özellik yokken de akış durmaz: yazıya dökme yoksa satırları Senaryo'da kendin eklersin; müzik ayrılmamışsa orijinal ses dublajın altında kısılarak çalar ve özelliği ekleyince Mikser'den **Konuşmaları fondan ayır** ile sahneyi sonradan ayırırsın (satırlar ve kayıtlar kalır).

| Gereken | |
|---|---|
| Sistem | Windows 10 / 11, 64 bit |
| Ekran kartı | Şart değil. NVIDIA varsa Müziği koru onu kullanır (RTX 20 ve sonrası CUDA 12.8, GTX 900/10 serisi CUDA 12.6). |
| Disk | Stüdyo için 1 GB; bütün özelliklerle 7 GB |

**Güncellemeler kendiliğinden gelir.** Yeni sürüm arka planda iner; üst çubukta **Güncelle ve yeniden başlat** belirir. Projeler, ayarlar, özellikler ve modeller olduğu gibi kalır.

## Ücretli mi, nasıl çalışıyor?

- **Oda:** Arkadaşlarına verilen link Cloudflare'in ücretsiz geçici tüneliyle (`cloudflared`, hesap gerekmez) senin bilgisayarına bağlanır. Link sadece DubKanka açıkken çalışır, 4 haneli PIN ister.
- **Yapay zeka:** Ses ayırma (Demucs), yazıya dökme (Whisper), konuşmacı ayrımı ve gürültü temizleme bilgisayarında çalışır (varsa ekran kartında). Bulut yok, ücret yok. Hepsi isteğe bağlı özellik.
- **Çeviri:** Google Çeviri ücretsiz ve varsayılan. Ayarlar'a anahtar girersen Claude, OpenAI, Gemini, Groq, OpenRouter, DeepSeek, Mistral ya da DeepL kullanılabilir; bunlar kendi hesabından ücretlendirilir. Ollama ve LM Studio bilgisayarında ücretsiz çalışır.
- **Yapay zeka sesi** (boş satırları doldurmak için): Microsoft Edge'in ücretsiz sesleri.

DubKanka'yı kuran her arkadaş kendi projesini ve odasını açabilir, kimsenin bilgisayarına bağlı değil.

## Dublaj adım adım

| Adım | Ne oluyor |
|---|---|
| **Video** | Ana sayfaya videoyu bırak ya da YouTube vb. linki yapıştır. **Bırakınca hazırla** açıksa (varsayılan) 15 dakikadan kısa videolar baştan sona hazırlanır, bitince senaryo açılır. Kapalıysa ya da uzun videolarda **Sahne** ekranında kısmı seçip dili ve konuşan kişi sayısını ayarlarsın. Yüklü olmayan bir özelliği ekran orada, boyutuyla birlikte teklif eder. |
| **Senaryo** | Her satır: kim söylüyor (renkli kalem izi), orijinal metin, dublaj metni. Lamba repliğin ağza sığıp sığmadığını hece sayısına göre söyler. Zaman çizelgesinde satırları sürükle, kenarlarından uzat. Oyuncular listesinde karakteri yeniden adlandır, rengini değiştir, `⋯` menüsünden başka karakterle birleştir. **Çevir** ile istediğin servisle yeniden çevirt. |
| **Kayıt** | Rolünü seç, **Boşluk**'a bas: video satırdan önce başlar, akış çizgisi ekranın sağına ulaştığında ve üçüncü bipten sonra konuş. Altta orijinal repliğin dalga biçimi ve kelimeleri gerçek zamanlarıyla durur; dublaj metni kelime kelime yanar. Kayıt sessizlikleri kesilip orijinal girişe hizalanır ve hemen dinletilir. |
| **Mikser** | Fon, ortam sesleri, karakterler ve ekstra sesler ayrı izlerde. Kayıtları sürükleyerek kaydır, **kenarlarından tutup baştan ya da sondan kırp**. Kaydı olmayan satırlar karakterin izinde boş kutu olarak durur; onları da uzatıp kısaltabilirsin. Dublaj / Orijinal / Konuşmasız arasında oynatırken geçiş yap. |
| **Paylaş** | Sırayla dört adım: **1 Biçim** (9:16, kare, orijinal), **2 Ses** (dublaj, konuşmasız, orijinal), **3 Altyazı**, **4 Kalite** (TikTok, Yüksek kalite, Küçük dosya, Kaynak kopyası). Teknik ayarlar kapalı gelir; isteyen açıp kendisi yapar: H.264 / H.265 / AV1, NVENC / Quick Sync / AMF / işlemci kodlayıcı, CRF-CQ / VBR / CBR, preset, kare hızı, çözünürlük, 8/10-bit, GOP, AAC / Opus / FLAC / PCM, EBU R128 ses yüksekliği, MP4 / MKV / MOV. Sağdaki önizleme kadrajı, altyazıyı ve gerçek miksi oynatır. |

**Kaynak kopyası:** Görüntü yeniden kodlanmaz (`-c:v copy`), sadece yeni ses eklenir; kaynak dosyanın kalitesi bit bit korunur. Kesim bir anahtar kareye denk gelmiyorsa kopya en yakın önceki anahtar kareden başlar ve o birkaç karede orijinal ses çalar; ekran bunu önceden söyler.

**Kısayollar (kayıt):** `Boşluk` kaydet / durdur · `P` orijinali dinle · `L` kaydımı dinle · `Enter` sonraki · `↑` önceki · `Esc` iptal

## Kabin ve mikrofon

- **Saf ses** varsayılan olarak açık: tarayıcının yankı engelleme, gürültü bastırma ve otomatik kazancı kapalı. İyi bir mikrofonu boğuk yapan bunlardı. Hoparlörle kayıt yapıyorsan ya da ortam çok gürültülüyse tek tek açabilirsin.
- **Alçak kesme 80 Hz** ve **yapay zeka gürültü temizleme** (DPDFNet, Kayıt temizleme özelliği) kayıttan sonra uygulanır; mikserde her kayıt için ayrıca açılıp kapanır.
- **Mikrofonu test et** ile seviyeyi gör, **Kendimi duy** ile sesini kulaklıktan dinle, **5 sn deneme kaydı** ile nasıl kaydettiğini duy.
- Bluetooth kulaklığın mikrofonu telefon kalitesinde kaydeder; uygulama bunu fark edince uyarır.

## Arkadaşlarla

**Oda** düğmesi → **Odayı aç** (ilk seferde Arkadaşlarla oda özelliği 60 MB iner). Oda düğmesine yeniden basınca geldiğin ekrana dönersin. Çıkan link ve PIN'i (ya da QR kodu) WhatsApp'tan gönder. Arkadaşın adını ve PIN'i yazar, rolünü seçer, kaydeder; kayıtlar anında projene düşer. Oda ekranında kimin hangi rolde ve hangi satırda olduğu görünür; sen de kayıt ekranında bir rol seçince herkes görür.

Odaya giremeyen arkadaş için: Senaryo → **Paylaş** ile replikleri gönder. Gelen ses dosyalarını Kayıt → **Toplu yükle** ile at; dosya adındaki numara satırı bulur, WhatsApp sesli mesajlarının satırını listeden seçersin.

## Ayarlar

Sağ üstteki dişliyle açılır; ayarlardayken dişli × olur ve geldiğin ekrana döner (Esc de aynısını yapar). Her konu ayrı bir sayfada:

- **Genel:** bırakınca hazırla, dublaj dili, **Animasyonlar** (Tam, Azaltılmış ya da Kapalı; zayıf bilgisayarlarda Kapalı).
- **Özellikler:** yazıya dökme, müziği koruma, oda ve kayıt temizlemeyi ekle ya da kaldır; inerken ilerleme burada ve üst çubukta görünür. Yazıya dökme modeli, ses ayırma modeli ve yapay zekanın ekran kartında mı işlemcide mi çalışacağı da burada.
- **Çeviri:** varsayılan servis, servis başına anahtar, model listesi ve **Dene** düğmesi. **Otomatik bul** bilgisayarda çalışan Ollama / LM Studio'yu ve ortam değişkenlerindeki API anahtarlarını bulup ayarlar.
- **Klasörler:** videoların, projelerin ve modellerin yeri.
- **Güncellemeler** ve **Sistem:** sürüm, günlükler, **Kurulumu onar**.

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
- **Bir şeyler bozuldu:** Ayarlar → Sistem → **Kurulumu onar**.

## Yeni sürüm yayınlamak

```powershell
.\scripts\release.ps1 1.2.0 "Kayıt ekranında yeni kısayollar"
```

Sürümü `desktop/package.json`'a yazar, commit'ler, notu `v1.2.0` etiketine koyup gönderir. GitHub Actions `DubKanka-Setup-1.2.0.exe`'yi derleyip sürüm olarak yayınlar; kurulu uygulamalar kendini günceller.

## Geliştirme

- **Kaynaktan çalıştırma:** `Kurulum.bat` (bir kere), sonra `Baslat.bat`. Tarayıcıda `http://127.0.0.1:8765` açılır.
- **Masaüstü uygulaması:** `cd desktop`, `npm install`, sonra mevcut Python ile: `$env:DUBKANKA_PYTHON = "..\.venv\Scripts\python.exe"; npm start`. Kurulum dosyası: `npm run dist`.
- **Yapı:** Python (FastAPI) sunucu + tarayıcı arayüzü (Preact, derleme adımı yok) + Electron kabuğu. İlk kurulum `requirements-core.txt`'yi kurar; özellikler (`dubkanka/features.py`) paketlerini `requirements.lock` sürümleriyle, uygulama açıkken uv ile ekler. Ses ayırma Demucs `htdemucs_ft`, ortam sesleri ve gürültü DPDFNet (sherpa-onnx), yazıya dökme faster-whisper, konuşmacı ayrımı sherpa-onnx (pyannote + WeSpeaker), hizalama Silero VAD, video ffmpeg (NVENC, rubberband, libass), yapay zeka sesi edge-tts. Tasarım dili: `DESIGN.md`.
