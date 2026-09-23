import {
  durum, t, baslat, iste, ceviriyiUygula, ortakAdi, ortakKisa, yerAdi, etkinlikBaslik, etkinlikOzet, tarihAraligi, tamTarih, ayYil, bugun, gunFarki, onayla, bildir,
} from './ortak.js';

/**
 * Etkinlik takvimi: üç görünüm, ortak filtre.
 *
 * BİRİNCİL GÖRÜNÜM ZAMAN ÇİZELGESİDİR. 24 aya yayılan 14 aktivitenin çoğu
 * haftalar-aylar sürüyor (çıktı üretim dönemleri) ve birbiriyle çakışıyor;
 * ay ızgarasında bu ilişki görünmez, tek bir aya bakan kişi projenin o ay
 * neyin ortasında olduğunu anlayamaz. Çizelge ayları sütun, aktiviteleri
 * satır yapar ve çakışmaları olduğu gibi gösterir. Ay ve liste görünümleri,
 * "bu ay ne var" ve "sıradaki ne" sorularına yanıt olarak yanında durur.
 */

const $ = id => document.getElementById(id);
const kap = () => $('gorunum-kabi');

const gorunumler = ['ay', 'zaman', 'liste'];
/* Varsayilan gun izgarasidir: kullanicilar takvimden once "bu ay hangi gun
   ne var" sorusunu soruyor. Zaman cizelgesi 24 ayin butununu gormek
   isteyenler icin bir tik uzakta duruyor. */
let gorunum = 'ay';
let ayImleci = null;   // Date (UTC ayın ilk günü) — yalnızca ay görünümünde
let etkinlikler = [];
let maxFoto = 10;

const filtre = { arama: '', wp: '', tur: '', ortak: '', durum: '' };

/* --- Yardımcılar --------------------------------------------------------- */
const ayAnahtari = gun => gun.slice(0, 7);
/* İki gün arasındaki tam ay farkı: çizelgede sütun konumunu verir. */
const ayFarki = (a, b) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));

const el = (etiket, sinif, metin) => {
  const d = document.createElement(etiket);
  if (sinif) d.className = sinif;
  if (metin != null) d.textContent = metin;
  return d;
};

/** Kullanıcı bu kaydı düzenleyebilir mi? Sunucudaki kuralın aynısı —
 *  arayüz yalnızca yapılabileni gösterir, yetkiyi sunucu doğrular. */
const duzenleyebilir = e =>
  !!durum.kullanici && (durum.kullanici.koordinator || durum.kullanici.partner === e.lider);

function suzulmus() {
  const ara = filtre.arama.trim().toLocaleLowerCase(durum.dil);
  return etkinlikler.filter(e => {
    if (filtre.wp && e.wp !== filtre.wp) return false;
    if (filtre.tur && e.tur !== filtre.tur) return false;
    if (filtre.durum && e.durum !== filtre.durum) return false;
    if (filtre.ortak && e.lider !== filtre.ortak && !e.katilimcilar.includes(filtre.ortak)) return false;
    if (!ara) return true;
    const havuz = [etkinlikBaslik(e), etkinlikOzet(e), t(`wp.${e.wp}.ad`), t(`tur.${e.tur}`), yerAdi(e.yer), ortakAdi(e.lider)]
      .join(' ').toLocaleLowerCase(durum.dil);
    return havuz.includes(ara);
  });
}

/* --- Zaman çizelgesi ----------------------------------------------------- */
function zamanCiz(liste) {
  const { start, end } = durum.proje;
  const ayAdet = ayFarki(start, end) + 1;
  const simdi = bugun();

  const sar = el('div', 'zaman-sar');
  const izgara = el('div', 'zaman');
  izgara.style.gridTemplateColumns = `220px repeat(${ayAdet}, minmax(52px, 1fr))`;

  /* Başlık satırı: ay kısaltması + yıl değiştiğinde yıl. */
  izgara.append(el('div', 'zaman-etiket'));
  for (let i = 0; i < ayAdet; i++) {
    const tarih = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1 + i, 1));
    const hucre = el('div', 'zaman-ay');
    hucre.textContent = new Intl.DateTimeFormat(durum.dil, { timeZone: 'UTC', month: 'short' }).format(tarih);
    if (tarih.getUTCMonth() === 0 || i === 0) hucre.append(el('small', null, String(tarih.getUTCFullYear())));
    izgara.append(hucre);
  }

  /* Satırlar iş paketine göre gruplanır; grid satır sayacı elle tutulur
     çünkü çubuk kendi satırındaki hücrelerin üstüne biniyor. */
  let satir = 2;
  const gruplar = durum.ispaketleri
    .map(wp => [wp, liste.filter(e => e.wp === wp).sort((a, b) => a.baslangic.localeCompare(b.baslangic))])
    .filter(([, kayitlar]) => kayitlar.length);

  for (const [wp, kayitlar] of gruplar) {
    const bas = el('div', 'zaman-wp-bas', t(`wp.${wp}.ad`));
    bas.style.gridRow = String(satir);
    izgara.append(bas);
    satir++;

    for (const e of kayitlar) {
      const etiket = el('div', 'zaman-etiket');
      etiket.style.gridRow = String(satir);
      etiket.append(el('strong', null, etkinlikBaslik(e)));
      etiket.append(el('small', null, `${t(`tur.${e.tur}.kisa`)} · ${ortakKisa(e.lider)}`));
      izgara.append(etiket);

      for (let i = 0; i < ayAdet; i++) {
        const hucre = el('div', 'zaman-hucre');
        hucre.style.gridRow = String(satir);
        hucre.style.gridColumn = String(i + 2);
        izgara.append(hucre);
      }

      /* Sütun çözünürlüğü aydır: gün gün çizmek 24 ayda okunmaz bir
         kalınlık üretirdi, ayrıca tek günlük TPM'ler görünmez olurdu. */
      const ilk = Math.max(0, ayFarki(start, e.baslangic));
      const son = Math.min(ayAdet - 1, ayFarki(start, e.bitis));
      /* Satır etiketi zaten adı taşıyor. Bir-iki aylık çubuklara başlık
         sığmadığı ve "A-1. Beceri Geliş…" gibi kesildiği için kısa çubuk
         tür kodunu (TPM, LTTA, Sanal) gösterir; tam ad ipucunda durur. */
      const genislik = Math.max(son, ilk) - ilk + 1;
      const cubuk = el('button', 'zaman-cubuk', genislik <= 2 ? t(`tur.${e.tur}.kisa`) : etkinlikBaslik(e));
      cubuk.type = 'button';
      cubuk.dataset.wp = e.wp;
      cubuk.dataset.durum = e.durum;
      cubuk.title = `${etkinlikBaslik(e)} — ${tarihAraligi(e.baslangic, e.bitis)}`;
      cubuk.style.setProperty('--satir', String(satir));
      cubuk.style.gridColumn = `${ilk + 2} / ${Math.max(son, ilk) + 3}`;
      cubuk.addEventListener('click', () => detayAc(e));
      izgara.append(cubuk);
      satir++;
    }
  }

  /* Bugün çizgisi yalnızca proje aralığındayken çizilir. */
  if (simdi >= start && simdi <= end) {
    const isaret = el('div', 'zaman-bugun');
    isaret.style.gridColumn = String(ayFarki(start, simdi) + 2);
    isaret.title = t('takvim.bugun');
    izgara.append(isaret);
  }

  sar.append(izgara);
  return sar;
}

