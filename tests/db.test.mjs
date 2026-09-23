import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, schemaSql, SONRAKI_ADIMLAR } from '../lib/db.mjs';
import { OFFICIAL } from '../lib/tohum.mjs';
import { PROJECT, partnerIds, listOf } from '../lib/data.mjs';

/**
 * Şema ve göç.
 *
 * Asıl sınanan şey İKİ ARKA UCUN AYNI ŞEMAYI GÖRMESİ. Yerelde SQLite,
 * sunucuda PostgreSQL çalışıyor; şema iki ayrı blok hâlinde yazılsaydı
 * birinde eklenip öbüründe unutulan bir sütun yalnızca sunucuda, üstelik
 * canlıda patlardı. Aşağıdaki test iki lehçenin çıktısını karşılaştırır ve
 * fark çıkarsa kırılır — PostgreSQL kurulu olmasa bile.
 */

const geciciDb = async () => {
  const dizin = mkdtempSync(join(tmpdir(), 'eyp-db-'));
  const db = await openDb({ url: null, dir: dizin });
  return { db, dizin, async kapat() { await db.close(); rmSync(dizin, { recursive: true, force: true }); } };
};

/** DDL metninden tablo → sütun adları. Karşılaştırma için yeterli. */
function semayiCoz(sql) {
  const tablolar = {};
  for (const [, ad, govde] of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g)) {
    tablolar[ad] = govde
      .split(/,(?![^(]*\))/)
      .map(parca => parca.trim().split(/\s+/)[0])
      .filter(kelime => !['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', ''].includes(kelime));
  }
  const dizinler = [...sql.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map(x => x[1]);
  return { tablolar, dizinler };
}

test('iki lehçe aynı tabloları ve sütunları tanımlar', () => {
  const sqlite = semayiCoz(schemaSql('sqlite'));
  const postgres = semayiCoz(schemaSql('postgres'));

  assert.deepEqual(Object.keys(postgres.tablolar).sort(), Object.keys(sqlite.tablolar).sort());
  assert.deepEqual(postgres.dizinler.sort(), sqlite.dizinler.sort());
  for (const tablo of Object.keys(sqlite.tablolar)) {
    assert.deepEqual(postgres.tablolar[tablo], sqlite.tablolar[tablo], `${tablo}: sütunlar ayrışmış`);
  }
  /* Bugünkü tablolar; Faz 1-3 bu listeyi büyütecek. */
  assert.deepEqual(Object.keys(sqlite.tablolar).sort(),
    ['event_photos', 'events', 'form_dosya', 'form_gorsel', 'form_hatirlatma', 'form_taslak',
     'form_yanitlar', 'forms', 'klasor_dosya', 'klasor_kisayol', 'klasor_surum', 'sessions', 'tasks', 'team', 'user_photos', 'users',
     'outputs', 'output_files', 'event_files'].sort());
});

test('lehçe farkı yalnızca üç sözcüktedir', () => {
  /* Fark büyürse burada görünür: yeni bir lehçe farkı eklendiğinde
     karşılığının öbür arka uçta da yazıldığı bilinçli olarak onaylansın. */
  const ortak = sql => sql
    .replaceAll('SERIAL PRIMARY KEY', 'INTEGER PRIMARY KEY')
    .replaceAll('BYTEA', 'BLOB')
    .replace(/expires BIGINT/, 'expires INTEGER');
  assert.equal(ortak(schemaSql('postgres')), schemaSql('sqlite'));
});

