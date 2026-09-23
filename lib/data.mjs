import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Projenin değişmeyen bilgileri: ortak kurumlar, iş paketleri, etkinlik
 * türleri ve doğrulama kuralları. Başvuru formu KA220-YOU-70AE2506 esas
 * alınmıştır. Mali takip (harcama) kapsam dışıdır: platform programı ve
 * ilerlemeyi gösterir. Taahhüt edilen bütçe dağılımı klasör yapısı
 * belgesindeki gibi proje panosunda durur (bkz. lib/klasor.mjs · BUTCE).
 *
 * Metinler burada TUTULMAZ: ortak adı dışındaki her görünür metin
 * `locales/*.json` içindedir (bkz. lib/i18n.mjs). Bu dosya yalnızca kimlik,
 * tarih ve ilişki taşır — yeni bir dil eklemek bu dosyaya dokunmayı
 * gerektirmez.
 */

export class ValidationError extends Error {}

/* --- Proje künyesi ------------------------------------------------------ */
export const PROJECT = {
  formId: 'KA220-YOU-70AE2506',
  acronym: 'E-YOUTHPRENEUR',
  action: 'KA220-YOU',
  call: 2026,
  round: 1,
  start: '2026-10-01',
  end: '2028-09-30',
  months: 24,
  agency: 'TR01',
  /* Projenin resmî hesapları; profil kartlarında görünür. */
  sosyal: [
    { id: 'linkedin', ad: 'LinkedIn', url: 'https://www.linkedin.com/in/e-youthpreneur-project-7b24b7439/' },
    { id: 'instagram', ad: 'Instagram', url: 'https://www.instagram.com/eyouthpreneurproject2026/' },
    { id: 'x', ad: 'X', url: 'https://x.com/Eyouthpreneur' },
  ],
};

/* --- Ortak kurumlar -----------------------------------------------------
   `id` kısa koddur: veritabanında, adreste ve renk sınıflarında bu geçer.
   Sıra listenin her göründüğü yeri belirler: ekip panosu, ana sayfadaki
   ortak kartları, filtreler ve katılımcı seçimleri hep buradan okur.
   Koordinatör başta, ardından eş koordinatör BTE; kalanlar başvuru
   formundaki sırayla. */
export const partners = [
  { id: 'hbv',       oid: 'E10019913', name: 'Ankara Hacı Bayram Veli Üniversitesi',   short: 'HBV',        country: 'TR', city: 'Ankara',      web: 'https://ahbv.edu.tr/',            coordinator: true },
  { id: 'bte',       oid: 'E10243126', name: 'Bilişim Teknolojileri Eğitimcileri Derneği', short: 'BTE',    country: 'TR', city: 'Çankaya',     web: 'https://www.bte.org.tr' },
  { id: 'unisalento',oid: 'E10208824', name: 'Università del Salento',                 short: 'UNISALENTO', country: 'IT', city: 'Lecce',       web: 'https://www.unisalento.it' },
  { id: 'geoclub',   oid: 'E10155521', name: 'Asociația GEO CLUB',                     short: 'GEO CLUB',   country: 'RO', city: 'Corbeanca',   web: '' },
  { id: 'cecf',      oid: 'E10089259', name: 'Caribbean Education and Culture Foundation', short: 'CECF',   country: 'NL', city: 'Philipsburg', web: 'https://www.caribbeanecf.com' },
  { id: 'educpro',   oid: 'E10298796', name: 'EducPro Portugal',                       short: 'EDUCPRO',    country: 'PT', city: 'Braga',       web: 'https://www.educpro.eu' },
  { id: 'po2050',    oid: 'E10146115', name: 'People of 2050',                         short: 'PO2050',     country: 'DK', city: 'Copenhagen',  web: 'https://www.peopleof2050.org/' },
];
export const partnerIds = partners.map(p => p.id);
export const partnerOf = id => partners.find(p => p.id === id);

/* Etkinliğin geçtiği yer: ülke kodu ya da çevrim içi. Ortakların bulunduğu
   ülkeler + sanal seçenek; başka ülkede etkinlik planlanmıyor. */
export const VIRTUAL = 'VIRTUAL';
export const venues = ['TR', 'IT', 'RO', 'NL', 'PT', 'DK', VIRTUAL];

/* --- İş paketleri ------------------------------------------------------- */
export const workPackages = [{ id: 'WP1' }, { id: 'WP2' }, { id: 'WP3' }, { id: 'WP4' }];
export const wpIds = workPackages.map(w => w.id);

/* --- Etkinlik türleri ---------------------------------------------------
   Takvimdeki renk ve simge bu türden türer. `tpm` ulusötesi proje
   toplantısı, `ltta` öğrenme/öğretme/eğitim faaliyeti, `sanal` kısa çevrim
   içi etkinlik, `cikti` tarih aralığına yayılan üretim süreci. */
export const types = ['tpm', 'ltta', 'sanal', 'cikti', 'konferans', 'cogaltici', 'toplanti'];

