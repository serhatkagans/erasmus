import { ValidationError, partnerIds, FILE_TYPES } from './data.mjs';

/**
 * Proje klasörleri — "E-YOUTHPRENEUR Proje Yönetim Panosu · Klasör Yapısı"
 * belgesinin (23.09.2026) platformdaki karşılığı. Kural dosyasıdır: veritabanına
 * bakmaz, bu yüzden `tests/klasor.test.mjs` içinde doğrudan denenir.
 *
 * Belgenin üç ilkesi burada kurala dönüşür:
 *
 *   · NUMARALANDIRMA — kimlik `01`, `01.1`, `05.1.ajanda` biçimindedir ve
 *     sıralama kimliğe göre yapılır. Klasör ADI kimlikte değil, sözlüktedir
 *     (`klasor.k.<kimlik>`): arayüz altı dile açık, numara ise her dilde aynı.
 *   · TEK DOĞRU YER — bir dosya tek bir klasörde durur. Başka bir başlığı da
 *     ilgilendiriyorsa oraya KISAYOL eklenir, kopya değil (klasor_kisayol).
 *     Yeni sürüm aynı kayda eklenir; "hangi sürüm geçerli" sorusu doğmaz.
 *   · SORUMLULUK — her klasörün yükleme yetkisi olan kurumları vardır
 *     (`sahip`). Sözleşme, bütçe ve raporlama koordinatörde kalır; iş paketi
 *     klasörlerinde yetki WP liderindedir. Alt klasör kendi sahibini
 *     yazmazsa üstününkini devralır. `HERKES` giriş yapmış her ortak demektir.
 *
 * WP liderleri başvuru formundan (KA220-YOU-70AE2506.md:1738-1780): WP1 HBV,
 * WP2 UNISALENTO, WP3 BTE (eş lider EducPro), WP4 GEO CLUB (eş lider People
 * of 2050); yaygınlaştırma ve iletişim CECF'de.
 *
 * OKUMA giriş yapmış herkese açıktır: klasörler proje içi çalışma alanıdır,
 * kamuya açık değildir (herkese açık indirme Faz 1'deki çıktı kütüphanesinin
 * işidir).
 */

export const HERKES = '*';

/* İç klasör kalıpları: belgede "Her WP altında: …" ve "Her toplantı altında:
   …" diye tek cümleyle verilenler. Adları `klasor.ic.<ad>` anahtarındadır. */
const WP_IC = ['taslak', 'katki', 'nihai', 'rapor'];
const TOPLANTI_IC = ['ajanda', 'infopack', 'katilim', 'tutanak', 'sunum', 'anket', 'foto'];

/* Ortak katkıları ve toplantı sunumları her kurumdan gelir: bu iç
   klasörlere herkes yükler, geri kalanı üst klasörün sahibindedir. */
const IC_SAHIP = { katki: [HERKES], sunum: [HERKES] };

const ic = (liste, sahipler = IC_SAHIP) => liste.map(ad => ({ ad, sahip: sahipler[ad] }));
const kurumlar = (onEk, kurum = id => [id]) => partnerIds.map((id, i) => ({ id: `${onEk}.${i + 1}`, etiket: 'kurum', kurum: id, sahip: kurum(id) }));

/**
 * Ağaç. Her düğüm:
 *   id       numara (sıralama anahtarı)
 *   sahip    yükleme yetkisi olan kurumlar; yoksa üstünden devralınır
 *   etkinlik resmî aktivitenin `slug`ı — tarih ve yer oradan okunur
 *   ic       her alt klasörün altında açılacak iç klasör kalıbı
 *   etiket   ad sözlükten değil başka yerden gelir: `kurum` (ortak adı),
 *            `ulke` (ülke adı), `yil` (sayının kendisi)
 */
