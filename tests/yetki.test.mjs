import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT } from '../lib/data.mjs';
import { sunucuBaslat, istemci, HESAPLAR, KOORDINATOR, ORTAK, ORTAK2 } from './yardim.mjs';

/**
 * Yetki sınırları — uçtan uca.
 *
 * Yetki tek bir işlevde durmuyor: oturum çerezi, CSRF denetimi, route
 * kuralları ve doğrulama birlikte karar veriyor. Bu yüzden testler GERÇEK
 * SUNUCUYA istek atıyor; işlevleri tek tek çağırmak "bu istek geçer mi"
 * sorusunu sormamak olurdu.
 *
 * Her sınama bir REDDİ doğruluyor. Kabul edilen yol da yanında duruyor:
 * yalnızca redde bakan bir test, her şeyi reddeden bozuk bir sunucuda da
 * yeşil kalırdı.
 */

let sunucu;
before(async () => { sunucu = await sunucuBaslat({ hesaplar: HESAPLAR }); });
after(async () => { await sunucu?.kapat(); });

/** Geçerli bir etkinlik gövdesi; testler gereken alanı değiştirip yollar. */
const etkinlik = (uzer = {}) => ({
  wp: 'WP4', kod: '', tur: 'cogaltici', yer: 'RO', lider: 'geoclub',
  katilimcilar: [], baslik: 'Test etkinliği', ozet: '',
  baslangic: '2028-03-01', bitis: '2028-03-02', durum: 'planlandi', url: '',
  ...uzer,
});

test('platform dışarıya kapalı: oturumsuz kişi yalnızca giriş ve profil kartını görür', async () => {
  const anonim = await istemci(sunucu);

  /* Veri uçları 401. */
  for (const yol of ['/api/etkinlikler', '/api/foto/1', '/api/ekip', '/api/formlar', '/api/klasorler', '/api/hatirlaticilar', '/api/ceviri-durumu', '/takvim.ics']) {
    assert.equal((await anonim.iste(yol)).durum, 401, yol);
  }
  const yazma = await anonim.iste('/api/etkinlikler', { method: 'POST', body: etkinlik() });
  assert.equal(yazma.durum, 401);

  /* Sayfalar girişe yönlenir; geri dönülecek adres taşınır. */
  const ana = await anonim.iste('/');
  assert.equal(ana.durum, 302);
  assert.equal(ana.basliklar.get('location'), 'giris.html');
  const takvim = await anonim.iste('/takvim.html?gorunum=liste');
  assert.equal(takvim.durum, 302);
  assert.equal(takvim.basliklar.get('location'), 'giris.html?geri=' + encodeURIComponent('takvim.html?gorunum=liste'));

  /* Açık kalanlar: giriş sayfası, açılış verisi, profil kartı, stil/betik. */
  for (const yol of ['/giris.html', '/profil.html', '/api/acilis', '/style.css', '/giris.js', '/logo.png']) {
    assert.equal((await anonim.iste(yol)).durum, 200, yol);
  }
  assert.equal((await anonim.iste(`/api/profil?u=${ORTAK.kullanici}`)).durum, 200);

  /* Giriş yapan program verisini görür. */
  const ortak = await istemci(sunucu, ORTAK);
  const liste = await ortak.iste('/api/etkinlikler');
  assert.equal(liste.durum, 200);
  assert.equal(liste.veri.etkinlikler.length, 14, 'başvurudaki resmî program görünür');
  assert.equal((await ortak.iste('/')).durum, 200);
});

test('Origin başlığı olmayan yazma reddedilir', async () => {
  const ortak = await istemci(sunucu, ORTAK);
  /* Başka bir siteden gelen istekte Origin ya yoktur ya da saldırganın
     alan adıdır; ikisi de sunucununkiyle uyuşmaz. */
  const origin_suz = await ortak.iste('/api/etkinlikler', { method: 'POST', body: etkinlik(), origin: false });
  assert.equal(origin_suz.durum, 403);

  const yabanci = await ortak.iste('/api/etkinlikler', {
    method: 'POST', body: etkinlik(), origin: false, headers: { origin: 'https://baska-site.example' },
  });
  assert.equal(yabanci.durum, 403);

  /* Aynı istek doğru Origin ile geçer. */
  const dogru = await ortak.iste('/api/etkinlikler', { method: 'POST', body: etkinlik() });
  assert.equal(dogru.durum, 201);
});

test('ortak hesabı başka kurumu lider gösteremez', async () => {
  const ortak = await istemci(sunucu, ORTAK);   // GEO CLUB
  const baskasi = await ortak.iste('/api/etkinlikler', { method: 'POST', body: etkinlik({ lider: 'hbv' }) });
  assert.equal(baskasi.durum, 400);
  assert.match(baskasi.veri.error, /kendi kurumunuzun/i);

  /* Koordinatör serbesttir. */
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const serbest = await koordinator.iste('/api/etkinlikler', { method: 'POST', body: etkinlik({ lider: 'educpro' }) });
  assert.equal(serbest.durum, 201);
});

test('ortak, başka kurumun etkinliğini düzenleyemez ve silemez', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const olustur = await koordinator.iste('/api/etkinlikler', {
    method: 'POST', body: etkinlik({ lider: 'educpro', baslik: 'EducPro etkinliği' }),
  });
  assert.equal(olustur.durum, 201);
  const id = olustur.veri.id;

  const ortak = await istemci(sunucu, ORTAK);   // GEO CLUB
  const duzenle = await ortak.iste(`/api/etkinlikler/${id}`, { method: 'PUT', body: etkinlik({ lider: 'educpro' }) });
  assert.equal(duzenle.durum, 403);
  const sil = await ortak.iste(`/api/etkinlikler/${id}`, { method: 'DELETE' });
  assert.equal(sil.durum, 403);

  /* Sahibi silebilir. */
  const silme = await koordinator.iste(`/api/etkinlikler/${id}`, { method: 'DELETE' });
  assert.equal(silme.durum, 200);
});

test('resmî aktivite silinemez; ortak yalnızca durum ve bağlantı değiştirir', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const liste = await koordinator.iste('/api/etkinlikler');
  const resmi = liste.veri.etkinlikler.find(e => e.resmi && e.lider === 'geoclub');
  assert.ok(resmi, 'GEO CLUB liderliğinde resmî aktivite var');

  /* Başvuru formundaki program koordinatör için de silinemez. */
  const sil = await koordinator.iste(`/api/etkinlikler/${resmi.id}`, { method: 'DELETE' });
  assert.equal(sil.durum, 403);

  /* Ortak, kendi liderliğindeki resmî kaydın yalnızca durumunu ve
     bağlantısını değiştirebilir; gönderdiği başka alanlar yok sayılır. */
  const ortak = await istemci(sunucu, ORTAK);
  const duzenle = await ortak.iste(`/api/etkinlikler/${resmi.id}`, {
    method: 'PUT',
    body: { ...resmi, durum: 'devam', url: 'https://ornek.test/rapor', baslangic: '2028-01-01', wp: 'WP1', baslik: 'DEĞİŞTİ' },
  });
  assert.equal(duzenle.durum, 200);
  assert.equal(duzenle.veri.durum, 'devam');
  assert.equal(duzenle.veri.url, 'https://ornek.test/rapor');
  assert.equal(duzenle.veri.baslangic, resmi.baslangic, 'tarih kilitli kalmalı');
  assert.equal(duzenle.veri.wp, resmi.wp, 'iş paketi kilitli kalmalı');
});

