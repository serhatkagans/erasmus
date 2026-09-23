import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, PROJECT } from '../lib/data.mjs';
import {
  belgeTuruMu, belgeMetniUret, aliciAdiniCoz, imzaBilgisiniCoz,
  imzaUnvaniOner, ozelMetniCoz, topluAlicilariSec, MAX_BELGE,
} from '../lib/belge.mjs';
import { metinler, donemBilgisi, tarihAraligi } from '../lib/rapor.mjs';
import { loadLocale } from '../lib/i18n.mjs';
import { OFFICIAL, participantsOf } from '../lib/tohum.mjs';

/**
 * Belge ve rapor metin üreticileri.
 *
 * Bu iki dosya SAFTIR: veritabanına bakmaz, metni sözlükten kurar. Bu
 * yüzden gerçek `locales/*.json` ile denenebilirler — ve denenmelidir,
 * çünkü asıl kırılgan nokta ÇEVİRİ ANAHTARLARININ VARLIĞIDIR. Anahtar
 * yoksa `t()` sessizce anahtarın kendisini döndürür ve belgeye
 * "belge.govde.katilim.proje" yazılır; kimse hata almaz.
 */

const sozlukler = { tr: await loadLocale('tr'), en: await loadLocale('en') };
const m = dil => metinler(sozlukler[dil], dil);

const reddeder = (islev, ...arg) => assert.throws(() => islev(...arg), ValidationError);

test('belge türü listesi kapalıdır', () => {
  assert.ok(belgeTuruMu('katilim') && belgeTuruMu('tesekkur'));
  for (const uydurma of ['sertifika', '', 'KATILIM', null]) assert.ok(!belgeTuruMu(uydurma));
});

test('alıcı adı kırpılır, boş ve uzun reddedilir', () => {
  assert.equal(aliciAdiniCoz('  Ana   Popescu '), 'Ana Popescu');
  reddeder(aliciAdiniCoz, '   ');
  reddeder(aliciAdiniCoz, 'A'.repeat(121));
  assert.equal(aliciAdiniCoz('A'.repeat(120)).length, 120);
});

test('imza: ad zorunlu, unvan boşsa önerilen kullanılır', () => {
  /* İmzasız katılım belgesi resmî olarak işe yaramaz. */
  reddeder(imzaBilgisiniCoz, { ad: '', unvan: 'Koordinatör' });
  reddeder(imzaBilgisiniCoz, { ad: 'A'.repeat(121) });
  reddeder(imzaBilgisiniCoz, { ad: 'Ad Soyad', unvan: 'U'.repeat(121) });

  assert.deepEqual(imzaBilgisiniCoz({ ad: ' Ad  Soyad ', unvan: ' Rektör ' }), { adSoyad: 'Ad Soyad', unvan: 'Rektör' });
  assert.deepEqual(
    imzaBilgisiniCoz({ ad: 'Ad Soyad', unvan: '', varsayilanUnvan: 'Proje Koordinatörü' }),
    { adSoyad: 'Ad Soyad', unvan: 'Proje Koordinatörü' });
});

test('önerilen unvan kurumun projedeki sıfatından gelir', () => {
  const t = m('tr').t;
  assert.match(imzaUnvaniOner({ partner: 'hbv', koordinator: true }, t), /Koordinatör/);
  assert.match(imzaUnvaniOner({ partner: 'geoclub', koordinator: false }, t), /GEO CLUB/);
  /* Tanınmayan kurumda çökmez, genel sıfata düşer. */
  assert.equal(imzaUnvaniOner({ partner: 'yok', koordinator: false }, t), t('belge.imza.unvan.varsayilan'));
});

test('özel metin sınırı', () => {
  assert.equal(ozelMetniCoz('  merhaba  '), 'merhaba');
  assert.equal(ozelMetniCoz(undefined), '');
  reddeder(ozelMetniCoz, 'x'.repeat(1201));
});

