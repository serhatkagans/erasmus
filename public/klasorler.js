import {
  durum, t, baslat, iste, ortakKisa, yerAdi, tarihAraligi, tamTarih, onayla, bildir,
} from './ortak.js';

/**
 * Proje klasörleri — "Proje Yönetim Panosu · Klasör Yapısı" belgesinin
 * platformdaki karşılığı. Ağaç ve yetkiler sunucudan gelir (bkz.
 * lib/klasor.mjs); bu sayfa yalnızca çizer, yükler ve seçimi adres
 * çubuğunda tutar (`#04.2`) ki bir klasörün bağlantısı paylaşılabilsin.
 *
 * Sayılar ALT KLASÖRLERİ DE KAPSAR: "04 İş paketleri · 12 dosya" dendiğinde
 * dört WP klasörünün toplamı kastedilir. "Yalnızca boş klasörler" süzgeci
 * ara rapor öncesi eksik belgeyi bulmak içindir.
 */

const $ = id => document.getElementById(id);
const el = (etiket, sinif, metin) => {
  const d = document.createElement(etiket);
  if (sinif) d.className = sinif;
  if (metin != null) d.textContent = metin;
  return d;
};
const dugme = (metin, sinif = 'metin-bag') => {
  const b = el('button', sinif, metin);
  b.type = 'button';
  return b;
};

let veri = { klasorler: [], dosyalar: [], sinir: { bayt: 0, uzantilar: [] } };
let dizin = new Map();
let secili = '';
/* İçerik panosu ya seçili klasörü ya da üstteki araçlardan birinin
   listesini gösterir: 'ara' | 'son' | 'kurum' | null (klasör). */
let gorunum = null;
const acik = new Set();

/* --- Ad ve sayılar ------------------------------------------------------ */
const numara = k => (/^[\d.]+$/.test(k.id) ? k.id : '');
function ad(k) {
  if (k.anahtar) return t(k.anahtar);
  if (k.etiket === 'kurum') return ortakKisa(k.kurum);
  return k.id.split('.').pop();
}
const tamAd = k => [numara(k), ad(k)].filter(Boolean).join(' ');

const cocuklar = id => veri.klasorler.filter(k => k.ust === id);
const altAgac = id => veri.klasorler.filter(k => k.id === id || k.id.startsWith(id + '.'));

/** Klasörde (alt klasörler dahil) duran ve kısayolla görünen dosyalar. */
function sayi(id) {
  const kimlikler = new Set(altAgac(id).map(k => k.id));
  return veri.dosyalar.filter(d => kimlikler.has(d.klasor) || d.kisayollar.some(k => kimlikler.has(k))).length;
}

const boyut = b => {
  const birim = b >= 1048576 ? ['megabyte', b / 1048576] : b >= 1024 ? ['kilobyte', b / 1024] : ['byte', b];
  return new Intl.NumberFormat(durum.dil, { style: 'unit', unit: birim[0], maximumFractionDigits: 1 }).format(birim[1]);
};
const gun = iso => tamTarih(iso.slice(0, 10));

function sahipMetni(k) {
  if (k.sahip.includes('*')) return t('klasor.sahip.herkes');
  return `${k.sahip.map(ortakKisa).join(', ')} ${t('klasor.sahip.koordinator')}`;
}

/* --- Ağaç --------------------------------------------------------------- */
function eslesir(k, arama) {
  if (!arama) return true;
  if (tamAd(k).toLocaleLowerCase(durum.dil).includes(arama)) return true;
  return veri.dosyalar.some(d => d.klasor === k.id && d.ad.toLocaleLowerCase(durum.dil).includes(arama));
}

