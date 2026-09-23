import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { partnerIds, packList, DEFAULT_STATUS } from './data.mjs';
import { OFFICIAL, participantsOf } from './tohum.mjs';
import { CIKTILAR } from './cikti.mjs';

/**
 * Veritabanı katmanı: iki arka uç, tek arayüz.
 *
 * DATABASE_URL tanımlıysa PostgreSQL (sunucu), değilse SQLite dosyası
 * (yerel çalıştırma kurulum gerektirmesin diye). Sürücü yalnızca seçilen
 * arka uç için yüklenir: sunucuda node:sqlite, yerelde `pg` hiç açılmaz.
 *
 * SORGULAR TEK BİÇİMDE YAZILIR ki iki arka uçta aynı kod çalışsın:
 * - yer tutucu `?` (PostgreSQL için `$1, $2…`ye çevrilir);
 * - sayımlar `CAST(count(*) AS INTEGER)` — pg bigint'i metin döndürür;
 * - yeni kimlik `RETURNING id` ile alınır;
 * - arama `LIKE` yazılır, PostgreSQL'de `ILIKE`'a çevrilir (SQLite'ın LIKE'ı
 *   zaten büyük/küçük harf duyarsızdır).
 *
 * TARİH SAKLAMA: `baslangic` ve `bitis` 'YYYY-MM-DD' metnidir ve bitiş
 * KAPSANAN SON GÜNDÜR. Tek günlük etkinlikte ikisi eşittir. Bu seçim
 * bilinçlidir: metin olarak sıralanabilir, karşılaştırılabilir ve saat
 * dilimi taşımaz — etkinlikler gün bazlıdır, saat sorulmaz.
 */
export async function openDb({ url = process.env.DATABASE_URL, dir = process.env.DATA_DIR || './data' } = {}) {
  const db = url ? await openPostgres(url) : await openSqlite(dir);
  await gocleriUygula(db);
  await seedOfficial(db);
  await seedOutputs(db);
  return db;
}

/* --- Şema ----------------------------------------------------------------
   TEK YERDE yazılır, iki lehçede üretilir. İki arka uç arasındaki fark
   üç sözcüktür; geri kalan her şey aynıdır. Şema eskiden iki ayrı blok
   hâlinde iki kez yazılıyordu: yeni bir tablo eklemek onu iki lehçede iki
   kez yazmak demekti ve ikisinin sürüklenmesi (bir yerde eklenip öbüründe
   unutulan sütun) hiçbir yerde fark edilmezdi — yerelde SQLite, sunucuda
   PostgreSQL çalışıyor. Çıktı dosyası, faaliyet dosyası ve katılımcı
   kaydı yedi tablo daha getirecek (bkz. DURUM.md, Faz 1-3). */
const LEHCELER = {
  sqlite:   { kimlik: 'INTEGER PRIMARY KEY', buyukSayi: 'INTEGER', ikil: 'BLOB' },
  postgres: { kimlik: 'SERIAL PRIMARY KEY',  buyukSayi: 'BIGINT',  ikil: 'BYTEA' },
};

/**
 * Tablolar `IF NOT EXISTS` ile yazılır ve HER AÇILIŞTA çalıştırılır:
 * şemaya yeni bir tablo ya da dizin eklemek, var olan veritabanında da
 * kendiliğinden oluşması demektir — ayrı bir göç adımı gerekmez.
 * Göç adımı yalnızca VAR OLAN bir tabloyu değiştirmek için lazımdır
 * (bkz. SONRAKI_ADIMLAR).
 */
