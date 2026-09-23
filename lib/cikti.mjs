/**
 * Çıktı kütüphanesi (Faz 1) — İÇ kütüphane.
 *
 * Platform dışarıya kapalı ve kamuya açık çıktılar (e-kitap başta) BAŞKA
 * YERDE yayımlanıyor (kullanıcı kararı, 23 Eylül 2026). Burada her çıktının
 * hazırlık durumu, sorumlusu, teslim tarihi, dil dil son sürüm dosyası ve
 * yayımlandığı dış adres durur. İndirme sayacı yok: dosya dışarıda iniyor.
 *
 * SORUMLU VE TESLİM TARİHİ: takvimde "çıktı üretim dönemi" olan çıktılarda
 * etkinlikten TÜRETİLİR (lider kurum, bitiş günü) — takvimde tarih değişince
 * burada da değişir, iki yerde ayrı ayrı tutulup ayrışmaz. Başvuruda ayrı
 * bir faaliyeti olmayan üç çıktının (masa başı araştırma, araç seti,
 * politika raporu) sorumlusu ve tarihi başvuruda YOK; uydurulmaz, proje
 * yöneticisi girer.
 */
import { ValidationError, partnerIds, langCodes, requireDay, requireText } from './data.mjs';

/* Sıra: iş paketi ve başvurudaki sıra. `anahtar`: sözlükteki başlık ve metin
   (ana sayfa kartlarıyla aynı anahtarlar; ikisi aynı çıktıdan söz ediyor). */
export const CIKTILAR = [
  { slug: 'ihtiyac-analizi', kod: 'WP2 A-1', wp: 'WP2', etkinlik: 'wp2-a1-ihtiyac-analizi', klasor: '08.1', anahtar: 'anasayfa.cikti.1' },
  { slug: 'masa-basi', kod: 'WP2', wp: 'WP2', etkinlik: null, klasor: '08.7', anahtar: 'cikti.masaBasi', araUrun: true },
  { slug: 'ekitap', kod: 'WP2 A-2', wp: 'WP2', etkinlik: 'wp2-a2-ekitap', klasor: '08.2', anahtar: 'anasayfa.cikti.2' },
  { slug: 'proje-formati', kod: 'WP3 A-1', wp: 'WP3', etkinlik: 'wp3-a1-proje-formati', klasor: '08.3', anahtar: 'anasayfa.cikti.3' },
  { slug: 'egitim-modulu', kod: 'WP3 A-2', wp: 'WP3', etkinlik: 'wp3-a2-egitim-modulu', klasor: '08.4', anahtar: 'anasayfa.cikti.4' },
  { slug: 'arac-seti', kod: '', wp: '', etkinlik: null, klasor: '08.8', anahtar: 'anasayfa.cikti.5' },
  { slug: 'politika-raporu', kod: '', wp: '', etkinlik: null, klasor: '08.9', anahtar: 'anasayfa.cikti.6' },
];
export const ciktiTanimi = slug => CIKTILAR.find(c => c.slug === slug);

/* Hazırlık durumu. "teslim": çıktı bitti ve (varsa) dışarıda yayımlandı. */
export const CIKTI_DURUMLARI = ['planlandi', 'hazirlaniyor', 'incelemede', 'teslim'];

/** Düzenleme gövdesi. Etkinliğe bağlı çıktıda sorumlu ve teslim tarihi
 *  etkinlikten gelir; gönderilse de yok sayılır. */
export function ciktiDogrula(veri, tanim) {
  const durum = String(veri.durum || '');
  if (!CIKTI_DURUMLARI.includes(durum)) throw new ValidationError('cikti.hata.durum');
  const disUrl = requireText(veri.disUrl, 'Bağlantı', { max: 500, required: false });
  if (disUrl && !/^https?:\/\//i.test(disUrl)) throw new ValidationError('cikti.hata.url');
  const not = requireText(veri.not, 'Not', { max: 1000, required: false });
  if (tanim.etkinlik) return { durum, disUrl, not, sorumlu: null, teslim: null };
  const sorumlu = veri.sorumlu ? String(veri.sorumlu) : '';
  if (sorumlu && !partnerIds.includes(sorumlu)) throw new ValidationError('cikti.hata.sorumlu');
  const teslim = veri.teslim ? requireDay(veri.teslim, 'Teslim tarihi') : '';
  return { durum, disUrl, not, sorumlu: sorumlu || null, teslim: teslim || null };
}

/** Dosyanın dili: arayüz dillerinin yanında ortakların çalıştığı her dil
 *  olabilir; bilinmeyen kod reddedilir. */
export const CIKTI_DILLERI = [...new Set([...langCodes, 'nl'])];
export function dilDogrula(dil) {
  if (!CIKTI_DILLERI.includes(dil)) throw new ValidationError('cikti.hata.dil');
  return dil;
}