test('proje dışı ve takvimde olmayan tarih reddedilir', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);

  for (const bozuk of [
    { baslangic: '2026-09-30', bitis: '2026-10-02' },          // proje başlamadan önce
    { baslangic: '2028-09-29', bitis: '2028-10-01' },          // proje bittikten sonra
    { baslangic: '2028-03-05', bitis: '2028-03-01' },          // bitiş başlangıçtan önce
    { baslangic: '2027-02-30', bitis: '2027-03-01' },          // takvimde olmayan gün
    { baslangic: '01.03.2028', bitis: '02.03.2028' },          // biçim
  ]) {
    const yanit = await koordinator.iste('/api/etkinlikler', { method: 'POST', body: etkinlik(bozuk) });
    assert.equal(yanit.durum, 400, `kabul edilmemeliydi: ${JSON.stringify(bozuk)}`);
  }

  /* Sınırın kendisi geçerlidir. */
  const sinir = await koordinator.iste('/api/etkinlikler', {
    method: 'POST', body: etkinlik({ baslangic: PROJECT.start, bitis: PROJECT.start }),
  });
  assert.equal(sinir.durum, 201);
});

test('belge: giriş şart, ortak yalnızca kendi kurumuna üretir', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  /* Belge üretilebilmesi için iki kurumda birer kişi. */
  /* Ekip üyesi sistemdeki bir hesaptır: kurumun kendi hesabı eklenir. */
  const adaylar = (await koordinator.iste('/api/ekip')).veri.adaylar;
  const hesap = kullanici => adaylar.find(a => a.ad === HESAPLAR.find(h => h.kullanici === kullanici).ad).id;
  const ekle = async (partner, userId) => {
    const y = await koordinator.iste('/api/ekip/uye', { method: 'POST', body: { partner, userId, rol: '', eposta: '' } });
    assert.equal(y.durum, 201, JSON.stringify(y.veri));
    return y.veri.id;
  };
  const geoUye = await ekle('geoclub', hesap('test-ortak'));
  const hbvUye = await ekle('hbv', hesap('test-koordinator'));

  const soru = alicilar => `/api/belge?tur=katilim&imzaAd=Imza%20Sahibi&alicilar=${alicilar}`;

  /* Anonim: program açık ama belge değil. */
  const anonim = await istemci(sunucu);
  assert.equal((await anonim.iste(soru(`uye:${geoUye}`))).durum, 401);

  /* Ortak kendi kurumuna üretir, başka kuruma üretemez. */
  const ortak = await istemci(sunucu, ORTAK);
  const kendi = await ortak.iste(soru(`uye:${geoUye}`));
  assert.equal(kendi.durum, 200);
  assert.equal(kendi.veri.belgeler.length, 1);
  assert.equal(kendi.veri.belgeler[0].ad, 'Test Ortak', 'ad ekip üyesinin hesabından gelir');

  const baskasi = await ortak.iste(soru(`uye:${hbvUye}`));
  assert.equal(baskasi.durum, 403);

  /* Kurumun kendisi de bir alıcıdır ve aynı kural geçer. */
  assert.equal((await ortak.iste(soru('kurum:geoclub'))).durum, 200);
  assert.equal((await ortak.iste(soru('kurum:hbv'))).durum, 403);

  /* Koordinatör herkese üretir; her kişi için AYRI belge çıkar. */
  const hepsi = await koordinator.iste(soru(`uye:${geoUye},uye:${hbvUye}`));
  assert.equal(hepsi.durum, 200);
  assert.equal(hepsi.veri.belgeler.length, 2);

  /* Kayıtlı olmayan kimlik adresten yazılamaz. */
  assert.equal((await koordinator.iste(soru('uye:999999'))).durum, 400);
  /* İmzasız belge üretilemez. */
  assert.equal((await koordinator.iste(`/api/belge?tur=katilim&alicilar=uye:${geoUye}`)).durum, 400);
});

test('ekip: üye sistemdeki bir hesaptır ve yalnızca kendi kurumunun ekibine girer', async () => {
  const ortak2 = await istemci(sunucu, ORTAK2);            // CECF
  const adaylar = (await ortak2.iste('/api/ekip')).veri.adaylar;
  const cecfli = adaylar.find(a => a.partner === 'cecf');
  const hbvli = adaylar.find(a => a.partner === 'hbv');

  /* Başka kurumun ekibine ekleyemez (yetki). */
  assert.equal((await ortak2.iste('/api/ekip/uye', { method: 'POST', body: { partner: 'hbv', userId: hbvli.id } })).durum, 403);
  /* Kendi ekibine başka kurumdan birini koyamaz. */
  assert.equal((await ortak2.iste('/api/ekip/uye', { method: 'POST', body: { partner: 'cecf', userId: hbvli.id } })).durum, 400);
  /* Dışarıdan ad yazılamaz: hesap seçilmeli. */
  assert.equal((await ortak2.iste('/api/ekip/uye', { method: 'POST', body: { partner: 'cecf', ad: 'Dışarıdan Biri' } })).durum, 400);

  /* Kendi kurumunun hesabı eklenir; aynı kişi ikinci kez eklenemez. */
  const eklendi = await ortak2.iste('/api/ekip/uye', { method: 'POST', body: { partner: 'cecf', userId: cecfli.id, rol: 'Proje sorumlusu' } });
  assert.equal(eklendi.durum, 201);
  assert.equal(eklendi.veri.ad, cecfli.ad, 'ad hesaptan gelir');
  assert.equal((await ortak2.iste('/api/ekip/uye', { method: 'POST', body: { partner: 'cecf', userId: cecfli.id } })).durum, 409);

  /* Koordinatöre de aynı kural: HBV'li biri CECF ekibine giremez. */
  const koordinator = await istemci(sunucu, KOORDINATOR);
  assert.equal((await koordinator.iste('/api/ekip/uye', { method: 'POST', body: { partner: 'cecf', userId: hbvli.id } })).durum, 400);

  /* Düzenlemede kişi değişmez: gönderilen ad yok sayılır. */
  const duzen = await ortak2.iste(`/api/ekip/uye/${eklendi.veri.id}`, { method: 'PUT', body: { ad: 'Başka Ad', rol: 'Eğitmen', eposta: '' } });
  assert.equal(duzen.durum, 200);
  assert.equal(duzen.veri.ad, cecfli.ad);
  assert.equal(duzen.veri.rol, 'Eğitmen');

  /* Ekipten çıkarılamaz — ne kurum ne koordinatör. */
  assert.equal((await ortak2.iste(`/api/ekip/uye/${eklendi.veri.id}`, { method: 'DELETE' })).durum, 400);
  assert.equal((await koordinator.iste(`/api/ekip/uye/${eklendi.veri.id}`, { method: 'DELETE' })).durum, 400);
  assert.ok((await ortak2.iste('/api/ekip')).veri.uyeler.some(u => u.id === eklendi.veri.id));
});

