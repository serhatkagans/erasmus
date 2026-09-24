import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durumBekliyor, teslimBekliyor, parcalar } from '../lib/faaliyet.mjs';

/**
 * İlerleme çubukları elle ilerliyor; unutulan kayıtlar hatırlatılır.
 * Kural tarihe bağlı olduğundan saf işlev olarak, bugünü vererek sınanır —
 * resmî program 2026 Ekim'de başladığı için sunucu üzerinden "geçmiş"
 * bir faaliyet kurmak mümkün değil.
 */
test('bitmiş ama tamamlandı yapılmamış faaliyet hatırlatılır', () => {
  const e = (bitis, durum) => ({ bitis, durum });
  assert.equal(durumBekliyor(e('2027-03-26', 'planlandi'), '2027-03-27'), true);
  assert.equal(durumBekliyor(e('2027-03-26', 'devam'), '2027-03-27'), true);
  assert.equal(durumBekliyor(e('2027-03-26', 'planlandi'), '2027-03-26'), false, 'bitiş günü kapsanır, o gün beklenmez');
  assert.equal(durumBekliyor(e('2027-03-26', 'tamamlandi'), '2027-04-01'), false);
  assert.equal(durumBekliyor(e('2027-03-26', 'ertelendi'), '2027-04-01'), false, 'ertelenen bilinçli bir karar');
});

test('teslim tarihi geçmiş ve teslim edilmemiş çıktı hatırlatılır', () => {
  assert.equal(teslimBekliyor({ teslim: '2027-02-28', durum: 'hazirlaniyor' }, '2027-03-01'), true);
  assert.equal(teslimBekliyor({ teslim: '2027-02-28', durum: 'teslim' }, '2027-03-01'), false);
  assert.equal(teslimBekliyor({ teslim: null, durum: 'planlandi' }, '2030-01-01'), false, 'tarihi olmayan çıktı gecikemez');
});

test('faaliyet dosyasının parçaları türe göre', () => {
  assert.equal(parcalar('tpm').length, 6);
  assert.deepEqual(parcalar('sanal'), ['gundem', 'yoklama', 'tutanak', 'anket']);
  assert.deepEqual(parcalar('cikti'), []);
});

test('bağdan önce toplantı klasörüne yüklenmiş belge parçayı tamamlar', async () => {
  const { dosyaOzetleri } = await import('../lib/faaliyet.mjs');
  const satirlar = {
    events: [{ id: 1, slug: 'wp2-a3-acilis-toplantisi', tur: 'tpm' }],
    event_files: [{ event_id: 1, tur: 'gundem' }],
    klasor_dosya: [{ klasor: '05.1.tutanak' }, { klasor: '05.1.sunum' }],
  };
  const db = { all: async sql => (/FROM events/.test(sql) ? satirlar.events : /FROM event_files/.test(sql) ? satirlar.event_files
    : /FROM klasor_dosya/.test(sql) ? satirlar.klasor_dosya : []) };
  const ozet = (await dosyaOzetleri(db))[1];
  assert.equal(ozet.toplam, 6);
  assert.deepEqual(ozet.eksik, ['infopack', 'yoklama', 'foto', 'anket'], 'gündem faaliyetten, tutanak klasörden; sunum parça değil');
});