const AGAC = [
  { id: '01', sahip: ['hbv'], alt: [
    { id: '01.1' }, { id: '01.2' }, { id: '01.3' }, { id: '01.4' }, { id: '01.5' },
  ] },
  /* Ortaklık anlaşmaları: koordinatör ile her ortak arasında; ortak kendi
     imzalı nüshasını kendi klasörüne yükleyebilir. HBV'nin kendisiyle
     anlaşması olmaz, bu yüzden listede yok (belgedeki gibi). */
  { id: '02', sahip: ['hbv'], alt: [
    ...kurumlar('02').filter(k => k.kurum !== 'hbv').map((k, i) => ({ ...k, id: `02.${i + 1}` })),
    { id: '02.7', sahip: [HERKES] },
  ] },
  /* 03.1'in adı belgedeki gibi WP tutarlarını taşır; tutarlar ayrıca
     BUTCE'de durur ve bu klasörde tablo olarak gösterilir. */
  { id: '03', sahip: ['hbv'], alt: [
    { id: '03.1' }, { id: '03.2' }, { id: '03.3' },
    { id: '03.4', sahip: [HERKES], alt: ['2026', '2027', '2028'].map(y => ({ id: `03.4.${y}`, etiket: 'yil' })) },
    { id: '03.5' },
  ] },
  { id: '04', sahip: ['hbv'], ic: ic(WP_IC), alt: [
    { id: '04.1', wp: 'WP1', sahip: ['hbv'] },
    { id: '04.2', wp: 'WP2', sahip: ['unisalento', 'hbv'] },
    { id: '04.3', wp: 'WP3', sahip: ['bte', 'educpro', 'hbv'] },
    { id: '04.4', wp: 'WP4', sahip: ['geoclub', 'po2050'] },
  ] },
  { id: '05', sahip: ['hbv'], ic: ic(TOPLANTI_IC), alt: [
    { id: '05.1', etkinlik: 'wp2-a3-acilis-toplantisi', sahip: ['hbv'] },
    { id: '05.2', etkinlik: 'wp2-a4-tpm2', sahip: ['cecf'] },
    { id: '05.3', etkinlik: 'wp3-a3-tpm3', sahip: ['po2050'] },
    { id: '05.4', etkinlik: 'wp3-a5-va1', sahip: ['hbv'] },
    { id: '05.5', etkinlik: 'wp3-a6-tpm4', sahip: ['unisalento'] },
    { id: '05.6', etkinlik: 'wp4-a2-tpm5', sahip: ['educpro'] },
    { id: '05.7', etkinlik: 'wp4-a3-va2', sahip: ['geoclub'] },
    { id: '05.8', etkinlik: 'wp4-a4-tpm6-final', sahip: ['geoclub'] },
    { id: '05.9', sahip: ['hbv'] },
  ] },
  { id: '06', sahip: ['hbv'], alt: [
    { id: '06.1' }, { id: '06.2', sahip: ['cecf'] }, { id: '06.3' }, { id: '06.4' }, { id: '06.5' }, { id: '06.6' },
  ] },
  { id: '07', sahip: ['geoclub', 'po2050'], alt: [
    { id: '07.1', etkinlik: 'wp3-a4-ltta', sahip: ['po2050', 'bte'] },
    { id: '07.2', etkinlik: 'wp4-a1-pilot' },
    { id: '07.3', sahip: [HERKES] }, { id: '07.4', sahip: [HERKES] }, { id: '07.5', sahip: [HERKES] },
    { id: '07.6' },
  ] },
  { id: '08', sahip: ['hbv'], alt: [
    { id: '08.1', etkinlik: 'wp2-a1-ihtiyac-analizi', sahip: ['unisalento'] },
    { id: '08.2', etkinlik: 'wp2-a2-ekitap' },
    { id: '08.3', etkinlik: 'wp3-a1-proje-formati' },
    { id: '08.4', etkinlik: 'wp3-a2-egitim-modulu', sahip: ['bte'] },
    { id: '08.5', sahip: [HERKES] },
    { id: '08.6' },
    /* Belgede yoktu; başvuru özetinde çıktı olarak geçiyor (satır 77-91). */
    { id: '08.7', sahip: ['unisalento'] }, { id: '08.8', sahip: ['hbv', 'bte'] }, { id: '08.9' },
  ] },
  { id: '09', sahip: [HERKES], alt: [
    { id: '09.1', sahip: ['cecf'] },
    { id: '09.2', etkinlik: 'wp4-a4-tpm6-final', sahip: ['geoclub'] },
    { id: '09.3', alt: ['TR', 'IT', 'RO', 'NL', 'PT', 'DK'].map(u => ({ id: `09.3.${u}`, etiket: 'ulke' })) },
    { id: '09.4' }, { id: '09.5' }, { id: '09.6' },
  ] },
  { id: '10', sahip: ['cecf'], alt: [
    { id: '10.1' }, { id: '10.2' }, { id: '10.3' }, { id: '10.4', sahip: [HERKES] }, { id: '10.5' }, { id: '10.6' },
  ] },
  /* Her kurum kendi logosunu yükler. */
  { id: '11', sahip: ['hbv'], alt: kurumlar('11') },
  { id: '12', sahip: ['hbv'], alt: [
    { id: '12.1' }, { id: '12.2' }, { id: '12.3' }, { id: '12.4' }, { id: '12.5' }, { id: '12.6' }, { id: '12.7' },
  ] },
  { id: '13', sahip: [HERKES], alt: [{ id: '13.1' }, { id: '13.2' }, { id: '13.3' }, { id: '13.4' }, { id: '13.5' }] },
  { id: '14', sahip: [HERKES], alt: [{ id: '14.1' }, { id: '14.2' }, { id: '14.3' }, { id: '14.4' }] },
  { id: '15', sahip: ['hbv'], alt: [{ id: '15.1' }, { id: '15.2', sahip: [HERKES] }, { id: '15.3' }, { id: '15.4' }] },
  { id: '16', sahip: ['hbv'], alt: [{ id: '16.1' }, { id: '16.2' }, { id: '16.3', sahip: [HERKES] }, { id: '16.4' }] },
  { id: '17', sahip: ['hbv'], alt: [{ id: '17.1' }, { id: '17.2' }, { id: '17.3' }, { id: '17.4' }] },
  { id: '18', sahip: ['hbv'], alt: [{ id: '18.1' }, { id: '18.2' }, { id: '18.3' }, { id: '18.4' }] },
  { id: '19', sahip: ['hbv'], alt: [
    { id: '19.1' }, { id: '19.2' }, { id: '19.3', sahip: [HERKES] }, { id: '19.4' }, { id: '19.5' }, { id: '19.6' },
  ] },
  /* Onam ve veli izin formlarını katılımcıyı kaydeden kurum toplar. */
  { id: '20', sahip: ['hbv'], alt: [
    { id: '20.1', sahip: [HERKES] }, { id: '20.2' }, { id: '20.3' }, { id: '20.4' }, { id: '20.5', sahip: [HERKES] },
  ] },
];