function agaciCiz() {
  const arama = $('klasor-ara').value.trim().toLocaleLowerCase(durum.dil);
  const yalnizBos = $('klasor-bos').checked;
  /* Bir düğüm, kendisi ya da altındakilerden biri süzgece uyuyorsa görünür:
     aranan dosya 04.2.nihai'deyse 04 ve 04.2 de açık kalmalı. */
  const gorunur = k => altAgac(k.id).some(a => eslesir(a, arama) && (!yalnizBos || sayi(a.id) === 0));
  const suzgecli = !!arama || yalnizBos;

  const liste = ust => {
    const ul = el('ul', 'klasor-liste');
    for (const k of cocuklar(ust)) {
      if (!gorunur(k)) continue;
      const li = el('li');
      const satir = el('div', 'klasor-satir');
      const altlari = cocuklar(k.id).length > 0;
      const genis = altlari && (suzgecli || acik.has(k.id));

      const ac = dugme(genis ? '▾' : '▸', 'klasor-ac');
      ac.hidden = !altlari;
      ac.setAttribute('aria-expanded', String(genis));
      ac.setAttribute('aria-label', tamAd(k));
      ac.addEventListener('click', () => { acik.has(k.id) ? acik.delete(k.id) : acik.add(k.id); agaciCiz(); });

      const sec = dugme('', 'klasor-sec');
      if (k.id === secili) sec.setAttribute('aria-current', 'true');
      const n = sayi(k.id);
      sec.dataset.bos = String(n === 0);
      if (numara(k)) sec.append(el('span', 'klasor-no', numara(k)));
      sec.append(el('span', 'klasor-ad', ad(k)));
      sec.append(el('span', 'klasor-adet', n ? String(n) : '·'));
      sec.addEventListener('click', () => sec_(k.id));

      satir.append(ac, sec);
      li.append(satir);
      if (genis) li.append(liste(k.id));
      ul.append(li);
    }
    return ul;
  };
  $('klasor-agac').replaceChildren(liste(null));

  const dolu = veri.klasorler.filter(k => veri.dosyalar.some(d => d.klasor === k.id || d.kisayollar.includes(k.id))).length;
  $('klasor-ozet').textContent = t('klasor.ozet', { dolu, toplam: veri.klasorler.length, dosya: veri.dosyalar.length });
}

function sec_(id, { kaydir = true } = {}) {
  if (!dizin.has(id)) id = '';
  secili = id;
  gorunumSec(null);
  /* Seçilen klasörün yolu açılır ki ağaçta nerede olduğu görünsün. */
  for (let k = dizin.get(id); k; k = dizin.get(k.ust)) acik.add(k.id);
  if (id && decodeURIComponent(location.hash.slice(1)) !== id) history.replaceState(null, '', '#' + id);
  agaciCiz();
  icerigiCiz();
  if (kaydir && id && matchMedia('(max-width: 900px)').matches) $('klasor-icerik').scrollIntoView({ block: 'start' });
}

/* --- İçerik ------------------------------------------------------------- */
function klasorSecimi(istisna = []) {
  const secim = el('select', 'klasor-hedef');
  const bos = el('option', '', t('klasor.hedefSec'));
  bos.value = '';
  secim.append(bos);
  for (const k of veri.klasorler) {
    if (!k.yukleyebilir || istisna.includes(k.id)) continue;
    const o = el('option', '', `${'  '.repeat(k.derinlik)}${tamAd(k)}`);
    o.value = k.id;
    secim.append(o);
  }
  return secim;
}

/** Taşı / kısayol ekle için satır içi seçici: açılır liste + Tamam. */
function hedefSorgusu(kap, istisna, isle) {
  const var_ = kap.querySelector('.klasor-sorgu');
  if (var_) { var_.remove(); return; }
  const kutu = el('div', 'klasor-sorgu');
  const secim = klasorSecimi(istisna);
  const tamam = dugme(t('klasor.tamam'), 'dugme dugme-ikincil');
  const vazgec = dugme(t('genel.vazgec'));
  tamam.addEventListener('click', async () => {
    if (!secim.value) return;
    tamam.disabled = true;
    try { await isle(secim.value); } catch (h) { hataGoster(h.message); tamam.disabled = false; }
  });
  vazgec.addEventListener('click', () => kutu.remove());
  kutu.append(secim, tamam, vazgec);
  kap.append(kutu);
  secim.focus();
}

function hataGoster(metin) {
  const h = $('klasor-hata');
  if (h) h.textContent = metin || '';
}

async function yenile() {
  veri = await iste('api/klasorler');
  dizin = new Map(veri.klasorler.map(k => [k.id, k]));
  agaciCiz();
  icerigiCiz();
}

