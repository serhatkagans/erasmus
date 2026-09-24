import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ValidationError } from '../lib/data.mjs';
import {
  KLASORLER, HERKES, klasor, klasorDogrula, adAnahtari, yukleyebilir, dosyaYetkisi, dosyaBilgisi, aciklamaDogrula,
} from '../lib/klasor.mjs';
import { loadLocale } from '../lib/i18n.mjs';
import { OFFICIAL } from '../lib/tohum.mjs';

/**
 * Proje klasörleri — saf kurallar. Ağaç "Proje Yönetim Panosu · Klasör
 * Yapısı" belgesinden gelir; buradaki sınamalar belgeyle platformun
 * ayrışmadığını ve yetki kalıbının (koordinatör / WP lideri / herkes)
 * beklendiği gibi devraldığını doğrular.
 */

const sozluk = { tr: await loadLocale('tr'), en: await loadLocale('en') };
const koordinator = { id: 1, partner: 'hbv', koordinator: true };
const geoclub = { id: 2, partner: 'geoclub', koordinator: false };
const cecf = { id: 3, partner: 'cecf', koordinator: false };

test('yirmi ana klasör, belgedeki sırayla', () => {
  const ana = KLASORLER.filter(k => k.ust === null).map(k => k.id);
  assert.deepEqual(ana, Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0')));
});

test('kimlikler benzersiz, her alt klasörün üstü var', () => {
  const kimlikler = KLASORLER.map(k => k.id);
  assert.equal(new Set(kimlikler).size, kimlikler.length);
  for (const k of KLASORLER) if (k.ust) assert.ok(klasor(k.ust), `${k.id}: üst klasör yok`);
});

test('her klasörün adı iki dilde de var', () => {
  for (const k of KLASORLER) {
    const anahtar = adAnahtari(k);
    if (!anahtar) continue;
    for (const dil of ['tr', 'en']) assert.ok(sozluk[dil][anahtar], `${dil}: ${anahtar} eksik`);
  }
});

test('kodda geçen klasor.* anahtarlarının hepsi sözlükte', () => {
  /* t() eksik anahtarda anahtarın kendisini döndürür; ekranda
     "klasor.hata.yetki" yazar ve kimse hata almaz. */
  const kod = ['lib/klasor.mjs', 'routes/klasor.mjs', 'public/klasorler.js', 'public/klasorler.html']
    .map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  const anahtarlar = new Set([...kod.matchAll(/['"`](klasor\.[a-zA-Z]+(?:\.[a-zA-Z]+)*)['"`]/g)].map(m => m[1]));
  assert.ok(anahtarlar.size > 20);
  for (const a of anahtarlar) for (const dil of ['tr', 'en']) assert.ok(a in sozluk[dil], `${dil}: ${a} eksik`);
});

test('iç klasör kalıbı: her WP ve her toplantı altında', () => {
  for (const wp of ['04.1', '04.2', '04.3', '04.4']) {
    for (const ic of ['taslak', 'katki', 'nihai', 'rapor']) assert.ok(klasor(`${wp}.${ic}`), `${wp}.${ic}`);
  }
  for (const t of ['05.1', '05.5', '05.9']) assert.ok(klasor(`${t}.tutanak`) && klasor(`${t}.infopack`));
  /* Kalıp yalnızca bir düzey iner: iç klasörün altında yeniden açılmaz. */
  assert.equal(klasor('04.2.taslak.taslak'), undefined);
});

test('toplantı klasörleri resmî aktivitelere bağlı', () => {
  const sluglar = new Set(OFFICIAL.map(a => a.slug));
  const bagli = KLASORLER.filter(k => k.etkinlik);
  assert.ok(bagli.length >= 12);
  for (const k of bagli) assert.ok(sluglar.has(k.etkinlik), `${k.id}: ${k.etkinlik} tohumda yok`);
});

test('sahiplik devralınır; iç klasör kendi sahibini koyabilir', () => {
  assert.deepEqual(klasor('05.2.ajanda').sahip, ['cecf'], 'TPM-2 ev sahibi CECF');
  assert.deepEqual(klasor('05.2.sunum').sahip, [HERKES], 'sunumu her ortak yükler');
  assert.deepEqual(klasor('04.4.nihai').sahip, ['geoclub', 'po2050']);
  assert.deepEqual(klasor('04.4.katki').sahip, [HERKES]);
});

test('yükleme yetkisi: koordinatör her yere, ortak kendi alanına', () => {
  for (const k of KLASORLER) assert.ok(yukleyebilir(koordinator, k.id));

  /* Sözleşme ve raporlama koordinatörde. */
  for (const id of ['01.1', '03.1', '15.1', '16.2', '17.1']) assert.ok(!yukleyebilir(geoclub, id), id);
  /* WP4 lideri kendi paketine yükler, başkasınınkine yalnızca katkı. */
  assert.ok(yukleyebilir(geoclub, '04.4.nihai'));
  assert.ok(!yukleyebilir(geoclub, '04.2.nihai'));
  assert.ok(yukleyebilir(geoclub, '04.2.katki'));
  /* Logo ve ortaklık anlaşması: yalnızca kurumun kendi klasörü. */
  assert.ok(yukleyebilir(geoclub, '11.4') && !yukleyebilir(geoclub, '11.5'));
  assert.ok(yukleyebilir(cecf, '11.5'));
  assert.ok(yukleyebilir(geoclub, '02.3') && !yukleyebilir(cecf, '02.3'));
  /* Herkese açık klasörler. */
  for (const id of ['13.1', '14.2', '09.3.RO', '20.1', '03.4.2027']) assert.ok(yukleyebilir(cecf, id), id);

  assert.ok(!yukleyebilir(geoclub, 'uydurma'));
  assert.ok(!yukleyebilir(null, '13.1'));
});

test('dosya değişikliği: koordinatör ya da yükleyen kurum', () => {
  const dosya = { partner: 'geoclub' };
  assert.ok(dosyaYetkisi(koordinator, dosya));
  assert.ok(dosyaYetkisi(geoclub, dosya));
  assert.ok(!dosyaYetkisi(cecf, dosya));
  assert.ok(!dosyaYetkisi(null, dosya));
});

test('klasör kimliği ve dosya bilgisi doğrulaması', () => {
  assert.equal(klasorDogrula('04.2'), '04.2');
  for (const kotu of ['', '21', '04.9', '../01', null]) assert.throws(() => klasorDogrula(kotu), ValidationError);

  assert.deepEqual(dosyaBilgisi('logo.SVG'), { ad: 'logo.SVG', tur: 'image/svg+xml' });
  assert.equal(dosyaBilgisi('a/b\\c.pdf').ad, 'a b c.pdf', 'dizin ayıracı adda kalmaz');
  for (const kotu of ['zararli.exe', 'uzantisiz', '', 'sayfa.html']) assert.throws(() => dosyaBilgisi(kotu), ValidationError);

  assert.equal(aciklamaDogrula('  iki   boşluk '), 'iki boşluk');
  assert.throws(() => aciklamaDogrula('x'.repeat(301)), ValidationError);
});

test('bütçe: iş paketleri götürü hibeye eşit', async () => {
  const { BUTCE } = await import('../lib/klasor.mjs');
  assert.equal(BUTCE.wp.reduce((a, w) => a + w.tutar, 0), BUTCE.toplam);
  assert.equal(BUTCE.toplam, 250000);
  /* Belgedeki 03.1 adı aynı tutarları taşır. */
  assert.match(sozluk.tr['klasor.k.03.1'], /WP1 49\.845 \/ WP2 54\.455 \/ WP3 77\.965 \/ WP4 67\.735 EUR/);
});

test('6.1 takvimi: belgedeki on bir satır, her biri bir klasöre bağlı', async () => {
  const { TAKVIM } = await import('../lib/klasor.mjs');
  assert.equal(TAKVIM.length, 11);
  for (const r of TAKVIM) {
    assert.ok(klasor(r.klasor), `${r.kod} ${r.ad}: klasör yok`);
    for (const dil of ['tr', 'en']) assert.ok(sozluk[dil][`klasor.takvim.a.${r.ad}`], `${dil}: ${r.ad}`);
  }
  /* Takvimdeki tarihler resmî aktivitelerle aynı. */
  const tohum = new Map(OFFICIAL.map(a => [a.slug, a]));
  for (const r of TAKVIM) {
    const bagli = klasor(r.klasor).etkinlik;
    if (!bagli) continue;
    assert.equal(r.baslangic, tohum.get(bagli).baslangic, r.ad);
  }
});

test('toplantı iç klasörleri faaliyet dosyasının parçalarına bağlanır', async () => {
  const { bagliParca, parcaKlasoru } = await import('../lib/klasor.mjs');
  assert.deepEqual(bagliParca('05.1.tutanak'), { etkinlik: 'wp2-a3-acilis-toplantisi', parca: 'tutanak' });
  assert.deepEqual(bagliParca('05.1.ajanda'), { etkinlik: 'wp2-a3-acilis-toplantisi', parca: 'gundem' });
  assert.deepEqual(bagliParca('05.1.katilim'), { etkinlik: 'wp2-a3-acilis-toplantisi', parca: 'yoklama' });
  /* Sunumun faaliyet dosyasında karşılığı yok; 05.9'un faaliyeti yok. */
  assert.equal(bagliParca('05.1.sunum'), null);
  assert.equal(bagliParca('05.9.tutanak'), null);
  assert.equal(bagliParca('05.1'), null);
  assert.equal(bagliParca('04.2.nihai'), null);
  assert.equal(parcaKlasoru('wp4-a4-tpm6-final', 'yoklama'), '05.8.katilim');
  assert.equal(parcaKlasoru('wp4-a1-pilot', 'yoklama'), null, 'pilotun toplantı klasörü yok');
});