test('rapor giriş ister', async () => {
  const anonim = await istemci(sunucu);
  const yol = `/api/rapor?bas=${PROJECT.start}&bit=${PROJECT.end}&bicim=xlsx`;
  assert.equal((await anonim.iste(yol)).durum, 401);

  const koordinator = await istemci(sunucu, KOORDINATOR);
  const yanit = await koordinator.iste(yol);
  assert.equal(yanit.durum, 200);
  /* ZIP imzası: xlsx bir zip paketidir. */
  assert.equal(yanit.veri.subarray(0, 2).toString('ascii'), 'PK');
});

test('çıkış sonrası oturum geçersizdir', async () => {
  const ortak = await istemci(sunucu, ORTAK);
  assert.equal((await ortak.iste('/api/cikis', { method: 'POST' })).durum, 200);
  assert.equal((await ortak.iste('/api/etkinlikler', { method: 'POST', body: etkinlik() })).durum, 401);
});

test('yanlış parola girişi reddedilir', async () => {
  const anonim = await istemci(sunucu);
  const yanit = await anonim.iste('/api/giris', {
    method: 'POST', body: { kullanici: ORTAK.kullanici, parola: 'YanlisParola2026' },
  });
  assert.equal(yanit.durum, 401);
  /* Olmayan hesap da aynı yanıtı verir: hesabın varlığı sızmamalı. */
  const yok = await anonim.iste('/api/giris', { method: 'POST', body: { kullanici: 'yok-boyle', parola: 'YanlisParola2026' } });
  assert.equal(yok.durum, 401);
  assert.deepEqual(yok.veri, yanit.veri);
});

test('kullanıcı adı büyük/küçük harf ve boşluktan etkilenmez', async () => {
  /* Telefon klavyesi baş harfi büyütür; " Test-ORTAK " de aynı hesaptır. */
  const anonim = await istemci(sunucu);
  const yanit = await anonim.iste('/api/giris', {
    method: 'POST', body: { kullanici: ' Test-ORTAK ', parola: ORTAK.parola },
  });
  assert.equal(yanit.durum, 200);
});

/* --- Formlar --------------------------------------------------------------
   Form yetkisi üç katmanda karar veriliyor: kim hazırlar (koordinatör), kim
   görür (hedef kitle + yayın durumu), kim doldurur (`fills`). Üçü de burada
   bir reddiyle sınanıyor. */

/** Geçerli bir form gövdesi. */
const formGovde = (uzer = {}) => ({
  baslik: 'Test formu',
  sorular: [{ id: 's1', type: 'kisa', title: 'Adınız', help: '', required: true }],
  hedef: [], koordinatorDoldurur: false, kapali: false, sonTarih: '',
  ...uzer,
});

test('form: yalnızca koordinatör hazırlar', async () => {
  const ortak = await istemci(sunucu, ORTAK);
  const reddedildi = await ortak.iste('/api/formlar', { method: 'POST', body: formGovde() });
  assert.equal(reddedildi.durum, 403);

  const koordinator = await istemci(sunucu, KOORDINATOR);
  const olustu = await koordinator.iste('/api/formlar', { method: 'POST', body: formGovde() });
  assert.equal(olustu.durum, 201);
  /* Yeni form TASLAK başlar: ortaklar görmez. */
  const gorunum = await koordinator.iste('/api/formlar/' + olustu.veri.id);
  assert.equal(gorunum.veri.durum, 'taslak');
  assert.equal((await ortak.iste('/api/formlar/' + olustu.veri.id)).durum, 404, 'taslak form ortağa görünmez');
});

test('form: hedef kitle dışındaki kurum formu göremez', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  /* Yalnızca EducPro'ya açık bir form; test ortağı GEO CLUB. */
  const olustu = await koordinator.iste('/api/formlar', { method: 'POST', body: formGovde({ hedef: ['educpro'] }) });
  const id = olustu.veri.id;
  assert.equal((await koordinator.iste(`/api/formlar/${id}/durum`, { method: 'PUT', body: { durum: 'yayinda' } })).durum, 200);

  const ortak = await istemci(sunucu, ORTAK);
  assert.equal((await ortak.iste('/api/formlar/' + id)).durum, 404);
  assert.equal((await ortak.iste(`/api/formlar/${id}/yanit`, { method: 'PUT', body: { yanitlar: { s1: 'Ana' } } })).durum, 404);
  /* Listede de görünmez. */
  const liste = await ortak.iste('/api/formlar');
  assert.ok(!liste.veri.some(f => f.id === id));
});

test('form: yayındaki forma yanıt verilir, kapalıya verilmez', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const olustu = await koordinator.iste('/api/formlar', { method: 'POST', body: formGovde() });
  const id = olustu.veri.id;
  await koordinator.iste(`/api/formlar/${id}/durum`, { method: 'PUT', body: { durum: 'yayinda' } });

  const ortak = await istemci(sunucu, ORTAK);
  /* Zorunlu soru boş geçilemez. */
  assert.equal((await ortak.iste(`/api/formlar/${id}/yanit`, { method: 'PUT', body: { yanitlar: {} } })).durum, 400);
  assert.equal((await ortak.iste(`/api/formlar/${id}/yanit`, { method: 'PUT', body: { yanitlar: { s1: 'Ana Popescu' } } })).durum, 200);

  /* İkinci gönderim yanıtı GÜNCELLER, ikinci satır açmaz. */
  assert.equal((await ortak.iste(`/api/formlar/${id}/yanit`, { method: 'PUT', body: { yanitlar: { s1: 'Ana P.' } } })).durum, 200);
  const sonuc = await koordinator.iste(`/api/formlar/${id}/yanitlar`);
  assert.equal(sonuc.veri.yanitlar.length, 1);
  assert.equal(sonuc.veri.yanitlar[0].yanitlar.s1, 'Ana P.');

  /* Yanıt almış form taslağa geri alınamaz. */
  assert.equal((await koordinator.iste(`/api/formlar/${id}/durum`, { method: 'PUT', body: { durum: 'taslak' } })).durum, 400);

  /* Kapatılan form yanıt almaz. */
  const surum = (await koordinator.iste('/api/formlar/' + id)).veri.updated;
  assert.equal((await koordinator.iste('/api/formlar/' + id, { method: 'PUT', body: { ...formGovde({ kapali: true }), updated: surum } })).durum, 200);
  assert.equal((await ortak.iste(`/api/formlar/${id}/yanit`, { method: 'PUT', body: { yanitlar: { s1: 'x' } } })).durum, 400);
});

test('form: yanıtları ve bekleyenleri yalnızca koordinatör görür', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const olustu = await koordinator.iste('/api/formlar', { method: 'POST', body: formGovde() });
  const id = olustu.veri.id;
  /* Form yayımlanır: taslak hâlinde ortak 404 alır ve asıl kural
     (yanıtları görmemesi) sınanmamış olurdu. */
  await koordinator.iste(`/api/formlar/${id}/durum`, { method: 'PUT', body: { durum: 'yayinda' } });

  const ortak = await istemci(sunucu, ORTAK);
  assert.equal((await ortak.iste('/api/formlar/' + id)).durum, 200, 'yayındaki formu görür');
  assert.equal((await ortak.iste(`/api/formlar/${id}/yanitlar`)).durum, 403, 'ama yanıtlarını görmez');
  assert.equal((await ortak.iste('/api/formlar/' + id, { method: 'DELETE' })).durum, 403);
  assert.equal((await ortak.iste(`/api/formlar/${id}/hatirlat`, { method: 'POST', body: {} })).durum, 403);

  const sonuc = await koordinator.iste(`/api/formlar/${id}/yanitlar`);
  assert.equal(sonuc.durum, 200);
  /* Koordinatör formu doldurmuyorsa bekleyenler yalnızca ortak kurumlardır. */
  assert.ok(sonuc.veri.bekleyen.every(p => p.partner !== 'hbv'));
});