/* --- Ay ızgarası --------------------------------------------------------- */
function ayCiz(liste) {
  const yil = ayImleci.getUTCFullYear(), ay = ayImleci.getUTCMonth();
  const izgara = el('div', 'ay-izgara');

  /* Hafta pazartesi başlar (Avrupa alışkanlığı); gün adları Intl'den gelir. */
  const adBicim = new Intl.DateTimeFormat(durum.dil, { timeZone: 'UTC', weekday: 'short' });
  for (let i = 0; i < 7; i++) {
    izgara.append(el('div', 'ay-baslik', adBicim.format(new Date(Date.UTC(2024, 0, 1 + i)))));
  }

  const ilk = new Date(Date.UTC(yil, ay, 1));
  const kaydir = (ilk.getUTCDay() + 6) % 7;
  const basla = new Date(Date.UTC(yil, ay, 1 - kaydir));
  const simdi = bugun();

  for (let i = 0; i < 42; i++) {
    const gun = new Date(basla.getTime() + i * 86400000);
    const anahtar = gun.toISOString().slice(0, 10);
    const hucre = el('div', 'ay-gun');
    if (gun.getUTCMonth() !== ay) hucre.dataset.disarda = '1';
    if (anahtar === simdi) hucre.dataset.bugun = '1';
    hucre.append(el('span', 'ay-gun-no', String(gun.getUTCDate())));

    for (const e of liste.filter(x => x.baslangic <= anahtar && anahtar <= x.bitis)) {
      const dugme = el('button', 'ay-etkinlik', etkinlikBaslik(e));
      dugme.type = 'button';
      dugme.dataset.wp = e.wp;
      dugme.dataset.durum = e.durum;
      dugme.title = etkinlikBaslik(e);
      dugme.addEventListener('click', () => detayAc(e));
      hucre.append(dugme);
    }
    izgara.append(hucre);
  }
  return izgara;
}

/* --- Liste --------------------------------------------------------------- */
function listeCiz(liste) {
  const kutu = el('div', 'liste');
  let sonAy = '';
  for (const e of [...liste].sort((a, b) => a.baslangic.localeCompare(b.baslangic))) {
    const anahtar = ayAnahtari(e.baslangic);
    if (anahtar !== sonAy) {
      sonAy = anahtar;
      kutu.append(el('div', 'liste-ay', ayYil(Number(anahtar.slice(0, 4)), Number(anahtar.slice(5, 7)) - 1)));
    }

    const satir = el('button', 'liste-satir');
    satir.type = 'button';
    satir.dataset.wp = e.wp;
    satir.id = `etkinlik-${e.id}`;
    satir.addEventListener('click', () => detayAc(e));

    const tarih = el('div', 'liste-tarih', tarihAraligi(e.baslangic, e.bitis));
    const sure = gunFarki(e.baslangic, e.bitis) + 1;
    tarih.append(el('small', null, `${sure} ${t('genel.gun')}`));

    const orta = el('div');
    orta.append(el('div', 'liste-ad', etkinlikBaslik(e)));
    const etiketler = el('div', 'liste-etiketler');
    etiketler.append(
      etiketYap(t(`wp.${e.wp}.ad`), 'etiket-wp', { wp: e.wp }),
      etiketYap(t(`tur.${e.tur}`)),
      etiketYap(`${yerAdi(e.yer)} · ${ortakKisa(e.lider)}`),
    );
    /* Faaliyet dosyası yalnızca başlamış faaliyette gösterilir: gelecektekinde
       "0/6" bir eksik değil, henüz zamanı gelmemiş iştir. */
    if (e.dosya && e.baslangic <= bugun()) {
      const tamam = e.dosya.tamam === e.dosya.toplam;
      etiketler.append(el('span', `fd-rozet${tamam ? ' fd-rozet-tamam' : ''}`, t('faaliyet.rozet', { n: e.dosya.tamam, toplam: e.dosya.toplam })));
    }
    orta.append(etiketler);

    const sag = etiketYap(t(`durum.${e.durum}`), 'etiket-durum', { durum: e.durum });

    satir.append(tarih, orta, sag);
    kutu.append(satir);
  }
  return kutu;
}

function etiketYap(metin, ek = '', veri = {}) {
  const span = el('span', `etiket ${ek}`.trim(), metin);
  for (const [ad, deger] of Object.entries(veri)) span.dataset[ad] = deger;
  return span;
}

