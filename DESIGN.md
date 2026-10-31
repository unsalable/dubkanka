# DubKanka tasarım dili: Kayıt Masası

DubKanka bir dublaj stüdyosunun masası gibi görünür. Masada iki şey var:

- **Konsol:** mat koyu donanım. Seviye göstergeleri, zaman kodu ekranı, transport tuşları, kayıt lambası.
- **Senaryo kâğıdı:** her oyuncunun replikleri kendi fosforlu kalem rengiyle işaretli.

Her ekran bu iki malzemeden kurulur. Süs yok; bir şey ekranda duruyorsa ya bir kontrol, ya bir ölçüm, ya da senaryonun kendisidir.

Bütün değerler `web/css/base.css` içindeki `:root` değişkenlerinde. Görünümler kendi dosyasında (`web/css/views/*.css`) sadece bu değişkenleri kullanır, yeni renk uydurmaz.

## Renk

Zemin hafif sıcak bir grafit. Tek marka rengi **sinyal sarısı**: fosforlu kalemin ve stüdyodaki "hazır" lambasının rengi. Kırmızı sadece kayıt içindir.

| Değişken | Değer | Kullanım |
|---|---|---|
| `--bg` | `#0e0e0d` | Pencere zemini, üst çubuk, paneller arası çizgi boşluğu |
| `--panel` | `#161615` | Paneller (`.pane`) |
| `--sunk` | `#0a0a09` | Kuyular: girdi alanları, zaman çizelgesi şeritleri, zaman kodu ekranı |
| `--raised` / `--raised-2` | `#21211f` / `#2b2b28` | Düğme yüzeyi; üzerine gelme ve basılı hali |
| `--line` / `--line-2` | `#262624` / `#363632` | İnce çizgiler; kontrol kenarlıkları |
| `--text` / `--text-2` / `--text-3` | `#f2f0ea` / `#b4b1a7` / `#8c897f` | Metin, ikincil, ipucu (panel üstünde en az 4.8:1) |
| `--accent` | `#ffd23f` | Ana düğme dolgusu, odak halkası, seçim çerçevesi, etkin sekme çizgisi |
| `--accent-ink` | `#17150d` | Sarı üstündeki yazı |
| `--accent-soft` | `rgba(255, 210, 63, 0.14)` | Seçili satır zemini, sürükleme hedefi |
| `--rec` | `#ff3b30` | Sadece kayıt: REC lambası, kayıt düğmesi, "Konuş" işareti |
| `--ok` / `--warn` / `--bad` | `#3dd68c` / `#ff9f43` / `#ff5a52` | Durum. Uyarı turuncu, sarı ile karışmasın diye |

**Karakter renkleri** (`dubkanka/projects.py`, `COLORS`): fosforlu kalem tonları. Hepsi aynı parlaklıkta, hiçbiri sarıya ya da kayıt kırmızısına yakın değil. Karakter rengi içerik içindir (klip, kalem izi, rozet karesi); arayüz durumu için kullanılmaz.

## Yazı

Tek aile: **IBM Plex** (`web/fonts`, SIL OFL). Türkçe karakterlerin hepsi var.

- **Arayüz:** `IBM Plex Sans` (değişken, `--font`). Temel 13 px, satır yüksekliği 1.45.
- **Etiket:** aynı ailenin dar hali (`--font-cond`, `font-stretch: 80%`). İz adları, sekmeler, kontrol grubu etiketleri, gösterge yazıları. Konsoldaki kanal etiketleri gibi.
- **Sayı:** `IBM Plex Mono` (`--mono`). Zaman kodu, PIN, dB, codec bilgisi, dosya yolu. Hep tablo rakamı.

| Rol | Boyut / ağırlık |
|---|---|
| Sayfa başlığı | 22 px / 600 |
| Panel başlığı | 13 px / 600 |
| Gövde | 13 px / 400 |
| İkincil, ipucu | 12 px / 400 |
| Kontrol grubu etiketi | 11 px / 600, dar, `letter-spacing: .04em` |
| Kabin repliği | 28 to 40 px / 600 |

## Biçim

- **Köşeler keskin:** 2 px (gösterge, renk karesi), 3 px (düğme, girdi), 4 px (panel), 8 px (açılır menü, pencere, bildirim). Hap biçimi sadece açma/kapama anahtarında.
- **Paneller yapışık:** ekran bölgeleri arasında boşluk yok, 1 px çizgi var (`gap: 1px` ve arkada `--bg`). Kart yığını değil, editör düzeni.
- **Kontrol yükseklikleri:** 28 px; küçük 24 px; büyük 36 px. Panel başlığı 36 px.
- **Düğme:** yüzeyin üstünde 1 px açık çizgi, basınca 1 px aşağı iner. Ana düğme sarı dolgu ve koyu yazı. İkincil düğme grafit. Hayalet düğme sadece araç çubuklarında.
- **Durum rozeti yok.** Durum, 6 px kare bir lamba ve yanında düz yazıdır: `■ kayıtlı`, `■ işleniyor`. Hap biçimli renkli rozet kullanılmaz.
- **Gölge** sadece açılır katmanlarda: menü, pencere, bildirim (`--shadow-pop`).

