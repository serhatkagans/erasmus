import {
  ValidationError, partnerIds, listOf, packList, QUESTION_TYPES, CHOICE_TYPES, hasOptions,
  answerable, live, MAX_QUESTIONS, MAX_OPTIONS, MAX_FILES, MAX_FILE_BYTES, FILE_TYPES, fileInfo, requireDay,
} from './data.mjs';

/**
 * Formlar: koordinatörün hazırladığı, ortak kurumların doldurduğu anketler
 * (Google Form benzeri). GençTek takvimindeki form modülünün bu projeye
 * taşınmış hâli — yapı, soru türleri, koruma kuralları ve ekran akışı
 * birebir aynıdır; yalnızca iki şey bu projeye uyarlandı:
 *
 *   · HEDEF KİTLE İL DEĞİL ORTAK KURUMDUR. Orada 81 il vardı, burada yedi
 *     ortak kurum; "merkez yöneticisi"nin karşılığı koordinatördür.
 *   · METİNLER SÖZLÜKTEN GELİR. Orada Türkçe sabitti; burada arayüz altı
 *     dile açık olduğu için doğrulama iletileri de anahtarla üretilir ve
 *     isteğin dilinde yazılır (bkz. routes/form.mjs · `m.t`).
 *
 * Form tanımı `forms` satırında durur; sorular tek bir JSON sütununda. Her
 * sorunun kalıcı bir kimliği (`id`) vardır ve yanıtlar bu kimlikle saklanır:
 * soru sırası değişse, başlığı düzeltilse ya da araya soru eklense bile eski
 * yanıtlar doğru soruya bağlı kalır. Silinen sorunun yanıtı satırda kalır ama
 * gösterilmez.
 *
 * HEDEF KİTLE: `hedef` boşsa bütün ortak kurumlar, doluysa "|geoclub|cecf|"
 * biçiminde yalnızca o kurumların kullanıcıları. `koordinator_doldurur`
 * işaretliyse koordinatör kurum da doldurur; değilse yalnızca önizler.
 *
 * YANIT: KİŞİ BAŞINA bir satır (`form_id`,`user_id` tekil) — kullanıcı
 * kararı, 22 Eylül 2026. Form açık kaldığı sürece kişi yanıtını
 * düzeltebilir; yeni gönderim eskisinin yerine geçer. Gönderilmemiş yanıt
 * `form_taslak` tablosunda taslak olarak durur.
 *
 * BÖLÜM: `bolum` türü soru değil, sayfa başlığıdır; doldururken form
 * bölümlerden sayfalara ayrılır. Yanıtı yoktur, özete ve Excel'e girmez.
 *
 * DOSYA: `dosya` türü sorunun yanıtı yüklenen dosyaların listesidir
 * ([{ id, ad, boyut }]); dosyaların kendisi `form_dosya` tablosunda.
 *
 * DURUM: yeni form `taslak` başlar, ortaklar görmez; koordinatör
 * yayımlayınca `yayinda` olur. Yayındaki form kapatılınca ya da son günü
 * geçince "Kapalı" sayılır (bkz. accepting).
 *
 * SORU KORUMA: yanıt almış sorunun türü değişmez; silinen soru atılmaz,
 * `archived` işaretlenir: doldurma ekranında çıkmaz, raporda kalır.
 * Seçenek adı düzeltilince eski yanıtlar yeni ada taşınır (renameAnswers).
 */

export { QUESTION_TYPES, CHOICE_TYPES, hasOptions, answerable, live, MAX_QUESTIONS, MAX_OPTIONS };
export { MAX_FILES, MAX_FILE_BYTES, FILE_TYPES, fileInfo };

const TEXT_LIMIT = { kisa: 500, paragraf: 5000 };

const metin = (value, max, t, anahtar, degerler = {}, required = false) => {
  const sonuc = typeof value === 'string' ? value.trim() : '';
  if (required && !sonuc) throw new ValidationError(t('form.hata.bos', { alan: t(anahtar, degerler) }));
  if (sonuc.length > max) throw new ValidationError(t('form.hata.uzun', { alan: t(anahtar, degerler), n: max }));
  return sonuc;
};

/**
 * Biçimli metin (form başlığı ve açıklaması): tarayıcıdaki düzenleyicinin
 * ürettiği, yalnızca <b> <i> <u> <ul> <ol> <li> <br> etiketlerinden oluşan,
 * özniteliksiz HTML. Metin kısmı &amp; &lt; &gt; &quot; &#39; ile kaçışlı.
 * Başka etiket, öznitelik ya da çıplak < > & içeren gövde reddedilir; böylece
 * saklanan değer ekrana doğrudan basılsa bile betik çalıştıramaz.
 */
