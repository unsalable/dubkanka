# DubKanka tasarım sistemi

Klasik video editörü görünümü. Resim ekrandaki en parlak şey olsun diye nötr grafit kullanılıyor. Tek vurgu rengi mavi; kırmızı sadece kayıt (REC) için. Tüm değerler `web/css/app.css` içindeki `:root` değişkenlerinde.

## Renk

| Değişken | Değer | Kullanım |
|---|---|---|
| `--bg` | `#0d0d0f` | Pencere zemini, üst çubuk |
| `--panel` | `#17171a` | Paneller (`.pane`, `.panel`) |
| `--sunk` | `#111113` | Girdi alanları, zaman çizelgesi şeritleri |
| `--raised` / `--raised-2` | `#1f1f23` / `#29292e` | Düğmeler; üzerine gelme ve basılı hali |
| `--line` / `--line-2` | `#2a2a2f` / `#38383f` | İnce çizgiler, kontrol kenarlıkları |
| `--text` / `--text-2` / `--text-3` | `#ededef` / `#a9a9b1` / `#8b8b93` | Metin, ikincil metin, ipucu |
| `--accent` | `#1a66e6` | Dolu ana düğme (beyaz yazıyla 5.1:1 kontrast) |
| `--accent-text` | `#6ea8ff` | Bağlantı, odak halkası, seçim, kaydırıcı dolgusu |
| `--rec` | `#ff453a` | Sadece kayıt düğmesi, KAYIT rozeti, "Konuş" işareti |
| `--ok` / `--warn` / `--bad` | `#34c759` / `#ffb340` / `#ff5a4f` | Durum renkleri |

**Karakter (klip) renkleri** `dubkanka/projects.py` içindeki `COLORS` listesinde: `#3bb4c1`, `#e3a13b`, `#a07cf0`, `#6bbf4e`, `#e66b93`, `#cdbd3d` ve devamı. Hepsinin parlaklığı eşit; hiçbiri vurgu mavisine ya da kayıt kırmızısına yakın değil. Eski Tailwind paleti projeler yüklenirken bire bir yeni renklere çevriliyor.

## Yazı

- **Arayüz:** sistem yazısı. Windows'ta `Segoe UI Variable Text` ve `Display`, telefonlarda SF Pro ve Roboto.
- **Boyutlar:** temel 13 px. Başlıklar 22, 16 ve 13 px; yükseklik 650 ile 700.
- **Zaman kodu, PIN, dosya yolu:** `--mono` (Cascadia Mono / SF Mono) ve tablo rakamları (`.tc`, `.mono`).

## Biçim

- **Köşeler:** 5, 7 ve 10 px (`--r-sm`, `--r`, `--r-lg`).
- **Kontrol yükseklikleri:** 32 px; küçükleri 26 px, büyükleri 40 px.
- **Paneller:** editör bölgeleri `.pane` ile kuruluyor (`.pane-head` 42 px, `.pane-body`, `.pane-scroll`). Paneller arası boşluk 8 px.
- **Gölge:** yalnızca açılan katmanlarda (`--shadow-pop`: açılır menü, bildirim, pencere).
- **Zaman çizelgesi:**
  - Klipler karakter rengiyle doluyor ve 1 px iç kenarlık alıyor.
  - Seçili klip 2 px beyaz kenarlıkla gösteriliyor.
  - Oynatma çizgisi beyaz ve başında bir işaret var.
  - Her izin başlığında canlı ses seviyesi çubuğu (`BusMeter`) duruyor.

## Hareket

- **Eğriler:** `--ease-out` (0.16, 1, 0.3, 1) ana eğri; giriş eğrisi `--ease-in`. Geçiş yayı (`--spring`), `linear()` ile yazılmış hafif taşmalı bir eğri.
- **Süreler:** 120 ms geri bildirim, 200 ms durum değişimi, 360–460 ms sayfa ya da yerleşim değişimi.
- **Sayfa geçişi:** View Transitions API kullanılıyor (`state.js` içindeki `transition()`).
  - Sayfa iş akışı yönünde kayıyor (`--vt-dir`).
  - `view-transition-name: viewer` taşıyan video resmi yeni yerine süzülüyor. Bu ad şunlarda var: proje kartı küçük resmi, `.videopane`, hazırlık küçük resmi, dışa aktarma çerçevesi.
- **Sürekli göstergeler:** sekme ve bölmeli kontrol göstergeleri kayıyor (`useIndicator`). Ses seviyesi göstergelerinin hepsi tek bir animasyon döngüsünden besleniyor.
- **Kayıt anı:**
  - 3-2-1 geri sayım halkası bip seslerine eş zamanlı ilerliyor.
  - Kayıt düğmesi daireden yuvarlak köşeli kareye dönüşüyor.
  - Yeni kayıt listeye yaylı bir hareketle düşüyor.
- **Hareket azaltma:** `prefers-reduced-motion` açıksa animasyonlar anında bitiyor; sadece dönen yükleme göstergeleri çalışıyor. Sayfa geçişi de atlanıyor.
