import { baslat, iste, t, durum, ortakAdi, ortakKisa, tamTarih, bugun, gunFarki, onayla, bildir } from './ortak.js';

/**
 * Çıktı kütüphanesi (iç): kartlar ve `#<slug>` ile açılan ayrıntı.
 *
 * Kamuya açık sürüm platformda değil, dış adreste yayımlanır (bkz.
 * lib/cikti.mjs). Burada hazırlık durumu, sorumlu, teslim tarihi ve dil dil
 * son sürüm durur. Sorumlu ve tarih takvimdeki çıktı üretim döneminden
 * geliyorsa burada değiştirilmez; takvimde değişir.
 */
const $ = id => document.getElementById(id);
const el = (etiket, sinif, metin) => {
  const d = document.createElement(etiket);
  if (sinif) d.className = sinif;
  if (metin != null) d.textContent = metin;
  return d;
};

let veri = { ciktilar: [], durumlar: [], diller: [] };
const baslik = c => t(`${c.anahtar}.baslik`);
const dilAdi = kod => t(`dil.${kod}`);
const boyutYaz = b => new Intl.NumberFormat(durum.dil, { style: 'unit', unit: b >= 1048576 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1 })
  .format(b >= 1048576 ? b / 1048576 : Math.max(b / 1024, 0.1));

/** Teslim tarihi ve kalan/geçen gün. Teslim edilmişse gecikme söylenmez. */
function teslimMetni(c) {
  if (!c.teslim) return t('cikti.teslimYok');
  const kalan = gunFarki(bugun(), c.teslim);
  const tarih = tamTarih(c.teslim);
  if (c.durum === 'teslim') return tarih;
  if (kalan < 0) return `${tarih} · ${t('cikti.gecikti', { n: -kalan })}`;
  return `${tarih} · ${t('cikti.kalan', { n: kalan })}`;
}
const gecikti = c => c.teslim && c.durum !== 'teslim' && gunFarki(bugun(), c.teslim) < 0;

function durumEtiketi(c) {
  const s = el('span', `cikti-durum cikti-durum-${c.durum}`, t(`cikti.durum.${c.durum}`));
  return s;
}

/* --- Kartlar ---------------------------------------------------------------- */
function listeCiz() {
  const kutu = $('cikti-liste');
  kutu.replaceChildren(...veri.ciktilar.map(c => {
    const kart = el('a', `cikti-kart${gecikti(c) ? ' cikti-kart-gecikti' : ''}`);
    kart.href = `#${c.slug}`;
    const ust = el('div', 'cikti-kart-ust');
    ust.append(el('span', 'cikti-kod', c.kod || t('cikti.kodYok')), durumEtiketi(c));
    kart.append(ust, el('h3', null, baslik(c)));
    if (c.araUrun) kart.append(el('span', 'cikti-ara', t('cikti.araUrun')));
    const dl = el('dl', 'cikti-bilgi');
    for (const [a, d] of [
      [t('cikti.sorumlu'), c.sorumlu ? ortakKisa(c.sorumlu) : t('cikti.sorumluYok')],
      [t('cikti.teslim'), teslimMetni(c)],
      [t('cikti.dosyalar'), c.diller.length ? c.diller.map(d => d.dil.toUpperCase()).join(' · ') : t('cikti.dosyaYok')],
    ]) {
      const s = el('div');
      s.append(el('dt', null, a), el('dd', null, d));
      dl.append(s);
    }
    kart.append(dl);
    return kart;
  }));
}

