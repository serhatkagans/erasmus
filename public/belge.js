import { durum, t, baslat, iste, ceviriyiUygula, ortakAdi, ortakKisa, yerAdi, etkinlikBaslik, tarihAraligi } from './ortak.js';

/**
 * Katılım ve teşekkür belgeleri.
 *
 * ALICI LİSTEDEN SEÇİLİR: ülkeler ve kişiler zaten kayıtlı (ortak kurumlar +
 * ekip tablosu). Ad elle yazıldığında yazım hataları belgeye geçer ve aynı
 * kişi iki farklı adla belgelenir. Listede olmayan konuşmacı/destekçi için
 * serbest ad alanı ayrıca duruyor.
 *
 * ETKİNLİK SEÇİMİ İSTEĞE BAĞLIDIR. GençTek'te belge yalnızca bir etkinliğin
 * içinden, rapor yazıldıktan ve yoklama alındıktan sonra üretilebiliyordu;
 * burada koordinatör istediği zaman, projenin geneline de belge üretebilir.
 *
 * Belge METNİ SUNUCUDA kurulur (bkz. routes/belge.mjs): ad veritabanından
 * çözülür ve kalıp cümleler isteğin dilinde gelir. Bu sayfa yalnızca seçimi
 * toplar, gelen belgeleri kâğıda dizer ve yazdırır.
 */

const $ = id => document.getElementById(id);

const el = (etiket, sinif, metin) => {
  const d = document.createElement(etiket);
  if (sinif) d.className = sinif;
  if (metin != null) d.textContent = metin;
  return d;
};

let uyeler = [];
let etkinlikler = [];
let kunye = null;

/** Koordinatör tüm kurumları görür; ortak yalnızca kendi kurumunu. */
const gorunurOrtaklar = () => (durum.kullanici.koordinator
  ? durum.ortaklar
  : durum.ortaklar.filter(o => o.id === durum.kullanici.partner));

function secenekDoldur(secim, degerler, etiketle, secili = '') {
  secim.replaceChildren();
  for (const deger of degerler) {
    const secenek = document.createElement('option');
    secenek.value = deger;
    secenek.textContent = etiketle(deger);
    secim.append(secenek);
  }
  secim.value = secili;
}

