import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../lib/data.mjs';
import {
  validateForm, validateAnswers, protectQuestions, validRenames, renameAnswers,
  plainOf, richText, accepting, stateOf, targets, fills, questionsOf, answersOf,
  MAX_OPTIONS,
} from '../lib/forms.mjs';

/**
 * Form kuralları.
 *
 * Asıl sınanan şey SORU KORUMA: form yayımlandıktan sonra düzenlenince eski
 * yanıtların anlamı bozulmamalı. Bir soru yanıt aldıysa türü değişmez,
 * silinirse atılmaz (raporda kalır), seçeneğinin adı düzeltilirse eski
 * yanıtlar yeni ada taşınır. Bunlar sessizce bozulabilecek şeyler: yanlış
 * giderse kimse hata almaz, yalnızca rapor yanlış çıkar.
 */

/* Sözlük yerine anahtarın kendisi: hangi kuralın kırıldığı ileti metnine
   değil anahtara bakarak anlaşılsın. */
const t = (anahtar, degerler) => (degerler ? `${anahtar}:${JSON.stringify(degerler)}` : anahtar);
const reddeder = (islev, anahtar) => {
  let hata = null;
  try { islev(); } catch (e) { hata = e; }
  assert.ok(hata instanceof ValidationError, `ValidationError bekleniyordu, gelen: ${hata}`);
  if (anahtar) assert.ok(hata.message.startsWith(anahtar), `beklenen ${anahtar}, gelen ${hata.message}`);
};

const soru = (uzer = {}) => ({ id: 's1', type: 'kisa', title: 'Adınız', help: '', required: false, ...uzer });
const govde = (uzer = {}) => ({ baslik: 'Deneme formu', sorular: [soru()], ...uzer });

test('form gövdesi: başlık zorunlu, sorusuz form olmaz', () => {
  const f = validateForm(govde(), t);
  assert.equal(f.baslik, 'Deneme formu');
  assert.equal(f.hedef, '', 'hedef boşsa bütün kurumlar');
  assert.equal(f.kapali, 0);

  reddeder(() => validateForm(govde({ baslik: '' }), t), 'form.hata.bos');
  reddeder(() => validateForm(govde({ sorular: [] }), t), 'form.hata.sorusuz');
  /* Yalnızca bölüm başlığı olan form da sorusuzdur. */
  reddeder(() => validateForm(govde({ sorular: [{ id: 'b1', type: 'bolum', title: 'Giriş' }] }), t), 'form.hata.sorusuz');
  /* Kaldırılmış soru "en az bir soru" saymaz. */
  reddeder(() => validateForm(govde({ sorular: [soru({ archived: true })] }), t), 'form.hata.sorusuz');
});

test('hedef kitle: tanınmayan kurum reddedilir, sıra listeye uyar', () => {
  const f = validateForm(govde({ hedef: ['geoclub', 'hbv'] }), t);
  assert.equal(f.hedef, '|hbv|geoclub|', 'sıra ortak listesindeki sıradır');
  reddeder(() => validateForm(govde({ hedef: ['yok-boyle'] }), t), 'form.hata.hedef');
});

test('soru kimliği istemciden gelir ama biçimi ve tekilliği denetlenir', () => {
  reddeder(() => validateForm(govde({ sorular: [soru({ id: 'BÜYÜK' })] }), t), 'form.hata.soruKimlik');
  reddeder(() => validateForm(govde({ sorular: [soru(), soru()] }), t), 'form.hata.soruKimlik');
  reddeder(() => validateForm(govde({ sorular: [soru({ type: 'uydurma' })] }), t), 'form.hata.soruTuru');
});

test('seçenekler: en az bir tane, tekrar yok, sınır var', () => {
  const secimli = (options) => govde({ sorular: [soru({ type: 'tekli', options })] });
  assert.deepEqual(JSON.parse(validateForm(secimli(['Evet', 'Hayır']), t).sorular)[0].options, ['Evet', 'Hayır']);
  reddeder(() => validateForm(secimli([]), t), 'form.hata.secenekYok');
  reddeder(() => validateForm(secimli(['Evet', 'Evet']), t), 'form.hata.secenekTekrar');
  reddeder(() => validateForm(secimli(Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `S${i}`)), t), 'form.hata.cokSecenek');
});

