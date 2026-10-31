# DubKanka tasarım dili: Kayıt Masası (yumuşak sürüm)

DubKanka bir dublaj stüdyosunun masası gibi görünür. Masada iki şey var:

- **Konsol:** mat koyu donanım. Seviye göstergeleri, zaman kodu ekranı, transport tuşları, kayıt lambası.
- **Senaryo kâğıdı:** her oyuncunun replikleri kendi fosforlu kalem rengiyle işaretli.

Her ekran bu iki malzemeden kurulur. Süs yok; bir şey ekranda duruyorsa ya bir kontrol, ya bir ölçüm, ya da senaryonun kendisidir.

**Yumuşak sürüm (31 Ekim 2026):** kullanıcı eski hâli "keskin" buldu, Apple tarzı ve ödül almış uygulamalar kadar yumuşak bir görünüm istedi. Renkler, yazı ailesi ve imza parçalar aynı kaldı; değişen biçim: paneller pencerenin üstünde yüzer, köşeler iç içe yuvarlanır, ayırıcılar kıl çizgisidir, etiketler büyük harfle bağırmaz.

Bütün değerler `web/css/base.css` içindeki `:root` değişkenlerinde. Görünümler kendi dosyasında (`web/css/views/*.css`) sadece bu değişkenleri kullanır, yeni renk uydurmaz.

## Renk

Zemin hafif sıcak bir grafit. Tek marka rengi **sinyal sarısı**: fosforlu kalemin ve stüdyodaki "hazır" lambasının rengi. Kırmızı sadece kayıt içindir.

| Değişken | Değer | Kullanım |
|---|---|---|
| `--bg` | `#0f0f0e` | Pencere zemini, üst çubuk, panellerin arasındaki boşluk |
| `--panel` / `--panel-2` | `#181816` / `#1e1e1c` | Paneller (`.pane`); panel içindeki kartlar ve seçenekler |
| `--sunk` | `#121211` | Kuyular: girdi alanları, zaman çizelgesi şeritleri, zaman kodu ekranı |
| `--raised` / `--raised-2` | `#262624` / `#30302d` | Düğme yüzeyi; üzerine gelme ve seçili hap |
| `--line` / `--line-2` / `--line-3` | sıcak beyaz %7 / %11 / %18 | Kıl çizgileri, kontrol kenarları (saydam: her yüzeyde aynı incelikte durur) |
| `--text` / `--text-2` / `--text-3` | `#f2f0ea` / `#b4b1a7` / `#8c897f` | Metin, ikincil, ipucu (panel üstünde en az 4.8:1) |
| `--accent` | `#ffd23f` | Ana düğme, seçimin işareti (tik, numara, ikon kutusu), odak halkası |
| `--accent-ink` | `#17150d` | Sarı üstündeki yazı |
| `--accent-soft` | sarı %13 | Seçili satır zemini, sürükleme hedefi, özellik ikon kutusu |
| `--rec` | `#ff3b30` | Sadece kayıt: REC lambası, kayıt düğmesi, "Konuş" işareti |
| `--ok` / `--warn` / `--bad` | `#3dd68c` / `#ff9f43` / `#ff5a52` | Durum. Uyarı turuncu, sarı ile karışmasın diye |

**Karakter renkleri** (`dubkanka/projects.py`, `COLORS`): fosforlu kalem tonları. Hepsi aynı parlaklıkta, hiçbiri sarıya ya da kayıt kırmızısına yakın değil. Karakter rengi içerik içindir (klip, kalem izi, renk noktası); arayüz durumu için kullanılmaz.

## Yazı

Tek aile: **IBM Plex** (`web/fonts`, SIL OFL). Türkçe karakterlerin hepsi var.

- **Arayüz:** `IBM Plex Sans` (değişken, `--font`). Temel 13 px, satır yüksekliği 1.5.
- **Dar hal** (`--cond`, `font-stretch: 80%`): sadece senaryodaki karakter adlarında, REC lambasında ve geri sayım yazısında. Kontrol grubu başlıkları artık düz cümle harfiyle yazılır.
- **Sayı:** `IBM Plex Mono` (`--mono`). Zaman kodu, PIN, dB, boyut, codec bilgisi, dosya yolu. Hep tablo rakamı.

| Rol | Boyut / ağırlık |
|---|---|
| Karşılama başlığı | 32 px / 600, `letter-spacing: -0.025em` |
| Sayfa başlığı (Ayarlar, Projeler) | 22-26 px / 600 |
| Panel başlığı | 13 px / 600, cümle harfi |
| Gövde | 13 px / 400 |
| İkincil, ipucu | 12 px / 400 |
| Grup başlığı (`.seclabel`) | 12 px / 600, `--text-2`, cümle harfi |
| Kabin repliği | 22 to 34 px / 600 |