test('form: eşzamanlı düzenleme ezilmez', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const olustu = await koordinator.iste('/api/formlar', { method: 'POST', body: formGovde() });
  const id = olustu.veri.id, surum = olustu.veri.updated;

  assert.equal((await koordinator.iste('/api/formlar/' + id, { method: 'PUT', body: { ...formGovde({ baslik: 'Birinci' }), updated: surum } })).durum, 200);
  /* Aynı sürümle ikinci kayıt: araya başka bir koordinatör girmiş demektir. */
  const cakisma = await koordinator.iste('/api/formlar/' + id, { method: 'PUT', body: { ...formGovde({ baslik: 'İkinci' }), updated: surum } });
  assert.equal(cakisma.durum, 409);
  /* Sürüm bilgisi hiç yoksa da reddedilir. */
  assert.equal((await koordinator.iste('/api/formlar/' + id, { method: 'PUT', body: formGovde() })).durum, 400);
});

test('form: silinen form listeden düşer ama yanıtları kalır', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const olustu = await koordinator.iste('/api/formlar', { method: 'POST', body: formGovde() });
  const id = olustu.veri.id;
  assert.equal((await koordinator.iste('/api/formlar/' + id, { method: 'DELETE' })).durum, 200);
  assert.equal((await koordinator.iste('/api/formlar/' + id)).durum, 404);
  const liste = await koordinator.iste('/api/formlar');
  assert.ok(!liste.veri.some(f => f.id === id));
});

test('form dosyası: yükleyen ve koordinatör iner, başkası inemez', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const sorular = [
    { id: 's1', type: 'kisa', title: 'Adınız', help: '', required: false },
    { id: 'd1', type: 'dosya', title: 'Pilot raporu', help: '', required: false },
  ];
  const olustu = await koordinator.iste('/api/formlar', { method: 'POST', body: formGovde({ sorular }) });
  const id = olustu.veri.id;
  await koordinator.iste(`/api/formlar/${id}/durum`, { method: 'PUT', body: { durum: 'yayinda' } });

  const ortak = await istemci(sunucu, ORTAK);
  const yukleme = yol => ({
    method: 'POST', ham: 'ad;deger\npilot;24\n',
    headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(yol) },
  });

  /* Tür UZANTIDAN bulunur; tanınmayan uzantı reddedilir. */
  const kotu = await ortak.iste(`/api/formlar/${id}/dosya?soru=d1`, yukleme('zararli.exe'));
  assert.equal(kotu.durum, 400);
  /* Dosya sorusu olmayan kimlikle yükleme yapılamaz. */
  assert.equal((await ortak.iste(`/api/formlar/${id}/dosya?soru=s1`, yukleme('a.csv'))).durum, 400);

  const yuklendi = await ortak.iste(`/api/formlar/${id}/dosya?soru=d1`, yukleme('pilot ölçüm.csv'));
  assert.equal(yuklendi.durum, 201);
  /* Ad temizlenir ama Türkçe harfler korunur. */
  assert.equal(yuklendi.veri.ad, 'pilot ölçüm.csv');
  const dosyaId = yuklendi.veri.id;

  /* Dosya yanıta bağlanır. */
  assert.equal((await ortak.iste(`/api/formlar/${id}/yanit`, { method: 'PUT', body: { yanitlar: { s1: 'Ana', d1: [dosyaId] } } })).durum, 200);

  /* Yükleyen indirir; her zaman EK olarak (tarayıcıda açılmaz). */
  const indir = await ortak.iste(`/api/formlar/${id}/dosya/${dosyaId}`);
  assert.equal(indir.durum, 200);
  assert.match(indir.basliklar.get('content-disposition'), /^attachment;/);
  assert.equal(indir.veri.toString('utf8'), 'ad;deger\npilot;24\n');

  /* Koordinatör de indirir. */
  assert.equal((await koordinator.iste(`/api/formlar/${id}/dosya/${dosyaId}`)).durum, 200);

  /* Yanıtta geçmeyen dosya gönderimde silinir. */
  const ikinci = await ortak.iste(`/api/formlar/${id}/dosya?soru=d1`, yukleme('ikinci.csv'));
  await ortak.iste(`/api/formlar/${id}/yanit`, { method: 'PUT', body: { yanitlar: { s1: 'Ana', d1: [dosyaId] } } });
  assert.equal((await ortak.iste(`/api/formlar/${id}/dosya/${ikinci.veri.id}`)).durum, 404, 'bağlanmayan dosya silinmeli');

  /* Başkasının dosyası bağlanamaz: kimlik yanıta yazılsa bile düşer. */
  const baskasi = await koordinator.iste(`/api/formlar/${id}/yanitlar`);
  assert.equal(baskasi.veri.yanitlar[0].yanitlar.d1.length, 1);
});

test('form taslağı: kaydedilir, gönderimde silinir', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const olustu = await koordinator.iste('/api/formlar', { method: 'POST', body: formGovde() });
  const id = olustu.veri.id;
  await koordinator.iste(`/api/formlar/${id}/durum`, { method: 'PUT', body: { durum: 'yayinda' } });

  const ortak = await istemci(sunucu, ORTAK);
  /* Taslakta zorunlu soru boş kalabilir: gönderim değil, ara kayıt. */
  assert.equal((await ortak.iste(`/api/formlar/${id}/taslak`, { method: 'PUT', body: { yanitlar: {} } })).durum, 200);
  const ara = await ortak.iste(`/api/formlar/${id}/taslak`, { method: 'PUT', body: { yanitlar: { s1: 'yarım' } } });
  assert.equal(ara.durum, 200);

  const okuma = await ortak.iste('/api/formlar/' + id);
  assert.deepEqual(okuma.veri.taslak.yanitlar, { s1: 'yarım' });
  assert.equal(okuma.veri.yanitlarim, null, 'henüz gönderilmedi');

  /* Gönderim taslağı kapatır. */
  await ortak.iste(`/api/formlar/${id}/yanit`, { method: 'PUT', body: { yanitlar: { s1: 'Ana' } } });
  const sonra = await ortak.iste('/api/formlar/' + id);
  assert.equal(sonra.veri.taslak, null);
  assert.deepEqual(sonra.veri.yanitlarim, { s1: 'Ana' });
});

/* --- Proje klasörleri ------------------------------------------------------ */
const klasorYukle = (ad, icerik = 'belge') => ({
  method: 'POST', ham: icerik,
  headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(ad) },
});