test('belge gövdesi: etkinlikli ve proje geneli kalıpları ayrıdır', () => {
  const t = m('tr').t;
  const etkinlikli = belgeMetniUret({
    tur: 'katilim', ad: 'Ana Popescu', t,
    etkinlik: { baslik: 'Açılış Toplantısı', tarih: '15 Aralık 2026' },
  });
  const proje = belgeMetniUret({ tur: 'katilim', ad: 'Ana Popescu', t });

  assert.equal(etkinlikli.baslik, t('belge.tur.katilim'));
  assert.match(etkinlikli.govde, /Açılış Toplantısı/);
  assert.notEqual(etkinlikli.govde, proje.govde, 'iki kalıp ayrı olmalı');

  /* Kapanış cümlesi türe göre ayrıdır ve ortaklaştırılmamalıdır: katılım
     belgesi yalnızca orada bulunmayı belgeler, teşekkür belgesi desteği. */
  const tesekkur = belgeMetniUret({ tur: 'tesekkur', ad: 'Ana Popescu', t });
  assert.notEqual(tesekkur.govde, proje.govde);

  /* Hiçbir gövde ham anahtar olmamalı — eksik çeviri sessizce belgeye geçer. */
  for (const metin of [etkinlikli.govde, proje.govde, tesekkur.govde]) {
    assert.ok(!metin.startsWith('belge.'), `çeviri eksik: ${metin}`);
  }
});

test('tarih belgede bölünmez', () => {
  const { govde } = belgeMetniUret({
    tur: 'katilim', ad: 'X', t: m('tr').t,
    etkinlik: { baslik: 'TPM-1', tarih: '15 Aralık 2026' },
  });
  /* Bağlantısız boşluk (U+00A0): "15" üst satırda, "Aralık 2026" alt
     satırda kalmasın. */
  assert.match(govde, /15 Aralık 2026/);
  assert.ok(!govde.includes('15 Aralık 2026'), 'tarihte sıradan boşluk kalmamalı');
});

test('özel metin kalıbın yerine geçer', () => {
  const { govde } = belgeMetniUret({ tur: 'katilim', ad: 'X', ozelMetin: 'Elle yazılmış metin.', t: m('tr').t });
  assert.equal(govde, 'Elle yazılmış metin.');
});

test('toplu seçim adres çubuğundan gelen kimliği kabul etmez', () => {
  const adaylar = [
    { anahtar: 'uye:1', ad: 'Çiğdem Yılmaz' },
    { anahtar: 'uye:2', ad: 'Ana Popescu' },
    { anahtar: 'kurum:hbv', ad: 'Ankara Hacı Bayram Veli Üniversitesi' },
  ];
  /* Listede olmayan kimlik sessizce elenir: kesişim alınır. */
  const secim = topluAlicilariSec({ adaylar, istenenler: ['uye:2', 'uye:999'] });
  assert.deepEqual(secim.map(x => x.anahtar), ['uye:2']);

  /* Hiç seçim yoksa hata; sınır aşılırsa hata. */
  reddeder(topluAlicilariSec, { adaylar, istenenler: ['uye:999'] });
  reddeder(topluAlicilariSec, {
    adaylar: [], istenenler: [],
    serbest: Array.from({ length: MAX_BELGE + 1 }, (_, i) => ({ ad: `Kişi ${i}` })),
  });
});

test('toplu seçim sırası dile göre kurulur', () => {
  const adaylar = [
    { anahtar: 'a', ad: 'Işık Demir' },
    { anahtar: 'b', ad: 'Irmak Kaya' },
  ];
  /* Türkçede "ı" harfi "i"den ÖNCE gelir; varsayılan sıralama bunu bilmez
     ve basılan deste elle dağıtılırken listeyle eşleşmez. */
  const tr = topluAlicilariSec({ adaylar, istenenler: ['a', 'b'], dil: 'tr' }).map(x => x.ad);
  assert.deepEqual(tr, ['Irmak Kaya', 'Işık Demir']);
});

test('rapor dönemi: tam proje, tam ay ve gün aralığı ayrı yazılır', () => {
  const tr = m('tr');
  assert.equal(donemBilgisi(tr, PROJECT.start, PROJECT.end).slug, 'tum-proje');
  assert.equal(donemBilgisi(tr, '2026-10-01', '2026-10-31').slug, '2026-10');
  assert.equal(donemBilgisi(tr, '2026-10-01', '2027-01-31').slug, '2026-10_2027-01');
  assert.equal(donemBilgisi(tr, '2026-10-05', '2026-10-20').slug, '2026-10-05_2026-10-20');
});