async function yukle(dosyalar, hedef, { surumDosyasi = null, aciklama = $('klasor-aciklama')?.value || '' } = {}) {
  const mb = Math.round(veri.sinir.bayt / 1048576);
  const durumSatiri = $('klasor-yukleme');
  let n = 0;
  hataGoster('');
  for (const f of dosyalar) {
    if (f.size > veri.sinir.bayt) { hataGoster(t('klasor.hata.buyuk', { ad: f.name, mb })); continue; }
    if (durumSatiri) durumSatiri.textContent = t('klasor.yukleniyor', { ad: f.name });
    const yol = surumDosyasi
      ? `api/klasorler/dosya/${surumDosyasi}/surum`
      : `api/klasorler/dosya?klasor=${encodeURIComponent(hedef)}`;
    const yanit = await fetch(yol, {
      method: 'POST', body: f,
      headers: { 'X-File-Name': encodeURIComponent(f.name), 'X-Aciklama': encodeURIComponent(aciklama) },
    });
    if (!yanit.ok) {
      const govde = await yanit.json().catch(() => ({}));
      hataGoster(durum.sozluk[govde.error] || govde.error || t('genel.hata'));
      continue;
    }
    n++;
  }
  await yenile();
  if (n) bildir(t('klasor.yuklendi', { n }));
}

function dosyaSatiri(d, k) {
  const li = el('li', 'klasor-dosya');
  const kisayolMu = d.klasor !== k.id;
  if (kisayolMu) li.dataset.kisayol = 'true';

  const ust = el('div', 'klasor-dosya-ust');
  const uzanti = d.ad.includes('.') ? d.ad.split('.').pop().toUpperCase().slice(0, 4) : '?';
  ust.append(el('span', 'klasor-tur', uzanti));

  const govde = el('div', 'klasor-dosya-govde');
  const bag = el('a', 'klasor-dosya-ad', d.ad);
  bag.href = `api/klasorler/surum/${d.surum.id}`;
  bag.setAttribute('download', '');
  const baslik = el('div', 'klasor-dosya-baslik');
  baslik.append(bag, el('span', 'etiket', t('klasor.surum', { no: d.surum.no })));
  govde.append(baslik);

  const kim = d.yukleyen ? t('klasor.yukleyen', { kurum: ortakKisa(d.partner), kisi: d.yukleyen }) : ortakKisa(d.partner);
  govde.append(el('p', 'klasor-dosya-meta', `${kim} · ${gun(d.surum.created)} · ${boyut(d.surum.boyut)}`));
  if (d.aciklama) govde.append(el('p', 'klasor-dosya-aciklama', d.aciklama));
  if (kisayolMu) govde.append(el('p', 'klasor-dosya-not', t('klasor.kisayol', { yer: tamAd(dizin.get(d.klasor)) })));
  else if (d.kisayollar.length) {
    govde.append(el('p', 'klasor-dosya-not', t('klasor.kisayollar', { yerler: d.kisayollar.map(id => numara(dizin.get(id)) || tamAd(dizin.get(id))).join(', ') })));
  }
  ust.append(govde);
  li.append(ust);

  /* Eylemler: yetki sunucudan gelir (`duzenleyebilir`, `yukleyebilir`),
     sunucu yine de her isteği ayrıca denetler. */
  const eylem = el('div', 'klasor-eylem');
  const indir = el('a', 'metin-bag', t('klasor.indir'));
  indir.href = bag.href;
  indir.setAttribute('download', '');
  eylem.append(indir);

  if (d.surumSayisi > 1) {
    const s = dugme(`${t('klasor.surumler')} (${d.surumSayisi})`);
    s.setAttribute('aria-expanded', 'false');
    s.addEventListener('click', async () => {
      const var_ = li.querySelector('.klasor-surumler');
      if (var_) { var_.remove(); s.setAttribute('aria-expanded', 'false'); return; }
      const { surumler } = await iste(`api/klasorler/dosya/${d.id}/surumler`);
      const ul = el('ul', 'klasor-surumler');
      for (const v of surumler) {
        const a = el('a', '', t('klasor.surumSatir', { no: v.no, tarih: gun(v.created), kisi: v.yukleyen || '—', boyut: boyut(v.boyut) }));
        a.href = `api/klasorler/surum/${v.id}`;
        a.setAttribute('download', '');
        const sat = el('li');
        sat.append(a);
        ul.append(sat);
      }
      li.append(ul);
      s.setAttribute('aria-expanded', 'true');
    });
    eylem.append(s);
  }

  if (d.duzenleyebilir && !kisayolMu) {
    const girdi = el('input');
    girdi.type = 'file';
    girdi.hidden = true;
    girdi.addEventListener('change', () => girdi.files.length && yukle([girdi.files[0]], k.id, { surumDosyasi: d.id }));
    const surum = dugme(t('klasor.surumYukle'));
    surum.addEventListener('click', () => girdi.click());
    eylem.append(surum, girdi);

    const tasi = dugme(t('klasor.tasi'));
    tasi.addEventListener('click', () => hedefSorgusu(li, [d.klasor], async hedef => {
      await iste(`api/klasorler/dosya/${d.id}`, { method: 'PUT', body: JSON.stringify({ klasor: hedef }) });
      await yenile();
    }));
    eylem.append(tasi);
  }

  if (!kisayolMu && veri.klasorler.some(x => x.yukleyebilir)) {
    const kis = dugme(t('klasor.kisayolEkle'));
    kis.addEventListener('click', () => hedefSorgusu(li, [d.klasor, ...d.kisayollar], async hedef => {
      await iste(`api/klasorler/dosya/${d.id}/kisayol`, { method: 'POST', body: JSON.stringify({ klasor: hedef }) });
      await yenile();
    }));
    eylem.append(kis);
  }

  if (kisayolMu && (k.yukleyebilir || d.duzenleyebilir)) {
    const kaldir = dugme(t('klasor.kisayolKaldir'));
    kaldir.addEventListener('click', async () => {
      try {
        await iste(`api/klasorler/dosya/${d.id}/kisayol/${encodeURIComponent(k.id)}`, { method: 'DELETE' });
        await yenile();
      } catch (h) { hataGoster(h.message); }
    });
    eylem.append(kaldir);
  }

  if (d.duzenleyebilir && !kisayolMu) {
    const sil = dugme(t('genel.sil'), 'metin-bag klasor-sil');
    sil.addEventListener('click', async () => {
      if (!(await onayla(t('klasor.silOnay', { ad: d.ad }), { evet: t('genel.sil'), tehlike: true }))) return;
      try {
        await iste(`api/klasorler/dosya/${d.id}`, { method: 'DELETE' });
        await yenile();
      } catch (h) { hataGoster(h.message); }
    });
    eylem.append(sil);
  }

  li.append(eylem);
  return li;
}