## İmza parçalar

- **Zaman kodu ekranı** (`.tc-lcd`): `--sunk` kuyu, içte 1 px çizgi, mono rakamlar; ayırıcılar daha sönük.
- **LED seviye göstergesi** (`.meter`): bölmeli; -18 dB'ye kadar yeşil, -6 dB'ye kadar sarı, üstü kırmızı. Tepe noktası 1 sn asılı kalır, 0 dB'yi geçince kırmızı "CLIP" yanar.
- **REC lambası** (`.tally`): kırmızı dikdörtgen, dar yazıyla `REC`. Sadece kayıt sürerken yanar.
- **Kalem izi** (`.hl`): karakter adının arkasında, karakter renginde yarı saydam, hafif eğik bir fosforlu kalem şeridi. Senaryo, kabin ve oda ekranlarında aynı karakter aynı izi taşır.
- **Akış çizgisi** (kabin): kayıttan önce videonun üstünde soldan sağa geçen dikey çizgi; sağ kenara tam replik başladığında varır. Profesyonel dublajdaki "streamer".
- **Zaman çizelgesi:** şeritler kuyu renginde; klipler karakter renginde dolu, içte 1 px koyu çizgi. Seçili klip 2 px sarı çerçeve. Oynatma çizgisi beyaz, başında sarı bir işaret.

## Hareket

Animasyondan vazgeçmiyoruz, ama her animasyon bir durumu ya da yer değişimini anlatır. Süs için dönen, parlayan, nabız atan şey yok; sadece kayıt ve işlem sürerken sürekli hareket var.

- **Eğriler:** `--ease-out` (0.16, 1, 0.3, 1) ana eğri, `--ease-in` çıkışlar için, `--spring` hafif taşmalı yay.
- **Süreler:** `--t-fast` 110 ms (basma, üzerine gelme), `--t` 180 ms (durum), `--t-slow` 280 ms (menü, panel), `--t-page` 420 ms (sayfa, yerleşim).
- **Sayfa geçişi:** View Transitions. Sayfa iş akışı yönünde kayar (`--vt-dir`), video resmi (`view-transition-name: viewer`) yeni yerine süzülür.
- **Kabin:** geri sayım halkası bip seslerine eş zamanlı, akış çizgisi, kayıt düğmesi daireden yuvarlak köşeli kareye döner, yeni kayıt listeye yayla düşer.
- **Göstergeler:** bütün seviye göstergeleri tek bir animasyon döngüsünden beslenir.

### Animasyon ayarı

Ayarlar → Görünüm → **Animasyonlar**: `Tam`, `Azaltılmış`, `Kapalı`. Seçim cihazda saklanır (`localStorage dk.motion`) ve `<html data-motion="…">` olarak uygulanır. İşletim sistemi "hareketi azalt" diyorsa varsayılan `Azaltılmış`.

| Seviye | Ne olur |
|---|---|
| `full` | Her şey açık. |
| `reduced` | Süreler yarıya iner. Kayma, büyüme ve yay hareketleri yerini kısa bir solmaya bırakır. Sayfa geçişi sadece çapraz solma. Kademeli liste girişi yok. |
| `off` | Geçiş ve animasyon yok (sadece yükleme göstergesi ve kayıt lambası çalışır). View Transitions hiç başlamaz. |

CSS'te süreler `calc(var(--m) * …)` ile yazılır: `full` için `--m: 1`, `reduced` için `0.5`, `off` için `0`. JavaScript tarafında `motion()` (`web/js/state.js`) aynı seviyeyi verir; `element.animate` çağrıları ondan önce bunu sorar.

## Yazı tonu

- Türkçe, kısa, düz. Ünlem, emoji, "Harika!" yok (WhatsApp davet mesajı hariç).
- Teknik ayar teknik adıyla yazılır, yanında tek satırlık açıklama olur: `CRF 18`, "düşük = daha kaliteli, daha büyük dosya".
- Ekranda sadece o an karar vermeye yarayan bilgi durur. Uzun açıklama `title` ipucuna ya da "Gelişmiş" bölümüne gider.

## Kaçınılanlar

Degrade, cam efekti, neon parlama, ikon yerine emoji, başlık üstü küçük etiket, aynı boy ikonlu kart ızgarası, renkli kalın sol kenarlık, hap biçimli durum rozetleri, boşluklarla ayrılmış yüzen kart yığınları, her şeyi ortalayan boş açılış ekranları.