test('klasörler: okuma giriş ister, yetki kullanıcıya göre gelir', async () => {
  const anonim = await istemci(sunucu);
  assert.equal((await anonim.iste('/api/klasorler')).durum, 401);
  assert.equal((await anonim.iste('/api/klasorler/dosya?klasor=13.1', klasorYukle('a.pdf'))).durum, 401);

  const ortak = await istemci(sunucu, ORTAK);
  const liste = await ortak.iste('/api/klasorler');
  assert.equal(liste.durum, 200);
  assert.equal(liste.veri.klasorler.filter(k => k.ust === null).length, 20);
  const bul = id => liste.veri.klasorler.find(k => k.id === id);
  assert.equal(bul('01.1').yukleyebilir, false);
  assert.equal(bul('04.4.nihai').yukleyebilir, true);
  /* Toplantı klasörü tarihini veritabanındaki resmî aktiviteden alır. */
  assert.deepEqual(bul('05.2').etkinlik, { slug: 'wp2-a4-tpm2', baslangic: '2027-03-22', bitis: '2027-03-26', yer: 'NL' });
});

test('klasörler: ortak yalnızca yetkili olduğu klasöre yükler', async () => {
  const ortak = await istemci(sunucu, ORTAK);   // GEO CLUB, WP4 lideri
  /* Sözleşme klasörü koordinatörde; başka WP'nin nihai sürümü de değil. */
  assert.equal((await ortak.iste('/api/klasorler/dosya?klasor=01.1', klasorYukle('sozlesme.pdf'))).durum, 403);
  assert.equal((await ortak.iste('/api/klasorler/dosya?klasor=04.2.nihai', klasorYukle('r.pdf'))).durum, 403);
  /* Olmayan klasör, yasak tür, boş dosya. */
  assert.equal((await ortak.iste('/api/klasorler/dosya?klasor=99', klasorYukle('a.pdf'))).durum, 400);
  assert.equal((await ortak.iste('/api/klasorler/dosya?klasor=04.4.nihai', klasorYukle('x.exe'))).durum, 400);
  assert.equal((await ortak.iste('/api/klasorler/dosya?klasor=04.4.nihai', klasorYukle('bos.pdf', ''))).durum, 400);
  /* Origin'siz yazma. */
  assert.equal((await ortak.iste('/api/klasorler/dosya?klasor=04.4.nihai', { ...klasorYukle('a.pdf'), origin: false })).durum, 403);

  /* Kabul edilen yollar: kendi WP'si ve başka WP'ye katkı. */
  assert.equal((await ortak.iste('/api/klasorler/dosya?klasor=04.4.nihai', klasorYukle('pilot-raporu.pdf'))).durum, 201);
  assert.equal((await ortak.iste('/api/klasorler/dosya?klasor=04.2.katki', klasorYukle('katki.docx'))).durum, 201);

  const koordinator = await istemci(sunucu, KOORDINATOR);
  assert.equal((await koordinator.iste('/api/klasorler/dosya?klasor=01.1', klasorYukle('sozlesme.pdf'))).durum, 201);
});

test('klasörler: dosyayı yalnızca yükleyen kurum ve koordinatör değiştirir', async () => {
  const ortak = await istemci(sunucu, ORTAK);     // GEO CLUB
  const baska = await istemci(sunucu, ORTAK2);    // CECF
  const koordinator = await istemci(sunucu, KOORDINATOR);

  const id = (await ortak.iste('/api/klasorler/dosya?klasor=13.4', klasorYukle('sunum.pptx', 'v1'))).veri.id;

  /* Herkes okur ve indirir — ek olarak, sandbox başlığıyla. */
  const kayit = (await baska.iste('/api/klasorler')).veri.dosyalar.find(d => d.id === id);
  assert.equal(kayit.duzenleyebilir, false);
  const indir = await baska.iste(`/api/klasorler/surum/${kayit.surum.id}`);
  assert.equal(indir.durum, 200);
  assert.match(indir.basliklar.get('content-disposition'), /^attachment;/);
  assert.equal(indir.basliklar.get('content-security-policy'), 'sandbox');
  assert.equal(indir.veri.toString('utf8'), 'v1');

  /* Başka kurum: sürüm, taşıma ve silme reddedilir. */
  assert.equal((await baska.iste(`/api/klasorler/dosya/${id}/surum`, klasorYukle('sunum.pptx', 'v2'))).durum, 403);
  assert.equal((await baska.iste(`/api/klasorler/dosya/${id}`, { method: 'PUT', body: { klasor: '13.1' } })).durum, 403);
  assert.equal((await baska.iste(`/api/klasorler/dosya/${id}`, { method: 'DELETE' })).durum, 403);

  /* Yükleyen kurum yeni sürüm ekler; liste geçerli sürümü gösterir. */
  assert.equal((await ortak.iste(`/api/klasorler/dosya/${id}/surum`, klasorYukle('sunum-son.pptx', 'v2'))).durum, 201);
  const sonra = (await ortak.iste('/api/klasorler')).veri.dosyalar.find(d => d.id === id);
  assert.equal(sonra.surum.no, 2);
  assert.equal(sonra.ad, 'sunum-son.pptx');
  const gecmis = await baska.iste(`/api/klasorler/dosya/${id}/surumler`);
  assert.deepEqual(gecmis.veri.surumler.map(s => s.no), [2, 1]);

  /* Taşıma: hedefe de yükleme yetkisi gerekir — ortak dosyasını
     koordinatörün klasörüne taşıyarak oraya yükleyemez. */
  assert.equal((await ortak.iste(`/api/klasorler/dosya/${id}`, { method: 'PUT', body: { klasor: '01.1' } })).durum, 403);
  assert.equal((await ortak.iste(`/api/klasorler/dosya/${id}`, { method: 'PUT', body: { klasor: '13.1' } })).durum, 200);

  /* Koordinatör her dosyayı siler; silinen dosyanın sürümleri de gider. */
  assert.equal((await koordinator.iste(`/api/klasorler/dosya/${id}`, { method: 'DELETE' })).durum, 200);
  assert.equal((await baska.iste(`/api/klasorler/surum/${kayit.surum.id}`)).durum, 404);
});

test('klasörler: kısayol hedef klasörün yetkisiyle eklenir', async () => {
  const ortak = await istemci(sunucu, ORTAK);     // GEO CLUB
  const baska = await istemci(sunucu, ORTAK2);    // CECF
  const id = (await ortak.iste('/api/klasorler/dosya?klasor=04.4.nihai', klasorYukle('final-programi.pdf'))).veri.id;

  /* CECF yaygınlaştırma planı klasörünün sahibi: kısayolu o koyar. */
  assert.equal((await baska.iste(`/api/klasorler/dosya/${id}/kisayol`, { method: 'POST', body: { klasor: '09.1' } })).durum, 201);
  /* GEO CLUB sözleşme klasörüne kısayol koyamaz. */
  assert.equal((await ortak.iste(`/api/klasorler/dosya/${id}/kisayol`, { method: 'POST', body: { klasor: '01.1' } })).durum, 403);
  /* Kendi klasörüne kısayol anlamsız. */
  assert.equal((await ortak.iste(`/api/klasorler/dosya/${id}/kisayol`, { method: 'POST', body: { klasor: '04.4.nihai' } })).durum, 400);

  const kayit = (await ortak.iste('/api/klasorler')).veri.dosyalar.find(d => d.id === id);
  assert.deepEqual(kayit.kisayollar, ['09.1']);

  /* Kısayolu hedefin sahibi ya da dosyanın sahibi kaldırır. */
  assert.equal((await ortak.iste(`/api/klasorler/dosya/${id}/kisayol/09.1`, { method: 'DELETE' })).durum, 200);
  const sonra = (await ortak.iste('/api/klasorler')).veri.dosyalar.find(d => d.id === id);
  assert.deepEqual(sonra.kisayollar, []);
});

