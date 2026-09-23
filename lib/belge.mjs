import { ValidationError, partnerOf } from './data.mjs';

/**
 * Katılım ve teşekkür belgesi kuralları.
 *
 * GençTek'teki belge yolundan uyarlandı. İKİ ŞEY BİLEREK DEĞİŞTİ:
 *
 *   · ÖN KOŞUL KAPISI KALDIRILDI. Orada belge, etkinlik raporu yazılmadan ve
 *     kişi yoklamada "geldi" işaretlenmeden üretilemiyordu; belge bir
 *     katılımın kanıtıydı ve kişinin profiline katılım düşürüyordu. Burada
 *     öyle bir bağ yok: ortaklık 24 aylık bir proje, ekipler belli ve
 *     koordinatör belgeyi ETKİNLİKTEN BAĞIMSIZ olarak, istediği zaman
 *     üretebilmeli (ör. proje sonunda ekibe toplu katılım belgesi).
 *
 *   · ALICI SERBEST METİN DEĞİL, LİSTEDEN gelir. Ülkeler ve kişiler zaten
 *     kayıtlı (ortak kurumlar + `team` tablosu); ad elle yazıldığında yazım
 *     hataları belgeye geçer ve aynı kişi iki farklı adla belgelenir.
 *     Listede olmayan konuşmacı/destekçi için serbest ad yine mümkün — o
 *     kişinin kaydı yoktur ve olması da beklenmez.
 *
 * Belge VERİTABANINDA TUTULMAZ: her istekte kayıtlardan üretilir. Ayrı bir
 * tablo aynı bilgiyi ikinci kez saklayıp güncel tutma zorunluluğu doğururdu —
 * kişinin adı düzeltildiğinde eski belge eski adı göstermeye devam ederdi.
 *
 * Saf tutulur: veritabanına bakmaz, metni sözlükten kurar (bkz. lib/i18n.mjs).
 */

export const belgeTurleri = ['katilim', 'tesekkur'];
export const belgeTuruMu = deger => belgeTurleri.includes(deger);

/**
 * Tek yazdırma işleminde üretilebilecek azami belge sayısı.
 *
 * Sınırın nedeni tarayıcı: her belge tam bir A4 sayfası demek ve yazdırma
 * önizlemesi birkaç yüz sayfada donuyor. Sunucuda bir maliyeti yok, bu yüzden
 * sınır sorguda değil burada.
 */
export const MAX_BELGE = 200;

const AD_MAKS = 120;
const UNVAN_MAKS = 120;
const OZEL_METIN_MAKS = 1200;

/** Bağlantısız boşluk (U+00A0): tarayıcı buradan satır kırmaz. */
const BOLUNMEZ = ' ';

/**
 * Tarihi BÖLÜNMEZ yapar: "15 Aralık 2026" satır sonunda ikiye ayrılmasın —
 * "15" üst satırda, "Aralık 2026" alt satırda kalmasın. GençTek'te aynı
 * sorun yaşanmış ve çözüm oradan alındı.
 */
const tarihiBolunmezYap = tarih => String(tarih).trim().replace(/\s+/g, BOLUNMEZ);

/**
 * Belge alıcısının adını doğrular.
 *
 * Listeden gelen adlar VERİTABANINDAN çözülür (bkz. routes/belge.mjs);
 * buraya yalnızca son temizlik için uğrarlar. Serbest yazılan ad da aynı
 * kurallardan geçer.
 */
export function aliciAdiniCoz(ham) {
  const ad = String(ham ?? '').trim().replace(/\s+/g, ' ');
  if (!ad) throw new ValidationError('belge.hata.alici');
  if (ad.length > AD_MAKS) throw new ValidationError('belge.hata.adUzun');
  return ad;
}

/**
 * İmza bloğunu doğrular.
 *
 * AD ZORUNLU: imzasız bir katılım belgesi resmî olarak işe yaramaz ve boş
 * geçilmesine izin vermek, farkına varılmadan imzasız belge dağıtılmasına yol
 * açardı. Unvan boş bırakılabilir — o zaman önerilen unvan kullanılır
 * (koordinatör kurumun projedeki sıfatı).
 *
 * İmza OTURUM KİŞİSİNDEN GELMEZ: belgeyi hazırlayan kişi ile imzalayan makam
 * aynı olmayabilir. GençTek'te bu bir kez oturumdan alınmış ve geri
 * alınmıştı; aynı hatayı tekrarlamıyoruz.
 */