test('biçimli metin: yalnızca izinli etiketler geçer', () => {
  assert.equal(richText('<b>Kalın</b> ve <i>italik</i>', 100, t, 'a'), '<b>Kalın</b> ve <i>italik</i>');
  /* Betik gömülü gövde reddedilir: saklanan değer ekrana doğrudan basılıyor. */
  reddeder(() => richText('<script>alert(1)</script>', 100, t, 'a'), 'form.hata.bicim');
  reddeder(() => richText('<b onclick="x">a</b>', 100, t, 'a'), 'form.hata.bicim');
  reddeder(() => richText('5 < 6', 100, t, 'a'), 'form.hata.bicim');
  /* Kaçışlı metin geçer. */
  assert.equal(richText('5 &lt; 6', 100, t, 'a'), '5 &lt; 6');
  /* Düz hâl: liste madde işaretine, <br> satır sonuna döner. */
  assert.equal(plainOf('<ul><li>bir</li><li>iki</li></ul>'), '• bir\n• iki');
  assert.equal(plainOf('bir<br>iki', true), 'bir iki');
});

test('yanıt doğrulama: tür başına kurallar', () => {
  const sorular = [
    soru({ id: 'a', type: 'kisa', required: true }),
    soru({ id: 'b', type: 'sayi' }),
    soru({ id: 'c', type: 'tekli', options: ['Evet', 'Hayır'] }),
    soru({ id: 'd', type: 'coklu', options: ['X', 'Y'] }),
    soru({ id: 'e', type: 'tarih' }),
    soru({ id: 'f', type: 'bolum' }),
  ];
  const oku = veri => JSON.parse(validateAnswers(sorular, veri, t));

  assert.deepEqual(oku({ a: ' Ana ', b: '3,5', c: 'Evet', d: ['Y', 'X'], e: '2027-06-01' }),
    { a: 'Ana', b: 3.5, c: 'Evet', d: ['X', 'Y'], e: '2027-06-01' });
  /* Çoklu seçim formdaki sıraya göre yazılır: iki yanıt karşılaştırılabilsin. */
  assert.deepEqual(oku({ a: 'x', d: ['Y', 'X'] }).d, ['X', 'Y']);
  /* Bölüm yanıt almaz, formda olmayan anahtar atılır. */
  assert.equal(oku({ a: 'x', f: 'yok', zzz: 'yok' }).f, undefined);

  reddeder(() => validateAnswers(sorular, {}, t), 'form.hata.zorunlu');
  reddeder(() => validateAnswers(sorular, { a: 'x', b: 'abc' }, t), 'form.hata.sayi');
  reddeder(() => validateAnswers(sorular, { a: 'x', c: 'Belki' }, t), 'form.hata.secim');
  reddeder(() => validateAnswers(sorular, { a: 'x', d: ['Z'] }, t), 'form.hata.secim');
  reddeder(() => validateAnswers(sorular, { a: 'x', e: '2027-02-30' }, t), 'form.hata.tarih');
});

test('taslak yanıt: zorunluluk aranmaz, bozuk değer sessizce atılır', () => {
  const sorular = [soru({ id: 'a', required: true }), soru({ id: 'b', type: 'sayi' })];
  const taslak = JSON.parse(validateAnswers(sorular, { b: 'abc' }, t, { partial: true }));
  assert.deepEqual(taslak, {}, 'hatalı sayı taslakta hata vermez, yazılmaz');
  assert.deepEqual(JSON.parse(validateAnswers(sorular, { a: 'yarım' }, t, { partial: true })), { a: 'yarım' });
});

test('soru koruma: yanıt almış sorunun türü kilitli, silineni kaldırılır', () => {
  const once = [soru({ id: 'a', type: 'sayi' }), soru({ id: 'b' })];
  const yanitlanan = new Set(['a']);

  /* Tür değişikliği reddedilir: eski yanıtların biçimi bozulurdu. */
  reddeder(() => protectQuestions(once, JSON.stringify([soru({ id: 'a', type: 'kisa' })]), yanitlanan, t), 'form.hata.turKilit');

  /* Listeden çıkarılan yanıtlı soru atılmaz, kaldırılmış olarak sona eklenir. */
  const sonra = JSON.parse(protectQuestions(once, JSON.stringify([soru({ id: 'b' })]), yanitlanan, t));
  const kaldirilan = sonra.find(q => q.id === 'a');
  assert.ok(kaldirilan?.archived, 'yanıtlı soru raporda kalmalı');
  assert.equal(kaldirilan.required, false, 'kaldırılan soru zorunlu kalamaz');

  /* Yanıtsız soru gerçekten silinir. */
  const temiz = JSON.parse(protectQuestions(once, JSON.stringify([soru({ id: 'a', type: 'sayi' })]), yanitlanan, t));
  assert.ok(!temiz.some(q => q.id === 'b'));
});