export function schemaSql(lehce) {
  const { kimlik, buyukSayi, ikil } = LEHCELER[lehce];
  return `
    CREATE TABLE IF NOT EXISTS users (
      id ${kimlik},
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      ad TEXT NOT NULL DEFAULT '',
      partner TEXT NOT NULL,
      koordinator INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires ${buyukSayi} NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      id ${kimlik},
      slug TEXT UNIQUE,
      wp TEXT NOT NULL,
      kod TEXT NOT NULL DEFAULT '',
      tur TEXT NOT NULL,
      yer TEXT NOT NULL,
      lider TEXT NOT NULL,
      katilimcilar TEXT NOT NULL DEFAULT '||',
      baslik TEXT NOT NULL DEFAULT '',
      ozet TEXT NOT NULL DEFAULT '',
      baslangic TEXT NOT NULL,
      bitis TEXT NOT NULL,
      durum TEXT NOT NULL DEFAULT '${DEFAULT_STATUS}',
      url TEXT NOT NULL DEFAULT '',
      resmi INTEGER NOT NULL DEFAULT 0,
      owner INTEGER REFERENCES users(id),
      updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_span ON events (baslangic, bitis);
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires);

    CREATE TABLE IF NOT EXISTS team (
      id ${kimlik},
      partner TEXT NOT NULL,
      ad TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT '',
      eposta TEXT NOT NULL DEFAULT '',
      aktif INTEGER NOT NULL DEFAULT 1,
      updated TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS team_partner ON team (partner);

    CREATE TABLE IF NOT EXISTS tasks (
      id ${kimlik},
      partner TEXT NOT NULL,
      uye_id INTEGER REFERENCES team(id) ON DELETE SET NULL,
      wp TEXT NOT NULL DEFAULT '',
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      baslik TEXT NOT NULL,
      aciklama TEXT NOT NULL DEFAULT '',
      son_tarih TEXT NOT NULL DEFAULT '',
      durum TEXT NOT NULL DEFAULT 'bekliyor',
      ilerleme INTEGER NOT NULL DEFAULT 0,
      olusturan INTEGER REFERENCES users(id),
      updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tasks_partner ON tasks (partner, durum);

    CREATE TABLE IF NOT EXISTS forms (
      id ${kimlik},
      baslik TEXT NOT NULL,
      aciklama TEXT NOT NULL DEFAULT '',
      baslik_rich TEXT NOT NULL DEFAULT '',
      aciklama_rich TEXT NOT NULL DEFAULT '',
      son_tarih TEXT NOT NULL DEFAULT '',
      sorular TEXT NOT NULL DEFAULT '[]',
      durum TEXT NOT NULL DEFAULT 'taslak',
      kapali INTEGER NOT NULL DEFAULT 0,
      hedef TEXT NOT NULL DEFAULT '',
      koordinator_doldurur INTEGER NOT NULL DEFAULT 0,
      yayinlandi TEXT NOT NULL DEFAULT '',
      silindi TEXT NOT NULL DEFAULT '',
      olusturan INTEGER REFERENCES users(id),
      created TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL);

    /* Yanıt KİŞİ BAŞINADIR (kullanıcı kararı, 22 Eylül 2026). Kurumu da
       yazılır: kişi sonradan başka kuruma geçse bile yanıt hangi kurum
       adına verildiyse orada kalır. */
    CREATE TABLE IF NOT EXISTS form_yanitlar (
      id ${kimlik},
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      partner TEXT NOT NULL,
      yanitlar TEXT NOT NULL DEFAULT '{}',
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      UNIQUE (form_id, user_id));

    /* Gönderilmemiş yanıt: doldururken birkaç saniyede bir kaydedilir. */
    CREATE TABLE IF NOT EXISTS form_taslak (
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      yanitlar TEXT NOT NULL DEFAULT '{}',
      updated TEXT NOT NULL,
      PRIMARY KEY (form_id, user_id));

    /* Dosya sorusuna yüklenenler. Yanıta bağlanana kadar yalnızca
       yükleyene aittir; gönderimde yanıtta geçmeyenler silinir. */
    CREATE TABLE IF NOT EXISTS form_dosya (
      id ${kimlik},
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      soru_id TEXT NOT NULL,
      ad TEXT NOT NULL,
      tur TEXT NOT NULL,
      boyut INTEGER NOT NULL,
      veri ${ikil} NOT NULL,
      created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS form_dosya_sahip ON form_dosya (form_id, user_id);

    /* Kapak görseli: form başına bir tane. */
    CREATE TABLE IF NOT EXISTS form_gorsel (
      form_id INTEGER PRIMARY KEY REFERENCES forms(id) ON DELETE CASCADE,
      tur TEXT NOT NULL,
      veri ${ikil} NOT NULL,
      updated TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS event_photos (
      id ${kimlik},
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      ad TEXT NOT NULL,
      tur TEXT NOT NULL,
      boyut INTEGER NOT NULL,
      veri ${ikil} NOT NULL,
      yukleyen INTEGER REFERENCES users(id),
      yuklendi TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS photos_event ON event_photos (event_id);

    /* Profil fotoğrafı: kişi başına en çok bir tane. Ayrı tablo, çünkü
       users satırı her istekte (oturum çözümü) okunuyor; görsel baytları
       orada durursa her istekte taşınırdı. Hesap silinince fotoğraf da gider. */
    /* Çıktı kütüphanesi (lib/cikti.mjs). Satırlar tohumdan gelir; sorumlu
       ve teslim yalnızca etkinliğe bağlı OLMAYAN çıktılarda doludur. */
    CREATE TABLE IF NOT EXISTS outputs (
      id ${kimlik},
      slug TEXT UNIQUE NOT NULL,
      durum TEXT NOT NULL DEFAULT 'planlandi',
      sorumlu TEXT,
      teslim TEXT,
      dis_url TEXT NOT NULL DEFAULT '',
      notlar TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL);

    /* Dil dil, sürüm sürüm dosya. Her dilin en büyük numaralı satırı son sürümdür. */
    CREATE TABLE IF NOT EXISTS output_files (
      id ${kimlik},
      output_id INTEGER NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
      dil TEXT NOT NULL,
      no INTEGER NOT NULL,
      ad TEXT NOT NULL,
      tur TEXT NOT NULL,
      boyut INTEGER NOT NULL,
      veri ${ikil} NOT NULL,
      yukleyen INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS output_files_cikti ON output_files (output_id, dil);

    /* Faaliyet dosyası (lib/faaliyet.mjs): bilgi paketi, gündem, yoklama, tutanak. */
    CREATE TABLE IF NOT EXISTS event_files (
      id ${kimlik},
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      tur TEXT NOT NULL,
      ad TEXT NOT NULL,
      mime TEXT NOT NULL,
      boyut INTEGER NOT NULL,
      veri ${ikil} NOT NULL,
      yukleyen INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS event_files_etkinlik ON event_files (event_id);

    CREATE TABLE IF NOT EXISTS user_photos (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      tur TEXT NOT NULL,
      veri ${ikil} NOT NULL,
      updated TEXT NOT NULL);

    /* Proje klasörleri (lib/klasor.mjs). Dosya TEK klasörde durur; içerik
       sürümlerdedir, en yüksek numaralı sürüm geçerli olandır. Sahiplik
       kişiye değil KURUMA yazılır: yükleyen ayrılsa da dosya kurumda kalır. */
    CREATE TABLE IF NOT EXISTS klasor_dosya (
      id ${kimlik},
      klasor TEXT NOT NULL,
      ad TEXT NOT NULL,
      aciklama TEXT NOT NULL DEFAULT '',
      partner TEXT NOT NULL,
      yukleyen INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created TEXT NOT NULL,
      updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS klasor_dosya_klasor ON klasor_dosya (klasor);

    CREATE TABLE IF NOT EXISTS klasor_surum (
      id ${kimlik},
      dosya_id INTEGER NOT NULL REFERENCES klasor_dosya(id) ON DELETE CASCADE,
      no INTEGER NOT NULL,
      ad TEXT NOT NULL,
      tur TEXT NOT NULL,
      boyut INTEGER NOT NULL,
      veri ${ikil} NOT NULL,
      yukleyen INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created TEXT NOT NULL,
      UNIQUE (dosya_id, no));

    /* Belgedeki "Drive kısayolu": dosya başka bir klasörde de GÖRÜNÜR ama
       orada kopyası yoktur. */
    CREATE TABLE IF NOT EXISTS klasor_kisayol (
      dosya_id INTEGER NOT NULL REFERENCES klasor_dosya(id) ON DELETE CASCADE,
      klasor TEXT NOT NULL,
      ekleyen INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created TEXT NOT NULL,
      PRIMARY KEY (dosya_id, klasor));

    /* Koordinatörün bekleyen kişiye gönderdiği hatırlatma; yanıt gelince
       silinir. Türetilemeyen tek hatırlatıcı budur — bir eylemdir. */
    CREATE TABLE IF NOT EXISTS form_hatirlatma (
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      gonderen INTEGER REFERENCES users(id),
      created TEXT NOT NULL,
      PRIMARY KEY (form_id, user_id));`;
}