export function imzaBilgisiniCoz({ ad, unvan, varsayilanUnvan }) {
  const adSoyad = String(ad ?? '').trim().replace(/\s+/g, ' ');
  if (!adSoyad) throw new ValidationError('belge.hata.imza');
  if (adSoyad.length > AD_MAKS) throw new ValidationError('belge.hata.adUzun');

  const sifat = String(unvan ?? '').trim().replace(/\s+/g, ' ') || String(varsayilanUnvan ?? '');
  if (sifat.length > UNVAN_MAKS) throw new ValidationError('belge.hata.unvanUzun');
  return { adSoyad, unvan: sifat };
}

export function ozelMetniCoz(ham) {
  const metin = String(ham ?? '').trim();
  if (metin.length > OZEL_METIN_MAKS) throw new ValidationError('belge.hata.metinUzun');
  return metin;
}

/**
 * Belge metnini üretir.
 *
 * GÖVDE İKİ KALIPTAN BİRİDİR: etkinlik seçilmişse "şu tarihte yapılan şu
 * etkinliğe", seçilmemişse projenin kendisine. İkincisi bu projeye özgü ve
 * asıl istenen: koordinatör, bir etkinliğe bağlı olmadan da belge
 * üretebilmeli.
 *
 * KAPANIŞ TÜRE GÖRE AYRIDIR ve ortaklaştırılmamalıdır: katılım belgesi
 * yalnızca orada bulunmayı belgeler, teşekkür belgesi destek verene yazılır.
 * GençTek'te bir kez ortaklaştırılıp aynı gün geri alınmıştı — ortak cümle
 * katılım belgesinde olmayan bir şeyi ("desteğiniz") söylüyordu.
 *
 * TARİH KENDİ SATIRINDA başlar ve bölünmez; satır sonu belgede korunur
 * (bkz. public/belge.css · white-space: pre-line).
 */
export function belgeMetniUret({ tur, ad, altAd = '', etkinlik = null, ozelMetin = '', t }) {
  const govde = ozelMetin
    ? ozelMetin
    : etkinlik
      ? t(`belge.govde.${tur}.etkinlik`, { tarih: tarihiBolunmezYap(etkinlik.tarih), etkinlik: etkinlik.baslik })
      : t(`belge.govde.${tur}.proje`);

  return { tur, baslik: t(`belge.tur.${tur}`), ad, altAd, govde };
}

/**
 * Belge basılacak kişileri belirler.
 *
 * `adaylar` kayıtlı ekip üyeleri ve ortak kurumlardır; istenen kimlikler
 * DAİMA bu listeyle kesiştirilir — adres çubuğuna elle kimlik yazan biri
 * listede olmayan birine belge bastıramasın. Serbest yazılan adlar bu
 * kesişimin dışındadır: onların kaydı zaten yoktur.
 *
 * Sıra öngörülebilir olmak zorunda: basılan deste elle dağıtılırken listeyle
 * eşleşmeli. Sıralama seçili dile göre yapılır — Türkçede "ı" harfi "i"den
 * öncedir, varsayılan sıralama bunu bilmez.
 */
export function topluAlicilariSec({ adaylar, istenenler, serbest = [], dil = 'tr' }) {
  const secilen = adaylar.filter(aday => istenenler.includes(aday.anahtar));
  const hepsi = [...secilen, ...serbest].sort((a, b) => a.ad.localeCompare(b.ad, dil));
  if (!hepsi.length) throw new ValidationError('belge.hata.secimyok');
  if (hepsi.length > MAX_BELGE) throw new ValidationError('belge.hata.sinir');
  return hepsi;
}

/**
 * İmza için önerilen unvan: belgeyi üreten kişinin kurumu projedeki sıfatıyla
 * yazılır (koordinatör kurum ya da ortak kurum). Kişinin adı önerilmez —
 * imzalayan makam ile belgeyi hazırlayan aynı kişi olmayabilir.
 */
export function imzaUnvaniOner(user, t) {
  const kurum = partnerOf(user.partner);
  if (!kurum) return t('belge.imza.unvan.varsayilan');
  return t(user.koordinator ? 'belge.imza.unvan.koordinator' : 'belge.imza.unvan.ortak', { kurum: kurum.name });
}