/* --- Üst araçlar: arama, kurumumun klasörleri, son eklenenler ------------------ */
function gorunumSec(yeni) {
  gorunum = yeni;
  $('kurumum-dugme').setAttribute('aria-pressed', String(yeni === 'kurum'));
  $('son-dugme').setAttribute('aria-pressed', String(yeni === 'son'));
}

/** Dosya listesi: her satırın üstünde durduğu klasöre giden bağlantı. */
function dosyaListesi(dosyalar) {
  const ul = el('ul', 'klasor-dosyalar');
  for (const d of dosyalar) {
    const k = dizin.get(d.klasor);
    const li = dosyaSatiri(d, k);
    const yer = dugme(`📁 ${tamAd(k)}`, 'metin-bag klasor-dosya-yer');
    yer.addEventListener('click', () => sec_(k.id, { kaydir: false }));
    li.prepend(yer);
    ul.append(li);
  }
  return ul;
}

/** Kurumun sorumlu olduğu klasörler: sahip listesinde kurum var ya da
 *  klasör kurumun kendi klasörü. "Herkes yükler" klasörleri sayılmaz —
 *  onlar her kurumun listesini aynı gürültüyle doldururdu. */
const kurumumunMu = k => !k.sahip.includes('*') && (k.sahip.includes(durum.kullanici.partner) || k.kurum === durum.kullanici.partner);

