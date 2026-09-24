import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError, PROJECT, partnerIds, partnerOf, venues, wpIds, types, statuses,
  requireDay, requireOneOf, requireText, requirePartners, requireProgress,
  checkPassword, checkUsername, hashPassword, verifyPassword, sniffPhoto,
  listOf, packList, shiftDay, daysBetween, MAX_TEXT, MIN_PASSWORD, PROGRESS_STEP,
  languages, readyLangs, hasOptions, answerable,
} from '../lib/data.mjs';

/**
 * Doğrulama kuralları: sunucunun "hayır" dediği yerler.
 *
 * Bu dosya hiçbir şey açmaz — kurallar saf işlevlerdir. Uçtan uca testler
 * (`yetki.test.mjs`) bu kuralların GERÇEKTEN uygulandığını ayrıca sınar;
 * burada kuralın kendisi doğrulanır.
 */

const reddeder = (islev, ...arg) =>
  assert.throws(() => islev(...arg), ValidationError, `reddetmeliydi: ${JSON.stringify(arg[0])}`);

test('requireDay yalnızca YYYY-AA-GG biçimini kabul eder', () => {
  assert.equal(requireDay('2026-10-01', 'Tarih'), '2026-10-01');
  /* ISO damgası gelirse gün kısmı alınır: veritabanı bazı sürücülerde
     tarihi damgayla döndürüyor. */
  assert.equal(requireDay('2026-10-01T09:00:00Z', 'Tarih'), '2026-10-01');
  for (const bozuk of ['', '01.10.2026', '2026-13-01', '2026-02-30', 'bugün', null, undefined]) {
    reddeder(requireDay, bozuk, 'Tarih');
  }
});

test('requireOneOf listede olmayanı reddeder', () => {
  assert.equal(requireOneOf('WP2', wpIds, 'İş paketi'), 'WP2');
  assert.equal(requireOneOf('tpm', types, 'Tür'), 'tpm');
  reddeder(requireOneOf, 'WP9', wpIds, 'İş paketi');
  reddeder(requireOneOf, '', statuses, 'Durum');
});

test('requireText kırpar, zorunluluğu ve uzunluğu denetler', () => {
  assert.equal(requireText('  Açılış Toplantısı  ', 'Ad'), 'Açılış Toplantısı');
  assert.equal(requireText('', 'Ad', { required: false }), '');
  reddeder(requireText, '   ', 'Ad');
  reddeder(requireText, 'x'.repeat(MAX_TEXT + 1), 'Ad');
  assert.equal(requireText('x'.repeat(MAX_TEXT), 'Ad').length, MAX_TEXT);
});

test('requirePartners tanınmayan kurumu reddeder ve sırayı listeye uydurur', () => {
  /* Sıra sabittir: veritabanına yazılan dizgenin ve arayüzdeki listenin
     aynı sırada olması, iki kaydın karşılaştırılabilmesi demek. */
  assert.deepEqual(requirePartners(['geoclub', 'hbv'], 'Katılımcılar'), ['hbv', 'geoclub']);
  assert.deepEqual(requirePartners('|hbv|bte|', 'Katılımcılar'), ['hbv', 'bte']);
  assert.deepEqual(requirePartners([], 'Katılımcılar'), []);
  reddeder(requirePartners, ['hbv', 'yok-boyle-kurum'], 'Katılımcılar');
});

test('requireProgress onar onar yuvarlar ve aralık dışını reddeder', () => {
  assert.equal(requireProgress(37), 40);
  assert.equal(requireProgress(34), 30);
  assert.equal(requireProgress(0), 0);
  assert.equal(requireProgress(100), 100);
  assert.equal(requireProgress(undefined), 0);
  assert.equal(requireProgress(5), PROGRESS_STEP);
  reddeder(requireProgress, 150);
  reddeder(requireProgress, -1);
  reddeder(requireProgress, 'yarısı');
});

test('parola: en az sınır, özet ve doğrulama', () => {
  const parola = 'CokGizliParola2026';
  assert.equal(checkPassword(parola), parola);
  reddeder(checkPassword, 'x'.repeat(MIN_PASSWORD - 1));
  reddeder(checkPassword, 'x'.repeat(201));
  reddeder(checkPassword, 12345678901234);

  const ozet = hashPassword(parola);
  assert.ok(verifyPassword(parola, ozet));
  assert.ok(!verifyPassword(parola + 'x', ozet));
  /* Aynı parola her seferinde farklı tuz alır. */
  assert.notEqual(ozet, hashPassword(parola));
  /* Bozuk özet 500'e dönmemeli, geçersiz sayılmalı. */
  for (const bozuk of ['', 'tuzyok', 'tuz:kisa', 'tuz:' + 'z'.repeat(128)]) {
    assert.equal(verifyPassword(parola, bozuk), false);
  }
});

test('kullanıcı adı: ad+soyad bitişik, küçük harf, ASCII', () => {
  assert.equal(checkUsername('  ErdalDelebe '), 'erdaldelebe');
  assert.equal(checkUsername('maria.rossi'), 'maria.rossi');
  reddeder(checkUsername, 'ab');
  reddeder(checkUsername, 'erdal delebe');
  reddeder(checkUsername, 'şükrüçelik');
  reddeder(checkUsername, 'x'.repeat(41));
});