/* --- Çizim --------------------------------------------------------------- */
function ciz() {
  const hepsi = suzulmus();
  /* Ay görünümü yalnızca o ayı gösterir; çizelge ve liste tüm programı. */
  const liste = gorunum === 'ay'
    ? hepsi.filter(e => ayFarki(e.baslangic, ayImleci.toISOString().slice(0, 10)) >= 0
                     && ayFarki(ayImleci.toISOString().slice(0, 10), e.bitis) >= 0)
    : hepsi;

  $('pano-baslik').textContent = gorunum === 'ay'
    ? ayYil(ayImleci.getUTCFullYear(), ayImleci.getUTCMonth())
    : tarihAraligi(durum.proje.start, durum.proje.end);

  /* Ay dışı gezinti anlamsız: çizelge ve liste zaten tüm projeyi kapsıyor. */
  ayYilSecimiTazele();
  for (const id of ['onceki', 'sonraki', 'bugun-dugme', 'ay-secim', 'yil-secim']) $(id).disabled = gorunum !== 'ay';

  const govde = liste.length
    ? (gorunum === 'zaman' ? zamanCiz(liste) : gorunum === 'ay' ? ayCiz(liste) : listeCiz(liste))
    : el('p', 'bos-durum', t('takvim.bos'));

  kap().replaceChildren(govde);
  $('pano-sayi').textContent = t('takvim.sayi', { n: liste.length });

  for (const dugme of document.querySelectorAll('.gorunum button')) {
    dugme.setAttribute('aria-pressed', String(dugme.id === `gorunum-${gorunum}`));
  }
}


/* --- Fotoğraflar ---------------------------------------------------------
   Görseller listeyle birlikte gelmez (bkz. routes/etkinlik.mjs): burada
   yalnızca kimlikleri var, gövdeyi tarayıcı `/api/foto/<id>` üzerinden
   kendisi çeker ve önbelleğe alır. */
function galeriCiz(kutu, foto, silinebilir, sonra) {
  kutu.replaceChildren();
  kutu.hidden = !foto.length && !silinebilir;
  if (!foto.length) {
    if (silinebilir) kutu.append(el('p', 'ipucu', t('foto.yok')));
    return;
  }
  for (const f of foto) {
    const hucre = el('figure', 'foto-kutu');

    const bag = el('a');
    bag.href = `api/foto/${f.id}`;
    bag.target = '_blank';
    bag.rel = 'noopener';
    bag.title = t('foto.ac');
    const gorsel = el('img');
    gorsel.src = `api/foto/${f.id}`;
    gorsel.alt = f.ad;
    gorsel.loading = 'lazy';
    bag.append(gorsel);
    hucre.append(bag);

    if (silinebilir) {
      const sil = el('button', 'foto-sil', '×');
      sil.type = 'button';
      sil.title = t('foto.sil');
      sil.setAttribute('aria-label', `${t('foto.sil')}: ${f.ad}`);
      sil.addEventListener('click', async () => {
        if (!(await onayla(t('foto.silOnay', { ad: f.ad }), { evet: t('genel.sil'), tehlike: true }))) return;
        try {
          await iste(`api/foto/${f.id}`, { method: 'DELETE' });
          await sonra();
        } catch (err) {
          bildir(err.message, 'hata');
        }
      });
      hucre.append(sil);
    }
    kutu.append(hucre);
  }
}

/** Seçilen dosyaları sırayla yükler. Paralel gönderim sunucuda adet
 *  sınırını yarışa sokardı: iki istek aynı anda "9 fotoğraf var" görüp
 *  ikisi birden geçebilirdi. */
async function fotolariYukle(etkinlikId, dosyalar) {
  for (const dosya of dosyalar) {
    await iste(`api/etkinlikler/${etkinlikId}/foto`, {
      method: 'POST',
      headers: { 'Content-Type': dosya.type || 'application/octet-stream', 'x-dosya-adi': encodeURIComponent(dosya.name) },
      body: dosya,
    });
  }
}

/* --- Ayrıntı kutusu ------------------------------------------------------ */
let acikEtkinlik = null;

/* --- Faaliyet dosyası ------------------------------------------------------
   Pencerede bir şerit: "Faaliyet dosyası 4/6" ve her parçanın satırı.
   Eksik parça tıklanınca kendi satırına gidilir; dosya yüklemek ile
   faaliyeti tamamlamak arasındaki bağ böylece görünür. Fotoğraf ve anket
   türetilir: fotoğraf etkinliğin galerisinden, anket Formlar'dan. */
const boyutYaz = b => new Intl.NumberFormat(durum.dil, { style: 'unit', unit: b >= 1048576 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1 })
  .format(b >= 1048576 ? b / 1048576 : Math.max(b / 1024, 0.1));

