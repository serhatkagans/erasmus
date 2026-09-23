# E-YOUTHPRENEUR Platformu

Erasmus+ KA220-YOU işbirliği ortaklığı **E-YOUTHPRENEUR** (Form No.
KA220-YOU-70AE2506) için proje platformu: projeyi tanıtır, 24 aylık etkinlik
programını yürütür, ülke ekiplerini ve görevleri izler, ortak kurumlardan
form ile bilgi toplar.

## Çalıştırma

```
npm ci            # bağımlılıkları kilit dosyasına göre kurar
npm start          # http://localhost:3020
```

Node.js 24 veya üzeri gerekir. Yerelde veritabanı sunucusu kurulumu gerekmez:
`data/eyouthpreneur.sqlite` dosyası açılır ve başvuru formundaki 14 resmî
aktivite ilk açılışta kendiliğinden yüklenir. Yerel çalışma kopyasında
`baslat.bat` da kullanılabilir.

Sunucuda PostgreSQL için `DATABASE_URL` tanımlamak yeterlidir; şema aynı
koddan kurulur. Ayarlar için `.env.example` dosyasına bakın.

## Git sürümleri

Depo: [serhatkagans/erasmus](https://github.com/serhatkagans/erasmus), ana dal
`main`. Sürümler `package.json` ile aynı numarayı taşıyan açıklamalı
`vBÜYÜK.KÜÇÜK.YAMA` Git etiketleriyle tutulur. Hata düzeltmeleri yama, geriye
uyumlu özellikler küçük, geriye uyumsuz değişiklikler büyük sürümü artırır.
İlk Git sürümü `v0.1.0`'dır. Etiketler `git tag -n` ile listelenebilir.

Takvim uygulamasındaki kurala göre ayrıntılı `SURUMLER.md`, yerel çalışma ve
dağıtım dosyaları depoya girmez. Veritabanları, `.env`, kullanıcı verileri
ve kaynak başvuru belgeleri de yerelde kalır.

## Formlar

Koordinatör form hazırlar, ortak kurumlar doldurur — GençTek takvimindeki
form modülünün bu projeye taşınmış hâli (`lib/forms.mjs`, `routes/form.mjs`,
`public/formlar.js`). Dokuz soru türü ve bölüm, biçimli başlık/açıklama,
kapak görseli, dosya yükleme, otomatik taslak kaydı, hedef kitle seçimi,
özet grafikleri ve Excel çıktısı.

İki kuralı bilmek yeter:

- **Soru kimliği kalıcıdır.** Yanıtlar soru kimliğiyle saklanır; soru
  sırası değişse, başlığı düzeltilse ya da araya soru eklense bile eski
  yanıtlar doğru soruya bağlı kalır. Yanıt almış sorunun TÜRÜ
  değiştirilemez; silinirse atılmaz, "kaldırıldı" işaretlenip raporda kalır.
- **Yanıt kişi başınadır** ve form açık kaldığı sürece düzeltilebilir.

## Test

```
npm test
```

Bağımlılık yok: `node --test` çalışır, saniyenin altında biter. İki katman
var ve ikisi bilerek ayrı duruyor:

- **Saf testler** (`tests/data`, `tests/belge`, `tests/db`) kural
  dosyalarını doğrudan çağırır: doğrulama, belge/rapor metin üreticileri,
  şema. Hiçbir sunucu açılmaz.
- **Uçtan uca testler** (`tests/yetki`) GERÇEK SUNUCUYU geçici bir
  veritabanıyla başlatıp `fetch` ile konuşur. Yetki tek bir işlevde
  durmuyor — oturum, CSRF denetimi, route ve doğrulama birlikte karar
  veriyor; işlevleri tek tek çağırmak "bu istek geçer mi" sorusunu
  sormamak olurdu.

Testler geliştirme verisine dokunmaz: her sunucu kendi geçici `DATA_DIR`
dizinini alır ve iş bitince siler.

## Hesaplar

Hesaplar komut satırından açılır — yedi ortağın hesabı proje başında bir kez
kurulur:

```
node scripts/kullanici.mjs listele
node scripts/kullanici.mjs ekle <kullanici> <kurum> <parola> [--koordinator] [--ad "Ad Soyad"]
node scripts/kullanici.mjs parola <kullanici> <yeni-parola>
node scripts/kullanici.mjs sil <kullanici>
```

Kurum kodları: `hbv`, `unisalento`, `geoclub`, `cecf`, `bte`, `educpro`,
`po2050`. Parola en az 12 karakter olmalıdır.

**Yetki modeli.** `--koordinator` bayrağı taşıyan hesap tüm kurumlar adına
işlem yapar. Ortak hesabı yalnızca kendi kurumunun kayıtlarına dokunur.
Platform giriş gerektirir; oturumsuz ziyaretçiler giriş ekranına yönlendirilir.
NFC profil kartları dışarıya açıktır. Ekip üyeleri aynı kurumun kayıtlı
kullanıcı hesaplarından seçilir.

## Bölümler

| Sayfa | Ne yapar |
| --- | --- |
| `pano.html` | Kurumun yaklaşan işleri, gecikmeleri, bekleyen formları ve eksik faaliyet dosyaları; koordinatör için genel durum |
| `ciktilar.html` | Yedi proje çıktısı, sorumlu ve teslim takibi, dillere göre dosya sürümleri |
| `index.html` | Proje tanıtımı, sayaçlar, ilerleme çubuğu, yaklaşan etkinlikler, hedefler, çıktılar, iş paketleri, ortak kurumlar |
| `takvim.html` | Etkinlik programı: gün ızgarası, 24 aylık zaman çizelgesi, liste; filtreler, etkinlik ekleme/düzenleme, fotoğraf, faaliyet raporu |
| `ekip.html` | Ülke ekipleri ve görev panosu |
| `formlar.html` | Koordinatörün hazırladığı, ortakların doldurduğu formlar |
| `belge.html` | Katılım ve teşekkür belgeleri: kayıtlı ekip ve kurumlardan seçim, yazdırma |

## Mimari

Çerçeve yok: `node:http` sunucusu, tarayıcıda ES modülleri. Üst klasördeki
GençTek takvim uygulamasıyla aynı yaklaşım, aynı iki arka uçlu veritabanı
katmanı (SQLite / PostgreSQL, tek sorgu biçimi).

```
lib/      ayar, veri modeli ve doğrulama, veritabanı, çeviri, ICS, HTTP,
          rapor (Word), excel (XLSX), zip, belge (katılım/teşekkür)
routes/   oturum, etkinlik (+fotoğraf), ekip/görev, form, rapor, belge
locales/  dil sözlükleri — tr.json dolu, diğerleri iskelet
public/   sayfalar, betikler, stil, logo, AB amblemi
scripts/  komut satırı araçları
```

### Çok dillilik

Arayüzde metin yoktur, **çeviri anahtarı** vardır:

```html
<h1 data-t="anasayfa.baslik"></h1>
<input data-t-yer="takvim.ara.ipucu">   <!-- placeholder -->
```

Yeni bir dil eklemek iki adımdır:

1. `locales/<kod>.json` dosyasını `tr.json` anahtarlarıyla doldurun.
2. `lib/data.mjs` içindeki `languages` listesinde o dili `ready: true` yapın.

Şablonlara, route'lara ve veritabanı şemasına dokunulmaz. Eksik anahtarlar
sessizce boş görünmez; Türkçe karşılığı kullanılır ve
`GET /api/ceviri-durumu` her dilin ne kadar tamamlandığını raporlar.

Dil seçimi sırasıyla `?dil=` parametresi, çerez, tarayıcının
`Accept-Language` başlığı ve Türkçe olarak çözülür.

### Faaliyet raporu

Takvim sayfasındaki **Faaliyet raporu** düğmesi seçilen dönemin programını
indirir (`GET /api/rapor`):

| Biçim | İçerik |
| --- | --- |
| `docx` | Künye bandı, sayaçlar, program tablosu, iş paketi/tür/kurum/yer dağılımı, etkinlik ayrıntıları; altbilgide finansman ibaresi, sonda sorumluluk reddi |
| `xlsx` | Her satır bir etkinlik; tarihler gerçek Excel tarihi, başlık satırı sabit ve süzgeçli |
| `zip` | Dönemdeki etkinliklerin fotoğrafları, etkinlik başına klasör + `icindekiler.txt` |

Belge **isteğin dilinde** üretilir: sözlük sunucuda çözülür, çünkü resmî
aktivitelerin başlığı veritabanında değil `locales/*.json` içindedir. Dil
değiştirip yeniden indirmek, aynı raporu ortakların dilinde verir.

Dönem, takvimdeki süzgeçler ve aramayla eşleşip işaretli bırakılan kayıtlar
rapora doğrudan yansır. Belgeler npm paketi olmadan, elle yazılan OOXML ve
yerleşik `zlib` ile üretilir (`lib/zip.mjs`). Rapor giriş ister: kimin
ürettiği belgenin altbilgisinde yazar.

### Katılım ve teşekkür belgeleri

`belge.html` sayfası belgeyi **kayıtlı listelerden seçerek** üretir: her ortak
kurumun ekibi (`team` tablosu), kurumun kendisi ve — listede olmayan konuşmacı
ya da destek veren için — serbest yazılan adlar. Bir etkinliğe bağlamak
**isteğe bağlıdır**: koordinatör proje geneline de, istediği zaman belge
üretebilir.

Metin sunucuda ve isteğin dilinde kurulur (`GET /api/belge`); ad
veritabanından çözülür, adresten değil. Belge tarayıcının yazdırma ekranından
"PDF olarak kaydet" ile indirilir; tek yazdırma işlemi tüm belgeleri tek PDF
dosyasında toplar (A4 yatay, sayfa başına bir belge).

Yetki: koordinatör her kuruma, ortak hesabı yalnızca kendi kurumunun ekibine
ve kendi kurumuna belge üretir. İmzalayanın adı her üretimde elle yazılır —
belgeyi hazırlayan ile imzalayan makam aynı kişi olmayabilir.

Belge veritabanında **tutulmaz**: her istekte kayıtlardan üretilir. Ayrı bir
tablo aynı bilgiyi ikinci kez saklardı ve kişinin adı düzeltildiğinde eski
belge eski adı göstermeye devam ederdi.

### Resmî program

Başvuru formundaki 14 aktivite `lib/tohum.mjs` içindedir ve veritabanına
`resmi=1` ile yazılır. Bu kayıtlar projenin taahhüdüdür:

- silinemezler (koordinatör dahil) — yalnızca "Ertelendi" durumuna alınabilir;
- lider ortak yalnızca **durum** ve **bağlantı** alanlarını günceller;
- ad, tarih ve lider yalnızca koordinatör tarafından değiştirilebilir.

Başlık ve özetleri sözlükten (`etkinlik.<slug>.baslik`) okunur, böylece dil
değişince resmî program da doğru dilde görünür. Ortakların eklediği yerel
etkinlikler bu kurallara tabi değildir.

## Güvenlik notları

- Parolalar rastgele tuzla `scrypt` ile özetlenir; karşılaştırma
  `timingSafeEqual` ile yapılır.
- Oturum jetonunun yalnızca SHA-256 özeti saklanır.
- Yazma isteklerinde `Origin` başlığı denetlenir (CSRF).
- Giriş denemeleri kullanıcı+adres ve adres bazında ayrı ayrı sınırlanır.
- Yüklenen görselin türü **baytlarından** çıkarılır; SVG kabul edilmez.
- İçerik Güvenliği Politikası dış kaynak yüklenmesine izin vermez.
