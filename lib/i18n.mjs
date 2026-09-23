import { readFile, stat } from 'node:fs/promises';
import { languages, langCodes, DEFAULT_LANG } from './data.mjs';

/**
 * Çeviri katmanı.
 *
 * Her dil `locales/<kod>.json` içinde düz bir anahtar-değer eşlemesidir.
 * Yeni bir dil eklemek iki adımdır: dosyayı yazmak ve data.mjs'teki
 * `languages` listesinde `ready: true` yapmak. Sunucu kodu, şablonlar ve
 * veritabanı şeması dile duyarsızdır — hiçbiri değişmez.
 *
 * EKSİK ANAHTAR SESSİZCE DÜŞMEZ: çeviri tamamlanana kadar Türkçe karşılık
 * kullanılır ve `eksik` listesinde raporlanır. Yarım çevrilmiş bir dilde
 * boş etiketler yerine anlaşılır bir metin görünür.
 */
/**
 * Sözlükler bellekte tutulur ama DOSYANIN DEĞİŞİM ZAMANI izlenir: dosya
 * güncellenince önbellek kendiliğinden tazelenir.
 *
 * Süresiz önbellek sinsi bir hataya yol açıyordu — bir çeviri anahtarı
 * eklenip arayüz onu kullanmaya başladığında, sunucu yeniden başlatılana
 * kadar ekranda çevirinin yerine ham anahtar ("form.soru.sayi") görünüyordu.
 * Dosya zaten her istekte değil, yalnızca `stat` kadar okunuyor.
 */
const cache = new Map();

export async function loadLocale(code) {
  const path = new URL(`../locales/${code}.json`, import.meta.url);

  let mtime = 0;
  try { mtime = (await stat(path)).mtimeMs; }
  catch { /* Dosya yok: boş sözlük, Türkçe yedeğe düşülür. */ }

  const saklanan = cache.get(code);
  if (saklanan && saklanan.mtime === mtime) return saklanan.dict;

  let dict = {};
  try { dict = JSON.parse(await readFile(path, 'utf8')); }
  catch { dict = {}; }
  cache.set(code, { mtime, dict });
  return dict;
}

/** Önbelleği elle boşaltır (testlerde işe yarar). */
export const clearCache = () => cache.clear();

/**
 * İstenen dilin sözlüğü, Türkçe yedeğiyle birleştirilmiş hâlde.
 * `eksik`, o dilde henüz karşılığı olmayan anahtarların sayısıdır — arayüz
 * bunu yönetim ekranında gösterir.
 */
export async function dictionary(code) {
  const base = await loadLocale(DEFAULT_LANG);
  if (code === DEFAULT_LANG) return { dil: code, sozluk: base, eksik: 0 };
  const own = await loadLocale(code);
  const merged = { ...base, ...own };
  const eksik = Object.keys(base).filter(key => !(key in own)).length;
  return { dil: code, sozluk: merged, eksik };
}

/**
 * İstek için dil seçimi, en açıktan en örtüğe:
 * adres çubuğundaki `?dil=`, sonra çerez, sonra tarayıcının Accept-Language
 * başlığı, sonra Türkçe. Yayına alınmamış diller yok sayılır.
 */
export function negotiate(req, url, ready = languages.filter(l => l.ready).map(l => l.code)) {
  const wanted = url.searchParams.get('dil');
  if (wanted && ready.includes(wanted)) return wanted;

  const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('dil='))?.slice(4);
  if (cookie && ready.includes(cookie)) return cookie;

  /* "tr-TR,tr;q=0.9,en;q=0.8" → ağırlığa göre sıralı kod listesi. */
  const accepted = String(req.headers['accept-language'] || '').split(',')
    .map(part => {
      const [tag, ...params] = part.trim().split(';');
      const q = Number(params.find(p => p.startsWith('q='))?.slice(2) ?? 1);
      return { code: tag.toLowerCase().split('-')[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter(x => x.code).sort((a, b) => b.q - a.q);
  for (const { code } of accepted) if (ready.includes(code)) return code;

  return DEFAULT_LANG;
}

/** Çeviri dosyalarının durumu: hangi dil ne kadar tamam. */
export async function coverage() {
  const base = Object.keys(await loadLocale(DEFAULT_LANG));
  const report = [];
  for (const lang of languages) {
    const own = lang.code === DEFAULT_LANG ? base : Object.keys(await loadLocale(lang.code));
    const covered = lang.code === DEFAULT_LANG ? base.length : base.filter(k => own.includes(k)).length;
    report.push({ ...lang, toplam: base.length, cevrilen: covered });
  }
  return report;
}

export { langCodes };