function aracGorunumunuCiz(kap) {
  const bas = el('div', 'klasor-bas');
  const arama = $('klasor-ara').value.trim().toLocaleLowerCase(durum.dil);

  if (gorunum === 'ara') {
    const bulunan = veri.dosyalar
      .filter(d => d.ad.toLocaleLowerCase(durum.dil).includes(arama) || (d.aciklama || '').toLocaleLowerCase(durum.dil).includes(arama))
      .sort((a, b) => b.updated.localeCompare(a.updated));
    bas.append(el('h2', '', t('klasor.araSonuc', { n: bulunan.length, arama: $('klasor-ara').value.trim() })));
    kap.append(bas);
    kap.append(bulunan.length ? dosyaListesi(bulunan.slice(0, 50)) : el('p', 'klasor-bos-not', t('klasor.araYok')));
    return;
  }

  if (gorunum === 'son') {
    const son = [...veri.dosyalar].sort((a, b) => b.surum.created.localeCompare(a.surum.created)).slice(0, 20);
    bas.append(el('h2', '', t('klasor.son')), el('p', 'klasor-meta', t('klasor.son.not')));
    kap.append(bas);
    kap.append(son.length ? dosyaListesi(son) : el('p', 'klasor-bos-not', t('klasor.son.yok')));
    return;
  }

  /* Kurumumun klasörleri: en üst düzeyde kalanlar (alt klasörü de kurumunsa
     tekrar listelenmez), dosya sayısıyla kart olarak. */
  const benim = veri.klasorler.filter(kurumumunMu);
  const kokler = benim.filter(k => !benim.some(u => u.id === k.ust));
  bas.append(el('h2', '', t('klasor.kurumum.baslik', { kurum: ortakKisa(durum.kullanici.partner) })),
    el('p', 'klasor-meta', t('klasor.kurumum.not', { n: benim.length })));
  kap.append(bas);
  if (!kokler.length) { kap.append(el('p', 'klasor-bos-not', t('klasor.kurumum.yok'))); return; }
  const izgara = el('div', 'klasor-kartlar');
  for (const a of kokler) {
    const kart = dugme('', 'klasor-kart');
    const n = sayi(a.id);
    kart.dataset.bos = String(n === 0);
    if (numara(a)) kart.append(el('span', 'klasor-no', numara(a)));
    kart.append(el('span', 'klasor-kart-ad', ad(a)));
    kart.append(el('span', 'klasor-kart-adet', t('klasor.dosyaSayisi', { n })));
    kart.addEventListener('click', () => sec_(a.id, { kaydir: false }));
    izgara.append(kart);
  }
  kap.append(izgara);
}

/* --- Dosya yükle kutusu -------------------------------------------------------------
   Üstteki düğmeden: dosya tek bir klasörde durduğu için önce "nereye?"
   sorulur. Seçili klasöre yüklenebiliyorsa o önceden seçili gelir. */
function yukleKutusunuKur() {
  const kutu = $('yukle-kutu');
  const form = $('yukle-form');
  for (const k of kutu.querySelectorAll('[data-kapat]')) k.addEventListener('click', () => kutu.close());
  $('yukle-dugme').addEventListener('click', () => {
    form.reset();
    const secim = klasorSecimi();
    secim.name = 'klasor';
    secim.required = true;
    if (dizin.get(secili)?.yukleyebilir) secim.value = secili;
    $('yukle-klasor-yer').replaceChildren(secim);
    form.dosya.accept = veri.sinir.uzantilar.map(u => '.' + u).join(',');
    $('yukle-sinir').textContent = t('klasor.yukle.ipucu', { mb: Math.round(veri.sinir.bayt / 1048576) });
    kutu.showModal();
  });
  form.addEventListener('submit', async olay => {
    olay.preventDefault();
    const hedef = form.klasor.value;
    const dosyalar = [...form.dosya.files];
    const aciklama = form.aciklama.value;
    kutu.close();
    /* Klasöre geçilir ki yükleme durumu ve olası hata orada görünsün. */
    sec_(hedef, { kaydir: false });
    await yukle(dosyalar, hedef, { aciklama });
  });
}