## Biçim

- **Köşeler iç içe yuvarlanır** (Apple'ın eş merkezli köşeleri): içteki öğenin yarıçapı dıştakinden bir adım küçüktür. `--r-xs` 4 px (küçük işaretler), `--r-sm` 8 px, düğme ve girdi 10 px, `--r` 12 px (panel, seçenek), `--r-lg` 16 px (ayar kartları, bildirim, menü 14 px), `--r-xl` 22 px (bırakma alanı, karşılama listesi, pencere). Hap (`--r-pill`): ekranın tek ana eylemi, adım çubuğu, segment kontrolü, açma/kapama, oda düğmesi.
- **Paneller yüzer:** editör ekranları hâlâ editör düzenidir (video, senaryo, zaman çizelgesi yan yana), ama paneller birbirine yapışmaz: aralarında 8 px boşluk (`--gap`), kenarlarında kıl çizgisi, köşeleri 12 px. Kart ızgarası değil; bölgeler aynı yerinde durur.
- **Kontrol yükseklikleri:** 32 px; küçük 26 px; büyük 40 px. Panel başlığı 42 px, üst çubuk 48 px.
- **Düğme:** basınca %97'ye küçülür (aşağı inmez). Ana eylem sarı dolgu, koyu yazı; ekranın asıl eylemi (Sahneyi hazırla, Videoyu oluştur, Başla) hap biçimli ve büyük. İkincil düğme grafit, hayalet düğme sadece araç çubuklarında. Oynat düğmesi beyaz bir daire.
- **Durum rozeti yok.** Durum, 7 px yuvarlak bir lamba ve yanında düz yazıdır: `● yüklü`, `● işleniyor`. Hap biçimli renkli rozet kullanılmaz.
- **Gölge:** yumuşak ve yayvan; sadece yüzen katmanlarda (menü, pencere, bildirim: `--shadow-pop`) ve öne çıkan kartlarda (`--shadow-card`). Sıfır bulanıklıklı sert gölge yok.
- **Seçim:** seçilebilen öğe (biçim, kalite, özellik) yumuşak bir kutudur; seçilince sarı bir kıl çizgisi, hafif sarı zemin ve sağ üstte sarı daire içinde tik alır. Listelerde seçili satır yuvarlak köşeli bir vurgu alır; renkli kalın sol kenarlık kullanılmaz.

## Ekranlar

- **İlk açılış** (`desktop/setup`): sadece stüdyo kurulur (Python, stüdyo paketleri, ffmpeg; yaklaşık 200 MB). Tek kart, tek ilerleme çubuğu.
- **Karşılama** (`web/js/views/onboarding.js`): tek soru, "DubKanka'yla ne yapmak istiyorsun?". Bir kontrol listesi: kendi sesinle dublaj (dahil), yazıya dök ve çevir, müziği ve efektleri koru, arkadaşlarla kaydet; her satırda gerçek indirme boyutu, altta toplam ve "Başla". Seçilenler arka planda iner; üst çubukta dolan bir halka (`.dlpill`) gösterir.
- **Özellik teklifi** (`.offer`, `feature-ui.js`): bir ekran yüklü olmayan bir özelliği kullanacaksa, ne kazandırdığını tek cümleyle söyler ve yerinde "Ekle · boyut" düğmesi sunar; inerken aynı yerde ilerleme gösterir.
- **Ayarlar:** solda sayfa listesi (Genel, Özellikler, Çeviri, Klasörler, Güncellemeler, Sistem), sağda o sayfa: yuvarlak kartlarda satırlar, solda etiket ve açıklama, sağda kontrol. Dişli düğmesi ayarlardayken × olur ve gelinen sayfaya döner; Esc de aynı şeyi yapar. Oda düğmesi de böyle çalışır.
- **Paylaş:** karar sırasıyla numaralı dört adım (1 Biçim, 2 Ses, 3 Altyazı, 4 Kalite). Altyazı stili ve teknik ayarlar kapalı gelir, isteyen açar. Sağda önizleme, altında düz yazıyla özet ve hap biçimli "Videoyu oluştur".

## İmza parçalar

- **Zaman kodu ekranı** (`.tc-lcd`): `--sunk` kuyu, içte kıl çizgisi, mono rakamlar; ayırıcılar daha sönük.
- **LED seviye göstergesi** (`.meter`): bölmeli; -18 dB'ye kadar yeşil, -6 dB'ye kadar sarı, üstü kırmızı. Tepe noktası 1 sn asılı kalır, 0 dB'yi geçince kırmızı "CLIP" yanar.
- **REC lambası** (`.tally`): kırmızı, dar yazıyla `REC`. Sadece kayıt sürerken yanar.
- **Kalem izi** (`.hl`): karakter adının arkasında, karakter renginde yarı saydam, hafif eğik bir fosforlu kalem şeridi. Senaryo, kabin ve oda ekranlarında aynı karakter aynı izi taşır.
- **Akış çizgisi** (kabin): kayıttan önce videonun üstünde soldan sağa geçen dikey çizgi; sağ kenara tam replik başladığında varır. Profesyonel dublajdaki "streamer".
- **Zaman çizelgesi:** şeritler kuyu renginde; klipler karakter renginde dolu, yuvarlak köşeli, içte kıl çizgisi. Seçili klip 2 px sarı çerçeve. Oynatma çizgisi beyaz, başında sarı bir işaret.
- **Adım çubuğu:** üst çubuğun ortasında tek bir hap; içinde beş adım numarasıyla, seçili adımın arkasında yayla kayan bir hap, numarası sarı dairede.

## Hareket

Animasyondan vazgeçmiyoruz, ama her animasyon bir durumu ya da yer değişimini anlatır. Süs için dönen, parlayan, nabız atan şey yok; sadece kayıt, iş ve indirme sürerken sürekli hareket var.

- **Eğriler:** `--ease-out` (0.16, 1, 0.3, 1) ana eğri, `--ease-in` çıkışlar için, `--spring` hafif taşmalı yay (kayan haplar, açma/kapama).
- **Süreler:** `--t-fast` 120 ms (basma, üzerine gelme), `--t` 200 ms (durum), `--t-slow` 300 ms (menü, panel), `--t-page` 420 ms (sayfa, yerleşim).
- **Sayfa geçişi:** View Transitions. Sayfa iş akışı yönünde kayar (`--vt-dir`), video resmi (`view-transition-name: viewer`) yeni yerine süzülür.
- **Kabin:** geri sayım halkası bip seslerine eş zamanlı, akış çizgisi, kayıt düğmesi daireden yuvarlak köşeli kareye döner, yeni kayıt listeye yayla düşer.
- **Göstergeler:** bütün seviye göstergeleri tek bir animasyon döngüsünden beslenir.

### Animasyon ayarı

Ayarlar → Genel → **Animasyonlar**: `Tam`, `Azaltılmış`, `Kapalı`. Seçim cihazda saklanır (`localStorage dk.motion`) ve `<html data-motion="…">` olarak uygulanır. İşletim sistemi "hareketi azalt" diyorsa varsayılan `Azaltılmış`.

| Seviye | Ne olur |
|---|---|
| `full` | Her şey açık. |
| `reduced` | Süreler yarıya iner. Kayma, büyüme ve yay hareketleri yerini kısa bir solmaya bırakır. Sayfa geçişi sadece çapraz solma. Kademeli liste girişi yok. |
| `off` | Geçiş ve animasyon yok (sadece yükleme göstergesi ve kayıt lambası çalışır). View Transitions hiç başlamaz. |

CSS'te süreler `calc(var(--m) * …)` ile yazılır: `full` için `--m: 1`, `reduced` için `0.5`, `off` için `0`. JavaScript tarafında `motion()` (`web/js/state.js`) aynı seviyeyi verir; `element.animate` çağrıları ondan önce bunu sorar.

## Yazı tonu

- Türkçe, kısa, düz. Ünlem, emoji, "Harika!" yok (WhatsApp davet mesajı hariç).
- Önce sade söz, teknik ad gerekirse yanında: kalite ayarları "Telefonda net, hızlı yüklenir" der, `CRF 18` teknik ayarlarda ve ipucunda durur.
- Ekranda sadece o an karar vermeye yarayan bilgi durur. Uzun açıklama `title` ipucuna ya da kapalı gelen bir bölüme gider.
- Boyutlar gerçek: indirme düğmesi ne kadar ineceğini yazar (`Ekle · 1.7 GB`).

## Kaçınılanlar

Degrade, cam efekti, neon parlama, ikon yerine emoji, başlık üstü küçük etiket, aynı boy ikonlu kart ızgarası, renkli kalın sol kenarlık, hap biçimli durum rozetleri, sert (bulanıklıksız) gölge, her yeri büyük harfle yazan etiketler, her şeyi ortalayan boş açılış ekranları, kapalı olması gerekirken açık gelen teknik ayarlar.
