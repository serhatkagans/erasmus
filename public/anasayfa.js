import {
  durum, t, baslat, iste, ortakAdi, yerAdi, etkinlikBaslik,
  tarihAraligi, bugun, gunFarki,
} from './ortak.js';

/**
 * Ana sayfa: projenin tanıtımı ve programın özeti.
 *
 * Sayaçlar, ilerleme çubuğu, yaklaşan etkinlikler ve iş paketi kartları
 * canlı veriden üretilir — takvimde bir şey değişince ana sayfa da değişir.
 * Statik metinler `data-t` anahtarlarıyla ortak.js tarafından yerleştirilir.
 */

const $ = id => document.getElementById(id);

/** Bayrak emojisi ülke kodundan türetilir; ayrı görsel dosyası gerekmez. */
const bayrak = kod => kod.length === 2
  ? String.fromCodePoint(...[...kod.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
  : '🌐';

function sayaclariDoldur(etkinlikler) {
  const ulkeler = new Set(durum.ortaklar.map(o => o.country));
  $('sayac-sure').textContent = durum.proje.months;
  $('sayac-ortak').textContent = durum.ortaklar.length;
  $('sayac-ulke').textContent = ulkeler.size;
  $('sayac-etkinlik').textContent = etkinlikler.length;
}

function ilerlemeyiCiz() {
  const { start, end, months } = durum.proje;
  const simdi = bugun();
  const toplam = gunFarki(start, end);
  const gecen = Math.min(Math.max(gunFarki(start, simdi), 0), toplam);
  const oran = toplam > 0 ? gecen / toplam : 0;

  $('ilerleme-dolu').style.width = `${(oran * 100).toFixed(1)}%`;
  $('ilerleme-sure').textContent = `${tarihAraligi(start, end)}`;
  $('ilerleme-metin').textContent = simdi < start
    /* Proje başlamadan "0 ay geçti" demek yerine geri sayım gösterilir. */
    ? `${t('anasayfa.ilerleme.basladi')} ${gunFarki(simdi, start)} ${t('genel.gun')}`
    : t('anasayfa.ilerleme.gecen', { n: Math.floor(oran * months) });
}

/* Başvuruda taahhüt edilen faaliyetlerden kaçı tamamlandı. Yalnızca resmî
   kayıtlar sayılır: ortakların eklediği ek etkinlikler paydayı büyütüp
   oranı düşürür, taahhüdün ölçüsü de değildir. Çıktı teslimi burada
   YOKTUR — çıktı kütüphanesi (Faz 1) gelince ayrı bir ölçü olarak eklenir. */
function faaliyetleriCiz(etkinlikler) {
  const resmi = etkinlikler.filter(e => e.resmi);
  const biten = resmi.filter(e => e.durum === 'tamamlandi').length;
  const suren = resmi.filter(e => e.durum === 'devam').length;
  $('faaliyet-dolu').style.width = resmi.length ? `${(biten / resmi.length * 100).toFixed(1)}%` : '0%';
  $('faaliyet-metin').textContent = t('anasayfa.faaliyet.tamam', { n: biten, toplam: resmi.length });
  $('faaliyet-devam').textContent = suren ? t('anasayfa.faaliyet.devam', { n: suren }) : '';
}

/* Teslim edilen çıktılar: çıktı kütüphanesindeki durumdan. Ara ürün (masa
   başı araştırma) sayılmaz — kamuya açık teslimat değil. Kartlarda da her
   çıktının güncel durumu yazar. */
function ciktilariCiz(ciktilar) {
  const asil = ciktilar.filter(c => !c.araUrun);
  const teslim = asil.filter(c => c.durum === 'teslim').length;
  $('teslim-dolu').style.width = asil.length ? `${(teslim / asil.length * 100).toFixed(1)}%` : '0%';
  $('teslim-metin').textContent = t('anasayfa.teslim.metin', { n: teslim, toplam: asil.length });
  for (const c of ciktilar) {
    const yer = document.querySelector(`[data-cikti="${c.slug}"]`);
    if (yer) { yer.textContent = t(`cikti.durum.${c.durum}`); yer.dataset.durum = c.durum; }
  }
}

function yaklasanlariCiz(etkinlikler) {
  const kutu = $('yaklasan');
  const simdi = bugun();
  /* Süren ve gelecek etkinlikler; biteni gösterilmez. En fazla beş satır —
     ana sayfa özet, tam liste takvimde. */
  const liste = etkinlikler
    .filter(e => e.bitis >= simdi && e.durum !== 'ertelendi')
    .sort((a, b) => a.baslangic.localeCompare(b.baslangic))
    .slice(0, 5);

  kutu.replaceChildren();
  if (!liste.length) {
    const bos = document.createElement('p');
    bos.className = 'bos-durum';
    bos.textContent = t('anasayfa.yaklasan.bos');
    kutu.append(bos);
    return;
  }

  for (const e of liste) {
    const bas = new Date(e.baslangic + 'T00:00:00Z');
    const kalanGun = gunFarki(simdi, e.baslangic);

    const satir = document.createElement('a');
    satir.className = 'yaklasan';
    satir.dataset.wp = e.wp;
    satir.href = `takvim.html#etkinlik-${e.id}`;

    const tarih = document.createElement('div');
    tarih.className = 'yaklasan-tarih';
    const gun = document.createElement('strong');
    gun.textContent = bas.getUTCDate();
    const ay = document.createElement('span');
    ay.textContent = new Intl.DateTimeFormat(durum.dil, { timeZone: 'UTC', month: 'short' }).format(bas);
    tarih.append(gun, ay);

    const orta = document.createElement('div');
    const ad = document.createElement('div');
    ad.className = 'yaklasan-ad';
    ad.textContent = etkinlikBaslik(e);
    const alt = document.createElement('div');
    alt.className = 'yaklasan-alt';
    for (const parca of [t(`tur.${e.tur}`), yerAdi(e.yer), ortakAdi(e.lider)]) {
      const span = document.createElement('span');
      span.textContent = parca;
      alt.append(span);
    }
    orta.append(ad, alt);

    const kalan = document.createElement('span');
    kalan.className = 'yaklasan-kalan';
    kalan.textContent = kalanGun < 0 ? t('anasayfa.yaklasan.suruyor')
      : kalanGun === 0 ? t('anasayfa.yaklasan.bugun')
      : t('anasayfa.yaklasan.kalan', { n: kalanGun });

    satir.append(tarih, orta, kalan);
    kutu.append(satir);
  }
}

function ispaketleriniCiz(etkinlikler) {
  const kutu = $('ispaketleri-izgara');
  kutu.replaceChildren();
  for (const wp of durum.ispaketleri) {
    const sayi = etkinlikler.filter(e => e.wp === wp).length;
    const kart = document.createElement('article');
    kart.className = 'kart wp-kart';
    kart.dataset.wp = wp;

    const ust = document.createElement('span');
    ust.className = 'ustbaslik';
    ust.textContent = t(`wp.${wp}.ad`);
    const baslik = document.createElement('h3');
    baslik.textContent = t(`wp.${wp}.baslik`);
    const ozet = document.createElement('p');
    ozet.textContent = t(`wp.${wp}.ozet`);
    kart.append(ust, baslik, ozet);

    /* WP1 yönetim paketidir; takvimde ayrı aktivitesi yok, sayı yazılmaz. */
    if (sayi) {
      const adet = document.createElement('p');
      adet.className = 'wp-sayi';
      adet.style.marginTop = '12px';
      adet.textContent = `${sayi} ${t('anasayfa.ispaketleri.aktivite')}`;
      kart.append(adet);
    }
    kutu.append(kart);
  }
}

function ortaklariCiz(etkinlikler) {
  const kutu = $('ortaklar-izgara');
  kutu.replaceChildren();
  for (const o of durum.ortaklar) {
    const liderlik = etkinlikler.filter(e => e.lider === o.id).length;

    const kart = document.createElement('article');
    kart.className = 'kart ortak-kart';

    const ust = document.createElement('div');
    ust.className = 'ortak-ust';
    const bayrakEl = document.createElement('span');
    bayrakEl.className = 'bayrak';
    bayrakEl.textContent = bayrak(o.country);
    bayrakEl.setAttribute('aria-hidden', 'true');
    const rozet = document.createElement('span');
    rozet.className = `rozet ${o.coordinator ? 'rozet-koordinator' : 'rozet-ortak'}`;
    rozet.textContent = t(o.coordinator ? 'anasayfa.ortaklar.koordinator' : 'anasayfa.ortaklar.ortak');
    ust.append(bayrakEl, rozet);

    const ad = document.createElement('h3');
    ad.textContent = o.name;
    const yer = document.createElement('div');
    yer.className = 'ortak-yer';
    yer.textContent = `${o.city} · ${yerAdi(o.country)}`;

    const alt = document.createElement('div');
    alt.className = 'ortak-alt';
    const rol = document.createElement('span');
    rol.textContent = liderlik ? t('anasayfa.ortaklar.lider', { n: liderlik }) : '';
    alt.append(rol);
    if (o.web) {
      const bag = document.createElement('a');
      bag.className = 'metin-bag';
      bag.href = o.web;
      bag.target = '_blank';
      bag.rel = 'noopener noreferrer';
      bag.textContent = t('genel.web');
      alt.append(bag);
    }

    kart.append(ust, ad, yer, alt);
    kutu.append(kart);
  }
}

(async () => {
  try {
    await baslat();
    const { etkinlikler } = await iste('api/etkinlikler');
    sayaclariDoldur(etkinlikler);
    ilerlemeyiCiz();
    faaliyetleriCiz(etkinlikler);
    iste('api/ciktilar').then(v => ciktilariCiz(v.ciktilar)).catch(err => console.error(err));
    yaklasanlariCiz(etkinlikler);
    ispaketleriniCiz(etkinlikler);
    ortaklariCiz(etkinlikler);
  } catch (err) {
    console.error(err);
  }
})();