/* --- Profil kartı ----------------------------------------------------------
   Oturumsuz açılan tek kişi ucu: yalnızca kartta görünen alanlar çıkmalı. */
test('profil kartı oturumsuz açılır ve yalnızca ad, kullanıcı adı, kurum döner', async () => {
  const anonim = await istemci(sunucu);
  const yanit = await anonim.iste(`/api/profil?u=${encodeURIComponent(ORTAK.kullanici.toUpperCase())}`);
  assert.equal(yanit.durum, 200);
  assert.deepEqual(Object.keys(yanit.veri).sort(), ['ad', 'foto', 'kullanici', 'partner']);
  assert.equal(yanit.veri.kullanici, ORTAK.kullanici);
  assert.equal((await anonim.iste('/api/profil?u=yok-boyle')).durum, 404);
  assert.equal((await anonim.iste('/api/profil')).durum, 404);
});

/* --- Kullanıcılar -----------------------------------------------------------
   Hesap açmak en geniş yetkidir: yalnızca koordinatör. */
const yeniHesap = (uzer = {}) => ({ ad: 'Maria Rossi', kullanici: 'mariarossi', partner: 'unisalento', parola: 'IlkParola2026!!', koordinator: false, ...uzer });

test('kullanıcı listesi ve ekleme yalnızca koordinatöre açıktır', async () => {
  const anonim = await istemci(sunucu);
  assert.equal((await anonim.iste('/api/kullanicilar')).durum, 401);
  assert.equal((await anonim.iste('/api/kullanicilar', { method: 'POST', body: yeniHesap() })).durum, 401);

  const ortak = await istemci(sunucu, ORTAK);
  assert.equal((await ortak.iste('/api/kullanicilar')).durum, 403);
  assert.equal((await ortak.iste('/api/kullanicilar', { method: 'POST', body: yeniHesap({ kullanici: 'ortakacti' }) })).durum, 403);

  const koordinator = await istemci(sunucu, KOORDINATOR);
  const liste = await koordinator.iste('/api/kullanicilar');
  assert.equal(liste.durum, 200);
  assert.ok(liste.veri.kullanicilar.some(k => k.kullanici === ORTAK.kullanici));
  /* Parola özeti hiçbir satırda dışarı çıkmamalı. */
  assert.ok(liste.veri.kullanicilar.every(k => !('password' in k) && !('parola' in k)));
});

test('koordinatör kullanıcı ekler; yeni hesap giriş yapabilir', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const yanit = await koordinator.iste('/api/kullanicilar', { method: 'POST', body: yeniHesap({ kullanici: 'MariaRossi' }) });
  assert.equal(yanit.durum, 201);
  assert.equal(yanit.veri.kullanici, 'mariarossi');
  assert.equal(yanit.veri.koordinator, false);

  const yeni = await istemci(sunucu, { kullanici: 'mariarossi', parola: 'IlkParola2026!!' });
  /* Kurum hesabı olarak açıldı: kullanıcı listesine erişemez. */
  assert.equal((await yeni.iste('/api/kullanicilar')).durum, 403);

  /* Aynı ad ikinci kez açılamaz; bozuk alanlar reddedilir. */
  assert.equal((await koordinator.iste('/api/kullanicilar', { method: 'POST', body: yeniHesap() })).durum, 409);
  assert.equal((await koordinator.iste('/api/kullanicilar', { method: 'POST', body: yeniHesap({ kullanici: 'maria rossi' }) })).durum, 400);
  assert.equal((await koordinator.iste('/api/kullanicilar', { method: 'POST', body: yeniHesap({ kullanici: 'mrossi2', partner: 'yok' }) })).durum, 400);
  assert.equal((await koordinator.iste('/api/kullanicilar', { method: 'POST', body: yeniHesap({ kullanici: 'mrossi3', parola: 'kisa' }) })).durum, 400);
  assert.equal((await koordinator.iste('/api/kullanicilar', { method: 'POST', body: yeniHesap({ kullanici: 'mrossi4', ad: '  ' }) })).durum, 400);
});

test('parola sıfırlama yalnızca koordinatöre açıktır; eski parola geçersizleşir', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const hedef = { kullanici: 'sifirlanacak', parola: 'EskiParola2026!!' };
  const acilan = await koordinator.iste('/api/kullanicilar', {
    method: 'POST', body: { ad: 'Sıfırlanacak Kişi', kullanici: hedef.kullanici, partner: 'bte', parola: hedef.parola },
  });
  assert.equal(acilan.durum, 201);
  const yol = `/api/kullanicilar/${acilan.veri.id}/parola`;

  /* Kişinin açık oturumu sıfırlamadan sonra kapanmalı. */
  const kendisi = await istemci(sunucu, hedef);
  assert.equal((await kendisi.iste('/api/hatirlaticilar')).durum, 200);

  const anonim = await istemci(sunucu);
  assert.equal((await anonim.iste(yol, { method: 'POST', body: { parola: 'YeniParola2026!!' } })).durum, 401);
  const ortak = await istemci(sunucu, ORTAK);
  assert.equal((await ortak.iste(yol, { method: 'POST', body: { parola: 'YeniParola2026!!' } })).durum, 403);
  assert.equal((await koordinator.iste(yol, { method: 'POST', body: { parola: 'kisa' } })).durum, 400);
  assert.equal((await koordinator.iste('/api/kullanicilar/999999/parola', { method: 'POST', body: { parola: 'YeniParola2026!!' } })).durum, 404);

  assert.equal((await koordinator.iste(yol, { method: 'POST', body: { parola: 'YeniParola2026!!' } })).durum, 200);
  assert.equal((await kendisi.iste('/api/hatirlaticilar')).durum, 401);

  const giris = parola => anonim.iste('/api/giris', { method: 'POST', body: { kullanici: hedef.kullanici, parola } });
  assert.equal((await giris(hedef.parola)).durum, 401);
  assert.equal((await giris('YeniParola2026!!')).durum, 200);
});

