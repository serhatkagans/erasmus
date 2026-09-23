import { baslat, iste, t, durum, ortakAdi, ortakKisa, etkinlikBaslik, tamTarih, tarihAraligi, bugun, gunFarki } from './ortak.js';

/**
 * Panom: girişten sonra açılan kişisel çalışma ekranı (GET /api/pano).
 * Kurumun yaklaşan işleri, geciken görevler, yanıt bekleyen formlar, eksik
 * faaliyet dosyaları, sorumlu olunan çıktılar ve son eklenen dosyalar.
 * Koordinatör üstte kurumlar arası genel durumu da görür.
 */
const $ = id => document.getElementById(id);
const el = (etiket, sinif, metin) => {
  const d = document.createElement(etiket);
  if (sinif) d.className = sinif;
  if (metin != null) d.textContent = metin;
  return d;
};

/** Bir pano kutusu: başlık, sayı, satırlar; boşsa olumlu bir cümle. */
function kutu(baslikAnahtari, satirlar, { bos, tumu, tumuMetin, vurgu = false } = {}) {
  const k = el('section', `pano-kutu${vurgu && satirlar.length ? ' pano-kutu-vurgu' : ''}`);
  const bas = el('div', 'pano-kutu-bas');
  bas.append(el('h2', null, t(baslikAnahtari)), el('span', 'pano-sayi', String(satirlar.length)));
  k.append(bas);
  if (!satirlar.length) k.append(el('p', 'pano-bos', t(bos)));
  else {
    const ul = el('ul', 'pano-liste');
    ul.append(...satirlar);
    k.append(ul);
  }
  if (tumu) {
    const a = el('a', 'metin-bag pano-tumu', `${t(tumuMetin)} →`);
    a.href = tumu;
    k.append(a);
  }
  return k;
}

function satir(href, baslik, alt, rozet, rozetSinif = '') {
  const li = el('li');
  const a = el('a', 'pano-satir');
  a.href = href;
  const govde = el('span', 'pano-satir-govde');
  govde.append(el('strong', null, baslik));
  if (alt) govde.append(el('span', 'pano-satir-alt', alt));
  a.append(govde);
  if (rozet) a.append(el('span', `pano-rozet ${rozetSinif}`, rozet));
  li.append(a);
  return li;
}

const kalanMetni = gun => {
  const n = gunFarki(bugun(), gun);
  return n < 0 ? t('pano.gecikti', { n: -n }) : n === 0 ? t('pano.bugun') : t('pano.kalan', { n });
};

function genelCiz(genel) {
  const k = $('pano-genel');
  k.hidden = false;
  const bas = el('div', 'pano-kutu-bas');
  bas.append(el('h2', null, t('pano.genel')));
  k.append(bas, el('p', 'pano-bos', t('pano.genelNot')));
  const sar = el('div', 'tablo-kaydir');
  const tablo = el('table', 'pano-tablo');
  const thead = el('thead');
  const tr = el('tr');
  for (const a of ['pano.g.kurum', 'pano.g.acikGorev', 'pano.g.geciken', 'pano.g.bekleyenYanit', 'pano.g.durum', 'pano.g.eksikFaaliyet', 'pano.g.cikti']) {
    const th = el('th', null, t(a));
    th.scope = 'col';
    tr.append(th);
  }
  thead.append(tr);
  const tbody = el('tbody');
  for (const g of genel) {
    const r = el('tr');
    const kurum = el('th', null, ortakKisa(g.partner));
    kurum.scope = 'row';
    kurum.title = ortakAdi(g.partner);
    r.append(kurum);
    const hucre = (n, uyari) => { const td = el('td', uyari && n ? 'pano-uyari' : '', String(n)); r.append(td); };
    hucre(g.acikGorev);
    hucre(g.gecikenGorev, true);
    hucre(g.bekleyenYanit, true);
    hucre(g.durumBekleyen, true);
    hucre(g.eksikFaaliyet, true);
    r.append(el('td', null, g.ciktiToplam ? `${g.ciktiTeslim}/${g.ciktiToplam}` : '—'));
    tbody.append(r);
  }
  tablo.append(thead, tbody);
  sar.append(tablo);
  k.append(sar);
}