async function dosyaSeridiCiz(e) {
  const kutu = $('detay-dosya');
  if (!e.dosya) { kutu.hidden = true; kutu.replaceChildren(); return; }
  let veri;
  try { veri = await iste(`api/etkinlikler/${e.id}/dosya`); }
  catch (err) { kutu.hidden = true; bildir(err.message, 'hata'); return; }
  if (acikEtkinlik?.id !== e.id) return;

  const tamam = veri.parcalar.filter(p => p.tamam).length;
  const bas = el('div', 'fd-bas');
  bas.append(el('h3', null, t('faaliyet.baslik')),
    el('span', `fd-sayac${tamam === veri.parcalar.length ? ' fd-sayac-tamam' : ''}`, t('faaliyet.sayac', { n: tamam, toplam: veri.parcalar.length })));

  /* Parça çipleri: eksikler tıklanabilir, kendi satırına götürür. */
  const cipler = el('div', 'fd-cipler');
  const liste = el('ul', 'fd-liste');
  for (const p of veri.parcalar) {
    const satirId = `fd-${e.id}-${p.tur}`;
    const cip = el('a', `fd-cip${p.tamam ? ' fd-cip-tamam' : ''}`, `${p.tamam ? '✓' : '○'} ${t(`faaliyet.parca.${p.tur}`)}`);
    cip.href = '#' + satirId;
    cip.addEventListener('click', o => { o.preventDefault(); document.getElementById(satirId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); document.getElementById(satirId)?.focus(); });
    cipler.append(cip);

    const li = el('li', `fd-satir${p.tamam ? ' fd-satir-tamam' : ''}`);
    li.id = satirId;
    li.tabIndex = -1;
    const ust = el('div', 'fd-satir-ust');
    ust.append(el('strong', null, t(`faaliyet.parca.${p.tur}`)), el('span', 'fd-durum', t(p.tamam ? 'faaliyet.tamam' : 'faaliyet.eksik')));
    li.append(ust);

    if (p.tur === 'foto') {
      li.append(el('p', 'fd-not', p.sayi ? t('faaliyet.foto.var', { n: p.sayi }) : t('faaliyet.foto.yok')));
      if (veri.yetkili) {
        const ekle = el('button', 'metin-bag', t('faaliyet.foto.ekle'));
        ekle.type = 'button';
        ekle.addEventListener('click', () => { $('detay-kutu').close(); formAc(e); });
        li.append(ekle);
      }
    } else if (p.tur === 'anket') {
      if (p.form) {
        const bag = el('a', 'metin-bag', p.form.baslik);
        bag.href = `formlar.html#form-${p.form.id}`;
        li.append(bag);
      } else {
        li.append(el('p', 'fd-not', t('faaliyet.anket.yok')));
      }
      if (veri.yetkili) {
        const secim = el('select', 'fd-anket-sec');
        secim.setAttribute('aria-label', t('faaliyet.anket.sec'));
        secim.append(new Option(t('faaliyet.anket.bagYok'), ''));
        for (const f of veri.secenekler) secim.append(new Option(f.baslik, f.id));
        secim.value = p.form ? String(p.form.id) : '';
        secim.addEventListener('change', async () => {
          try {
            await iste(`api/etkinlikler/${e.id}/anket`, { method: 'PUT', body: JSON.stringify({ formId: secim.value ? Number(secim.value) : null }) });
            bildir(t('genel.kaydedildi'));
            await dosyaDegisti(e);
          } catch (err) { bildir(err.message, 'hata'); }
        });
        li.append(secim);
        if (!veri.secenekler.length) li.append(el('p', 'fd-not', t('faaliyet.anket.secenekYok')));
      }
    } else {
      const dosyalar = el('ul', 'fd-dosyalar');
      for (const d of p.dosyalar) {
        const di = el('li');
        const bag = el('a', 'metin-bag', d.ad);
        bag.href = `api/faaliyet-dosya/${d.id}`;
        bag.setAttribute('download', '');
        di.append(bag, el('span', 'fd-meta', ` · ${boyutYaz(d.boyut)} · ${tamTarih(d.created.slice(0, 10))}${d.yukleyen ? ' · ' + d.yukleyen : ''}`));
        if (veri.yetkili) {
          const sil = el('button', 'fd-sil', '×');
          sil.type = 'button';
          sil.setAttribute('aria-label', `${t('genel.sil')}: ${d.ad}`);
          sil.addEventListener('click', async () => {
            if (!(await onayla(t('klasor.silOnay', { ad: d.ad }), { evet: t('genel.sil'), tehlike: true }))) return;
            try { await iste(`api/faaliyet-dosya/${d.id}`, { method: 'DELETE' }); bildir(t('genel.silindi')); await dosyaDegisti(e); }
            catch (err) { bildir(err.message, 'hata'); }
          });
          di.append(sil);
        }
        dosyalar.append(di);
      }
      if (p.dosyalar.length) li.append(dosyalar);
      if (veri.yetkili) {
        const etiket = el('label', 'dugme dugme-ikincil dugme-kucuk fd-yukle', t('faaliyet.yukle'));
        const girdi = el('input', 'gorsel-gizli');
        girdi.type = 'file';
        girdi.multiple = true;
        etiket.append(girdi);
        girdi.addEventListener('change', async () => {
          const secilen = [...girdi.files];
          girdi.value = '';
          let n = 0;
          for (const f of secilen) {
            const yanit = await fetch(`api/etkinlikler/${e.id}/dosya?tur=${p.tur}`, {
              method: 'POST', body: f, headers: { 'X-File-Name': encodeURIComponent(f.name) },
            });
            if (yanit.ok) { n++; continue; }
            const g = await yanit.json().catch(() => ({}));
            bildir(`${f.name}: ${durum.sozluk[g.error] || g.error || t('genel.hata')}`, 'hata');
          }
          if (n) bildir(t('klasor.yuklendi', { n }));
          await dosyaDegisti(e);
        });
        li.append(etiket);
      }
    }
    liste.append(li);
  }

  kutu.replaceChildren(bas, cipler, liste);
  kutu.hidden = false;
}

/** Dosya değişince hem şerit hem liste/ana sayfa özetleri tazelenir. */
async function dosyaDegisti(e) {
  await etkinlikleriYenile();
  const guncel = etkinlikler.find(x => x.id === e.id) || e;
  acikEtkinlik = guncel;
  await dosyaSeridiCiz(guncel);
}