test('profil fotoğrafı: herkes görür, yalnızca kişi ve koordinatör değiştirir', async () => {
  /* En küçük geçerli PNG başlığı yeter: tür baytlardan çıkarılıyor. */
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
  const yol = u => `/api/profil/foto?u=${u}`;
  const yukle = (istemci, u, ham = png) => istemci.iste(yol(u), { method: 'PUT', ham, headers: { 'content-type': 'image/png' } });

  const anonim = await istemci(sunucu);
  assert.equal((await yukle(anonim, ORTAK.kullanici)).durum, 401);
  const ortak2 = await istemci(sunucu, ORTAK2);
  assert.equal((await yukle(ortak2, ORTAK.kullanici)).durum, 403);

  const ortak = await istemci(sunucu, ORTAK);
  assert.equal((await yukle(ortak, ORTAK.kullanici, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).durum, 400);
  const yuklendi = await yukle(ortak, ORTAK.kullanici);
  assert.equal(yuklendi.durum, 200);
  assert.ok(yuklendi.veri.foto);

  /* Oturumsuz okunur ve profil sürümü döner. */
  assert.equal((await anonim.iste(`/api/profil?u=${ORTAK.kullanici}`)).veri.foto, yuklendi.veri.foto);
  assert.equal((await anonim.iste(yol(ORTAK.kullanici))).durum, 200);

  /* Koordinatör başkasının fotoğrafını kaldırabilir. */
  const koordinator = await istemci(sunucu, KOORDINATOR);
  assert.equal((await ortak2.iste(yol(ORTAK.kullanici), { method: 'DELETE' })).durum, 403);
  assert.equal((await koordinator.iste(yol(ORTAK.kullanici), { method: 'DELETE' })).durum, 200);
  assert.equal((await anonim.iste(yol(ORTAK.kullanici))).durum, 404);
});

test('hesap silme: yalnızca koordinatör, kendini silemez, silinen giremez', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const hedef = { kullanici: 'silinecek', parola: 'SilinecekParola26' };
  const acilan = await koordinator.iste('/api/kullanicilar', {
    method: 'POST', body: { ad: 'Silinecek Kişi', kullanici: hedef.kullanici, partner: 'bte', parola: hedef.parola },
  });
  assert.equal(acilan.durum, 201);
  const yol = `/api/kullanicilar/${acilan.veri.id}`;

  /* Silinecek kişinin başka tablolara bağlı kaydı olsun: silme yarıda kalmamalı. */
  const kendisi = await istemci(sunucu, hedef);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
  assert.equal((await kendisi.iste(`/api/profil/foto?u=${hedef.kullanici}`, { method: 'PUT', ham: png, headers: { 'content-type': 'image/png' } })).durum, 200);

  const anonim = await istemci(sunucu);
  assert.equal((await anonim.iste(yol, { method: 'DELETE' })).durum, 401);
  const ortak = await istemci(sunucu, ORTAK);
  assert.equal((await ortak.iste(yol, { method: 'DELETE' })).durum, 403);
  assert.equal((await koordinator.iste('/api/kullanicilar/999999', { method: 'DELETE' })).durum, 404);

  /* Koordinatör kendini silemez. */
  const liste = (await koordinator.iste('/api/kullanicilar')).veri.kullanicilar;
  const ben = liste.find(k => k.kullanici === KOORDINATOR.kullanici);
  assert.equal((await koordinator.iste(`/api/kullanicilar/${ben.id}`, { method: 'DELETE' })).durum, 400);

  assert.equal((await koordinator.iste(yol, { method: 'DELETE' })).durum, 200);
  assert.equal((await kendisi.iste('/api/hatirlaticilar')).durum, 401);
  assert.equal((await anonim.iste('/api/giris', { method: 'POST', body: hedef })).durum, 401);
  assert.equal((await anonim.iste(`/api/profil?u=${hedef.kullanici}`)).durum, 404);
});

test('hesap düzenleme: yalnızca koordinatör, kendi yetkisini düşüremez', async () => {
  const koordinator = await istemci(sunucu, KOORDINATOR);
  const acilan = await koordinator.iste('/api/kullanicilar', {
    method: 'POST', body: { ad: 'Yanlis Yazilmis', kullanici: 'yanlisyazilmis', partner: 'bte', parola: 'DuzenleParola26' },
  });
  assert.equal(acilan.durum, 201);
  const yol = `/api/kullanicilar/${acilan.veri.id}`;
  const govde = { ad: 'Doğru Yazılmış', kullanici: 'dogruyazilmis', partner: 'cecf', koordinator: true };

  assert.equal((await (await istemci(sunucu)).iste(yol, { method: 'PUT', body: govde })).durum, 401);
  assert.equal((await (await istemci(sunucu, ORTAK)).iste(yol, { method: 'PUT', body: govde })).durum, 403);
  assert.equal((await koordinator.iste(yol, { method: 'PUT', body: { ...govde, kullanici: ORTAK.kullanici } })).durum, 409);
  assert.equal((await koordinator.iste(yol, { method: 'PUT', body: { ...govde, partner: 'yok' } })).durum, 400);

  const duzeltildi = await koordinator.iste(yol, { method: 'PUT', body: govde });
  assert.equal(duzeltildi.durum, 200);
  assert.deepEqual({ ...duzeltildi.veri, id: undefined }, { id: undefined, ad: 'Doğru Yazılmış', kullanici: 'dogruyazilmis', partner: 'cecf', koordinator: true });
  /* Parola değişmedi: yeni kullanıcı adıyla eski parola geçer. */
  const anonim = await istemci(sunucu);
  assert.equal((await anonim.iste('/api/giris', { method: 'POST', body: { kullanici: 'dogruyazilmis', parola: 'DuzenleParola26' } })).durum, 200);

  /* Koordinatör kendi tam yetkisini kaldıramaz, adını değiştirebilir. */
  const ben = (await koordinator.iste('/api/kullanicilar')).veri.kullanicilar.find(k => k.kullanici === KOORDINATOR.kullanici);
  const benYol = `/api/kullanicilar/${ben.id}`;
  assert.equal((await koordinator.iste(benYol, { method: 'PUT', body: { ...ben, koordinator: false } })).durum, 400);
  assert.equal((await koordinator.iste(benYol, { method: 'PUT', body: ben })).durum, 200);
});

/* --- Çıktı kütüphanesi ------------------------------------------------------
   Görmek her üyeye açık; durum ve dosya sorumlu kurumun ve koordinatörün;
   sorumluyu ve tarihi yalnızca koordinatör değiştirir. */
const dosyaYukle = (istemci, yol, ad = 'rapor.pdf') =>
  istemci.iste(yol, { method: 'POST', ham: Buffer.from('%PDF-1.4 deneme'), headers: { 'x-file-name': encodeURIComponent(ad) } });