(async () => {
  await baslat();
  const k = durum.kullanici;
  $('pano-ust').textContent = `${ortakAdi(k.partner)}${k.koordinator ? ` · ${t('kullanicilar.yetki.tam')}` : ''}`;
  $('pano-merhaba').textContent = t('pano.merhaba', { ad: (k.ad || k.kullanici).split(/\s+/)[0] });

  const p = await iste('api/pano');
  if (p.genel) genelCiz(p.genel);

  const izgara = $('pano-izgara');

  const gecikenler = p.geciken.map(g => satir('ekip.html', g.baslik,
    `${p.genel ? ortakKisa(g.partner) + ' · ' : ''}${tamTarih(g.son_tarih)}`, kalanMetni(g.son_tarih), 'pano-rozet-kirmizi'));
  izgara.append(kutu('pano.geciken', gecikenler, { bos: 'pano.geciken.bos', tumu: 'ekip.html', tumuMetin: 'pano.tumGorevler', vurgu: true }));

  const formlar = p.bekleyenForm.map(f => satir(`formlar.html#form-${f.id}`, f.baslik,
    f.sonTarih ? tamTarih(f.sonTarih) : t('pano.sonTarihYok'), f.sonTarih ? kalanMetni(f.sonTarih) : '', 'pano-rozet-amber'));
  izgara.append(kutu('pano.formlar', formlar, { bos: 'pano.formlar.bos', tumu: 'formlar.html', tumuMetin: 'pano.tumFormlar', vurgu: true }));

  const yaklasan = [
    ...p.yaklasan.map(e => ({ gun: e.baslangic, li: satir(`takvim.html#etkinlik-${e.id}`, etkinlikBaslik(e),
      `${tarihAraligi(e.baslangic, e.bitis)} · ${t(e.rol === 'lider' ? 'pano.rol.lider' : 'pano.rol.katilimci')}`,
      e.baslangic <= bugun() ? t('pano.suruyor') : kalanMetni(e.baslangic)) })),
    ...p.yaklasanGorev.map(g => ({ gun: g.son_tarih, li: satir('ekip.html', g.baslik,
      `${t('pano.gorev')} · %${g.ilerleme}`, kalanMetni(g.son_tarih)) })),
  ].sort((a, b) => a.gun.localeCompare(b.gun)).map(x => x.li);
  izgara.append(kutu('pano.yaklasan', yaklasan, { bos: 'pano.yaklasan.bos', tumu: 'takvim.html', tumuMetin: 'pano.takvim' }));

  /* En üstte: ilerleme çubukları elle ilerlediği için unutulanlar. */
  const durumlar = p.durumGuncelle.map(x => (x.tur === 'etkinlik'
    ? satir(`takvim.html#etkinlik-${x.id}`, etkinlikBaslik(x),
      `${t('pano.durum.bitti', { tarih: tamTarih(x.bitis) })}${p.genel ? ' · ' + ortakKisa(x.lider) : ''}`,
      t(`durum.${x.durum}`), 'pano-rozet-amber')
    : satir(`ciktilar.html#${x.slug}`, t(`${x.anahtar}.baslik`),
      `${t('pano.durum.teslim', { tarih: tamTarih(x.teslim) })}${p.genel && x.sorumlu ? ' · ' + ortakKisa(x.sorumlu) : ''}`,
      t(`cikti.durum.${x.durum}`), 'pano-rozet-amber')));
  izgara.prepend(kutu('pano.durum', durumlar, { bos: 'pano.durum.bos', vurgu: true }));

  const eksik = p.eksikDosya.map(e => satir(`takvim.html#etkinlik-${e.id}`, etkinlikBaslik(e),
    e.dosya.eksik.map(x => t(`faaliyet.parca.${x}`)).join(', '),
    t('faaliyet.rozet', { n: e.dosya.tamam, toplam: e.dosya.toplam }), 'pano-rozet-amber'));
  izgara.append(kutu('pano.eksikDosya', eksik, { bos: 'pano.eksikDosya.bos', vurgu: true }));

  const ciktilar = p.ciktilar.map(c => satir(`ciktilar.html#${c.slug}`, t(`${c.anahtar}.baslik`),
    c.teslim ? tamTarih(c.teslim) : t('cikti.teslimYok'), t(`cikti.durum.${c.durum}`)));
  izgara.append(kutu('pano.ciktilar', ciktilar, { bos: 'pano.ciktilar.bos', tumu: 'ciktilar.html', tumuMetin: 'pano.tumCiktilar' }));

  const dosyalar = p.dosyalar.map(d => satir(`klasorler.html#${d.klasor}`, d.ad,
    `${d.klasor} · ${tamTarih(d.updated.slice(0, 10))}${d.yukleyen ? ' · ' + d.yukleyen : ''}`));
  izgara.append(kutu('pano.dosyalar', dosyalar, { bos: 'pano.dosyalar.bos', tumu: 'klasorler.html', tumuMetin: 'pano.klasorler' }));
})();
