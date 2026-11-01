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

**Karakter renkleri** (`dubkanka/projects.py`, `COLORS`): fosforlu kalem tonları. Hepsi aynı parlaklıkta, hiçbiri sarıya ya da kayıt kırmızısına yakın değil. Karakter rengi içerik içindir (klip, ad etiketinin noktası, renk noktası); arayüz durumu için kullanılmaz.

## Yazı

Tek aile: **IBM Plex** (`web/fonts`, SIL OFL). Türkçe karakterlerin hepsi var.

- **Arayüz:** `IBM Plex Sans` (değişken, `--font`). Temel 13 px, satır yüksekliği 1.5.
- **Dar hal** (`--cond`, `font-stretch: 80%`): sadece REC lambasında, "Konuş" işaretinde ve geri sayım yazısında. Karakter adları ve kontrol grubu başlıkları düz yazılır.
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
- **Durum rozeti yok.** Durum, 7 px yuvarlak bir lamba ve yanında düz yazıdır: `● işleniyor`, `● ayarlı`. Hap biçimli renkli rozet kullanılmaz. Yüklü bir özellik lamba değil, sakin bir tik ve kelimedir (`✓ Yüklü`): yanan yeşil nokta uyarı ışığı gibi okunuyordu (1 Kasım 2026).
- **Açılır liste** (`Select`): sistemin kendi `<select>` listesi uygulamaya yabancı duruyordu (1 Kasım 2026). Alan diğer girdiler gibidir, oku açılınca döner; liste menü yüzeyindedir (`.popover.listbox`), alanın altında (yer yoksa üstünde) açılır, seçili satır tikli ve ortada görünür. Ok tuşları, Home / End, Enter, Esc ve ilk harfleri yazmak çalışır. Uygulamada yerel `<select>` kalmadı.
- **İpucu** (`installTooltips`): her `title` uygulamanın kendi koyu küçük etiketiyle görünür (Windows'un sarımsı kutusu değil); kısa bir beklemeden sonra öğenin altında (yer yoksa üstünde) solarak gelir.
- **"?" yardımı** (`HelpTip`): kilitli ya da ilk bakışta anlaşılmayan bir şeyin satırının en sağında küçük yuvarlak bir "?" durur. Üzerine gelince ya da tıklayınca menü yüzeyinde başlık ("Neden seçilemiyor?"), bir iki cümle ve varsa çıkış yolu düğmesi ("Standart kaliteye geç") açılır. Kilitli seçeneğin kendisine tıklamak da aynı yardımı açar. Açıklama ekrana paragraf olarak yazılmaz; "?" arkasında bekler.
- **Gölge:** yumuşak ve yayvan; sadece yüzen katmanlarda (menü, pencere, bildirim: `--shadow-pop`) ve öne çıkan kartlarda (`--shadow-card`). Sıfır bulanıklıklı sert gölge yok.
- **Seçim:** seçilebilen öğe (biçim, kalite, özellik) yumuşak bir kutudur; seçilince sarı bir kıl çizgisi, hafif sarı zemin ve sağ üstte sarı daire içinde tik alır. Listelerde seçili satır yuvarlak köşeli bir vurgu alır; renkli kalın sol kenarlık kullanılmaz.

## Ekranlar

- **Açılış** (`desktop/setup`): her açılışta önce yeni sürüm sorulur ("Güncelleme kontrol ediliyor…"); varsa aynı kartta "DubKanka x.y.z indiriliyor", ilerleme çubuğu ve hayalet "Şimdilik atla" düğmesi; inince kendiliğinden kurulup yeni sürümle açılır. İlk kurulumda sadece stüdyo kurulur (Python, stüdyo paketleri, ffmpeg; yaklaşık 200 MB). Tek kart, tek ilerleme çubuğu.
- **Karşılama** (`web/js/views/onboarding.js`): tek soru, "DubKanka'yla ne yapmak istiyorsun?". İki grup: **Temel** (kendi sesinle dublaj; seçili ve kilitli, "Dahil") ve **Ek özellikler** (yazıya dök ve çevir, müziği koru, arkadaşlarla kaydet, kayıt temizleme; boş gelir, her satırda gerçek indirme boyutu). Altta toplam ve "Başla". Seçilenler arka planda iner; üst çubukta dolan bir halka (`.dlpill`) gösterir.
- **Özellik teklifi** (`.offer`, `feature-ui.js`): bir ekran indirilmemiş bir özelliği kullanacaksa, ne kazandırdığını tek cümleyle söyler ve tam orada "İndir · boyut" düğmesi sunar; inerken aynı yerde ilerleme gösterir. Ayarlar → Özellikler indirilebilen her şeyin listesidir.
- **Soru penceresi** (`.dialog`, `ask()`): silme gibi geri alınamayan işler uygulamanın içinde küçük, yumuşak bir kartla sorulur; tarayıcının ya da Windows'un kendi `confirm()` kutusu hiç kullanılmaz. Başlık soru cümlesi, altında tek satır sonuç, sağda "Vazgeç" ve eylem düğmesi (hap). Yıkıcı eylem kırmızı değil, hata uyarısının yumuşak tonunda (`.btn-destroy`); odak "Vazgeç"te başlar, Enter tek başına bir şey silmez. Esc ve dışarı tıklama iptal eder.
- **Kayıt → Mikrofon ayarları** (eski adı "Kabin"; arkadaşlar bulamıyordu, 1 Kasım 2026): yan paneldeki sekmenin adı "Mikrofon ayarları"; aynı yere mikrofon şeridinin sonundaki dişli düğmesi de götürür.
- **Mikrofon ayarları → Gürültü engelleme:** sesli sohbet uygulamalarındaki gibi bir segment kontrolü: Standart (tarayıcı), RNNoise (canlı, gömülü), DPDFNet (kayıttan sonra, Kayıt temizleme özelliği), Kapalı. Altında seçilenin ne yaptığını söyleyen tek satır; DPDFNet indirilmemişse orada özellik teklifi.
- **Ayarlar:** solda sayfa listesi (Genel, Özellikler, Çeviri, Klasörler, Güncellemeler, Sistem), sağda o sayfa: yuvarlak kartlarda satırlar, solda etiket ve açıklama, sağda kontrol. Dişli düğmesi ayarlardayken × olur ve gelinen sayfaya döner; Esc de aynı şeyi yapar. Oda düğmesi de böyle çalışır. **Genel** insanların en çok aradığı şeyleri toplar: Dil (Türkçe / English) ve Animasyonlar; özelliklerin tek satırlık listesi (durum ya da "İndir · boyut"); kayıtlarda görünen ad ve yeni sahnelerin dublaj dili.
- **Mikser → sessiz bölgeler:** Fon ya da Ortam izinde bir yere konuşma karışmışsa izin üstünde sürüklenir, seçilen aralığın ortasında "Sustur" çıkar; susturulan aralık izin üstünde koyu taralı bir blok olur, klip gibi taşınır ve uzatılır, seçince "Sesi geri aç" (ya da Delete). Bir satıra tıklayınca incelemede "Bu satırın altında: Ortam sesini sustur / Fonu sustur" anahtarları durur. Kenarlar 30 ms'de yumuşar; önizleme ve dışa aktarma aynı kuralla susturur (`engine.js` `scheduleMutes`, `mixer.py` `mute_envelope`).
- **Paylaş:** karar sırasıyla numaralı dört adım (1 Biçim, 2 Ses, 3 Altyazı, 4 Kalite). Kalite seçenekleri platform adı taşımaz ve "önerilen" etiketi yoktur: Kaynak kopyası, Yüksek kalite, Standart, Küçük dosya; her biri ne kazandırıp neye mal olduğunu tek cümleyle söyler. **Varsayılan Kaynak kopyası** (kullanıcının isteği, 1 Kasım 2026: görüntü yeniden kodlanıp bozulmasın). Kaynak kopyasında yapılamayan şeyler gizlenmez, kilitlenir: 9:16 ve kare kartları kesikli çerçeve ve küçük kilitle durur, "Videonun üstüne yazılsın" sönük kalır; ikisinin satırının en sağında "?" nedenini söyler ve "Standart kaliteye geç" sunar. Anahtar kare yüzünden video seçilen yerden önce başlıyorsa Kalite'nin altında tek satır ve "?" bunu söyler. Altyazı stili ve teknik ayarlar kapalı gelir, isteyen açar. Sağda önizleme, altında düz yazıyla özet (codec ayrıntısı ipucunda) ve hap biçimli "Videoyu oluştur".

## İmza parçalar

- **Zaman kodu ekranı** (`.tc-lcd`): `--sunk` kuyu, içte kıl çizgisi, mono rakamlar; ayırıcılar daha sönük.
- **LED seviye göstergesi** (`.meter`): bölmeli; -18 dB'ye kadar yeşil, -6 dB'ye kadar sarı, üstü kırmızı. Tepe noktası 1 sn asılı kalır, 0 dB'yi geçince kırmızı "CLIP" yanar.
- **REC lambası** (`.tally`): kırmızı, dar yazıyla `REC`. Sadece kayıt sürerken yanar.
- **Ad etiketi** (`.hl`): karakter adı, karakter renginin soluk bir zemininde, aynı rengin açık tonunda yazılır; köşeleri 7 px yuvarlak küçük bir etiket. Senaryo, kabin, mikser ve oda ekranlarında aynı karakter aynı etiketi taşır; senaryoda etiketin kendisi satırı başka karaktere veren düğmedir (yanında küçük ok). Kabin satır listesinde etiket yerine satır numarası karakter renginde yazılır; mikser izlerinde rengi izin solundaki ince çizgi taşır. (Fosforlu kalem şeridi net okunmuyordu, 31 Ekim 2026'da kaldırıldı; yerine gelen renkli nokta da ucuz durdu, 1 Kasım 2026'da kaldırıldı.)
- **Senaryo satırı:** sadece gereken: numara, ad etiketi, orijinal (küçük, sönük), dublaj (büyük, yazılabilir). Zaman kodu ve süre zaman çizelgesinde ve numaranın ipucunda durur; uygunluk lambası yok, sadece dublaj belirgin uzunsa turuncu "uzun" yazar; kaydı olan satırda küçük yeşil tik. Dinle / kaydet düğmeleri üzerine gelince ya da satır seçiliyken görünür.
- **Akış çizgisi** (kabin): kayıttan önce videonun üstünde soldan sağa geçen dikey çizgi; sağ kenara tam replik başladığında varır. Profesyonel dublajdaki "streamer".
- **Zaman çizelgesi:** şeritler kuyu renginde; klipler karakter renginde dolu, yuvarlak köşeli, içte kıl çizgisi. Seçili klip 2 px sarı çerçeve. Oynatma çizgisi beyaz, başında sarı bir işaret.
- **Adım çubuğu:** üst çubuğun ortasında tek bir hap; içinde beş adım numarasıyla, seçili adımın arkasında yayla kayan bir hap, numarası sarı dairede.

## Hareket

Animasyondan vazgeçmiyoruz, ama her animasyon bir durumu ya da yer değişimini anlatır ve hepsi aynı dilbilgisine uyar (`web/css/motion.css` başındaki not). Kullanıcı 31 Ekim 2026'da "tutarlılık yok, bir yer açılıyormuş gibi oluyor" dedi: sebep, sayfa yana kayarken içindeki her şeyin ayrıca yukarı süzülmesiydi. Kural artık şu:

| Ne oluyor | Nasıl hareket eder |
|---|---|
| Yer değişiyor (ana sayfa, bir adım, ayarlar, oda) | Sayfa tek parça halinde, geldiği yönden kayarak gelir (yeni sayfa 36 px, eskisi 24 px; 380 ms, `--ease-page`). Üst çubuk hiç kıpırdamaz. Eski ve yeni sayfa aynı süre ve eğriyle karışır, saydamlıkları hep toplam bire eşittir: iki sayfada ortak olan yer (panel kenarları) yerinde durur, arkadan pencere görünmez. |
| Başka bir ayar sayfası | Kenar çubuğu yerinde durur, seçim hapı yeni satıra yayla kayar; sayfanın kendisi listede bulunduğu yönden dikey kayarak gelir (aşağı inerken alttan, yukarı çıkarken üstten). |
| Aynı yerin içinde sekme değişiyor (kabindeki Satırlar / Kabin) | Kaymaz; içerik yerinde çapraz geçiş yapar. |
| Bir şey açılıyor (açılır bölüm, servis satırı, teknik ayarlar, yazı stili) | Hep aynı `drop`: hafif yukarıdan yerine oturur, 200 ms. |
| Açık sayfaya yeni bir şey geliyor (yeni kayıt, yeni video, bildirim, oda açılınca link ve PIN) | Yayla düşer (`take-in`). Sadece gerçekten yeni olan; sayfa açılınca zaten orada olanlar kıpırdamaz. |
| Seçim değişiyor (adım çubuğu, segment kontrolü) | Hap yayla kayar. |
| İş sürüyor (kayıt, indirme, işlem) | Sürekli hareket: sadece bunlar döner, yanıp söner. |
| Bir iş adım adım ilerliyor (sahne hazırlığı) | Adımlar tek bir rayda: biten adım yayla yeşil tike oturur, ray aynı eğri ve sürede (520 ms) bir sonraki adıma dolar, o adım ancak ray ona varınca döner: dönen bir yay ve içinde yavaşça nefes alan bir çekirdek. Hiçbir şey kesik kesik yanıp sönmez. |
| Dil değişiyor | Bütün pencere, üst çubuk dahil, yerinde çapraz geçiş yapar; hiçbir şey kaymaz. |

Bir sayfa gelirken içindeki satırlar, kartlar ve klipler kendi başına animasyon yapmaz. Tek istisna ilk karşılama ekranı: uygulamanın tek "an"ı.

- **Eğriler:** `--ease-out` (0.16, 1, 0.3, 1) ana eğri, `--ease-in` çıkışlar için, `--spring` hafif taşmalı yay (kayan haplar, açma/kapama, yeni gelenler).
- **Süreler:** `--t-fast` 120 ms (basma, üzerine gelme), `--t` 200 ms (durum, açılma), `--t-slow` 300 ms (menü, pencere), `--t-page` 380 ms (sayfa). Sayfa eğrisi `--ease-page` (0.25, 0.75, 0.25, 1) kontrol eğrisinden yumuşaktır: kayma görülür, göz kırpması gibi geçmez.
- **Geçiş atlanmaz:** ağır bir sayfanın (uzun senaryo, kabin) resmi birkaç kare sürebilir; geçiş sadece pencere gerçekten çizmiyorsa (küçültülmüş, donmuş) 900 ms sonra atlanır. Kullanıcı 31 Ekim 2026'da "senaryodan geçerken animasyon yok" dedi: sebep 250 ms'lik bekçinin ağır sayfalarda geçişi iptal etmesiydi.
- **Video resmi** (`view-transition-name: viewer`) adımlar arasında yeni yerine sayfayla aynı saatte süzülür.
- **Kabin:** geri sayım halkası bip seslerine eş zamanlı, akış çizgisi, kayıt düğmesi daireden yuvarlak köşeli kareye döner, yeni kayıt listeye yayla düşer, konuşan karakter değişince ad etiketinin noktası yayla belirir.
- **Soru penceresi:** arka plan solarak, kart yayla hafif büyüyerek gelir; kapanırken 150 ms'de söner.
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

- Türkçe ve İngilizce, ikisi de kısa ve düz. Ünlem, emoji, "Harika!" yok (WhatsApp davet mesajı hariç).
- **İki dil** (1 Kasım 2026): kod Türkçe yazılır; `t('…')` (arayüz, `web/js/i18n.js` + `web/js/lang/en.js`), `tx("…")` (sunucu, `dubkanka/i18n.py` + `lang_en.py`) ve kabuğun `t()`'si (`desktop/lib/i18n.js`, `desktop/setup/setup.js`) aynı Türkçe metni İngilizce sözlükte arar. Sunucu, isteği gönderen sayfanın dilinde konuşur (`X-DK-Lang`); bir iş, onu başlatan isteğin dilinde. Aynı Türkçe kelimenin iki İngilizcesi varsa anahtar bağlam taşır (`rec|Kaydet` → Record, `Kaydet` → Save). Her sürümden önce `python scripts/check-i18n.py` çalışır: eksik, fazla, yer tutucusu tutmayan çeviri ya da `t()` dışında kalmış Türkçe sıfır olmalı. İngilizce de aynı tonda: "Mute", "Bring the sound back", "Why can't I pick this?".
- Önce sade söz, teknik ad gerekirse yanında: kalite ayarları "İyi görüntü, orta boy dosya" der, `CRF 18` teknik ayarlarda ve ipucunda durur. Platform adı (TikTok, Reels) seçenek adı ya da öneri olmaz.
- **Gereksiz bilgi yok** (kullanıcının açık isteği, 31 Ekim 2026: "gereksiz bilgilerin hepsini kaldır, sevmiyorum"). Ekranda sadece o an karar vermeye yarayan bilgi durur: açıklayıcı paragraf, alt başlık, kısayol şeridi, "nasıl çalışıyor" kutusu, sistem bilgisi satırı yok. Bir ayarın altında ancak yanlış anlaşılırsa zarar verecekse tek kısa satır durur ("Sadece kulaklıkla."). Uzun açıklama `title` ipucuna gider.
- Boyutlar gerçek: indirme düğmesi ne kadar ineceğini yazar (`İndir · 1.7 GB`).

## Kaçınılanlar

Degrade, cam efekti, neon parlama, ikon yerine emoji, başlık üstü küçük etiket, aynı boy ikonlu kart ızgarası, renkli kalın sol kenarlık, hap biçimli durum rozetleri, sert (bulanıklıksız) gölge, her yeri büyük harfle yazan etiketler, her şeyi ortalayan boş açılış ekranları, kapalı olması gerekirken açık gelen teknik ayarlar, isimlerin arkasında boya / kalem izi, sistemin kendi `confirm()` / `alert()` kutuları, `<select>` listeleri ve sarı `title` ipuçları, ekrana açıklama paragrafları, isimlerin yanındaki renkli noktalar, "yapay zeka" pırıltısı ya da sihirli değnek ikonları, sayfayı yeniden yükleyen dil değişimi, linkleri ve resimleri pencereden dışarı sürükleme (adresiyle bir hayalet bırakıyordu).

## Sağlamlık kuralları

- **Kaydırılmayan kap kaydırılamaz:** paneller ve kartlar `overflow: clip` kullanır, `hidden` değil. `hidden` bir kap odak ya da `scrollIntoView` ile kodla kaydırılabilir ve içeriği geri getirilemez biçimde kayar (kabinde rollerin ve Satırlar / Kabin sekmesinin bir anahtara tıklayınca kaybolması buydu). Gizli onay kutusu (`.toggle input`) etiketinin içinde konumlanır.
- **Liste içinde gösterme:** bir satırı görünür yapmak için `revealInList` (`util.js`): sadece satırın kendi listesini kaydırır, sayfayı ve panelleri hiç oynatmaz.
- **Kaydırılan sütunun çocukları büzülmez:** `.pane-scroll > * { flex-shrink: 0 }`; yoksa açılan bir bölüm (paylaşta teknik ayarlar) kendi içine sıkışır ve alta inilemez.
