/**
 * Başvuru formundaki resmî aktiviteler — veritabanı boşken bir kez yüklenir.
 *
 * Bu kayıtlar projenin taahhüt ettiği programdır; kullanıcıların eklediği
 * yerel etkinliklerden `resmi` sütunuyla ayrılır ve arayüzde silinemez.
 * `slug` çeviri anahtarıdır: başlık ve özet `locales/<dil>.json` içindeki
 * `etkinlik.<slug>.baslik` / `.ozet` değerlerinden okunur, böylece resmî
 * program dil değiştirince de doğru görünür.
 *
 * `bitis` alanı KAPSANAN SON GÜNDÜR (formdaki "estimated end date"). Veritabanına
 * yazılırken tüm gün kuralına uyması için bir gün ileri alınır — bkz. db.mjs.
 */
export const OFFICIAL = [
  /* --- WP2: İhtiyaç Analizi & İyi Uygulamalar E-Kitabı ---------------- */
  { slug: 'wp2-a1-ihtiyac-analizi',   wp: 'WP2', kod: 'A-1', tur: 'cikti',     yer: 'IT',      lider: 'unisalento', baslangic: '2026-10-31', bitis: '2027-02-28' },
  { slug: 'wp2-a2-ekitap',            wp: 'WP2', kod: 'A-2', tur: 'cikti',     yer: 'TR',      lider: 'hbv',        baslangic: '2027-02-01', bitis: '2027-06-30' },
  { slug: 'wp2-a3-acilis-toplantisi', wp: 'WP2', kod: 'A-3', tur: 'tpm',       yer: 'TR',      lider: 'hbv',        baslangic: '2026-12-15', bitis: '2026-12-16' },
  { slug: 'wp2-a4-tpm2',              wp: 'WP2', kod: 'A-4', tur: 'tpm',       yer: 'NL',      lider: 'cecf',       baslangic: '2027-03-22', bitis: '2027-03-26' },

  /* --- WP3: Proje Formatı & Çevrim İçi Eğitim Modülü ------------- */
  { slug: 'wp3-a1-proje-formati',     wp: 'WP3', kod: 'A-1', tur: 'cikti',     yer: 'TR',      lider: 'hbv',        baslangic: '2027-06-01', bitis: '2027-10-31' },
  { slug: 'wp3-a2-egitim-modulu',     wp: 'WP3', kod: 'A-2', tur: 'cikti',     yer: 'TR',      lider: 'bte',        baslangic: '2026-10-31', bitis: '2028-02-29' },
  { slug: 'wp3-a3-tpm3',              wp: 'WP3', kod: 'A-3', tur: 'tpm',       yer: 'DK',      lider: 'po2050',     baslangic: '2027-06-01', bitis: '2027-06-02' },
  { slug: 'wp3-a4-ltta',              wp: 'WP3', kod: 'A-4', tur: 'ltta',      yer: 'DK',      lider: 'po2050',     baslangic: '2027-06-03', bitis: '2027-06-04' },
  { slug: 'wp3-a5-va1',               wp: 'WP3', kod: 'A-5', tur: 'sanal',     yer: 'TR',      lider: 'hbv',        baslangic: '2027-08-04', bitis: '2027-08-04' },
  { slug: 'wp3-a6-tpm4',              wp: 'WP3', kod: 'A-6', tur: 'tpm',       yer: 'IT',      lider: 'unisalento', baslangic: '2027-11-24', bitis: '2027-11-26' },

  /* --- WP4: Pilot Uygulama, Final Konferansı & Yaygınlaştırma -------- */
  { slug: 'wp4-a1-pilot',             wp: 'WP4', kod: 'A-1', tur: 'cikti',     yer: 'RO',      lider: 'geoclub',    baslangic: '2028-02-01', bitis: '2028-05-31' },
  { slug: 'wp4-a2-tpm5',              wp: 'WP4', kod: 'A-2', tur: 'tpm',       yer: 'PT',      lider: 'educpro',    baslangic: '2028-02-01', bitis: '2028-02-03' },
  { slug: 'wp4-a3-va2',               wp: 'WP4', kod: 'A-3', tur: 'sanal',     yer: 'VIRTUAL', lider: 'geoclub',    baslangic: '2028-03-02', bitis: '2028-03-02' },
  { slug: 'wp4-a4-tpm6-final',        wp: 'WP4', kod: 'A-4', tur: 'konferans', yer: 'RO',      lider: 'geoclub',    baslangic: '2028-05-03', bitis: '2028-05-05' },
];

/* Formda her aktivitede bütün ortaklar "participating organisations" olarak
   listelidir; lider dışındakiler katılımcıdır. Tek tek yazmak yerine
   türetiliyor — ortak listesi değişirse burada düzeltme gerekmez. */
export const participantsOf = (activity, allIds) => allIds.filter(id => id !== activity.lider);
