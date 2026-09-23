import {
  durum, t, baslat, iste, ceviriyiUygula, ortakAdi, ortakKisa, yerAdi, etkinlikBaslik, tamTarih, bugun, gunFarki, onayla, bildir,
} from './ortak.js';

/**
 * Ülke ekipleri ve görev panosu.
 *
 * Sayfa KURUM KURUM düzenlenir: her ortak kendi başlığı altında ekibini ve
 * görevlerini görür. Tek bir uzun görev listesi yerine bu düzen seçildi
 * çünkü buradaki asıl soru "hangi ülke ne yapıyor" — proje ortaklığında
 * iş bölümü kurum eksenlidir.
 */

const $ = id => document.getElementById(id);
const el = (etiket, sinif, metin) => {
  const d = document.createElement(etiket);
  if (sinif) d.className = sinif;
  if (metin != null) d.textContent = metin;
  return d;
};

let uyeler = [];
/* Ekibe eklenebilecek kişiler: sistemdeki hesaplar (dışarıdan ad yazılmaz). */
let adaylar = [];
let gorevler = [];
let gorevDurumlari = [];
let ilerlemeAdimi = 10;
let etkinlikler = [];

const yetkili = partner => !!durum.kullanici && (durum.kullanici.koordinator || durum.kullanici.partner === partner);
/** Görevi yalnızca tanımlayan ya da koordinatör siler/düzenler (sunucudaki kural). */
const gorevSahibi = g => !!durum.kullanici && (durum.kullanici.koordinator || g.olusturan === durum.kullanici.id);