function icerigiCiz() {
  const kap = $('klasor-icerik');
  kap.replaceChildren();
  if (gorunum) { aracGorunumunuCiz(kap); return; }
  const k = dizin.get(secili);
  if (!k) {
    kap.append(el('p', 'bos-durum', t('klasor.sec')));
    return;
  }

  /* Başlık: yol, ad, etkinlik bilgisi ve yükleme yetkisi. */
  const bas = el('div', 'klasor-bas');
  const yol = el('nav', 'klasor-yol');
  yol.setAttribute('aria-label', t('klasor.agac'));
  const zincir = [];
  for (let x = dizin.get(k.ust); x; x = dizin.get(x.ust)) zincir.unshift(x);
  for (const x of zincir) {
    const b = dugme(tamAd(x));
    b.addEventListener('click', () => sec_(x.id, { kaydir: false }));
    yol.append(b, el('span', 'klasor-yol-ayrac', '/'));
  }
  if (zincir.length) bas.append(yol);

  const h2 = el('h2');
  if (numara(k)) h2.append(el('span', 'klasor-no', numara(k)), ' ');
  h2.append(ad(k));
  bas.append(h2);

  const meta = el('p', 'klasor-meta');
  if (k.wp) {
    const w = el('span', 'etiket etiket-wp', k.wp);
    w.dataset.wp = k.wp;
    meta.append(w);
  }
  meta.append(el('span', 'klasor-sahip', `${t('klasor.sahip')}: ${sahipMetni(k)}`));
  bas.append(meta);
  kap.append(bas);

  /* Bütçe klasöründe (03, 03.1) dağılım tablosu da görünür. */
  if (k.id === '03' || k.id === '03.1') {
    const b = el('section', 'klasor-bolum');
    b.append(el('h3', 'klasor-bolum-bas', t('klasor.butce')), butceTablosu());
    kap.append(b);
  }

  /* Alt klasörler: kart olarak, dosya sayısıyla. */
  const altlar = cocuklar(k.id);
  if (altlar.length) {
    const bolum = el('section', 'klasor-bolum');
    bolum.append(el('h3', 'klasor-bolum-bas', t('klasor.altKlasorler')));
    const izgara = el('div', 'klasor-kartlar');
    for (const a of altlar) {
      const kart = dugme('', 'klasor-kart');
      const n = sayi(a.id);
      kart.dataset.bos = String(n === 0);
      if (numara(a)) kart.append(el('span', 'klasor-no', numara(a)));
      kart.append(el('span', 'klasor-kart-ad', ad(a)));
      kart.append(el('span', 'klasor-kart-adet', t('klasor.dosyaSayisi', { n })));
      kart.addEventListener('click', () => sec_(a.id, { kaydir: false }));
      izgara.append(kart);
    }
    bolum.append(izgara);
    kap.append(bolum);
  }

  /* Dosyalar: burada duranlar önce, kısayolla görünenler sonra. */
  const burada = veri.dosyalar.filter(d => d.klasor === k.id);
  const kisayollar = veri.dosyalar.filter(d => d.klasor !== k.id && d.kisayollar.includes(k.id));
  const bolum = el('section', 'klasor-bolum');
  bolum.append(el('h3', 'klasor-bolum-bas', t('klasor.dosyalar')));
  if (!burada.length && !kisayollar.length) bolum.append(el('p', 'klasor-bos-not', t('klasor.bos')));
  else {
    const ul = el('ul', 'klasor-dosyalar');
    for (const d of [...burada, ...kisayollar]) ul.append(dosyaSatiri(d, k));
    bolum.append(ul);
  }
  kap.append(bolum);

  /* Yükleme alanı. Yetkisi olmayana neden olmadığı söylenir; alanı
     tamamen gizlemek "bu klasöre nasıl belge konur" sorusunu cevapsız
     bırakırdı. */
  const yukleme = el('section', 'klasor-yukle');
  if (k.yukleyebilir) {
    const girdi = el('input');
    girdi.type = 'file';
    girdi.multiple = true;
    girdi.id = 'klasor-dosya';
    girdi.accept = veri.sinir.uzantilar.map(u => '.' + u).join(',');
    const etiket = el('label', 'dugme dugme-ikincil', t('klasor.yukle'));
    etiket.htmlFor = 'klasor-dosya';
    girdi.className = 'klasor-gizli';
    girdi.addEventListener('change', () => girdi.files.length && yukle([...girdi.files], k.id));

    const aciklama = el('input', 'klasor-aciklama');
    aciklama.id = 'klasor-aciklama';
    aciklama.maxLength = veri.sinir.aciklama || 300;
    aciklama.placeholder = t('klasor.yukle.aciklama');
    aciklama.setAttribute('aria-label', t('klasor.yukle.aciklama'));

    const satir = el('div', 'klasor-yukle-satir');
    satir.append(etiket, girdi, aciklama);
    yukleme.append(satir);
    yukleme.append(el('p', 'ipucu', t('klasor.yukle.ipucu', { mb: Math.round(veri.sinir.bayt / 1048576) })));

    /* Sürükle-bırak: bütün yükleme şeridi hedeftir. */
    yukleme.addEventListener('dragover', o => { o.preventDefault(); yukleme.dataset.uzerinde = 'true'; });
    yukleme.addEventListener('dragleave', () => { delete yukleme.dataset.uzerinde; });
    yukleme.addEventListener('drop', o => {
      o.preventDefault();
      delete yukleme.dataset.uzerinde;
      if (o.dataTransfer.files.length) yukle([...o.dataTransfer.files], k.id);
    });
  } else {
    yukleme.append(el('p', 'ipucu', t('klasor.yukle.yetkiYok')));
  }
  const s = el('p', 'ipucu');
  s.id = 'klasor-yukleme';
  s.setAttribute('role', 'status');
  const h = el('p', 'hata');
  h.id = 'klasor-hata';
  h.setAttribute('role', 'alert');
  yukleme.append(s, h);
  kap.append(yukleme);
}