test('çıktı kütüphanesi: sorumlu ve tarih takvimden türer, yetki sorumlu kurumda', async () => {
  const anonim = await istemci(sunucu);
  assert.equal((await anonim.iste('/api/ciktilar')).durum, 401);

  const ortak = await istemci(sunucu, ORTAK);          // GEO CLUB
  const liste = await ortak.iste('/api/ciktilar');
  assert.equal(liste.durum, 200);
  assert.equal(liste.veri.ciktilar.length, 7);
  const ia = liste.veri.ciktilar.find(c => c.slug === 'ihtiyac-analizi');
  assert.equal(ia.sorumlu, 'unisalento', 'lider kurum takvimden');
  assert.equal(ia.teslim, '2027-02-28', 'teslim = çıktı üretim döneminin bitişi');
  assert.equal(liste.veri.ciktilar.find(c => c.slug === 'arac-seti').sorumlu, null, 'başvuruda yok, uydurulmaz');

  /* Sorumlu olmayan kurum değiştiremez. */
  assert.equal((await ortak.iste('/api/ciktilar/ihtiyac-analizi', { method: 'PUT', body: { durum: 'teslim' } })).durum, 403);
  assert.equal((await dosyaYukle(ortak, '/api/ciktilar/ihtiyac-analizi/dosya?dil=en')).durum, 403);

  /* Koordinatör araç setinin sorumlusunu ve tarihini belirler. */
  const koordinator = await istemci(sunucu, KOORDINATOR);
  assert.equal((await koordinator.iste('/api/ciktilar/arac-seti', { method: 'PUT', body: { durum: 'planlandi', sorumlu: 'geoclub', teslim: '2027-12-31' } })).durum, 200);
  assert.equal((await koordinator.iste('/api/ciktilar/arac-seti', { method: 'PUT', body: { durum: 'uydurma' } })).durum, 400);
  assert.equal((await koordinator.iste('/api/ciktilar/arac-seti', { method: 'PUT', body: { durum: 'teslim', disUrl: 'javascript:alert(1)' } })).durum, 400);

  /* Artık sorumlu GEO CLUB: durumu günceller ama işi devredemez. */
  assert.equal((await ortak.iste('/api/ciktilar/arac-seti', { method: 'PUT', body: { durum: 'incelemede', sorumlu: 'cecf', teslim: '2028-01-01' } })).durum, 200);
  let c = (await ortak.iste('/api/ciktilar')).veri.ciktilar.find(x => x.slug === 'arac-seti');
  assert.equal(c.durum, 'incelemede');
  assert.equal(c.sorumlu, 'geoclub');
  assert.equal(c.teslim, '2027-12-31');

  /* Dil dil sürüm. */
  assert.equal((await dosyaYukle(ortak, '/api/ciktilar/arac-seti/dosya?dil=en')).durum, 201);
  const ikinci = await dosyaYukle(ortak, '/api/ciktilar/arac-seti/dosya?dil=en');
  assert.equal(ikinci.veri.no, 2);
  assert.equal((await dosyaYukle(ortak, '/api/ciktilar/arac-seti/dosya?dil=xx')).durum, 400);
  assert.equal((await dosyaYukle(ortak, '/api/ciktilar/arac-seti/dosya?dil=tr', 'virus.exe')).durum, 400);
  c = (await ortak.iste('/api/ciktilar')).veri.ciktilar.find(x => x.slug === 'arac-seti');
  assert.equal(c.diller.find(d => d.dil === 'en').surumler.length, 2);

  /* Her üye indirir (ek olarak); yalnızca sorumlu/koordinatör siler. */
  const ortak2 = await istemci(sunucu, ORTAK2);
  const indir = await ortak2.iste(`/api/ciktilar/dosya/${ikinci.veri.id}`);
  assert.equal(indir.durum, 200);
  assert.match(indir.basliklar.get('content-disposition'), /^attachment/);
  assert.equal((await ortak2.iste(`/api/ciktilar/dosya/${ikinci.veri.id}`, { method: 'DELETE' })).durum, 403);
  assert.equal((await ortak.iste(`/api/ciktilar/dosya/${ikinci.veri.id}`, { method: 'DELETE' })).durum, 200);
});

/* --- Faaliyet dosyası -------------------------------------------------------- */
test('faaliyet dosyası: lider kurum yükler, parçalar türe göre, özet takvimde', async () => {
  const ortak = await istemci(sunucu, ORTAK);           // GEO CLUB
  const etkinlikler = (await ortak.iste('/api/etkinlikler')).veri.etkinlikler;
  const sanal = etkinlikler.find(e => e.slug === 'wp4-a3-va2');          // lider GEO CLUB, sanal
  const final = etkinlikler.find(e => e.slug === 'wp4-a4-tpm6-final');   // lider GEO CLUB, konferans
  const cikti = etkinlikler.find(e => e.slug === 'wp2-a1-ihtiyac-analizi');
  assert.deepEqual(sanal.dosya, { tamam: 0, toplam: 4, eksik: ['gundem', 'yoklama', 'tutanak', 'anket'] });
  assert.equal(final.dosya.toplam, 6);
  assert.equal(cikti.dosya, null, 'çıktı üretim döneminin faaliyet dosyası yok');

  const anonim = await istemci(sunucu);
  assert.equal((await anonim.iste(`/api/etkinlikler/${sanal.id}/dosya`)).durum, 401);

  /* Başka kurum görür ama yükleyemez. */
  const ortak2 = await istemci(sunucu, ORTAK2);
  const gorunum = await ortak2.iste(`/api/etkinlikler/${sanal.id}/dosya`);
  assert.equal(gorunum.durum, 200);
  assert.equal(gorunum.veri.yetkili, false);
  assert.deepEqual(gorunum.veri.secenekler, []);
  assert.equal((await dosyaYukle(ortak2, `/api/etkinlikler/${sanal.id}/dosya?tur=gundem`)).durum, 403);
  assert.equal((await ortak2.iste(`/api/etkinlikler/${sanal.id}/anket`, { method: 'PUT', body: { formId: null } })).durum, 403);

  /* Lider kurum yükler; türe uymayan parça reddedilir. */
  const yuklendi = await dosyaYukle(ortak, `/api/etkinlikler/${sanal.id}/dosya?tur=gundem`, 'gundem.docx');
  assert.equal(yuklendi.durum, 201);
  assert.equal((await dosyaYukle(ortak, `/api/etkinlikler/${sanal.id}/dosya?tur=infopack`)).durum, 400, 'sanal toplantıda bilgi paketi yok');
  assert.equal((await dosyaYukle(ortak, `/api/etkinlikler/${sanal.id}/dosya?tur=foto`)).durum, 400);
  assert.equal((await ortak.iste(`/api/etkinlikler/${sanal.id}/anket`, { method: 'PUT', body: { formId: 999999 } })).durum, 400);
  assert.equal((await ortak.iste(`/api/etkinlikler/${sanal.id}/anket`, { method: 'PUT', body: { formId: null } })).durum, 200);

  const sonra = (await ortak.iste('/api/etkinlikler')).veri.etkinlikler.find(e => e.id === sanal.id);
  assert.deepEqual(sonra.dosya, { tamam: 1, toplam: 4, eksik: ['yoklama', 'tutanak', 'anket'] });

  /* İndirme her üyeye; silme lider kuruma. */
  assert.equal((await ortak2.iste(`/api/faaliyet-dosya/${yuklendi.veri.id}`)).durum, 200);
  assert.equal((await ortak2.iste(`/api/faaliyet-dosya/${yuklendi.veri.id}`, { method: 'DELETE' })).durum, 403);
  assert.equal((await ortak.iste(`/api/faaliyet-dosya/${yuklendi.veri.id}`, { method: 'DELETE' })).durum, 200);
});

/* --- Pano ---------------------------------------------------------------------- */
test('pano: kurum kapsamlı; genel durum yalnızca koordinatörde', async () => {
  assert.equal((await (await istemci(sunucu)).iste('/api/pano')).durum, 401);
  const ortak = await istemci(sunucu, ORTAK);
  const p = await ortak.iste('/api/pano');
  assert.equal(p.durum, 200);
  assert.equal(p.veri.kurum, 'geoclub');
  assert.equal(p.veri.genel, null);
  for (const alan of ['yaklasan', 'yaklasanGorev', 'geciken', 'bekleyenForm', 'dosyalar', 'eksikDosya', 'ciktilar', 'durumGuncelle']) {
    assert.ok(Array.isArray(p.veri[alan]), alan);
  }
  const k = await (await istemci(sunucu, KOORDINATOR)).iste('/api/pano');
  assert.equal(k.veri.genel.length, 7);
});