const RICH_TAG = /<\/?(?:b|i|u|ul|ol|li|br)>/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
export function richText(value, max, t, anahtar) {
  const rich = typeof value === 'string' ? value.trim() : '';
  if (rich.length > max) throw new ValidationError(t('form.hata.uzun', { alan: t(anahtar), n: max }));
  const kalan = rich.replace(RICH_TAG, '');
  if (/[<>]/.test(kalan) || /&(?!(?:amp|lt|gt|quot|#39);)/.test(kalan)) {
    throw new ValidationError(t('form.hata.bicim', { alan: t(anahtar) }));
  }
  return rich;
}

/** Biçimli metnin düz hâli; `inline` başlık içindir (satır sonu boşluk olur). */
export function plainOf(rich, inline = false) {
  const duz = rich
    .replace(/(<br>)?<[uo]l>|<br>|<\/li>/g, inline ? ' ' : '\n')
    .replace(/<li>/g, inline ? '' : '• ')
    .replace(RICH_TAG, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, ad) => ENTITIES[ad])
    .replace(/ /g, ' ');
  return inline ? duz.replace(/\s+/g, ' ').trim() : duz.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Bugün — UTC.
 *
 * Proje altı ülkeye yayılı ve platformdaki bütün günler UTC 'YYYY-AA-GG'
 * olarak saklanıyor (bkz. lib/db.mjs). Son yanıt günü de UTC'ye göre
 * geçerlidir: en batıdaki ortak için gün birkaç saat uzamış olur, bu da
 * son tarihi kaçırtmaktan iyidir.
 */
export const bugun = (now = new Date()) => now.toISOString().slice(0, 10);

/** Form yanıt alıyor mu: yayında, kapatılmamış ve bitiş günü geçmemiş. */
export const accepting = (form, now = new Date()) =>
  form.durum !== 'taslak' && !form.kapali && (!form.son_tarih || bugun(now) <= form.son_tarih);

/** Formun ekrandaki durumu: taslak, yayında ya da kapalı. */
export const stateOf = (form, now = new Date()) =>
  (form.durum === 'taslak' ? 'taslak' : accepting(form, now) ? 'acik' : 'kapali');

/** Bu ortak kurum formun hedef kitlesinde mi. */
export const targets = (form, partner) => !!partner && (!form.hedef || listOf(form.hedef).includes(partner));

/**
 * Bu kullanıcı formu doldurur mu?
 *
 * Koordinatör kurum ÖZEL DURUMDUR: formu o hazırlar, bu yüzden kendi
 * hedef kitlesinde olması ayrı bir anahtara bağlıdır. Ortak kurum
 * kullanıcısı yalnızca hedef kitledeyse doldurur.
 */
export const fills = (form, user) =>
  (user?.koordinator ? !!form.koordinator_doldurur : targets(form, user?.partner));

export function questionsOf(form) {
  try {
    const deger = JSON.parse(form.sorular || '[]');
    return Array.isArray(deger) ? deger : [];
  } catch { return []; }
}

export function answersOf(satir) {
  try {
    const deger = JSON.parse(satir?.yanitlar || '{}');
    return deger && typeof deger === 'object' && !Array.isArray(deger) ? deger : {};
  } catch { return {}; }
}

/**
 * Form gövdesini doğrular ve veritabanı satırına çevirir. Soru kimliklerini
 * istemci üretir (düzenlemede aynı kimlik geri gelir); yalnızca biçimi ve
 * tekilliği denetlenir.
 */
export function validateForm(gelen, t) {
  const baslikRich = richText(gelen.baslikRich, 2000, t, 'form.baslik.alan');
  const baslik = metin(baslikRich ? plainOf(baslikRich, true) : gelen.baslik, 200, t, 'form.baslik.alan', {}, true);
  const aciklamaRich = richText(gelen.aciklamaRich, 20000, t, 'form.aciklama.alan');
  const aciklama = metin(aciklamaRich ? plainOf(aciklamaRich) : gelen.aciklama, 5000, t, 'form.aciklama.alan');

  const sonTarih = typeof gelen.sonTarih === 'string' ? gelen.sonTarih : '';
  if (sonTarih) {
    try { requireDay(sonTarih, 'sonTarih'); }
    catch { throw new ValidationError(t('form.hata.sontarih')); }
  }

  const hedef = Array.isArray(gelen.hedef) ? [...new Set(gelen.hedef)] : [];
  if (hedef.some(id => !partnerIds.includes(id))) throw new ValidationError(t('form.hata.hedef'));

  if (!Array.isArray(gelen.sorular) || !gelen.sorular.some(q => q?.type !== 'bolum' && !q?.archived)) {
    throw new ValidationError(t('form.hata.sorusuz'));
  }
  if (gelen.sorular.length > MAX_QUESTIONS) throw new ValidationError(t('form.hata.cokSoru', { n: MAX_QUESTIONS }));

  const gorulen = new Set();
  const sorular = gelen.sorular.map((q, i) => {
    const sira = { n: i + 1 };
    if (!q || typeof q !== 'object') throw new ValidationError(t('form.hata.soruGecersiz', sira));
    const id = String(q.id || '');
    if (!/^[a-z0-9]{1,16}$/.test(id) || gorulen.has(id)) throw new ValidationError(t('form.hata.soruKimlik', sira));
    gorulen.add(id);
    if (!QUESTION_TYPES.includes(q.type)) throw new ValidationError(t('form.hata.soruTuru', sira));

    /* Bölüm başlığı boş kalabilir (Google'daki gibi "Başlıksız bölüm"); zorunlu olmaz. */
    const bolum = q.type === 'bolum';
    const soru = {
      id,
      type: q.type,
      title: metin(q.title, 500, t, 'form.hata.soruBaslik', sira, !bolum),
      help: metin(q.help, 1000, t, 'form.hata.soruAciklama', sira),
      required: !bolum && !!q.required,
    };
    if (!bolum && q.archived) soru.archived = true;

    if (hasOptions(q.type)) {
      const secenekler = (Array.isArray(q.options) ? q.options : [])
        .map(o => metin(o, 300, t, 'form.hata.soruSecenek', sira)).filter(Boolean);
      if (!secenekler.length) throw new ValidationError(t('form.hata.secenekYok', sira));
      if (secenekler.length > MAX_OPTIONS) throw new ValidationError(t('form.hata.cokSecenek', { n: sira.n, n2: MAX_OPTIONS }));
      if (new Set(secenekler).size !== secenekler.length) throw new ValidationError(t('form.hata.secenekTekrar', sira));
      soru.options = secenekler;
    }
    return soru;
  });

  return {
    baslik, aciklama, baslikRich, aciklamaRich,
    koordinatorDoldurur: gelen.koordinatorDoldurur ? 1 : 0,
    sonTarih,
    hedef: hedef.length ? packList(partnerIds.filter(id => hedef.includes(id))) : '',
    kapali: gelen.kapali ? 1 : 0,
    sorular: JSON.stringify(sorular),
  };
}

/**
 * Yanıtı sorulara göre doğrular. Formda olmayan anahtarlar atılır; boş
 * bırakılan isteğe bağlı sorular kaydedilmez. Sayılar sayı, tarihler
 * "YYYY-AA-GG" olarak saklanır. Dosya sorusunda yalnızca dosya kimlikleri
 * denetlenir; kime ait oldukları sunucuda veritabanından doğrulanır.
 *
 * `partial` taslak içindir: zorunlu soru boş kalabilir, hatalı yanıt
 * (yarım yazılmış sayı gibi) hata vermeden atılır.
 */
export function validateAnswers(sorular, gelen, t, { partial = false } = {}) {
  const veri = gelen && typeof gelen === 'object' && !Array.isArray(gelen) ? gelen : {};
  const yanitlar = {};

  sorular.forEach((q, i) => {
    if (!answerable(q) || q.archived) return;
    if (partial) {
      try {
        const tek = JSON.parse(validateAnswers([{ ...q, required: false }], { [q.id]: veri[q.id] }, t));
        if (tek[q.id] !== undefined) yanitlar[q.id] = tek[q.id];
      } catch { /* taslakta hatalı yanıt sessizce atılır */ }
      return;
    }

    const etiket = q.title.length > 60 ? q.title.slice(0, 57) + '…' : q.title;
    const ham = veri[q.id];
    let deger;

    if (q.type === 'coklu') {
      const secili = Array.isArray(ham) ? [...new Set(ham.map(String))] : [];
      if (secili.some(o => !q.options.includes(o))) throw new ValidationError(t('form.hata.secim', { soru: etiket }));
      deger = q.options.filter(o => secili.includes(o));
      if (!deger.length) deger = undefined;
    } else if (q.type === 'tekli' || q.type === 'liste') {
      deger = typeof ham === 'string' && ham ? ham : undefined;
      if (deger !== undefined && !q.options.includes(deger)) throw new ValidationError(t('form.hata.secim', { soru: etiket }));
    } else if (q.type === 'sayi') {
      if (ham !== undefined && ham !== null && String(ham).trim() !== '') {
        deger = Number(String(ham).replace(',', '.'));
        if (!Number.isFinite(deger) || Math.abs(deger) > 1e12) throw new ValidationError(t('form.hata.sayi', { soru: etiket }));
      }
    } else if (q.type === 'dosya') {
      const idler = (Array.isArray(ham) ? ham : []).map(x => Number(x && typeof x === 'object' ? x.id : x));
      if (idler.some(id => !Number.isInteger(id) || id < 1)) throw new ValidationError(t('form.hata.dosyaGecersiz', { soru: etiket }));
      deger = [...new Set(idler)];
      if (deger.length > MAX_FILES) throw new ValidationError(t('form.hata.cokDosya', { soru: etiket, n: MAX_FILES }));
      if (!deger.length) deger = undefined;
    } else if (q.type === 'tarih') {
      if (typeof ham === 'string' && ham) {
        /* Tarih kuralı tek yerde: `requireDay` takvimde olmayan günü de
           (30 Şubat) yakalar — JS onu sessizce bir sonraki aya taşır. */
        try { deger = requireDay(ham, 'tarih'); }
        catch { throw new ValidationError(t('form.hata.tarih', { soru: etiket })); }
      }
    } else {
      deger = metin(ham, TEXT_LIMIT[q.type], t, 'form.hata.yanit', { soru: etiket }) || undefined;
    }

    if (deger === undefined) {
      if (q.required) throw new ValidationError(t('form.hata.zorunlu', { n: i + 1, soru: etiket }));
    } else {
      yanitlar[q.id] = deger;
    }
  });

  return JSON.stringify(yanitlar);
}

/**
 * Yanıt toplamış soruları korur (formu düzenlerken, sunucuda):
 * - türü değiştirilemez (eski yanıtların biçimi bozulurdu),
 * - listeden çıkarılmışsa atılmaz, kaldırılmış (`archived`) olarak sona eklenir.
 */
export function protectQuestions(once, json, yanitlanan, t) {
  const sonra = JSON.parse(json);
  for (const q of sonra) {
    const eski = once.find(o => o.id === q.id);
    if (eski && yanitlanan.has(q.id) && eski.type !== q.type) {
      throw new ValidationError(t('form.hata.turKilit', { soru: eski.title }));
    }
  }
  for (const eski of once) {
    if (yanitlanan.has(eski.id) && !sonra.some(q => q.id === eski.id)) {
      sonra.push({ ...eski, archived: true, required: false });
    }
  }
  return JSON.stringify(sonra);
}

/**
 * Seçenek adı düzeltmesi: `renames` = { soruKimliği: { eskiAd: yeniAd } }.
 * Yalnızca eski formda olan eski ad ile yeni formda olan yeni ad arasında
 * geçerlidir; yanıttaki eski ad yenisiyle değiştirilir.
 */
export function validRenames(renames, once, sonra) {
  const sonuc = {};
  if (!renames || typeof renames !== 'object') return sonuc;
  for (const [id, ciftler] of Object.entries(renames)) {
    const eski = once.find(q => q.id === id), yeni = sonra.find(q => q.id === id);
    if (!eski || !yeni || !hasOptions(eski.type) || !hasOptions(yeni.type) || !ciftler || typeof ciftler !== 'object') continue;
    const gecerli = Object.entries(ciftler).filter(([from, to]) =>
      typeof to === 'string' && from !== to && eski.options.includes(from) && yeni.options.includes(to) && !yeni.options.includes(from));
    if (gecerli.length) sonuc[id] = Object.fromEntries(gecerli);
  }
  return sonuc;
}

export function renameAnswers(json, renames) {
  const yanitlar = answersOf({ yanitlar: json });
  let degisti = false;
  for (const [id, ciftler] of Object.entries(renames)) {
    const deger = yanitlar[id];
    if (deger === undefined) continue;
    const sonraki = Array.isArray(deger) ? [...new Set(deger.map(v => ciftler[v] ?? v))] : (ciftler[deger] ?? deger);
    if (JSON.stringify(sonraki) !== JSON.stringify(deger)) { yanitlar[id] = sonraki; degisti = true; }
  }
  return degisti ? JSON.stringify(yanitlar) : null;
}