function detayAc(e) {
  acikEtkinlik = e;
  $('detay-baslik').textContent = etkinlikBaslik(e);

  const etiketler = $('detay-etiketler');
  etiketler.replaceChildren(
    etiketYap(t(`wp.${e.wp}.ad`), 'etiket-wp', { wp: e.wp }),
    etiketYap(t(`tur.${e.tur}`)),
    etiketYap(t(`durum.${e.durum}`), 'etiket-durum', { durum: e.durum }),
    etiketYap(t(e.resmi ? 'etkinlik.resmi' : 'etkinlik.yerel')),
  );

  const sure = gunFarki(e.baslangic, e.bitis) + 1;
  const satirlar = [
    ['etkinlik.tarih', tarihAraligi(e.baslangic, e.bitis)],
    ['etkinlik.sure', `${sure} ${t('genel.gun')}`],
    ['etkinlik.yer', yerAdi(e.yer)],
    ['etkinlik.lider', ortakAdi(e.lider)],
    ['etkinlik.katilimci', e.katilimcilar.map(ortakAdi).join(', ') || '—'],
  ];
  const dl = $('detay-satirlar');
  dl.replaceChildren();
  for (const [anahtar, deger] of satirlar) {
    const satir = el('div', 'kutu-satir');
    satir.append(el('dt', null, t(anahtar)), el('dd', null, deger));
    dl.append(satir);
  }

  const ozet = etkinlikOzet(e);
  const ozetKutu = $('detay-ozet');
  ozetKutu.hidden = !ozet;
  if (ozet) ozetKutu.replaceChildren(el('strong', null, t('etkinlik.ozet')), document.createTextNode(ozet));

  galeriCiz($('detay-fotolar'), e.fotolar || [], false, () => {});

  const bag = $('detay-baglanti');
  bag.hidden = !e.url;
  if (e.url) bag.href = e.url;

  const yetkili = duzenleyebilir(e);
  $('detay-duzenle').hidden = !yetkili;
  /* Resmî program taahhüttür: silinemez, yalnızca "Ertelendi" yapılabilir. */
  $('detay-sil').hidden = !yetkili || e.resmi;
  /* Silme düğmesi yoksa nedeni söylenir: yanlış girilmiş resmî kaydın
     çaresi düzenlemek ya da "Ertelendi" yapmaktır. */
  $('detay-resmi-not').hidden = !yetkili || !e.resmi;
  $('detay-resmi-not').textContent = t(durum.kullanici?.koordinator ? 'etkinlik.resmi.silinmez' : 'etkinlik.resmi.silinmezOrtak');

  $('detay-kutu').showModal();
  dosyaSeridiCiz(e);
}

/* --- Form ---------------------------------------------------------------- */
function secenekDoldur(secim, degerler, etiketle, seciliDeger, bosEtiket) {
  secim.replaceChildren();
  if (bosEtiket != null) {
    const bos = el('option', null, bosEtiket);
    bos.value = '';
    secim.append(bos);
  }
  for (const deger of degerler) {
    const secenek = el('option', null, etiketle(deger));
    secenek.value = deger;
    secim.append(secenek);
  }
  secim.value = seciliDeger ?? '';
}

function formAc(mevcut) {
  const form = $('etkinlik-form');
  const kisitli = !!mevcut?.resmi && !durum.kullanici.koordinator;
  $('form-baslik').textContent = t(mevcut ? 'form.baslik.duzenle' : 'form.baslik.yeni');
  $('form-kilit').hidden = !kisitli;
  $('form-hata').textContent = '';

  secenekDoldur(form.wp, durum.ispaketleri, wp => t(`wp.${wp}.ad`), mevcut?.wp ?? 'WP4');
  secenekDoldur(form.tur, durum.turler, tur => t(`tur.${tur}`), mevcut?.tur ?? 'cogaltici');
  secenekDoldur(form.yer, durum.yerler, yerAdi, mevcut?.yer ?? durum.ortaklar.find(o => o.id === durum.kullanici.partner)?.country);
  secenekDoldur(form.durum, durum.durumlar, d => t(`durum.${d}`), mevcut?.durum ?? 'planlandi');
  /* Ortak hesabı yalnızca kendi kurumunu lider gösterebilir (sunucu da
     bunu doğrular); koordinatör tüm kurumlar arasından seçer. */
  const liderSecenekleri = durum.kullanici.koordinator
    ? durum.ortaklar.map(o => o.id)
    : [durum.kullanici.partner];
  secenekDoldur(form.lider, liderSecenekleri, ortakAdi, mevcut?.lider ?? durum.kullanici.partner);

  form.baslik.value = mevcut ? etkinlikBaslik(mevcut) : '';
  form.ozet.value = mevcut ? etkinlikOzet(mevcut) : '';
  form.baslangic.value = mevcut?.baslangic ?? '';
  form.bitis.value = mevcut?.bitis ?? '';
  form.url.value = mevcut?.url ?? '';
  form.baslangic.min = form.bitis.min = durum.proje.start;
  form.baslangic.max = form.bitis.max = durum.proje.end;

  const kutu = $('form-katilimcilar');
  kutu.replaceChildren();
  for (const o of durum.ortaklar) {
    const etiket = el('label', 'onay');
    const onay = el('input');
    onay.type = 'checkbox';
    onay.value = o.id;
    onay.checked = mevcut ? mevcut.katilimcilar.includes(o.id) : false;
    etiket.append(onay, document.createTextNode(o.short));
    kutu.append(etiket);
  }

  /* Kısıtlı düzenlemede yalnızca durum ve bağlantı açık kalır — sunucudaki
     kuralın ekrandaki karşılığı. */
  for (const alan of ['baslik', 'ozet', 'wp', 'tur', 'yer', 'lider', 'baslangic', 'bitis']) {
    form[alan].disabled = kisitli;
  }
  for (const onay of kutu.querySelectorAll('input')) onay.disabled = kisitli;

  /* Yeni etkinlikte kayıt henüz yok: fotoğraflar kaydedildikten sonra
     yüklenir, bu yüzden liste boş gösterilir. */
  const secici = $('foto-sec');
  secici.value = '';
  $('foto-ipucu').textContent = t('foto.ipucu', { n: maxFoto });
  galeriCiz($('form-fotolar'), mevcut?.fotolar ?? [], !!mevcut, async () => {
    await etkinlikleriYenile();
    const taze = etkinlikler.find(x => x.id === mevcut.id);
    if (taze) galeriCiz($('form-fotolar'), taze.fotolar, true, () => {});
  });

  form.dataset.id = mevcut?.id ?? '';
  $('form-kutu').showModal();
}