/**
 * Ağacı düz listeye açar: her düğüm üst kimliğini, derinliğini ve
 * DEVRALINMIŞ sahip listesini taşır. İç klasör kalıbı (`ic`) burada her
 * alt klasörün altına çoğaltılır.
 */
function duzlestir(dugumler, ust = null, ustSahip = [], ustIc = null, derinlik = 0, cikti = []) {
  for (const d of dugumler) {
    const sahip = d.sahip || ustSahip;
    const kayit = {
      id: d.id, ust, derinlik, sahip,
      etiket: d.etiket || null, kurum: d.kurum || null, wp: d.wp || null, etkinlik: d.etkinlik || null,
    };
    cikti.push(kayit);
    const altlar = [...(d.alt || [])];
    /* Kalıp yalnızca birinci düzey alt klasörlere uygulanır (04.2 → taslak…). */
    if (ustIc && derinlik === 1) {
      for (const k of ustIc) altlar.push({ id: `${d.id}.${k.ad}`, etiket: 'ic', ad: k.ad, sahip: k.sahip });
    }
    if (d.etiket === 'ic') kayit.ic = d.ad;
    duzlestir(altlar, d.id, sahip, d.ic || null, derinlik + 1, cikti);
  }
  return cikti;
}

export const KLASORLER = duzlestir(AGAC);
const DIZIN = new Map(KLASORLER.map(k => [k.id, k]));

export const klasorVar = id => DIZIN.has(id);
export const klasor = id => DIZIN.get(id);

/** Klasör kimliği doğrulaması: listede yoksa reddedilir. */
export function klasorDogrula(id) {
  const k = DIZIN.get(String(id ?? ''));
  if (!k) throw new ValidationError('klasor.hata.klasor');
  return k.id;
}

/** Klasörün sözlükteki ad anahtarı ve (varsa) sözlük dışı ad kaynağı.
 *  İstemci bunu kullanarak adı kendi dilinde kurar. */
export function adAnahtari(k) {
  if (k.etiket === 'ic') return `klasor.ic.${k.ic}`;
  if (k.etiket === 'ulke') return `ulke.${k.id.split('.').pop()}`;
  if (k.etiket === 'yil' || k.etiket === 'kurum') return null;
  return `klasor.k.${k.id}`;
}

/**
 * Bu kullanıcı bu klasöre dosya yükleyebilir mi?
 * Koordinatör her yere; ortak yalnızca sahip listesinde kurumu varsa ya da
 * klasör herkese açıksa.
 */
export function yukleyebilir(user, klasorId) {
  if (!user) return false;
  if (user.koordinator) return true;
  const k = DIZIN.get(klasorId);
  if (!k) return false;
  return k.sahip.includes(HERKES) || k.sahip.includes(user.partner);
}

/**
 * Var olan bir dosya üzerinde değişiklik (yeni sürüm, taşıma, silme):
 * koordinatör ya da dosyayı yükleyen KURUM. Kişi değil kurum, çünkü ekipler
 * değişir — yükleyen ayrıldığında dosya sahipsiz kalmamalı (görevlerdeki
 * aynı karar, bkz. routes/ekip.mjs).
 */
export const dosyaYetkisi = (user, dosya) => !!user && (user.koordinator || user.partner === dosya.partner);

/* --- Dosya türü ---------------------------------------------------------
   Form dosyalarının listesi (lib/data.mjs · FILE_TYPES) temel alınır; logo
   klasörü (11) için vektör biçimler ve toplantı kayıtları için video eklenir.
   Dosyalar tarayıcıda AÇILMAZ, her zaman ek olarak ve sandbox başlığıyla
   iner (routes/klasor.mjs) — SVG'nin içine gömülü betik bu yüzden
   çalışamaz. */