test('seçenek adı düzeltmesi eski yanıtlara işlenir', () => {
  const once = [soru({ id: 'a', type: 'tekli', options: ['Evet', 'Hayır'] })];
  const sonra = [soru({ id: 'a', type: 'tekli', options: ['Katılıyorum', 'Hayır'] })];
  const renames = validRenames({ a: { Evet: 'Katılıyorum' } }, once, sonra);
  assert.deepEqual(renames, { a: { Evet: 'Katılıyorum' } });

  assert.equal(renameAnswers(JSON.stringify({ a: 'Evet' }), renames), JSON.stringify({ a: 'Katılıyorum' }));
  /* Değişmeyen yanıt için null döner: gereksiz UPDATE yapılmasın. */
  assert.equal(renameAnswers(JSON.stringify({ a: 'Hayır' }), renames), null);
  /* Çoklu seçimde de taşınır. */
  assert.equal(renameAnswers(JSON.stringify({ a: ['Evet', 'Hayır'] }), renames), JSON.stringify({ a: ['Katılıyorum', 'Hayır'] }));

  /* Uydurma eşleme geçmez: eski ad eski formda, yeni ad yeni formda olmalı. */
  assert.deepEqual(validRenames({ a: { Uydurma: 'Katılıyorum' } }, once, sonra), {});
  assert.deepEqual(validRenames({ a: { Evet: 'Uydurma' } }, once, sonra), {});
});

test('form hâli: yayın, kapatma ve son tarih birlikte karar verir', () => {
  const gun = '2027-06-01';
  const simdi = new Date(`${gun}T12:00:00Z`);

  assert.equal(accepting({ durum: 'taslak', son_tarih: '' }, simdi), false, 'taslak yanıt almaz');
  assert.equal(accepting({ durum: 'yayinda', kapali: 1 }, simdi), false, 'durdurulmuş form yanıt almaz');
  assert.equal(accepting({ durum: 'yayinda', son_tarih: '2027-05-31' }, simdi), false, 'süresi dolmuş');
  /* Son gün DAHİLDİR: o günün sonuna kadar yanıt alınır. */
  assert.equal(accepting({ durum: 'yayinda', son_tarih: gun }, simdi), true);
  assert.equal(accepting({ durum: 'yayinda', son_tarih: '' }, simdi), true);

  assert.equal(stateOf({ durum: 'taslak' }, simdi), 'taslak');
  assert.equal(stateOf({ durum: 'yayinda', son_tarih: '' }, simdi), 'acik');
  assert.equal(stateOf({ durum: 'yayinda', kapali: 1 }, simdi), 'kapali');
});

test('hedef kitle ve doldurma yetkisi', () => {
  const herkese = { hedef: '', koordinator_doldurur: 0 };
  const secili = { hedef: '|geoclub|', koordinator_doldurur: 0 };

  assert.ok(targets(herkese, 'hbv') && targets(herkese, 'geoclub'));
  assert.ok(targets(secili, 'geoclub') && !targets(secili, 'hbv'));

  /* Koordinatör hedef kitleden değil, kendi anahtarından geçer: formu o
     hazırlıyor, doldurması ayrı bir karar. */
  assert.equal(fills(herkese, { koordinator: true, partner: 'hbv' }), false);
  assert.equal(fills({ ...herkese, koordinator_doldurur: 1 }, { koordinator: true, partner: 'hbv' }), true);
  assert.equal(fills(secili, { koordinator: false, partner: 'geoclub' }), true);
  assert.equal(fills(secili, { koordinator: false, partner: 'educpro' }), false);
});

test('bozuk JSON sütunu çökertmez', () => {
  assert.deepEqual(questionsOf({ sorular: 'bozuk' }), []);
  assert.deepEqual(questionsOf({ sorular: '{"a":1}' }), [], 'dizi olmayan değer liste sayılmaz');
  assert.deepEqual(answersOf({ yanitlar: 'bozuk' }), {});
  assert.deepEqual(answersOf({ yanitlar: '[1,2]' }), {}, 'dizi yanıt nesnesi değildir');
});