async function formGonder(olay) {
  olay.preventDefault();
  const form = olay.target;
  const dugme = form.querySelector('button[type="submit"]');
  const hata = $('form-hata');
  hata.textContent = '';
  dugme.disabled = true;

  const veri = {
    baslik: form.baslik.value,
    ozet: form.ozet.value,
    wp: form.wp.value,
    tur: form.tur.value,
    yer: form.yer.value,
    lider: form.lider.value,
    baslangic: form.baslangic.value,
    bitis: form.bitis.value,
    durum: form.durum.value,
    url: form.url.value,
    katilimcilar: [...$('form-katilimcilar').querySelectorAll('input:checked')].map(o => o.value),
  };

  try {
    const id = form.dataset.id;
    const kayit = await iste(id ? `api/etkinlikler/${id}` : 'api/etkinlikler', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(veri),
    });
    const dosyalar = [...$('foto-sec').files];
    if (dosyalar.length) {
      dugme.textContent = t('foto.yukleniyor');
      await fotolariYukle(kayit.id, dosyalar);
    }
    $('form-kutu').close();
    await etkinlikleriYenile();
    bildir(t('genel.kaydedildi'));
  } catch (err) {
    hata.textContent = err.message;
  } finally {
    dugme.disabled = false;
  }
}

async function etkinlikleriYenile() {
  ({ etkinlikler, maxFoto = maxFoto } = await iste('api/etkinlikler'));
  ciz();
}

/* --- Faaliyet raporu ------------------------------------------------------
   Kutuda yalnızca DÖNEM ve DOSYA BİÇİMİ sorulur; süzgeçler sayfadakilerle
   aynıdır. İki ayrı süzgeç takımı (biri ekranda, biri kutuda) tutmak
   kullanıcıya "hangisi geçerli" sorusunu sordururdu; rapor, ekranda
   görünenin belgeye dökülmüş hâlidir ve kapsam kutuda yazılı durur.

   Arama yazılıysa eşleşenler işaretli liste olarak çıkar: rapora yalnızca
   işaretli kalanlar girer. Belge sunucuda ve İSTEĞİN DİLİNDE üretilir. */
const raporDisi = new Set();   // eşleşip işareti kaldırılan kayıtlar