/* --- Durumlar ----------------------------------------------------------- */
export const statuses = ['planlandi', 'devam', 'tamamlandi', 'ertelendi'];
export const DEFAULT_STATUS = 'planlandi';

/* --- Diller -------------------------------------------------------------
   Arayüz Türkçe ile başlar; ortakların ülkelerine karşılık gelen diller
   sırayla tamamlanır. Bir dili yayına almak için `locales/<kod>.json`
   dosyasını doldurup buradaki `ready` değerini true yapmak yeterlidir. */
export const DEFAULT_LANG = 'tr';
export const languages = [
  { code: 'tr', name: 'Türkçe',    ready: true },
  { code: 'en', name: 'English',   ready: true },
  { code: 'it', name: 'Italiano',  ready: false },
  { code: 'ro', name: 'Română',    ready: false },
  { code: 'pt', name: 'Português', ready: false },
  { code: 'da', name: 'Dansk',     ready: false },
];
export const langCodes = languages.map(l => l.code);
export const readyLangs = () => languages.filter(l => l.ready).map(l => l.code);

/* --- Doğrulama ---------------------------------------------------------- */
export const MIN_PASSWORD = 12;
/* Bir etkinlik en çok bu kadar gün sürebilir: 24 aylık projede tek bir
   kaydın tüm takvimi kaplaması yazım hatasıdır. */
export const MAX_RANGE_DAYS = 400;
export const MAX_TITLE = 160;
export const MAX_TEXT = 4000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const listOf = value => String(value || '').split('|').filter(Boolean);
export const packList = names => `|${names.join('|')}|`;

/** Gün ekleyip çıkarır; tüm gün kayıtlarında bitiş, son günün ertesidir. */
export const shiftDay = (day, days) =>
  new Date(Date.parse(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);

export const daysBetween = (from, to) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

export function requireDay(value, field) {
  const day = String(value || '').slice(0, 10);
  if (!DAY.test(day)) throw new ValidationError(`${field} geçerli bir tarih olmalı.`);
  const damga = Date.parse(day + 'T00:00:00Z');
  /* TAKVİMDE OLMAYAN GÜN sessizce taşar: `Date.parse('2026-02-30')` hata
     vermez, 2 Mart'a döner. Yalnızca NaN'a bakılsaydı "30 Şubat" kabul
     edilir, veritabanına olduğu gibi yazılır ve takvimde hiçbir aya
     düşmezdi. Geri yazıp karşılaştırmak bunu yakalar. */
  if (Number.isNaN(damga) || new Date(damga).toISOString().slice(0, 10) !== day) {
    throw new ValidationError(`${field} geçerli bir tarih olmalı.`);
  }
  return day;
}

export function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new ValidationError(`${field} seçimi geçersiz.`);
  return value;
}

export function requireText(value, field, { max = MAX_TEXT, required = true } = {}) {
  const text = String(value ?? '').trim();
  if (!text && required) throw new ValidationError(`${field} boş bırakılamaz.`);
  if (text.length > max) throw new ValidationError(`${field} en fazla ${max} karakter olabilir.`);
  return text;
}

/** Katılımcı kurumlar: bilinmeyen kod reddedilir, sıra listeye uydurulur. */
export function requirePartners(value, field) {
  const chosen = Array.isArray(value) ? value : listOf(value);
  for (const id of chosen) if (!partnerIds.includes(id)) throw new ValidationError(`${field} içinde tanınmayan kurum var.`);
  return partnerIds.filter(id => chosen.includes(id));
}

/* --- Parola -------------------------------------------------------------
   scrypt, kayıt başına rastgele tuzla. Karşılaştırma timingSafeEqual ile
   yapılır: sıradan `===` doğru baytların sayısına göre farklı sürede
   dönerek parolanın sızmasına yol açabilir. */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password, hash) {
  const [salt, key] = String(hash).split(':');
  /* Bozuk ya da eksik özet 500'e dönmesin; geçersiz sayılır. */
  if (!salt || !/^[0-9a-f]{128}$/.test(key || '')) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'));
}

export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new ValidationError(`Parola en az ${MIN_PASSWORD} karakter olmalıdır.`);
  if (password.length > 200) throw new ValidationError('Parola en fazla 200 karakter olabilir.');
  return password;
}

/* Kullanıcı adı: yabancı ortaklar da gireceği için kimlik numarası değil,
   ad ve soyadın bitişik yazımı (`erdaldelebe`). Küçük harfe indirilir ve
   ASCII ile sınırlanır: telefon klavyesinin baş harfi büyütmesi ya da
   ş/ș/ã/ø gibi harflerin farklı yazılması girişi bozmasın. */
export function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase();
}

export function checkUsername(username) {
  const ad = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,40}$/.test(ad)) {
    throw new ValidationError('Kullanıcı adı 3-40 karakter olmalı; yalnızca a-z, 0-9, nokta, tire ve alt çizgi (ş→s, ö→o gibi harfler sadeleştirilir).');
  }
  return ad;
}