const bayrak = kod => kod.length === 2
  ? String.fromCodePoint(...[...kod.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
  : '🌐';

/** Yüzdeyi çubuk olarak çizer. Ekran okuyucular için `progressbar` rolü ve
 *  değer öznitelikleri verilir — çubuk yalnızca görsel bir ipucu olmamalı. */
function ilerlemeCubugu(yuzde, ekSinif = '') {
  const kutu = el('div', `gorev-ilerleme ${ekSinif}`.trim());
  const ray = el('div', 'gorev-ray');
  const dolu = el('div', 'gorev-dolu');
  dolu.style.width = `${yuzde}%`;
  ray.append(dolu);
  ray.setAttribute('role', 'progressbar');
  ray.setAttribute('aria-valuenow', String(yuzde));
  ray.setAttribute('aria-valuemin', '0');
  ray.setAttribute('aria-valuemax', '100');
  ray.setAttribute('aria-label', t('gorev.ilerleme'));
  kutu.append(ray, el('span', 'gorev-yuzde', `%${yuzde}`));
  return kutu;
}

/* --- Çizim --------------------------------------------------------------- */
function ciz() {
  const kutu = $('kurumlar');
  kutu.replaceChildren();

  for (const o of durum.ortaklar) {
    const kurumUyeleri = uyeler.filter(u => u.partner === o.id);
    const kurumGorevleri = gorevler.filter(g => g.partner === o.id);
    const tamam = kurumGorevleri.filter(g => g.durum === 'tamamlandi').length;

    const bolum = el('section', 'kurum-kart');

    /* Başlık: bayrak, kurum adı, rol rozeti ve görev sayacı. */
    const bas = el('div', 'kurum-bas');
    const isim = el('div', 'kurum-isim');
    const bayrakEl = el('span', 'bayrak', bayrak(o.country));
    bayrakEl.setAttribute('aria-hidden', 'true');
    const ad = el('h2', null, o.name);
    isim.append(bayrakEl, ad);

    const rozet = el('span', `rozet ${o.coordinator ? 'rozet-koordinator' : 'rozet-ortak'}`,
      t(o.coordinator ? 'anasayfa.ortaklar.koordinator' : 'anasayfa.ortaklar.ortak'));
    bas.append(isim, rozet);
    if (kurumGorevleri.length) {
      /* Kurumun genel ilerlemesi görevlerin ortalamasıdır. Sayılan görev
         değil yapılan iş: yarısı bitmiş üç görev "0 tamamlandı" görünürdü,
         oysa kurum yolun ortasında. */
      const ortalama = Math.round(kurumGorevleri.reduce((a, g) => a + g.ilerleme, 0) / kurumGorevleri.length);
      const sayac = el('div', 'kurum-sayac');
      sayac.append(el('span', null, t('gorev.sayi', { tamam, toplam: kurumGorevleri.length })));
      sayac.append(ilerlemeCubugu(ortalama, 'kurum-ilerleme'));
      bas.append(sayac);
    }
    bolum.append(bas);

    const govde = el('div', 'kurum-govde');

    /* Ekip sütunu */
    const ekipSutun = el('div', 'kurum-sutun');
    ekipSutun.append(el('h3', 'sutun-bas', t('ekip.uyeler')));
    if (!kurumUyeleri.length) {
      ekipSutun.append(el('p', 'ipucu', t('ekip.uye.yok')));
    } else {
      const liste = el('ul', 'uye-liste');
      for (const u of kurumUyeleri) liste.append(uyeSatiri(u));
      ekipSutun.append(liste);
    }
    if (yetkili(o.id)) {
      const ekleDugme = el('button', 'metin-bag', t('ekip.uye.ekle'));
      ekleDugme.type = 'button';
      ekleDugme.addEventListener('click', () => uyeFormAc(null, o.id));
      ekipSutun.append(ekleDugme);
    }

    /* Görev sütunu */
    const gorevSutun = el('div', 'kurum-sutun kurum-sutun-genis');
    gorevSutun.append(el('h3', 'sutun-bas', t('gorev.baslik')));
    if (!kurumGorevleri.length) {
      gorevSutun.append(el('p', 'ipucu', t('gorev.yok')));
    } else {
      const liste = el('div', 'gorev-liste');
      for (const g of kurumGorevleri) liste.append(gorevSatiri(g));
      gorevSutun.append(liste);
    }
    if (yetkili(o.id)) {
      const ekleDugme = el('button', 'metin-bag', t('gorev.ekle'));
      ekleDugme.type = 'button';
      ekleDugme.addEventListener('click', () => gorevFormAc(null, o.id));
      gorevSutun.append(ekleDugme);
    }

    govde.append(ekipSutun, gorevSutun);
    bolum.append(govde);
    kutu.append(bolum);
  }
}

function uyeSatiri(u) {
  const satir = el('li', 'uye-satir');
  const bilgi = el('div');
  bilgi.append(el('strong', null, u.ad));
  if (u.rol) bilgi.append(el('small', null, u.rol));
  if (u.eposta) {
    const posta = el('a', 'uye-posta', u.eposta);
    posta.href = `mailto:${u.eposta}`;
    bilgi.append(posta);
  }
  satir.append(bilgi);

  if (yetkili(u.partner)) {
    const eylem = el('div', 'satir-eylem');
    const duzenle = el('button', 'satir-dugme', '✎');
    duzenle.type = 'button';
    duzenle.title = t('genel.duzenle');
    duzenle.setAttribute('aria-label', `${t('genel.duzenle')}: ${u.ad}`);
    duzenle.addEventListener('click', () => uyeFormAc(u, u.partner));

    /* Ekipten çıkarma düğmesi YOK (kullanıcı kararı, 23 Eylül 2026): ekip
       üyesi kurumun kalıcı kadrosudur; yanlışlıkla silinip görev ataması
       kopmasın. Kişi ekipten yalnızca hesabı silinince çıkar. */
    eylem.append(duzenle);
    satir.append(eylem);
  }
  return satir;
}

function gorevSatiri(g) {
  const satir = el('article', 'gorev-kart');
  satir.dataset.durum = g.durum;

  const ust = el('div', 'gorev-ust');
  ust.append(el('strong', 'gorev-ad', g.baslik));

  /* Durum, yetkisi olan için açılır liste; olmayan için etiket. */
  if (yetkili(g.partner)) {
    const secim = el('select', 'gorev-durum-secim');
    for (const d of gorevDurumlari) {
      const secenek = el('option', null, t(`gorevdurum.${d}`));
      secenek.value = d;
      secim.append(secenek);
    }
    secim.value = g.durum;
    secim.setAttribute('aria-label', t('etkinlik.durum'));
    secim.addEventListener('change', async () => {
      try {
        /* Sunucu, görevi tanımlamayan kullanıcıdan yalnızca durum alanını
           kabul eder; yine de tam kayıt gönderilir ki tanımlayan kişi aynı
           denetimle başka alanları da düzeltebilsin. */
        await iste(`api/gorevler/${g.id}`, { method: 'PUT', body: JSON.stringify({ ...g, durum: secim.value }) });
        await yenile();
      } catch (err) { bildir(err.message, 'hata'); secim.value = g.durum; }
    });
    ust.append(secim);
  } else {
    ust.append(el('span', 'etiket etiket-gorev', t(`gorevdurum.${g.durum}`)));
  }
  satir.append(ust);

  if (g.aciklama) satir.append(el('p', 'gorev-aciklama', g.aciklama));

  if (yetkili(g.partner)) {
    /* Yetkili kişi çubuğu doğrudan sürükler: ayrı bir düzenleme kutusu
       açmak, haftada bir güncellenen bir değer için fazla engel. */
    const kutu = el('div', 'gorev-ilerleme');
    const kaydirici = el('input', 'gorev-kaydirici');
    kaydirici.type = 'range';
    kaydirici.min = '0';
    kaydirici.max = '100';
    kaydirici.step = String(ilerlemeAdimi);
    kaydirici.value = String(g.ilerleme);
    kaydirici.setAttribute('aria-label', t('gorev.ilerleme'));
    const yuzde = el('span', 'gorev-yuzde', `%${g.ilerleme}`);
    /* Sürüklerken yalnızca etiket güncellenir; sunucuya `change` ile
       tek istek gider — her adımda yazmak onlarca gereksiz istek olurdu. */
    kaydirici.addEventListener('input', () => { yuzde.textContent = `%${kaydirici.value}`; });
    kaydirici.addEventListener('change', async () => {
      try {
        await iste(`api/gorevler/${g.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...g, ilerleme: Number(kaydirici.value) }),
        });
        await yenile();
      } catch (err) {
        bildir(err.message, 'hata');
        kaydirici.value = String(g.ilerleme);
        yuzde.textContent = `%${g.ilerleme}`;
      }
    });
    kutu.append(kaydirici, yuzde);
    satir.append(kutu);
  } else {
    satir.append(ilerlemeCubugu(g.ilerleme));
  }

  const alt = el('div', 'gorev-alt');
  const kisi = uyeler.find(u => u.id === g.uyeId);
  alt.append(el('span', null, kisi ? kisi.ad : t('gorev.kisi.yok')));
  if (g.wp) alt.append(el('span', 'etiket etiket-wp', t(`wp.${g.wp}.ad`)) , document.createTextNode(''));
  if (g.etkinlikId) {
    const etkinlik = etkinlikler.find(e => e.id === g.etkinlikId);
    if (etkinlik) alt.append(el('span', null, etkinlikBaslik(etkinlik)));
  }
  if (g.sonTarih) {
    const kalan = gunFarki(bugun(), g.sonTarih);
    const bitmis = g.durum === 'tamamlandi' || g.durum === 'iptal';
    const tarih = el('span', kalan < 0 && !bitmis ? 'gorev-gecikti' : 'gorev-sure');
    tarih.textContent = kalan < 0 && !bitmis
      ? `${tamTarih(g.sonTarih)} · ${t('gorev.gecikti')}`
      : `${tamTarih(g.sonTarih)}${bitmis ? '' : ` · ${t('gorev.kalan', { n: kalan })}`}`;
    alt.append(tarih);
  }
  satir.append(alt);

  if (gorevSahibi(g)) {
    const eylem = el('div', 'satir-eylem gorev-eylem');
    const duzenle = el('button', 'satir-dugme', '✎');
    duzenle.type = 'button';
    duzenle.title = t('genel.duzenle');
    duzenle.setAttribute('aria-label', `${t('genel.duzenle')}: ${g.baslik}`);
    duzenle.addEventListener('click', () => gorevFormAc(g, g.partner));

    const sil = el('button', 'satir-dugme satir-dugme-sil', '×');
    sil.type = 'button';
    sil.title = t('genel.sil');
    sil.setAttribute('aria-label', `${t('genel.sil')}: ${g.baslik}`);
    sil.addEventListener('click', async () => {
      if (!(await onayla(t('gorev.sil.onay'), { evet: t('genel.sil'), tehlike: true }))) return;
      try { await iste(`api/gorevler/${g.id}`, { method: 'DELETE' }); await yenile(); bildir(t('genel.silindi')); }
      catch (err) { bildir(err.message, 'hata'); }
    });
    eylem.append(duzenle, sil);
    satir.append(eylem);
  }
  return satir;
}

/* --- Formlar -------------------------------------------------------------- */
function secenekDoldur(secim, degerler, etiketle, secili, bosEtiket) {
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
  secim.value = secili ?? '';
}

/** Kullanıcının adına işlem yapabildiği kurumlar: koordinatör hepsi, ortak
 *  yalnızca kendisi. */
const yetkiliKurumlar = () => durum.kullanici.koordinator
  ? durum.ortaklar.map(o => o.id)
  : [durum.kullanici.partner];

function uyeFormAc(mevcut, partner) {
  const form = $('uye-form');
  $('uye-form-baslik').textContent = t(mevcut ? 'ekip.uye.baslik.duzenle' : 'ekip.uye.baslik.yeni');
  $('uye-hata').textContent = '';
  secenekDoldur(form.partner, yetkiliKurumlar(), ortakAdi, mevcut?.partner ?? partner ?? durum.kullanici.partner);
  /* Kurum değiştirmek kaydı taşımak demek olurdu; düzenlemede kilitli. */
  form.partner.disabled = !!mevcut;
  kisiSecimi(form, mevcut);
  form.rol.value = mevcut?.rol ?? '';
  form.eposta.value = mevcut?.eposta ?? '';
  form.dataset.id = mevcut?.id ?? '';
  $('uye-kutu').showModal();
}

/**
 * Kişi seçimi: yalnızca SEÇİLİ KURUMUN hesapları, ekipte olmayanlar.
 * Başka kurumdan biri listede hiç çıkmaz (sunucu da reddeder). Düzenlemede
 * kişi değiştirilemez; kayıt o kişinindir.
 */
function kisiSecimi(form, mevcut) {
  const secim = form.userId;
  secim.replaceChildren();
  if (mevcut) {
    const o = new Option(mevcut.ad, mevcut.userId ?? '');
    secim.append(o);
    secim.disabled = true;
    return;
  }
  secim.disabled = false;
  const ekipte = new Set(uyeler.map(u => u.userId).filter(Boolean));
  const liste = adaylar.filter(a => a.partner === form.partner.value && !ekipte.has(a.id));
  if (!liste.length) {
    const bos = new Option(t('ekip.uye.aday.yok'), '');
    bos.disabled = true;
    secim.append(bos);
    secim.value = '';
  } else {
    secim.append(new Option(t('ekip.uye.aday.sec'), ''), ...liste.map(a => new Option(a.ad, a.id)));
  }
}

function gorevFormAc(mevcut, partner) {
  const form = $('gorev-form');
  $('gorev-form-baslik').textContent = t(mevcut ? 'gorev.duzenle' : 'gorev.yeni');
  $('gorev-hata').textContent = '';

  const kurum = mevcut?.partner ?? partner ?? durum.kullanici.partner;
  secenekDoldur(form.partner, yetkiliKurumlar(), ortakAdi, kurum);
  form.partner.disabled = !!mevcut;
  secenekDoldur(form.wp, durum.ispaketleri, wp => t(`wp.${wp}.ad`), mevcut?.wp ?? '', t('takvim.filtre.hepsi'));
  secenekDoldur(form.durum, gorevDurumlari, d => t(`gorevdurum.${d}`), mevcut?.durum ?? 'bekliyor');
  secenekDoldur(form.etkinlikId, etkinlikler.map(e => String(e.id)),
    id => etkinlikBaslik(etkinlikler.find(e => String(e.id) === id)),
    mevcut?.etkinlikId ? String(mevcut.etkinlikId) : '', t('gorev.etkinlik.yok'));

  /* Sorumlu kişi listesi seçili kuruma bağlıdır: kurum değişince yenilenir. */
  const kisileriDoldur = () => secenekDoldur(
    form.uyeId,
    uyeler.filter(u => u.partner === form.partner.value).map(u => String(u.id)),
    id => uyeler.find(u => String(u.id) === id).ad,
    mevcut?.uyeId ? String(mevcut.uyeId) : '', t('gorev.kisi.yok'));
  kisileriDoldur();
  form.partner.onchange = kisileriDoldur;

  form.baslik.value = mevcut?.baslik ?? '';
  form.aciklama.value = mevcut?.aciklama ?? '';
  form.sonTarih.value = mevcut?.sonTarih ?? '';
  form.ilerleme.step = String(ilerlemeAdimi);
  form.ilerleme.value = String(mevcut?.ilerleme ?? 0);
  const cikti = $('gorev-ilerleme-cikti');
  cikti.textContent = `%${form.ilerleme.value}`;
  form.ilerleme.oninput = () => { cikti.textContent = `%${form.ilerleme.value}`; };
  form.sonTarih.min = durum.proje.start;
  form.sonTarih.max = durum.proje.end;
  form.dataset.id = mevcut?.id ?? '';
  $('gorev-kutu').showModal();
}

async function gonder(form, hataKutusu, yol, veri) {
  const dugme = form.querySelector('button[type="submit"]');
  hataKutusu.textContent = '';
  dugme.disabled = true;
  try {
    const id = form.dataset.id;
    await iste(id ? `${yol}/${id}` : yol, { method: id ? 'PUT' : 'POST', body: JSON.stringify(veri) });
    form.closest('dialog').close();
    await yenile();
    bildir(t('genel.kaydedildi'));
  } catch (err) {
    hataKutusu.textContent = err.message;
  } finally {
    dugme.disabled = false;
  }
}

async function yenile() {
  const veri = await iste('api/ekip');
  uyeler = veri.uyeler;
  adaylar = veri.adaylar || [];
  gorevler = veri.gorevler;
  gorevDurumlari = veri.gorevDurumlari;
  ilerlemeAdimi = veri.ilerlemeAdimi ?? ilerlemeAdimi;
  ciz();
}

/* --- Kurulum -------------------------------------------------------------- */
(async () => {
  try {
    await baslat();
    if (!durum.kullanici) { location.href = 'giris.html'; return; }

    ({ etkinlikler } = await iste('api/etkinlikler'));
    await yenile();

    $('uye-ekle').hidden = false;
    $('gorev-ekle').hidden = false;
    $('uye-ekle').addEventListener('click', () => uyeFormAc(null, durum.kullanici.partner));
    $('gorev-ekle').addEventListener('click', () => gorevFormAc(null, durum.kullanici.partner));

    for (const dugme of document.querySelectorAll('[data-kapat]')) {
      dugme.addEventListener('click', () => dugme.closest('dialog').close());
    }

    /* Kurum değişince kişi listesi o kurumun hesaplarına döner. */
    $('uye-form').partner.addEventListener('change', () => kisiSecimi($('uye-form'), null));

    $('uye-form').addEventListener('submit', olay => {
      olay.preventDefault();
      const f = olay.target;
      const mevcut = uyeler.find(u => String(u.id) === f.dataset.id);
      gonder(f, $('uye-hata'), 'api/ekip/uye', {
        partner: f.partner.value, userId: f.userId.value ? Number(f.userId.value) : null,
        ad: mevcut?.ad, rol: f.rol.value, eposta: f.eposta.value,
      });
    });

    $('gorev-form').addEventListener('submit', olay => {
      olay.preventDefault();
      const f = olay.target;
      gonder(f, $('gorev-hata'), 'api/gorevler', {
        partner: f.partner.value,
        uyeId: f.uyeId.value || null,
        wp: f.wp.value,
        etkinlikId: f.etkinlikId.value || null,
        baslik: f.baslik.value,
        aciklama: f.aciklama.value,
        sonTarih: f.sonTarih.value,
        durum: f.durum.value,
        ilerleme: Number(f.ilerleme.value),
      });
    });

    ceviriyiUygula();
  } catch (err) {
    console.error(err);
    $('kurumlar').replaceChildren(el('p', 'bos-durum', err.message));
  }
})();