/* --- Ayrıntı ------------------------------------------------------------------- */
function ayrintiCiz(c) {
  const kutu = $('cikti-ayrinti');
  kutu.replaceChildren();

  const geri = el('a', 'metin-bag cikti-geri', `← ${t('cikti.tumu')}`);
  geri.href = '#';
  const ust = el('div', 'cikti-ayrinti-ust');
  ust.append(el('span', 'cikti-kod', c.kod || t('cikti.kodYok')), durumEtiketi(c));
  if (c.araUrun) ust.append(el('span', 'cikti-ara', t('cikti.araUrun')));
  kutu.append(geri, ust, el('h2', null, baslik(c)), el('p', 'cikti-metin', t(`${c.anahtar}.metin`)));
  if (c.araUrun) kutu.append(el('p', 'cikti-not', t('cikti.araUrunNot')));

  const dl = el('dl', 'kutu-satirlar');
  const satir = (a, d) => {
    const s = el('div', 'kutu-satir');
    const dd = el('dd');
    if (d instanceof Node) dd.append(d); else dd.textContent = d;
    s.append(el('dt', null, a), dd);
    dl.append(s);
  };
  satir(t('cikti.sorumlu'), c.sorumlu ? ortakAdi(c.sorumlu) : t('cikti.sorumluYok'));
  satir(t('cikti.teslim'), teslimMetni(c));
  if (c.etkinlikId) {
    const bag = el('a', 'metin-bag', t('cikti.takvimdeGor'));
    bag.href = `takvim.html#etkinlik-${c.etkinlikId}`;
    satir(t('cikti.uretim'), bag);
  }
  if (c.disUrl) {
    const bag = el('a', 'metin-bag', c.disUrl);
    bag.href = c.disUrl;
    bag.target = '_blank';
    bag.rel = 'noopener noreferrer';
    satir(t('cikti.disUrl'), bag);
  } else {
    satir(t('cikti.disUrl'), t('cikti.disUrlYok'));
  }
  const klasor = el('a', 'metin-bag', c.klasor);
  klasor.href = `klasorler.html#${c.klasor}`;
  satir(t('cikti.klasor'), klasor);
  if (c.not) satir(t('cikti.not'), c.not);
  kutu.append(dl);

  if (c.yetkili) {
    const duzenle = el('button', 'dugme dugme-ikincil', t('genel.duzenle'));
    duzenle.type = 'button';
    duzenle.addEventListener('click', () => formAc(c));
    kutu.append(duzenle);
  }

  /* Dil dil son sürüm. */
  const dosyaBolum = el('section', 'cikti-dosyalar');
  dosyaBolum.append(el('h3', null, t('cikti.dosyalar')));
  if (!c.diller.length) dosyaBolum.append(el('p', 'cikti-not', t('cikti.dosyaYokUzun')));
  for (const d of c.diller) {
    const [son, ...eski] = d.surumler;
    const blok = el('div', 'cikti-dil');
    const bas = el('div', 'cikti-dil-bas');
    bas.append(el('strong', null, dilAdi(d.dil)), el('span', 'etiket', t('klasor.surum', { no: son.no })));
    const indir = el('a', 'dugme dugme-ikincil dugme-kucuk', t('cikti.indir'));
    indir.href = `api/ciktilar/dosya/${son.id}`;
    indir.setAttribute('download', '');
    bas.append(indir);
    blok.append(bas, el('p', 'cikti-dosya-meta', `${son.ad} · ${boyutYaz(son.boyut)} · ${tamTarih(son.created.slice(0, 10))}${son.yukleyen ? ' · ' + son.yukleyen : ''}`));
    if (eski.length) {
      const ac = el('details', 'cikti-eski');
      ac.append(el('summary', null, t('cikti.eskiSurumler', { n: eski.length })));
      const ul = el('ul');
      for (const s of eski) {
        const li = el('li');
        const a = el('a', 'metin-bag', `${t('klasor.surum', { no: s.no })} · ${s.ad}`);
        a.href = `api/ciktilar/dosya/${s.id}`;
        a.setAttribute('download', '');
        li.append(a, el('span', 'cikti-dosya-meta', ` · ${tamTarih(s.created.slice(0, 10))}`));
        if (c.yetkili) {
          const sil = el('button', 'fd-sil', '×');
          sil.type = 'button';
          sil.setAttribute('aria-label', `${t('genel.sil')}: ${s.ad}`);
          sil.addEventListener('click', () => surumSil(s));
          li.append(sil);
        }
        ul.append(li);
      }
      ac.append(ul);
      blok.append(ac);
    }
    dosyaBolum.append(blok);
  }

  if (c.yetkili) {
    const yukle = el('div', 'cikti-yukle');
    const dil = el('select');
    dil.setAttribute('aria-label', t('cikti.dil'));
    for (const kod of veri.diller) dil.append(new Option(dilAdi(kod), kod));
    dil.value = durum.dil === 'tr' ? 'en' : durum.dil;
    const etiket = el('label', 'dugme dugme-birincil', t('cikti.surumYukle'));
    const girdi = el('input', 'gorsel-gizli');
    girdi.type = 'file';
    etiket.append(girdi);
    girdi.addEventListener('change', async () => {
      const f = girdi.files[0];
      girdi.value = '';
      if (!f) return;
      const yanit = await fetch(`api/ciktilar/${c.slug}/dosya?dil=${dil.value}`, {
        method: 'POST', body: f, headers: { 'X-File-Name': encodeURIComponent(f.name) },
      });
      const g = await yanit.json().catch(() => ({}));
      if (!yanit.ok) { bildir(durum.sozluk[g.error] || g.error || t('genel.hata'), 'hata'); return; }
      bildir(t('cikti.yuklendi', { dil: dilAdi(dil.value), no: g.no }));
      await yenile();
    });
    yukle.append(el('span', 'cikti-yukle-etiket', t('cikti.dil')), dil, etiket);
    dosyaBolum.append(yukle, el('p', 'cikti-not', t('cikti.yukleNot')));
  }
  kutu.append(dosyaBolum);
}