/* --- Etkinlik fotoğrafları ----------------------------------------------
   Etkinlik başına en çok 10 fotoğraf; her biri 8 MB'a kadar. Sınır hem
   arayüzde hem sunucuda uygulanır — arayüz kolaylık, sunucu kuraldır. */
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/* Yalnızca tarayıcının güvenle gösterebildiği raster biçimler. SVG dışarıda:
   içine betik gömülebildiği için aynı kökenden sunulması risklidir. */
export const PHOTO_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Dosyanın ilk baytlarından gerçek türü: istemcinin bildirdiği
 *  Content-Type'a güvenilmez, uzantı da değiştirilebilir. */
export function sniffPhoto(buffer) {
  const b = buffer;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

/* --- Görevler -----------------------------------------------------------
   Görev bir ORTAK KURUMA tanımlanır; kurumun ekibinden bir kişiye
   bağlanması isteğe bağlıdır. Böylece kişi ayrılsa bile görev kurumda
   kalır — 24 aylık bir projede ekipler değişir. */
export const taskStatuses = ['bekliyor', 'devam', 'tamamlandi', 'iptal'];
export const DEFAULT_TASK_STATUS = 'bekliyor';

/* Görevin ne kadarının yapıldığı: yüzde. Onar onar ilerler — "%37 bitti"
   gibi bir kesinlik kimsenin elinde yok, ince ayar yanlış bir kesinlik
   duygusu verirdi. */
export const PROGRESS_STEP = 10;
export function requireProgress(value, field = 'İlerleme') {
  const sayi = Number(value ?? 0);
  if (!Number.isFinite(sayi) || sayi < 0 || sayi > 100) throw new ValidationError(`${field} 0 ile 100 arasında olmalı.`);
  return Math.round(sayi / PROGRESS_STEP) * PROGRESS_STEP;
}

/* --- Form dosyaları -----------------------------------------------------
   Dosya sorusuna yüklenenler. Tür UZANTIDAN bulunur, fotoğraflardaki gibi
   baytlardan değil: burada raster görsel değil belge var (Word, Excel, PDF)
   ve her birinin kendi iç yapısını tanımak için ayrı bir çözümleyici
   gerekirdi. Dosya tarayıcıda açılmaz, her zaman EK olarak indirilir
   (bkz. routes/form.mjs) — türü yanlış bildirilmiş bir dosya bu yüzden
   aynı kökende çalışamaz. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
};

/** Yüklenen dosyanın adını temizler ve türünü uzantıdan bulur. Ad denetim
 *  karakterlerinden ve dizin ayıracından arındırılır: indirme başlığına ham
 *  hâliyle giremez. */
export function fileInfo(rawName, t = anahtar => anahtar) {
  const name = String(rawName || '').replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(-150);
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!name || !FILE_TYPES[ext]) throw new ValidationError(t('form.hata.dosyaTuru'));
  return { name, type: FILE_TYPES[ext] };
}

/* --- Formlar ------------------------------------------------------------
   Koordinatörün hazırladığı, ortak kurumların doldurduğu anketler.
   Kuralların tamamı `lib/forms.mjs` içinde; burada yalnızca listeler durur. */
export const formStatuses = ['taslak', 'yayinda'];
export const QUESTION_TYPES = ['kisa', 'paragraf', 'tekli', 'coklu', 'liste', 'sayi', 'tarih', 'dosya', 'bolum'];
/* Seçenek listesi taşıyan türler. */
export const CHOICE_TYPES = ['tekli', 'coklu', 'liste'];
export const hasOptions = type => CHOICE_TYPES.includes(type);
/* `bolum` soru değil sayfa başlığıdır: yanıtı yoktur, özete girmez. */
export const answerable = q => q.type !== 'bolum';
/** Doldurma ekranında görünen soru: kaldırılmamış olanlar. */
export const live = q => !q.archived;
export const MAX_QUESTIONS = 100;
export const MAX_OPTIONS = 60;
/** Dosya sorusu başına en çok bu kadar dosya. */
export const MAX_FILES = 5;

/* --- Hatırlatıcılar -----------------------------------------------------
   Hatırlatıcıların çoğu TÜRETİLMİŞTİR: ayrı bir tabloda durmaz, her istekte
   mevcut veriden hesaplanır (gecikmiş görev, yanıtlanmamış form, yaklaşan
   etkinlik). Böylece veri değiştiği anda hatırlatıcı da doğrulanır; bayat
   bildirim birikmez.

   Tek istisna koordinatörün elle gönderdiği "dürtme"dir: o bir eylemdir,
   veriden türetilemez, bu yüzden saklanır (bkz. form_durtme tablosu).

   Eşikler: bir şey kaç gün kala hatırlatılmaya başlanır. Ulusötesi
   toplantılar için 30 gün, başvuru formundaki "TPM bilgi paketi en az iki
   ay önce" kuralına hazırlık payı bırakır. */
export const GOREV_YAKIN_GUN = 14;
export const FORM_YAKIN_GUN = 14;
export const ETKINLIK_YAKIN_GUN = 30;

/* Aciliyet: arayüzdeki renk ve sıralama bundan türer. */
export const oncelikler = ['acil', 'uyari', 'bilgi'];