test('sniffPhoto türü baytlardan çıkarır, SVG geçmez', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16)]);
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
  assert.equal(sniffPhoto(jpeg), 'image/jpeg');
  assert.equal(sniffPhoto(png), 'image/png');
  assert.equal(sniffPhoto(gif), 'image/gif');
  assert.equal(sniffPhoto(webp), 'image/webp');

  /* SVG bilerek dışarıda: içine betik gömülebiliyor ve aynı kökenden
     sunulduğu için oturum çerezine erişebilirdi. */
  assert.equal(sniffPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffPhoto(Buffer.from('%PDF-1.7 ....................')), null);
  assert.equal(sniffPhoto(Buffer.from([0xff, 0xd8])), null, 'kısa dosya tür veremez');
});

test('kurum listesi metne paketlenir ve geri okunur', () => {
  assert.equal(packList(['hbv', 'bte']), '|hbv|bte|');
  assert.deepEqual(listOf('|hbv|bte|'), ['hbv', 'bte']);
  assert.deepEqual(listOf('||'), []);
  assert.deepEqual(listOf(''), []);
  assert.deepEqual(listOf(packList([])), []);
});

test('gün aritmetiği yaz saatinden etkilenmez', () => {
  assert.equal(shiftDay('2026-10-01', 1), '2026-10-02');
  assert.equal(shiftDay('2026-10-01', -1), '2026-09-30');
  /* Avrupa'da saatlerin geri alındığı hafta sonu: yerel saatle hesaplansaydı
     bir gün kayardı. */
  assert.equal(shiftDay('2026-10-24', 2), '2026-10-26');
  assert.equal(daysBetween('2026-10-01', '2026-10-31'), 30);
  assert.equal(daysBetween(PROJECT.start, PROJECT.end), 730);
});

test('proje künyesi ve ortak listesi başvuru formuyla uyumlu', () => {
  assert.equal(PROJECT.formId, 'KA220-YOU-70AE2506');
  assert.equal(PROJECT.start, '2026-10-01');
  assert.equal(PROJECT.end, '2028-09-30');
  assert.equal(PROJECT.months, 24);
  assert.equal(partnerIds.length, 7);
  /* Sıra listenin göründüğü her yeri belirler: koordinatör başta,
     eş koordinatör BTE ikinci (kullanıcı kararı). */
  assert.equal(partnerIds[0], 'hbv');
  assert.equal(partnerIds[1], 'bte');
  assert.ok(partnerOf('hbv').coordinator, 'HBV koordinatördür');
  assert.equal(partnerIds.filter(id => partnerOf(id).coordinator).length, 1, 'tek koordinatör');
  /* Her ortağın ülkesi etkinlik yeri olarak seçilebilmeli. */
  for (const id of partnerIds) assert.ok(venues.includes(partnerOf(id).country), `${id} ülkesi yerler listesinde`);
  /* Kimlikler benzersiz olmalı. */
  assert.equal(new Set(partnerIds).size, partnerIds.length);
});

test('dil listesi: yayına alma tek alandan yürür', () => {
  assert.deepEqual(readyLangs(), ['tr', 'en']);
  assert.equal(languages.length, 6);
  assert.equal(new Set(languages.map(l => l.code)).size, 6);
});

test('soru türleri: seçenek taşıyanlar ve yanıtlanabilirler', () => {
  assert.ok(hasOptions('tekli') && hasOptions('coklu') && hasOptions('liste'));
  assert.ok(!hasOptions('kisa') && !hasOptions('sayi'));
  /* `bolum` soru değil sayfa başlığıdır: yanıtı yoktur, özete girmez. */
  assert.ok(!answerable({ type: 'bolum' }));
  assert.ok(answerable({ type: 'kisa' }));
});

test('görev durumu: değiştirilen alan kazanır, tamamlanan görev yeniden açılır', async () => {
  const { gorevDurumu } = await import('../lib/data.mjs');
  const tamam = { durum: 'tamamlandi', ilerleme: 100 };
  /* Açılır listeden "devam ediyor": eskiden %100 yüzünden tamamlandıya dönüyordu. */
  assert.deepEqual(gorevDurumu('devam', 100, tamam), ['devam', 90]);
  assert.deepEqual(gorevDurumu('bekliyor', 100, tamam), ['bekliyor', 0]);
  /* Kaydırıcı %100'den aşağı: durum ilerlemeden çıkar. */
  assert.deepEqual(gorevDurumu('tamamlandi', 60, tamam), ['devam', 60]);
  assert.deepEqual(gorevDurumu('tamamlandi', 0, tamam), ['bekliyor', 0]);
  /* Uçlar yine bağlı. */
  assert.deepEqual(gorevDurumu('devam', 100, { durum: 'devam', ilerleme: 90 }), ['tamamlandi', 100]);
  assert.deepEqual(gorevDurumu('tamamlandi', 40, { durum: 'devam', ilerleme: 40 }), ['tamamlandi', 100]);
  assert.deepEqual(gorevDurumu('iptal', 40, { durum: 'devam', ilerleme: 40 }), ['iptal', 0]);
  /* Yeni görev (önceki yok). */
  assert.deepEqual(gorevDurumu('bekliyor', 30), ['devam', 30]);
  assert.deepEqual(gorevDurumu('devam', 100), ['tamamlandi', 100]);
});