async function surumSil(s) {
  if (!(await onayla(t('klasor.silOnay', { ad: s.ad }), { evet: t('genel.sil'), tehlike: true }))) return;
  try {
    await iste(`api/ciktilar/dosya/${s.id}`, { method: 'DELETE' });
    bildir(t('genel.silindi'));
    await yenile();
  } catch (err) { bildir(err.message, 'hata'); }
}

/* --- Düzenleme kutusu ------------------------------------------------------------- */
let duzenlenen = null;
function formAc(c) {
  duzenlenen = c;
  const form = $('cikti-form');
  form.reset();
  $('cikti-hata').textContent = '';
  $('cikti-form-baslik').textContent = baslik(c);
  form.durum.value = c.durum;
  form.disUrl.value = c.disUrl || '';
  form.not.value = c.not || '';
  /* Sorumlu ve tarih: takvimden geliyorsa gizli; değilse yalnızca koordinatör. */
  const serbest = !c.etkinlikId && durum.kullanici.koordinator;
  $('cikti-sorumlu-alan').hidden = !serbest;
  $('cikti-teslim-alan').hidden = !serbest;
  $('cikti-takvim-not').hidden = !c.etkinlikId;
  form.sorumlu.value = c.sorumlu || '';
  form.teslim.value = c.teslim || '';
  $('cikti-kutu').showModal();
}

function formuKur() {
  const form = $('cikti-form');
  form.durum.replaceChildren(...veri.durumlar.map(d => new Option(t(`cikti.durum.${d}`), d)));
  form.sorumlu.replaceChildren(new Option(t('cikti.sorumluYok'), ''), ...durum.ortaklar.map(o => new Option(`${o.short} — ${o.name}`, o.id)));
  form.teslim.min = durum.proje.start;
  form.teslim.max = durum.proje.end;
  for (const k of $('cikti-kutu').querySelectorAll('[data-kapat]')) k.addEventListener('click', () => $('cikti-kutu').close());
  form.addEventListener('submit', async olay => {
    olay.preventDefault();
    $('cikti-hata').textContent = '';
    try {
      await iste(`api/ciktilar/${duzenlenen.slug}`, {
        method: 'PUT',
        body: JSON.stringify({
          durum: form.durum.value, disUrl: form.disUrl.value.trim(), not: form.not.value,
          sorumlu: form.sorumlu.value, teslim: form.teslim.value,
        }),
      });
      $('cikti-kutu').close();
      bildir(t('genel.kaydedildi'));
      await yenile();
    } catch (err) { $('cikti-hata').textContent = err.message; }
  });
}

/* --- Yönlendirme ------------------------------------------------------------------ */
function goster() {
  const slug = decodeURIComponent(location.hash.slice(1));
  const c = veri.ciktilar.find(x => x.slug === slug);
  $('cikti-liste').hidden = !!c;
  $('cikti-ayrinti').hidden = !c;
  if (c) { ayrintiCiz(c); scrollTo({ top: 0 }); } else listeCiz();
}

async function yenile() {
  veri = await iste('api/ciktilar');
  goster();
}

(async () => {
  await baslat();
  await yenile();
  formuKur();
  addEventListener('hashchange', goster);
})();
