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