/* --- Alıcı listesi -------------------------------------------------------- */
function alicilariCiz() {
  const kutu = $('belge-alicilar');
  kutu.replaceChildren();

  for (const ortak of gorunurOrtaklar()) {
    const kart = el('div', 'belge-kurum');
    const bas = el('div', 'belge-kurum-bas');
    bas.append(el('strong', null, ortak.name), el('small', null, `${ortakKisa(ortak.id)} · ${yerAdi(ortak.country)}`));

    /* Kurumun kendisi de bir alıcıdır: teşekkür belgesi çoğu zaman kişiye
       değil kuruma yazılır. */
    const kurumEtiket = el('label', 'onay belge-kurum-onay');
    const kurumOnay = el('input');
    kurumOnay.type = 'checkbox';
    kurumOnay.value = `kurum:${ortak.id}`;
    kurumEtiket.append(kurumOnay, el('span', null, t('belge.kuruma')));

    const tumu = el('button', 'metin-bag', t('belge.tumunu'));
    tumu.type = 'button';
    bas.append(tumu);
    kart.append(bas);

    const kisiler = el('div', 'belge-kisiler');
    const kadro = uyeler.filter(u => u.partner === ortak.id && u.aktif);
    for (const uye of kadro) {
      const etiket = el('label', 'onay');
      const onay = el('input');
      onay.type = 'checkbox';
      onay.value = `uye:${uye.id}`;
      onay.dataset.kisi = '1';
      const ad = el('span', null, uye.ad);
      if (uye.rol) ad.append(el('small', null, ` · ${uye.rol}`));
      etiket.append(onay, ad);
      kisiler.append(etiket);
    }
    /* Ekibi boş kurum sessizce geçilmez: belge kişi kişi üretildiği için
       burada kimse görünmüyorsa yapılacak iş ekip sayfasındadır. */
    if (!kadro.length) {
      const yok = el('p', 'belge-kisi-yok');
      const bag = el('a', 'metin-bag', t('belge.kisi.ekle'));
      bag.href = 'ekip.html';
      yok.append(document.createTextNode(t('belge.kisi.yok') + ' '), bag);
      kisiler.append(yok);
    }
    kart.append(kisiler, kurumEtiket);

    /* "Tümünü seç" kurumun kendisini de kapsar: kutuların hepsi tek
       düğmeyle dolup boşalmazsa, düğme yarım iş yapmış olur. */
    tumu.addEventListener('click', () => {
      const kutular = [...kart.querySelectorAll('input[type=checkbox]')];
      const hepsiSecili = kutular.every(k => k.checked);
      for (const k of kutular) k.checked = !hepsiSecili;
      sayiyiYenile();
    });

    kutu.append(kart);
  }

  kutu.addEventListener('change', sayiyiYenile);

  /* Kayıtlı herkes tek düğmeyle: kurum kurum dolaşmak, yedi ortaklı bir
     projede aynı işi yedi kez yaptırırdı. Kurum kutuları dışarıda kalır —
     bu düğme KİŞİ belgeleri içindir. */
  const kisiKutulari = () => [...kutu.querySelectorAll('input[data-kisi]')];
  $('belge-herkes').addEventListener('click', () => {
    const kutular = kisiKutulari();
    const hepsiSecili = kutular.length > 0 && kutular.every(k => k.checked);
    for (const k of kutular) k.checked = !hepsiSecili;
    sayiyiYenile();
  });
  $('belge-herkes').disabled = !kisiKutulari().length;
  $('belge-kisi-toplam').textContent = t('belge.kisi.toplam', { n: kisiKutulari().length });

  sayiyiYenile();
}

const secililer = () => [...$('belge-alicilar').querySelectorAll('input:checked')].map(k => k.value);

function sayiyiYenile() {
  const serbest = $('belge-serbest').value.split('\n').filter(satir => satir.trim()).length;
  $('belge-secim-sayisi').textContent = t('belge.secim.sayi', { n: secililer().length + serbest });
}

/* --- Belgeleri hazırla ---------------------------------------------------- */
function belgeCiz(belge, imza) {
  const kagit = el('article', 'belge');

  const ust = el('header', 'belge-ust');
  const marka = el('div', 'belge-marka');
  const logo = el('img');
  logo.src = 'logo.png';
  logo.alt = '';
  const markaMetin = el('div');
  markaMetin.append(el('strong', null, kunye.proje), el('span', null, kunye.program));
  marka.append(logo, markaMetin);

  const ab = el('div', 'belge-ab');
  const amblem = el('img');
  amblem.src = 'ab-amblem.svg';
  amblem.alt = t('ab.amblem');
  ab.append(amblem, el('span', null, kunye.finanse));
  ust.append(marka, ab);

  const govde = el('div', 'belge-govde');
  govde.append(el('p', 'belge-baslik', belge.baslik), el('p', 'belge-ad', belge.ad));
  if (belge.altAd) govde.append(el('p', 'belge-altad', belge.altAd));
  govde.append(el('p', 'belge-metin', belge.govde));

  const alt = el('footer', 'belge-alt');
  alt.append(el('div', 'belge-kunye', `${t('altbilgi.projeno')}`));
  const imzaKutu = el('div', 'belge-imza');
  imzaKutu.append(el('div', 'belge-imza-cizgi', imza.adSoyad), el('div', 'belge-birim', imza.unvan));
  alt.append(imzaKutu);

  kagit.append(ust, govde, alt, el('p', 'belge-feragat', kunye.feragat));
  return kagit;
}