export const KLASOR_TURLERI = {
  ...FILE_TYPES,
  svg: 'image/svg+xml', eps: 'application/postscript', ai: 'application/postscript',
  gif: 'image/gif', mp4: 'video/mp4', rtf: 'application/rtf', odp: 'application/vnd.oasis.opendocument.presentation',
};
export const MAX_KLASOR_BYTES = 20 * 1024 * 1024;
export const MAX_ACIKLAMA = 300;

/** Dosya adını temizler, türünü uzantıdan bulur. */
export function dosyaBilgisi(hamAd) {
  const ad = String(hamAd || '').replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(-150);
  const uzanti = ad.includes('.') ? ad.split('.').pop().toLowerCase() : '';
  if (!ad || !KLASOR_TURLERI[uzanti]) throw new ValidationError('klasor.hata.tur');
  return { ad, tur: KLASOR_TURLERI[uzanti] };
}

export function aciklamaDogrula(deger) {
  const metin = String(deger ?? '').replace(/\s+/g, ' ').trim();
  if (metin.length > MAX_ACIKLAMA) throw new ValidationError('klasor.hata.aciklama');
  return metin;
}

/* --- Bütçe ----------------------------------------------------------------
   Klasör yapısı belgesi (03.1) ve onaylı başvuru formu (satır 98-102):
   götürü hibe 250.000 EUR, iş paketlerine dağılımı. Kullanıcı kararı
   (23 Eylül 2026): "proje varsa proje bütçesi de yazsın, asıl rehber o".
   Platform harcama takibi yapmaz; bu, taahhüt edilen dağılımın kendisidir. */
export const BUTCE = {
  toplam: 250000,
  wp: [
    { wp: 'WP1', tutar: 49845 },
    { wp: 'WP2', tutar: 54455 },
    { wp: 'WP3', tutar: 77965 },
    { wp: 'WP4', tutar: 67735 },
  ],
};

/* --- 6.1 Toplantı ve faaliyet takvimi ---------------------------------------
   Belgedeki tablo, satır satır ve belgedeki sırayla. Faaliyet kodu başvuru
   formundaki koddur. `klasor` satırın platformdaki klasörüdür; `bitis`
   yoksa tek günlük, `tarihAnahtari` varsa tarih yerine o metin yazılır. */
export const TAKVIM = [
  { kod: 'A-3', ad: 'tpm1',   ulke: 'TR', ev: 'hbv',        baslangic: '2026-12-15', bitis: '2026-12-16', wp: 'WP2', klasor: '05.1' },
  { kod: 'A-4', ad: 'tpm2',   ulke: 'NL', ev: 'cecf',       baslangic: '2027-03-22', bitis: '2027-03-26', wp: 'WP2', klasor: '05.2' },
  { kod: 'A-3', ad: 'tpm3',   ulke: 'DK', ev: 'po2050',     baslangic: '2027-06-01', bitis: '2027-06-02', wp: 'WP3', klasor: '05.3' },
  { kod: 'A-4', ad: 'ltta',   ulke: 'DK', ev: 'po2050',     baslangic: '2027-06-03', bitis: '2027-06-04', wp: 'WP3', klasor: '07.1' },
  { kod: 'A-5', ad: 'va1',    ulke: 'TR', ev: 'hbv',        baslangic: '2027-08-04', wp: 'WP3', klasor: '05.4' },
  { kod: 'A-6', ad: 'tpm4',   ulke: 'IT', ev: 'unisalento', baslangic: '2027-11-24', bitis: '2027-11-26', wp: 'WP3', klasor: '05.5' },
  { kod: 'A-2', ad: 'tpm5',   ulke: 'PT', ev: 'educpro',    baslangic: '2028-02-01', bitis: '2028-02-03', wp: 'WP4', klasor: '05.6' },
  { kod: 'A-1', ad: 'pilot',  ulke: 'RO', ev: 'geoclub',    baslangic: '2028-02-01', bitis: '2028-05-31', wp: 'WP4', klasor: '07.2' },
  { kod: 'A-3', ad: 'va2',    ulke: 'RO', ev: 'geoclub',    baslangic: '2028-03-02', wp: 'WP4', klasor: '05.7' },
  { kod: 'A-4', ad: 'tpm6',   ulke: 'RO', ev: 'geoclub',    baslangic: '2028-05-03', bitis: '2028-05-05', wp: 'WP4', klasor: '05.8' },
  { kod: 'A-5', ad: 'carpan', ulke: null, ev: null, tarihAnahtari: 'klasor.takvim.wp4Donemi', wp: 'WP4', klasor: '09.3' },
];