/* --- Belgenin tabloları ------------------------------------------------------ */
const eur = n => new Intl.NumberFormat(durum.dil, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

function tablo(basliklar, satirlar) {
  const tb = el('table', 'klasor-tablo');
  const bas = el('tr');
  for (const b of basliklar) bas.append(el('th', '', b));
  const thead = el('thead');
  thead.append(bas);
  const tbody = el('tbody');
  for (const satir of satirlar) {
    const tr = el('tr');
    for (const hucre of satir) {
      const td = el('td');
      if (hucre instanceof Node) td.append(hucre); else td.textContent = hucre;
      tr.append(td);
    }
    tbody.append(tr);
  }
  tb.append(thead, tbody);
  return tb;
}

function butceTablosu() {
  const { toplam, wp } = veri.butce;
  const yuzde = n => new Intl.NumberFormat(durum.dil, { style: 'percent', maximumFractionDigits: 1 }).format(n / toplam);
  const satirlar = wp.map(w => {
    const etiket = el('span', 'etiket etiket-wp', t(`wp.${w.wp}.ad`));
    etiket.dataset.wp = w.wp;
    return [etiket, eur(w.tutar), yuzde(w.tutar)];
  });
  satirlar.push([el('strong', '', t('klasor.butce.toplam')), el('strong', '', eur(toplam)), yuzde(toplam)]);
  const sar = el('div', 'klasor-tablo-sar');
  sar.append(el('p', 'ipucu', t('klasor.butce.not')),
    tablo([t('klasor.butce.wp'), t('klasor.butce.tutar'), t('klasor.butce.pay')], satirlar));
  return sar;
}

function takvimTablosu() {
  const satirlar = veri.takvim.map(r => {
    const git = dugme(tamAd(dizin.get(r.klasor)));
    git.addEventListener('click', () => { sec_(r.klasor, { kaydir: false }); $('klasor-duzen').scrollIntoView({ block: 'start' }); });
    const yer = r.ulke ? `${yerAdi(r.ulke)} / ${ortakKisa(r.ev)}` : t('klasor.takvim.tumUlkeler');
    const tarih = r.tarihAnahtari ? t(r.tarihAnahtari) : tarihAraligi(r.baslangic, r.bitis || r.baslangic);
    return [r.kod, t(`klasor.takvim.a.${r.ad}`), yer, tarih, r.wp, git];
  });
  return tablo(['kod', 'faaliyet', 'yer', 'tarih', 'wp', 'klasor'].map(a => t(`klasor.takvim.${a}`)), satirlar);
}

/* --- Açılış --------------------------------------------------------------- */
await baslat();
if (!durum.kullanici) {
  $('giris-uyarisi').hidden = false;
} else {
  $('klasor-duzen').hidden = false;
  await yenile();
  $('klasor-takvim').replaceChildren(takvimTablosu());
  $('klasor-butce').replaceChildren(butceTablosu());
  $('klasor-takvim-bolum').hidden = false;
  $('klasor-butce-bolum').hidden = false;
  $('klasor-arac').hidden = false;
  /* Arama hem ağacı süzer hem de bulunan dosyaları içerik panosunda listeler;
     kutu boşalınca seçili klasöre dönülür. */
  $('klasor-ara').addEventListener('input', () => {
    gorunumSec($('klasor-ara').value.trim() ? 'ara' : null);
    agaciCiz();
    icerigiCiz();
  });
  for (const [dugmeId, ad_] of [['kurumum-dugme', 'kurum'], ['son-dugme', 'son']]) {
    $(dugmeId).addEventListener('click', () => {
      gorunumSec(gorunum === ad_ ? null : ad_);
      icerigiCiz();
    });
  }
  yukleKutusunuKur();
  $('klasor-bos').addEventListener('change', agaciCiz);
  const ilk = decodeURIComponent(location.hash.slice(1));
  sec_(dizin.has(ilk) ? ilk : '01', { kaydir: false });
  addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id !== secili && dizin.has(id)) sec_(id, { kaydir: false });
  });
}