/** Kutudaki dönem, seçili aya ya da tüm projeye göre açılır. */
function raporAc() {
  const form = $('rapor-form');
  const { start, end } = durum.proje;
  if (gorunum === 'ay' && ayImleci) {
    const ilk = `${ayImleci.getUTCFullYear()}-${String(ayImleci.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const son = new Date(Date.UTC(ayImleci.getUTCFullYear(), ayImleci.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    form.bas.value = ilk < start ? start : ilk;
    form.bit.value = son > end ? end : son;
  } else {
    form.bas.value = start;
    form.bit.value = end;
  }
  /* Etkinlikler yalnızca proje süresi içinde olabildiği için dönem de
     oraya sınırlanır. */
  form.bas.min = form.bit.min = start;
  form.bas.max = form.bit.max = end;

  raporDisi.clear();
  $('rapor-hata').textContent = '';
  raporKapsamiCiz();
  raporEslesenCiz();
  $('rapor-kutu').showModal();
}

/** Raporun kapsamı: sayfadaki süzgeçlerin okunur özeti. */
function raporKapsamiCiz() {
  $('rapor-kapsam').textContent = [
    filtre.wp ? `${filtre.wp} · ${t(`wp.${filtre.wp}.kisa`)}` : t('rapor.kapsam.wp'),
    filtre.tur ? t(`tur.${filtre.tur}`) : t('rapor.kapsam.tur'),
    filtre.ortak ? ortakKisa(filtre.ortak) : t('rapor.kapsam.ortak'),
    filtre.durum ? t(`durum.${filtre.durum}`) : t('rapor.kapsam.durum'),
    filtre.arama.trim() && t('rapor.kapsam.arama', { q: filtre.arama.trim() }),
  ].filter(Boolean).join('  ·  ');
}

/** Arama yazılıysa süzgeçlerden geçen kayıtlar; dönem dışındakiler ayrıca
 *  döner, "Dönemi genişlet" ile rapora alınabilsinler. */
function raporEslesenler() {
  const form = $('rapor-form');
  if (!filtre.arama.trim() || !form.bas.value || !form.bit.value) return null;
  const liste = suzulmus().slice().sort((a, b) => a.baslangic.localeCompare(b.baslangic));
  const icinde = e => e.baslangic <= form.bit.value && e.bitis >= form.bas.value;
  return Object.assign(liste.filter(icinde), { disarida: liste.filter(e => !icinde(e)) });
}

function raporEslesenCiz() {
  const eslesenler = raporEslesenler();
  $('rapor-eslesen-alan').hidden = !eslesenler;
  if (!eslesenler) return;

  const kutu = $('rapor-eslesen');
  kutu.replaceChildren();
  if (!eslesenler.length) kutu.append(el('p', 'bos-durum', t('rapor.eslesen.yok')));

  for (const e of eslesenler) {
    const etiket = el('label', 'onay');
    const onay = el('input');
    onay.type = 'checkbox';
    onay.checked = !raporDisi.has(e.id);
    onay.addEventListener('change', () => {
      if (onay.checked) raporDisi.delete(e.id); else raporDisi.add(e.id);
      raporEslesenSayisi(eslesenler);
    });
    const bilgi = el('span');
    bilgi.append(
      el('strong', null, etkinlikBaslik(e)),
      el('small', null, ` ${tarihAraligi(e.baslangic, e.bitis)} · ${ortakKisa(e.lider)} · ${t(`durum.${e.durum}`)}`),
    );
    etiket.append(onay, bilgi);
    kutu.append(etiket);
  }

  /* Dönem dışındakiler aynı kutuda, seçilemez hâlde durur: ayrı bir not
     olarak altta kalınca gözden kaçıyordu (GençTek takviminde görülmüştü). */
  if (eslesenler.disarida.length) {
    const dis = el('div', 'rapor-disinda');
    dis.append(el('p', null, t('rapor.disinda', { n: eslesenler.disarida.length })));
    for (const e of eslesenler.disarida) {
      dis.append(el('div', null, `${etkinlikBaslik(e)} · ${tarihAraligi(e.baslangic, e.bitis)}`));
    }
    const genislet = el('button', 'dugme dugme-ikincil', t('rapor.genislet'));
    genislet.type = 'button';
    genislet.addEventListener('click', () => {
      const form = $('rapor-form');
      form.bas.value = [form.bas.value, ...eslesenler.disarida.map(e => e.baslangic)].sort()[0];
      form.bit.value = [form.bit.value, ...eslesenler.disarida.map(e => e.bitis)].sort().at(-1);
      raporEslesenCiz();
    });
    dis.append(genislet);
    kutu.append(dis);
  }

  raporEslesenSayisi(eslesenler);
}

const raporEslesenSayisi = eslesenler => {
  $('rapor-eslesen-sayi').textContent =
    t('rapor.eslesen.sayi', { n: eslesenler.filter(e => !raporDisi.has(e.id)).length, toplam: eslesenler.length });
};

/** Bağlantı yerine fetch: oturum düşmüşse tarayıcı hata JSON'unu rapor
 *  dosyası diye kaydetmesin, mesaj kutuda görünsün. */
async function raporGonder(olay) {
  olay.preventDefault();
  const form = olay.target;
  const dugme = form.querySelector('button[type="submit"]');
  const hata = $('rapor-hata');
  hata.textContent = '';
  if (form.bit.value < form.bas.value) { hata.textContent = t('rapor.hata.tarih'); return; }

  const bicim = form.bicim.value;
  const parametreler = new URLSearchParams({ bas: form.bas.value, bit: form.bit.value, bicim });
  const eslesenler = raporEslesenler();
  if (eslesenler) {
    const idler = eslesenler.filter(e => !raporDisi.has(e.id)).map(e => e.id);
    if (!idler.length) { hata.textContent = t('rapor.hata.secimyok'); return; }
    /* Arama metni belgenin kapsam satırına yazılsın diye gönderilir;
       hangi kayıtların gireceğini `idler` belirler. */
    parametreler.set('ara', filtre.arama.trim());
    parametreler.set('idler', idler.join(','));
  } else {
    for (const [ad, deger] of [['wp', filtre.wp], ['tur', filtre.tur], ['ortak', filtre.ortak], ['durum', filtre.durum]]) {
      if (deger) parametreler.set(ad, deger);
    }
  }

  const etiket = dugme.textContent;
  dugme.disabled = true;
  dugme.textContent = t('rapor.hazirlaniyor');
  try {
    const yanit = await fetch('api/rapor?' + parametreler);
    if (!yanit.ok) {
      const veri = await yanit.json().catch(() => ({}));
      throw new Error(durum.sozluk[veri.error] || veri.error || t('genel.hata'));
    }
    const ad = /filename="([^"]+)"/.exec(yanit.headers.get('content-disposition') || '')?.[1] || `e-youthpreneur.${bicim}`;
    const bag = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await yanit.blob()), download: ad });
    document.body.append(bag);
    bag.click();
    bag.remove();
    setTimeout(() => URL.revokeObjectURL(bag.href), 30000);
    $('rapor-kutu').close();
  } catch (err) {
    hata.textContent = err.message;
  } finally {
    dugme.disabled = false;
    dugme.textContent = etiket;
  }
}

/* --- Kurulum ------------------------------------------------------------- */
function filtreleriKur() {
  secenekDoldur($('filtre-wp'), durum.ispaketleri, wp => t(`wp.${wp}.ad`), '', t('takvim.filtre.hepsi'));
  secenekDoldur($('filtre-tur'), durum.turler, tur => t(`tur.${tur}`), '', t('takvim.filtre.hepsi'));
  secenekDoldur($('filtre-ortak'), durum.ortaklar.map(o => o.id), ortakAdi, '', t('takvim.filtre.hepsi'));
  secenekDoldur($('filtre-durum'), durum.durumlar, d => t(`durum.${d}`), '', t('takvim.filtre.hepsi'));

  const bagla = (id, alan) => $(id).addEventListener('change', olay => { filtre[alan] = olay.target.value; ciz(); });
  bagla('filtre-wp', 'wp');
  bagla('filtre-tur', 'tur');
  bagla('filtre-ortak', 'ortak');
  bagla('filtre-durum', 'durum');

  let zamanlayici;
  $('arama').addEventListener('input', olay => {
    /* Her tuşta yeniden çizmek zaman çizelgesinde gözle görülür takılmaya
       yol açıyordu; kısa bir bekleme yeterli. */
    clearTimeout(zamanlayici);
    zamanlayici = setTimeout(() => { filtre.arama = olay.target.value; ciz(); }, 160);
  });

  $('filtre-temizle').addEventListener('click', () => {
    Object.keys(filtre).forEach(anahtar => { filtre[anahtar] = ''; });
    $('arama').value = '';
    for (const id of ['filtre-wp', 'filtre-tur', 'filtre-ortak', 'filtre-durum']) $(id).value = '';
    ciz();
  });
}

/**
 * Renk göstergesi.
 *
 * Yalnızca "WP1 WP2 WP3 WP4" yazmak yetmiyordu: kısaltmalar projeyi
 * bilmeyen için anlamsız, bilen için de hangi renk hangi paket olduğunu
 * hatırlatmıyordu. Artık paketin adı yazılı, tam başlığı ipucunda.
 */
function gostergeyiKur() {
  const kutu = $('gosterge');
  kutu.replaceChildren();
  for (const wp of durum.ispaketleri) {
    const span = el('span');
    span.title = t(`wp.${wp}.baslik`);
    const isaret = el('i');
    isaret.dataset.wp = wp;
    span.append(isaret, document.createTextNode(`${wp} · ${t(`wp.${wp}.kisa`)}`));
    kutu.append(span);
  }
}

function gorunumleriKur() {
  for (const ad of gorunumler) {
    $(`gorunum-${ad}`).addEventListener('click', () => { gorunum = ad; ciz(); });
  }
  ayYilSecimiKur();
  const kaydir = adim => {
    ayImleci = new Date(Date.UTC(ayImleci.getUTCFullYear(), ayImleci.getUTCMonth() + adim, 1));
    ciz();
  };
  $('onceki').addEventListener('click', () => kaydir(-1));
  $('sonraki').addEventListener('click', () => kaydir(1));
  $('bugun-dugme').addEventListener('click', () => {
    const simdi = new Date();
    ayImleci = new Date(Date.UTC(simdi.getFullYear(), simdi.getMonth(), 1));
    ciz();
  });
}

/* --- Ay ve yıl seçimi -------------------------------------------------
   24 aylık programda uzaktaki bir aya oklarla gitmek yirmi tıklama demek;
   seçiciler tek adımda götürür. Oklar kalsın, çünkü komşu aya bakmak
   için en kısa yol hâlâ onlar. */
function ayaGit() {
  ayImleci = new Date(Date.UTC(Number($('yil-secim').value), Number($('ay-secim').value), 1));
  ciz();
}

function ayYilSecimiKur() {
  /* Ay adlarını sözlük değil Intl verir: on iki adı altı dile elle yazmak
     yerine tarayıcının takvim bilgisini kullanıyoruz. */
  const adlar = new Intl.DateTimeFormat(durum.dil, { timeZone: 'UTC', month: 'long' });
  const secim = $('ay-secim');
  for (let ay = 0; ay < 12; ay++) {
    const secenek = el('option', null, adlar.format(new Date(Date.UTC(2000, ay, 1))));
    secenek.value = String(ay);
    secim.append(secenek);
  }
  secim.addEventListener('change', ayaGit);
  $('yil-secim').addEventListener('change', ayaGit);
}

/** Yıl listesi proje dönemini kapsar; oklarla dönem dışına çıkıldıysa o yıl
 *  da listeye katılır — seçici hiçbir zaman imleci gösteremez duruma düşmesin. */
function ayYilSecimiTazele() {
  const yilSecim = $('yil-secim');
  const yillar = [];
  for (let y = Number(durum.proje.start.slice(0, 4)); y <= Number(durum.proje.end.slice(0, 4)); y++) yillar.push(y);
  if (!yillar.includes(ayImleci.getUTCFullYear())) yillar.push(ayImleci.getUTCFullYear());
  yillar.sort((a, b) => a - b);

  const imza = yillar.join(',');
  if (yilSecim.dataset.imza !== imza) {
    yilSecim.dataset.imza = imza;
    yilSecim.replaceChildren(...yillar.map(y => {
      const secenek = el('option', null, String(y));
      secenek.value = String(y);
      return secenek;
    }));
  }
  $('ay-secim').value = String(ayImleci.getUTCMonth());
  yilSecim.value = String(ayImleci.getUTCFullYear());
}

function kutulariKur() {
  for (const dugme of document.querySelectorAll('[data-kapat]')) {
    dugme.addEventListener('click', () => dugme.closest('dialog').close());
  }

  $('ekle-dugme').addEventListener('click', () => formAc(null));
  $('etkinlik-form').addEventListener('submit', formGonder);

  $('rapor-dugme').addEventListener('click', raporAc);
  $('rapor-form').addEventListener('submit', raporGonder);
  $('rapor-form').addEventListener('change', olay => {
    if (['bas', 'bit'].includes(olay.target.name)) raporEslesenCiz();
  });
  $('rapor-tum-donem').addEventListener('click', () => {
    const form = $('rapor-form');
    form.bas.value = durum.proje.start;
    form.bit.value = durum.proje.end;
    raporEslesenCiz();
  });

  $('detay-duzenle').addEventListener('click', () => {
    $('detay-kutu').close();
    formAc(acikEtkinlik);
  });

  $('detay-sil').addEventListener('click', async () => {
    if (!(await onayla(t('form.sil.onay'), { evet: t('genel.sil'), tehlike: true }))) return;
    try {
      await iste(`api/etkinlikler/${acikEtkinlik.id}`, { method: 'DELETE' });
      $('detay-kutu').close();
      await etkinlikleriYenile();
    } catch (err) {
      bildir(err.message, 'hata');
    }
  });

}

/** Ana sayfadaki "yaklaşan etkinlik" bağlantıları `#etkinlik-<id>` ile gelir:
 *  liste görünümüne geçilip o kayıt açılır. */
function adresKancasi() {
  const eslesme = /^#etkinlik-(\d+)$/.exec(location.hash);
  if (!eslesme) return;
  const hedef = etkinlikler.find(e => e.id === Number(eslesme[1]));
  if (!hedef) return;
  gorunum = 'liste';
  ciz();
  detayAc(hedef);
}

(async () => {
  try {
    await baslat();
    ({ etkinlikler, maxFoto = maxFoto } = await iste('api/etkinlikler'));

    /* Açılışta proje içindeysek bu ay, değilsek projenin ilk ayı. */
    const simdi = bugun();
    const baslangic = simdi >= durum.proje.start && simdi <= durum.proje.end ? simdi : durum.proje.start;
    ayImleci = new Date(Date.UTC(Number(baslangic.slice(0, 4)), Number(baslangic.slice(5, 7)) - 1, 1));

    filtreleriKur();
    gostergeyiKur();
    gorunumleriKur();
    kutulariKur();
    ceviriyiUygula();

    $('ekle-dugme').hidden = !durum.kullanici;
    /* Program herkese açık, rapor değil: belgenin altbilgisinde kimin
       ürettiği yazdığı için giriş ister (bkz. routes/rapor.mjs). */
    $('rapor-dugme').hidden = !durum.kullanici;
    ciz();
    adresKancasi();
  } catch (err) {
    console.error(err);
    kap().replaceChildren(el('p', 'bos-durum', err.message));
  }
})();