/**
 * Göç adımları: VAR OLAN bir tabloyu değiştiren işler.
 *
 * `CREATE TABLE IF NOT EXISTS` var olan tabloya dokunmaz, bu yüzden şemaya
 * sonradan eklenen bir SÜTUN eski veritabanlarında oluşmaz; onu buraya bir
 * adım olarak yazmak gerekir. Yeni TABLO ve DİZİN için adım gerekmez —
 * şema her açılışta çalışır.
 *
 * Her adım tek tek denenir ve "zaten var" hatası yutulur: adımların hangi
 * sırayla uygulandığını ayrı bir tabloda tutmak yerine, adımların
 * TEKRAR ÇALIŞTIRILMAYA DAYANIKLI yazılması istenir. Veri taşıyan bir adım
 * eklenecekse (ör. sütun doldurma) `WHERE` ile kendi işini iki kez
 * yapmayacak biçimde yazılmalıdır.
 */
export const SONRAKI_ADIMLAR = lehce => [
  /* Ekip üyesi dışarıdan yazılan bir ad değil, sistemdeki bir hesaptır
     (kullanıcı kararı, 23 Eylül 2026). Hesap silinince ekip satırı da gider. */
  'ALTER TABLE team ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE',

  /* Faaliyet dosyası (Faz 2): memnuniyet anketi faaliyete bağlanır. */
  'ALTER TABLE forms ADD COLUMN event_id INTEGER REFERENCES events(id) ON DELETE SET NULL',

  'ALTER TABLE tasks ADD COLUMN ilerleme INTEGER NOT NULL DEFAULT 0',

  /* Form modülü GençTek takvimindeki hâliyle yeniden kuruldu (22 Eylül
     2026, kullanıcı isteği): biçimli başlık, hedef kitle, kapatma anahtarı,
     yayım zamanı ve geri alınabilir silme. */
  `ALTER TABLE forms ADD COLUMN baslik_rich TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE forms ADD COLUMN aciklama_rich TEXT NOT NULL DEFAULT ''`,
  'ALTER TABLE forms ADD COLUMN kapali INTEGER NOT NULL DEFAULT 0',
  `ALTER TABLE forms ADD COLUMN hedef TEXT NOT NULL DEFAULT ''`,
  'ALTER TABLE forms ADD COLUMN koordinator_doldurur INTEGER NOT NULL DEFAULT 0',
  `ALTER TABLE forms ADD COLUMN yayinlandi TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE forms ADD COLUMN silindi TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE forms ADD COLUMN created TEXT NOT NULL DEFAULT ''`,

  /* Eski `durum` üç değerliydi (taslak/yayinda/kapali); artık kapatma ayrı
     bir anahtar. `WHERE` adımı ikinci çalıştırmada boşa düşürür. */
  `UPDATE forms SET kapali=1, durum='yayinda' WHERE durum='kapali'`,
  `UPDATE forms SET created=updated WHERE created=''`,

  /* Yanıt kurum başınayken (`form_yanit`) kişi başına geçti
     (`form_yanitlar`). Eski satırlar gönderen kişiye bağlanarak taşınır;
     göndereni bilinmeyen satır taşınamaz, eski tabloda durur.
     `NOT EXISTS` ikinci çalıştırmada kopya üretmesini engeller. */
  `INSERT INTO form_yanitlar (form_id, user_id, partner, yanitlar, created, updated)
     SELECT e.form_id, e.gonderen, e.partner, e.yanitlar, e.gonderildi, e.gonderildi
       FROM form_yanit e
      WHERE e.gonderen IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM form_yanitlar y WHERE y.form_id=e.form_id AND y.user_id=e.gonderen)`,

  /* Dürtme kuruma gönderiliyordu; artık kişiye. Kurumun her kullanıcısına
     açılır. */
  `INSERT INTO form_hatirlatma (form_id, user_id, gonderen, created)
     SELECT d.form_id, u.id, d.gonderen, d.created
       FROM form_durtme d JOIN users u ON u.partner = d.partner
      WHERE NOT EXISTS (SELECT 1 FROM form_hatirlatma h WHERE h.form_id=d.form_id AND h.user_id=u.id)`,
];