test('tarih aralığı dile göre kurulur', () => {
  /* Elle birleştirildiğinde İngilizce çıktı "15–December 16, 2026"
     oluyordu; Intl.formatRange sırayı dile bırakıyor. */
  const tr = tarihAraligi(m('tr'), '2026-12-15', '2026-12-16');
  const en = tarihAraligi(m('en'), '2026-12-15', '2026-12-16');
  assert.match(tr, /Aralık/);
  assert.match(en, /December/);
  assert.notEqual(tr, en);
  /* Tek günlük etkinlikte aralık değil tek tarih yazılır. */
  assert.equal(tarihAraligi(m('tr'), '2026-12-15', '2026-12-15'), m('tr').tamTarih('2026-12-15'));
});

test('resmî aktivitenin adı sözlükten, yerel kaydınki veritabanından gelir', () => {
  const tr = m('tr');
  const resmi = { slug: OFFICIAL[0].slug, baslik: '', kod: OFFICIAL[0].kod, wp: OFFICIAL[0].wp };
  assert.notEqual(tr.baslik(resmi), resmi.kod, 'resmî kaydın adı sözlükte olmalı');
  assert.equal(tr.baslik({ slug: null, baslik: 'Bükreş Çoğaltıcı Etkinliği', kod: '', wp: 'WP4' }), 'Bükreş Çoğaltıcı Etkinliği');
  /* Hiçbiri yoksa koda, o da yoksa iş paketine düşer — boş başlık çıkmaz. */
  assert.equal(tr.baslik({ slug: null, baslik: '', kod: 'X-9', wp: 'WP4' }), 'X-9');
  assert.equal(tr.baslik({ slug: null, baslik: '', kod: '', wp: 'WP4' }), 'WP4');
});

test('başvurudaki 14 resmî aktivite: tarihler, kimlikler ve çevirileri', () => {
  assert.equal(OFFICIAL.length, 14);
  assert.equal(new Set(OFFICIAL.map(a => a.slug)).size, 14, 'slug benzersiz olmalı');

  for (const a of OFFICIAL) {
    assert.ok(a.baslangic <= a.bitis, `${a.slug}: bitiş başlangıçtan önce`);
    /* Program dışına düşen resmî tarih, aynı kuralı kullanıcıya
       uygulayan doğrulamayla çelişirdi. */
    assert.ok(a.baslangic >= PROJECT.start && a.bitis <= PROJECT.end, `${a.slug}: proje dışı tarih`);
    /* Lider kendi etkinliğinde ayrıca katılımcı olarak yazılmaz. */
    assert.ok(!participantsOf(a, ['hbv', 'bte', a.lider]).includes(a.lider));

    /* ÇEVİRİ ANAHTARI EKSİKSE sessizce anahtarın kendisi görünür:
       takvimde "etkinlik.wp2-a1-ihtiyac-analizi.baslik" yazardı. */
    for (const dil of ['tr', 'en']) {
      assert.ok(sozlukler[dil][`etkinlik.${a.slug}.baslik`], `${dil}: ${a.slug} başlığı eksik`);
      assert.ok(sozlukler[dil][`etkinlik.${a.slug}.ozet`], `${dil}: ${a.slug} özeti eksik`);
    }
  }
});

test('yayındaki diller aynı anahtar kümesini taşır', () => {
  /* Bir dilde olup öbüründe olmayan anahtar, o dilde ham anahtar
     görünmesi demek. `/api/ceviri-durumu` bunu sayar; burada kırılır. */
  const tr = Object.keys(sozlukler.tr).sort();
  const en = Object.keys(sozlukler.en).sort();
  assert.deepEqual(en.filter(k => !sozlukler.tr[k]), [], 'Türkçede eksik anahtar');
  assert.deepEqual(tr.filter(k => !sozlukler.en[k]), [], 'İngilizcede eksik anahtar');

  /* Yer tutucular da eşleşmeli: çeviride `%{n}` unutulursa sayı hiç
     yazılmaz ve kimse hata almaz. */
  const tutucular = metin => [...String(metin).matchAll(/%\{(\w+)\}/g)].map(x => x[1]).sort();
  for (const anahtar of tr) {
    assert.deepEqual(tutucular(sozlukler.en[anahtar]), tutucular(sozlukler.tr[anahtar]),
      `${anahtar}: yer tutucular uyuşmuyor`);
  }
});