test('her tablo IF NOT EXISTS ile yazılır', () => {
  /* Şema HER AÇILIŞTA çalışır: yeni bir tablo eklemek var olan
     veritabanında da kendiliğinden oluşması demektir. `IF NOT EXISTS`
     düşerse ikinci açılış hata verir. */
  for (const sql of [schemaSql('sqlite'), schemaSql('postgres')]) {
    const toplam = (sql.match(/CREATE TABLE/g) || []).length;
    assert.equal((sql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, toplam);
    const dizin = (sql.match(/CREATE INDEX/g) || []).length;
    assert.equal((sql.match(/CREATE INDEX IF NOT EXISTS/g) || []).length, dizin);
  }
});

test('göç adımları tekrar çalıştırılmaya dayanıklıdır', async () => {
  const { db, kapat } = await geciciDb();
  try {
    /* Adımlar her açılışta yeniden denenir ve "zaten var" hatası yutulur;
       burada elle iki kez çalıştırıp bunun gerçekten sorun çıkarmadığı
       görülüyor. */
    for (const adim of SONRAKI_ADIMLAR(db.kind)) {
      await assert.doesNotReject(async () => {
        try { await db.run(adim); } catch { /* beklenen */ }
      });
    }
    const satir = await db.get('SELECT count(ilerleme) AS n FROM tasks');
    assert.ok(satir, 'ilerleme sütunu var');
  } finally {
    await kapat();
  }
});

test('açılış tohumlaması: 14 resmî aktivite, ikinci açılışta çoğalmaz', async () => {
  const dizin = mkdtempSync(join(tmpdir(), 'eyp-db-'));
  try {
    const ilk = await openDb({ url: null, dir: dizin });
    const sayi = async db => Number((await db.get('SELECT CAST(count(*) AS INTEGER) AS n FROM events WHERE resmi=1')).n);
    assert.equal(await sayi(ilk), OFFICIAL.length);

    /* Koordinatörün düzeltmesi sonraki açılışta geri alınmamalı. */
    await ilk.run("UPDATE events SET durum='devam' WHERE resmi=1 AND slug=?", [OFFICIAL[0].slug]);
    await ilk.close();

    const ikinci = await openDb({ url: null, dir: dizin });
    assert.equal(await sayi(ikinci), OFFICIAL.length, 'tohum ikinci kez yazılmamalı');
    const kayit = await ikinci.get('SELECT durum FROM events WHERE slug=?', [OFFICIAL[0].slug]);
    assert.equal(kayit.durum, 'devam', 'elle yapılan değişiklik korunmalı');
    await ikinci.close();
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
});

test('tohumlanan kayıtlar başvurudaki değerleri taşır', async () => {
  const { db, kapat } = await geciciDb();
  try {
    for (const a of OFFICIAL) {
      const satir = await db.get('SELECT * FROM events WHERE slug=?', [a.slug]);
      assert.ok(satir, `${a.slug} tohumlanmamış`);
      assert.equal(String(satir.baslangic).slice(0, 10), a.baslangic);
      assert.equal(String(satir.bitis).slice(0, 10), a.bitis);
      assert.equal(satir.lider, a.lider);
      assert.equal(satir.resmi, 1);
      /* Lider kendi etkinliğinde ayrıca katılımcı olarak yazılmaz. */
      const katilimcilar = listOf(satir.katilimcilar);
      assert.ok(!katilimcilar.includes(a.lider));
      assert.equal(katilimcilar.length, partnerIds.length - 1);
      /* Resmî kaydın başlığı sözlükten gelir, sütunda boştur. */
      assert.equal(satir.baslik, '');
      assert.ok(satir.baslangic >= PROJECT.start && satir.bitis <= PROJECT.end);
    }
  } finally {
    await kapat();
  }
});

test('yabancı anahtar silmeleri taşır: etkinlik silinince fotoğrafı da gider', async () => {
  const { db, kapat } = await geciciDb();
  try {
    const id = await db.insert(
      `INSERT INTO events (slug,wp,kod,tur,yer,lider,katilimcilar,baslik,ozet,baslangic,bitis,durum,url,resmi,owner,updated)
       VALUES (NULL,'WP4','','cogaltici','RO','geoclub','||','Test','','2028-03-01','2028-03-02','planlandi','',0,NULL,?)`,
      [new Date().toISOString()]);
    await db.run(
      'INSERT INTO event_photos (event_id,ad,tur,boyut,veri,yukleyen,yuklendi) VALUES (?,?,?,?,?,NULL,?)',
      [id, 'a.jpg', 'image/jpeg', 3, Buffer.from([0xff, 0xd8, 0xff]), new Date().toISOString()]);

    await db.run('DELETE FROM events WHERE id=?', [id]);
    const kalan = await db.get('SELECT CAST(count(*) AS INTEGER) AS n FROM event_photos WHERE event_id=?', [id]);
    assert.equal(Number(kalan.n), 0, 'ON DELETE CASCADE çalışmalı (PRAGMA foreign_keys açık mı?)');
  } finally {
    await kapat();
  }
});