async function gocleriUygula(db) {
  for (const adim of SONRAKI_ADIMLAR(db.kind)) {
    try {
      await db.run(adim);
    } catch {
      /* Zaten uygulanmış — beklenen durum, sessizce geçilir. */
    }
  }
}

const EVENT_COLUMNS = `id, slug, wp, kod, tur, yer, lider, katilimcilar, baslik, ozet, baslangic, bitis, durum, url, resmi, owner, updated`;

/**
 * Başvuru formundaki resmî program: tablo boşken bir kez yazılır.
 *
 * `slug` benzersizdir; var olan kayıt güncellenmez ki koordinatörün tarih
 * ya da durum düzeltmeleri sonraki açılışta geri alınmasın. Yeni bir resmî
 * aktivite tohum listesine eklenirse yalnızca o eklenir.
 */
async function seedOfficial(db) {
  const have = new Set((await db.all('SELECT slug FROM events WHERE resmi=1')).map(r => r.slug));
  for (const a of OFFICIAL) {
    if (have.has(a.slug)) continue;
    await db.run(
      `INSERT INTO events (slug, wp, kod, tur, yer, lider, katilimcilar, baslik, ozet, baslangic, bitis, durum, url, resmi, owner, updated)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL,?)`,
      [a.slug, a.wp, a.kod, a.tur, a.yer, a.lider, packList(participantsOf(a, partnerIds)),
       '', '', a.baslangic, a.bitis, DEFAULT_STATUS, '', new Date().toISOString()]);
  }
}