async function hazirla(olay) {
  olay.preventDefault();
  const form = olay.target;
  const dugme = form.querySelector('button[type="submit"]');
  const hata = $('belge-hata');
  hata.textContent = '';

  const parametreler = new URLSearchParams({ tur: form.tur.value });
  if (form.etkinlik.value) parametreler.set('etkinlik', form.etkinlik.value);
  const secim = secililer();
  if (secim.length) parametreler.set('alicilar', secim.join(','));
  if (form.ad.value.trim()) parametreler.set('ad', form.ad.value);
  if (form.imzaAd.value.trim()) parametreler.set('imzaAd', form.imzaAd.value);
  if (form.imzaUnvan.value.trim()) parametreler.set('imzaUnvan', form.imzaUnvan.value);
  if (form.metin.value.trim()) parametreler.set('metin', form.metin.value);

  dugme.disabled = true;
  try {
    const veri = await iste('api/belge?' + parametreler);
    kunye = veri.kunye;
    const liste = $('belge-listesi');
    liste.replaceChildren(...veri.belgeler.map(belge => belgeCiz(belge, veri.imza)));
    $('belge-sayi').textContent = t('belge.hazir', { n: veri.belgeler.length });
    $('belge-cikti').hidden = false;
    $('belge-cikti').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    hata.textContent = err.message;
  } finally {
    dugme.disabled = false;
  }
}

/* --- Kurulum -------------------------------------------------------------- */
(async () => {
  try {
    await baslat();

    if (!durum.kullanici) {
      $('giris-uyarisi').hidden = false;
      ceviriyiUygula();
      return;
    }

    ({ uyeler } = await iste('api/ekip'));
    ({ etkinlikler } = await iste('api/etkinlikler'));

    const form = $('belge-form');
    form.hidden = false;

    secenekDoldur($('belge-tur'), ['katilim', 'tesekkur'], tur => t(`belge.tur.${tur}`), 'katilim');

    /* Etkinlik seçimi isteğe bağlı: ilk seçenek projenin kendisidir. */
    const secim = $('belge-etkinlik');
    secim.replaceChildren();
    const proje = document.createElement('option');
    proje.value = '';
    proje.textContent = t('belge.etkinlik.proje');
    secim.append(proje);
    for (const e of [...etkinlikler].sort((a, b) => a.baslangic.localeCompare(b.baslangic))) {
      const secenek = document.createElement('option');
      secenek.value = String(e.id);
      secenek.textContent = `${etkinlikBaslik(e)} · ${tarihAraligi(e.baslangic, e.bitis)}`;
      secim.append(secenek);
    }

    /* Unvan boş bırakılabilir: sunucu aynı öneriyi kullanır, kutudaki yer
       tutucu da onu gösterir ki kullanıcı ne yazılacağını bilsin. */
    $('belge-imza-unvan').placeholder = durum.kullanici.koordinator
      ? t('belge.imza.unvan.koordinator', { kurum: ortakAdi(durum.kullanici.partner) })
      : t('belge.imza.unvan.ortak', { kurum: ortakAdi(durum.kullanici.partner) });
    form.imzaAd.value = durum.kullanici.ad || '';

    alicilariCiz();
    ceviriyiUygula();

    form.addEventListener('submit', hazirla);
    $('belge-serbest').addEventListener('input', sayiyiYenile);
    $('belge-temizle').addEventListener('click', () => {
      form.reset();
      $('belge-cikti').hidden = true;
      $('belge-hata').textContent = '';
      for (const kutucuk of $('belge-alicilar').querySelectorAll('input:checked')) kutucuk.checked = false;
      sayiyiYenile();
    });
    $('belge-yazdir').addEventListener('click', () => window.print());
    $('belge-kapat').addEventListener('click', () => { $('belge-cikti').hidden = true; });
  } catch (err) {
    console.error(err);
    $('belge-hata').textContent = err.message;
  }
})();