/** Çıktı kütüphanesinin satırları: eksik olan eklenir, var olana dokunulmaz. */
async function seedOutputs(db) {
  const have = new Set((await db.all('SELECT slug FROM outputs')).map(r => r.slug));
  for (const c of CIKTILAR) {
    if (!have.has(c.slug)) await db.run('INSERT INTO outputs (slug, updated) VALUES (?,?)', [c.slug, new Date().toISOString()]);
  }
}

/* --- SQLite ------------------------------------------------------------- */
async function openSqlite(dir) {
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(resolve(dir), { recursive: true });
  const db = new DatabaseSync(resolve(dir, 'eyouthpreneur.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`);
  db.exec(schemaSql('sqlite'));

  const run = (sql, args = []) => { db.prepare(sql).run(...args); };
  return {
    kind: 'sqlite',
    all: async (sql, args = []) => db.prepare(sql).all(...args),
    get: async (sql, args = []) => db.prepare(sql).get(...args),
    run: async (sql, args = []) => run(sql, args),
    /* SQLite'ta RETURNING desteklenir; pg ile aynı imza korunur. */
    insert: async (sql, args = []) => db.prepare(sql + ' RETURNING id').get(...args).id,
    close: async () => db.close(),
  };
}

/* --- PostgreSQL --------------------------------------------------------- */
async function openPostgres(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  await pool.query(schemaSql('postgres'));

  /* `?` → `$1…` ve LIKE → ILIKE çevirisi tek yerde; sorgular SQLite
     biçiminde yazılır. Yer tutucu sayacı dizge içindeki `?` karakterlerine
     değil, yalnızca gerçek yer tutuculara uygulanır — sorgularımızda metin
     sabitleri soru işareti içermiyor. */
  const translate = sql => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`).replace(/\bLIKE\b/g, 'ILIKE'); };
  const query = async (sql, args) => (await pool.query(translate(sql), args)).rows;
  return {
    kind: 'postgres',
    all: query,
    get: async (sql, args = []) => (await query(sql, args))[0],
    run: async (sql, args = []) => { await query(sql, args); },
    insert: async (sql, args = []) => (await query(sql + ' RETURNING id', args))[0].id,
    close: () => pool.end(),
  };
}

export { EVENT_COLUMNS };
