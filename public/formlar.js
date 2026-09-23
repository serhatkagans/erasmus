import {
  durum, t, baslat, ceviriyiUygula, ortakAdi, ortakKisa, tamTarih, bugun,
} from './ortak.js';

const $ = secici => document.querySelector(secici);
const $$ = secici => [...document.querySelectorAll(secici)];

/**
 * Formlar sayfası: koordinatör form hazırlar ve yanıtları izler, ortak kurum
 * kullanıcısı kendisine gönderilen formları doldurur. Görünüm adres
 * çubuğundaki # ile seçilir (bkz. formlar.html); sunucu kuralları
 * lib/forms.mjs içinde, burası yalnızca ekranı çizer.
 *
 * GençTek takvimindeki form ekranının bu projeye taşınmış hâli: düzen, soru
 * kartları, bölüm sayfaları, taslak kaydı ve özet grafikleri aynıdır.
 * Değişen iki şey: hedef kitle il değil ORTAK KURUM, ve bütün metinler
 * sözlükten gelir (arayüz altı dile açık).
 */

/* Soru türleri — sunucudaki adlarla (lib/data.mjs · QUESTION_TYPES). */
const TURLER = ['kisa', 'paragraf', 'tekli', 'coklu', 'liste', 'sayi', 'tarih', 'dosya'];
const SECIMLI = ['tekli', 'coklu', 'liste'];
const bolumMu = q => q.type === 'bolum';
const yanitlanabilir = q => !bolumMu(q);

/* Dosya sorusu: sunucudaki sınırlarla aynı (lib/data.mjs). */
const MAX_DOSYA = 5, MAX_DOSYA_MB = 10;
const DOSYA_KABUL = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.jpg,.jpeg,.png,.webp,.txt,.csv,.zip';
const METIN_LISTE_SINIRI = 20;

const kacis = deger => String(deger ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let sayiBicim, damgaBicim, saatBicim, siralayici;
const sayi = n => sayiBicim.format(n);
const damga = iso => damgaBicim.format(new Date(iso));
const gunEtiketi = gun => tamTarih(gun);
const boyutMetni = bayt => (bayt < 1048576
  ? t('form.boyut.kb', { n: Math.max(1, Math.round(bayt / 1024)) })
  : t('form.boyut.mb', { n: sayi(Math.round(bayt / 104857.6) / 10) }));

/* Soru kimliği: sunucu [a-z0-9]{1,16} bekler. randomUUID güvenli bağlam
   ister; yerel ağ adresinden (http) açılışta da çalışsın diye getRandomValues. */
const yeniId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(36).padStart(2, '0')).join('');

let koordinator = false, formlar = [], taslak = null, kirli = false, bildirim = '', sonHash = location.hash, sonuclar = null;

async function api(yol, secenek = {}) {
  const yanit = await fetch(yol, { ...secenek, headers: { 'Content-Type': 'application/json', ...secenek.headers } });
  const veri = await yanit.json().catch(() => ({}));
  /* Oturum düştüyse giriş sayfasına dönülür. */
  if (yanit.status === 401) { location.href = 'giris.html'; throw Error(durum.sozluk[veri.error] || t('form.hata.giris')); }
  if (!yanit.ok) throw Error(durum.sozluk[veri.error] || veri.error || t('genel.hata'));
  return veri;
}

function bas(ustbaslik, baslik, giris = '') {
  $('#bas-ustbaslik').textContent = ustbaslik;
  $('#bas-baslik').textContent = baslik;
  $('#bas-giris').textContent = giris;
  $('#bas-giris').hidden = !giris;
  document.title = `${baslik} · ${t('site.ad')}`;
}

/* ---- Yönlendirme ---------------------------------------------------------- */
async function yonlendir() {
  const [gorunum, ham, sekme] = location.hash.slice(1).split('/');
  const id = Number(ham);
  for (const bolge of ['#liste-gorunum', '#duzenle-gorunum', '#doldur-gorunum', '#yanitlar-gorunum']) $(bolge).hidden = true;
  /* Liste dışındaki görünümler Google Formlar düzeninde: dar sütun. */
  document.body.classList.toggle('gf-modu', ['yeni', 'duzenle', 'doldur', 'yanitlar'].includes(gorunum));
  $('#sayfa-hata').textContent = '';
  for (const not of $$('.fp-bildirim')) not.remove();
  window.scrollTo(0, 0);
  try {
    if (koordinator && gorunum === 'yeni') return await duzenleyiciAc();
    if (koordinator && gorunum === 'duzenle' && id) return await duzenleyiciAc(id, sekme);
    if (koordinator && gorunum === 'yanitlar' && id) return await sonuclariAc(id);
    if (gorunum === 'doldur' && id) return await doldurAc(id);
    return await listeAc();
  } catch (hata) {
    document.body.classList.remove('gf-modu');
    bas(t('form.sayfa.ustbaslik'), t('form.sayfa.baslik'));
    $('#sayfa-hata').textContent = hata.message;
  }
}

/* Düzenleyicide kaydedilmemiş değişiklik varsa başka görünüme geçmeden sorulur. */
window.addEventListener('hashchange', () => {
  if (kirli && !confirm(t('form.onay.kaydedilmemis'))) {
    history.replaceState(null, '', sonHash || location.pathname);
    return;
  }
  kirli = false; sonHash = location.hash;
  yonlendir();
});
window.addEventListener('beforeunload', olay => { if (kirli) olay.preventDefault(); });
/* Aynı adrese gitmek hashchange üretmez; o zaman görünüm elle yenilenir. */
const git = hash => { if (location.hash === hash || (hash === '#' && !location.hash)) yonlendir(); else location.hash = hash; };

/* ---- Biçimli metin -------------------------------------------------------
   Form başlığı ve açıklaması kalın / italik / altı çizili / liste taşıyabilir.
   Düzenleyici (contenteditable) ne üretirse üretsin, kaydedilen ve ekrana
   basılan değer zenginOku'dan geçer: yalnızca <b> <i> <u> <ul> <ol> <li>
   <br> kalır, öznitelik kalmaz, metin kaçışlanır. Sunucu aynı kuralı ayrıca
   denetler (lib/forms.mjs · richText). `satirIci` başlık içindir. */
const ZENGIN_ETIKET = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', UL: 'ul', OL: 'ol', LI: 'li' };
function zenginOku(kok, satirIci = false) {
  let cikti = '';
  const gez = dugum => {
    for (const cocuk of dugum.childNodes) {
      if (cocuk.nodeType === Node.TEXT_NODE) { cikti += kacis(cocuk.nodeValue.replace(/\s*\n\s*/g, ' ')); continue; }
      if (cocuk.nodeType !== Node.ELEMENT_NODE) continue;
      const etiket = cocuk.tagName;
      if (etiket === 'BR') { cikti += satirIci ? ' ' : '<br>'; continue; }
      /* Tarayıcı Enter'a basılınca her satırı <div> içine alır: satır sonuna çevrilir. */
      if (etiket === 'DIV' || etiket === 'P') {
        if (cikti && !/(<br>|<\/[uo]l>| )$/.test(cikti)) cikti += satirIci ? ' ' : '<br>';
        gez(cocuk);
        continue;
      }
      let sarmal = ZENGIN_ETIKET[etiket] ? [ZENGIN_ETIKET[etiket]] : [];
      /* Satır birleştirirken tarayıcı biçimi bazen <span style> olarak bırakır. */
      if (!sarmal.length && cocuk.style) {
        if (cocuk.style.fontWeight === 'bold' || Number(cocuk.style.fontWeight) >= 600) sarmal.push('b');
        if (cocuk.style.fontStyle === 'italic') sarmal.push('i');
        if (cocuk.style.textDecorationLine?.includes('underline') || cocuk.style.textDecoration?.includes('underline')) sarmal.push('u');
      }
      if (satirIci) sarmal = sarmal.filter(ad => !['ul', 'ol', 'li'].includes(ad));
      cikti += sarmal.map(ad => `<${ad}>`).join('');
      gez(cocuk);
      cikti += sarmal.reverse().map(ad => `</${ad}>`).join('');
    }
  };
  gez(kok);
  cikti = cikti.replace(/(<br>|\s)+$/, '').replace(/^(<br>|\s)+/, '');
  /* Yalnızca boş etiket kaldıysa (ör. <b></b>) alan boş sayılır. */
  return cikti.replace(/<[^>]+>/g, '').trim() ? cikti : '';
}

/** Saklanan biçimli metni güvenle HTML'e çevirir; yoksa düz metni kaçışlar. */
function zenginHtml(zengin, duz, satirIci = false) {
  if (!zengin) return satirIci ? kacis(duz) : kacis(duz).replace(/\n/g, '<br>');
  const kalip = document.createElement('template');
  kalip.innerHTML = zengin;
  return zenginOku(kalip.content, satirIci);
}

/* Biçimli alanlar: başlıkta Enter yok; yapıştırılan metin biçimsiz girer. */
function zenginAlanlariKur() {
  for (const alan of $$('.zengin-duzenleyici')) {
    const satirIci = alan.hasAttribute('data-satir-ici');
    alan.addEventListener('keydown', olay => { if (satirIci && olay.key === 'Enter') olay.preventDefault(); });
    alan.addEventListener('paste', olay => {
      olay.preventDefault();
      const metin = olay.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, satirIci ? metin.replace(/\s*\n\s*/g, ' ') : metin);
    });
    /* Boşaltılan alanda tarayıcının bıraktığı <br> yer tutucuyu gizlemesin. */
    alan.addEventListener('input', () => { if (!alan.textContent.trim() && !alan.querySelector('li')) alan.innerHTML = ''; });
  }
  /* Araç çubuğu: düğmeye basınca odak metinden kaçmasın, seçim korunsun. */
  for (const cubuk of $$('.zengin-arac')) {
    cubuk.addEventListener('mousedown', olay => { if (olay.target.closest('[data-cmd]')) olay.preventDefault(); });
    cubuk.addEventListener('click', olay => {
      const dugme = olay.target.closest('[data-cmd]');
      if (!dugme) return;
      const alan = cubuk.parentElement.querySelector('.zengin-duzenleyici');
      if (document.activeElement !== alan) alan.focus();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(dugme.dataset.cmd);
      if (dugme.dataset.cmd === 'removeFormat' && !alan.hasAttribute('data-satir-ici')) {
        /* removeFormat listeyi kaldırmaz; açıksa o da kapatılır. */
        for (const liste of ['insertUnorderedList', 'insertOrderedList']) if (document.queryCommandState(liste)) document.execCommand(liste);
      }
      aracCubuguEsitle();
    });
  }
  document.addEventListener('selectionchange', aracCubuguEsitle);
}

/* İmlecin olduğu yerdeki biçim düğmelerde basılı görünür. */
function aracCubuguEsitle() {
  const alan = document.activeElement?.closest?.('.zengin-duzenleyici');
  if (!alan) return;
  for (const dugme of alan.parentElement.querySelectorAll('[data-cmd][aria-pressed]')) {
    let acik = false;
    try { acik = document.queryCommandState(dugme.dataset.cmd); } catch { /* desteklenmiyor */ }
    dugme.setAttribute('aria-pressed', String(acik));
  }
}

/* ---- Kapak görseli ------------------------------------------------------ */
const GORSEL_GENISLIK = 1600, GORSEL_TUT_BAYT = 1.5 * 1024 * 1024;
const gorselAdresi = (id, surum) => `api/formlar/${id}/gorsel?v=${encodeURIComponent(surum)}`;

/* Büyük fotoğraf yüklemeden önce küçültülür: form her açılışta bu görseli
   indirir, yedi ülkedeki ortakların telefonunda 10 MB'lık kapak gereksiz. */
async function gorseliKucult(dosya) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(dosya.type)) throw Error(t('form.hata.gorselTuru'));
  const resim = await createImageBitmap(dosya).catch(() => { throw Error(t('form.hata.gorselAcilmadi')); });
  const olcek = Math.min(1, GORSEL_GENISLIK / resim.width);
  if (olcek === 1 && dosya.size <= GORSEL_TUT_BAYT) { resim.close(); return dosya; }
  const tuval = document.createElement('canvas');
  tuval.width = Math.round(resim.width * olcek); tuval.height = Math.round(resim.height * olcek);
  const ctx = tuval.getContext('2d');
  /* Saydam PNG JPEG'e çevrilince siyah olmasın. */
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tuval.width, tuval.height);
  ctx.drawImage(resim, 0, 0, tuval.width, tuval.height);
  resim.close();
  return new Promise((coz, at) => tuval.toBlob(b => (b ? coz(b) : at(Error(t('form.hata.gorselHazirlanamadi')))), 'image/jpeg', 0.86));
}

async function gorselYukle(id, blob) {
  const yanit = await fetch(`api/formlar/${id}/gorsel`, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
  const veri = await yanit.json().catch(() => ({}));
  if (!yanit.ok) throw Error(durum.sozluk[veri.error] || veri.error || t('form.hata.gorselYuklenemedi'));
  return veri.gorsel;
}

/* ---- Liste ---------------------------------------------------------------- */
let halSuzgeci = 'hepsi';

function halBilgisi(form) {
  if (koordinator) {
    if (form.hal === 'taslak') return [t('form.hal.taslak'), 'taslak'];
    return form.acik
      ? [t('form.hal.acikUzun'), 'acik']
      : [form.kapali ? t('form.hal.durduruldu') : t('form.hal.suresiDoldu'), 'kapali'];
  }
  if (form.yanitladi) return [t('form.hal.yanitlandi'), 'bitti'];
  return form.acik ? [t('form.hal.bekleniyor'), 'acik'] : [t('form.hal.kapandi'), 'kapali'];
}

async function listeAc() {
  bas(t('form.sayfa.ustbaslik'), t('form.sayfa.baslik'),
    koordinator ? t('form.giris.koordinator') : t('form.giris.ortak'));
  $('#yeni-form').hidden = !koordinator;
  $('#hal-suzgec').hidden = !koordinator;
  $('#liste-gorunum').hidden = false;
  $('#form-listesi').innerHTML = `<p class="bos-durum">${kacis(t('genel.yukleniyor'))}</p>`;
  formlar = await api('api/formlar');
  listeCiz();
  if (bildirim) { $('#sayfa-hata').textContent = ''; bildirimGoster(bildirim); bildirim = ''; }
}

function bildirimGoster(metin, hedef = '#liste-gorunum') {
  const not = document.createElement('p');
  not.className = 'fp-not fp-bildirim';
  not.setAttribute('role', 'status');
  not.textContent = metin;
  $(hedef).prepend(not);
}

/** Hedef kitle metni: "Bütün ortak kurumlar" ya da "3 kurum". */
const hedefMetni = form => (form.hedef.length
  ? t('form.hedef.nKurum', { n: form.hedef.length })
  : t('form.hedef.hepsi')) + (form.koordinatorDoldurur ? t('form.hedef.veKoordinator') : '');

function listeCiz() {
  const arama = $('#liste-arama').value.trim().toLocaleLowerCase(durum.dil);
  const satirlar = formlar.filter(f => f.baslik.toLocaleLowerCase(durum.dil).includes(arama)
    && (!koordinator || halSuzgeci === 'hepsi' || f.hal === halSuzgeci));

  if (koordinator) {
    for (const dugme of $$('#hal-suzgec [data-hal]')) {
      const adet = dugme.dataset.hal === 'hepsi' ? formlar.length : formlar.filter(f => f.hal === dugme.dataset.hal).length;
      dugme.querySelector('small').textContent = adet;
      dugme.setAttribute('aria-pressed', String(dugme.dataset.hal === halSuzgeci));
    }
  }

  if (!satirlar.length) {
    const metin = arama ? t('form.bos.arama')
      : koordinator ? (halSuzgeci === 'hepsi' ? t('form.bos.koordinator') : t('form.bos.suzgec'))
      : t('form.bos.ortak');
    $('#form-listesi').innerHTML = `<p class="bos-durum">${kacis(metin)}</p>`;
    return;
  }

  /* Koordinatörün hatırlattığı, henüz gönderilmemiş formlar listenin başında. */
  const hatirlatilan = formlar.filter(f => f.hatirlatildi && !f.yanitladi && f.acik);
  const serit = hatirlatilan.length
    ? `<div class="hatirlatma-serit" role="status"><strong>${kacis(t('form.hatirlatma.geldi'))}</strong><ul>${hatirlatilan.map(f =>
        `<li><a href="#doldur/${f.id}">${kacis(f.baslik)}</a>${f.sonTarih ? ` · ${kacis(t('form.sonGun', { gun: gunEtiketi(f.sonTarih) }))}` : ''}</li>`).join('')}</ul></div>`
    : '';

  $('#form-listesi').innerHTML = serit + satirlar.map(f => {
    const [etiket, sinif] = halBilgisi(f);
    const ayrinti = [
      t('form.soru.sayi', { n: f.soruSayisi }),
      f.sonTarih && t('form.sonGun', { gun: gunEtiketi(f.sonTarih) }),
      koordinator && hedefMetni(f),
      koordinator && f.acanAd && t('form.acan', { ad: f.acanAd }),
      f.yanitladi && t('form.yanitiniz', { zaman: damga(f.yanitladi) }),
    ].filter(Boolean).join(' · ');

    const bag = koordinator ? (f.hal === 'taslak' ? `#duzenle/${f.id}` : `#yanitlar/${f.id}`) : `#doldur/${f.id}`;
    const ilerleme = koordinator && f.hal !== 'taslak'
      ? `<div class="form-ilerleme"><progress max="${Math.max(f.beklenen, 1)}" value="${Math.min(f.yanitSayisi, f.beklenen || f.yanitSayisi)}"></progress><small>${kacis(t('form.ilerleme', { n: f.yanitSayisi, toplam: f.beklenen }))}</small></div>`
      : '';

    const doldur = `<a class="dugme ${f.acik && !f.yanitladi ? 'dugme-birincil' : 'dugme-ikincil'}" href="#doldur/${f.id}">${kacis(
      f.yanitladi ? (f.acik ? t('form.eylem.duzelt') : t('form.eylem.gor'))
        : f.acik ? t('form.eylem.doldur') : t('form.eylem.gorFormu'))}</a>`;

    const taslakMi = f.hal === 'taslak';
    const eylemler = !koordinator ? doldur : taslakMi
      ? `<button type="button" class="dugme dugme-birincil" data-yayimla="${f.id}">${kacis(t('form.eylem.yayimla'))}</button>`
        + `<a class="dugme dugme-ikincil" href="#duzenle/${f.id}">${kacis(t('genel.duzenle'))}</a>`
        + `<a class="metin-bag" href="#doldur/${f.id}">${kacis(t('form.onizle'))}</a>`
        + `<button type="button" class="metin-bag" data-kopya="${f.id}">${kacis(t('form.eylem.kopya'))}</button>`
      : `${f.koordinatorDoldurur ? doldur : ''}`
        + `<a class="dugme dugme-ikincil" href="#yanitlar/${f.id}">${kacis(t('form.sekme.yanitlar'))}</a>`
        + `<a class="metin-bag" href="#duzenle/${f.id}">${kacis(t('genel.duzenle'))}</a>`
        + `${f.koordinatorDoldurur ? '' : `<a class="metin-bag" href="#doldur/${f.id}">${kacis(t('form.onizle'))}</a>`}`
        + `<button type="button" class="metin-bag" data-kopya="${f.id}">${kacis(t('form.eylem.kopya'))}</button>`;

    const kapak = f.gorsel ? `<img class="form-kapak" src="${gorselAdresi(f.id, f.gorsel)}" alt="" loading="lazy">` : '';
    return `<article class="form-kart${kapak ? ' kapakli' : ''}">
      ${kapak}
      <div class="form-kart-govde">
        <span class="form-rozetler"><span class="form-rozet is-${sinif}">${kacis(etiket)}</span>${
          f.hatirlatildi && !f.yanitladi && f.acik ? `<span class="form-rozet is-hatirlatildi">${kacis(t('form.rozet.hatirlatildi'))}</span>` : ''}</span>
        <h2><a href="${bag}">${kacis(f.baslik)}</a></h2>
        <p class="form-kart-ust">${kacis(ayrinti)}</p>
        ${ilerleme}
      </div>
      <div class="form-kart-eylem">${eylemler}</div>
    </article>`;
  }).join('');
}

/* Yayımlama: taslak form ortaklara açılır. */
async function formYayimla(form) {
  if (!confirm(t('form.onay.yayimla', { baslik: form.baslik, hedef: hedefMetni(form) }))) return false;
  await api(`api/formlar/${form.id}/durum`, { method: 'PUT', body: JSON.stringify({ durum: 'yayinda' }) });
  return true;
}

function listeOlaylariniKur() {
  $('#liste-arama').addEventListener('input', listeCiz);
  $('#yeni-form').onclick = () => git('#yeni');

  $('#hal-suzgec').addEventListener('click', olay => {
    const dugme = olay.target.closest('[data-hal]');
    if (dugme) { halSuzgeci = dugme.dataset.hal; listeCiz(); }
  });

  $('#form-listesi').addEventListener('click', async olay => {
    const yayimDugme = olay.target.closest('[data-yayimla]');
    if (yayimDugme) {
      const form = formlar.find(f => f.id === Number(yayimDugme.dataset.yayimla));
      try {
        if (!await formYayimla(form)) return;
        bildirim = t('form.bildirim.yayimlandi', { baslik: form.baslik });
        await listeAc();
      } catch (hata) { $('#sayfa-hata').textContent = hata.message; }
      return;
    }

    /* Kopya: aynı sorular (kaldırılmışlar hariç), yanıtsız yeni bir taslak. */
    const kopyaDugme = olay.target.closest('[data-kopya]');
    if (!kopyaDugme) return;
    kopyaDugme.disabled = true;
    try {
      const kaynak = await api('api/formlar/' + kopyaDugme.dataset.kopya);
      const yeni = await api('api/formlar', {
        method: 'POST',
        body: JSON.stringify({
          baslik: t('form.kopyaAdi', { baslik: kaynak.baslik }).slice(0, 200),
          baslikRich: kaynak.baslikRich && `${kaynak.baslikRich} ${kacis(t('form.kopyaEki'))}`,
          aciklama: kaynak.aciklama, aciklamaRich: kaynak.aciklamaRich,
          sonTarih: '', hedef: kaynak.hedef, koordinatorDoldurur: kaynak.koordinatorDoldurur,
          kapali: false, sorular: kaynak.sorular.filter(q => !q.archived),
        }),
      });
      if (kaynak.gorsel) {
        const gorsel = await fetch(gorselAdresi(kaynak.id, kaynak.gorsel));
        if (gorsel.ok) await gorselYukle(yeni.id, await gorsel.blob());
      }
      git('#duzenle/' + yeni.id);
    } catch (hata) { $('#sayfa-hata').textContent = hata.message; kopyaDugme.disabled = false; }
  });
}

/* ---- Düzenleyici (koordinatör) -------------------------------------------
   `kokler`: seçeneklerin formun açıldığı andaki adları (yeni seçenekte null).
   Kaydederken adı değişen seçenek sunucuya bildirilir; eski yanıtlar yeni ada
   taşınır (bkz. lib/forms.mjs · renameAnswers). */
const bosSoru = (type = 'tekli') => ({
  id: yeniId(), type, title: '', help: '', required: false,
  options: SECIMLI.includes(type) ? [''] : [], kokler: SECIMLI.includes(type) ? [null] : [],
});
/* Yanıt almış soru: türü kilitli, silinirse kaldırılmış olarak kalır. */
const yanitAldiMi = q => taslak.yanitlanan.has(q.id);

async function duzenleyiciAc(id, sekme) {
  const form = $('#duzenle-form');
  form.reset();
  $('#duzenle-hata').textContent = '';

  if (id) {
    const f = await api('api/formlar/' + id);
    taslak = {
      id, updated: f.updated, yanitSayisi: f.yanitSayisi, hal: f.hal, durum: f.durum,
      yanitlanan: new Set(f.yanitAlanSorular || []), etkin: 0,
      sorular: f.sorular.map(q => ({ ...q, options: q.options || [], kokler: [...(q.options || [])] })),
    };
    taslak.etkin = Math.max(0, taslak.sorular.findIndex(q => !q.archived));
    $('#baslik-duzenleyici').innerHTML = zenginHtml(f.baslikRich, f.baslik, true);
    $('#aciklama-duzenleyici').innerHTML = zenginHtml(f.aciklamaRich, f.aciklama);
    taslak.gorsel = { surum: f.gorsel, blob: null, url: null, kaldirildi: false };
    form.elements.sonTarih.value = f.sonTarih;
    form.elements.kapali.checked = f.kapali;
    form.elements.koordinatorDoldurur.checked = f.koordinatorDoldurur;
    form.querySelector(`[name="hedef-kip"][value="${f.hedef.length ? 'secili' : 'hepsi'}"]`).checked = true;
    hedefleriCiz(f.hedef);
    bas(t('form.duzenle.ustbaslik'), f.baslik);
  } else {
    taslak = {
      id: null, updated: null, yanitSayisi: 0, hal: 'taslak', durum: 'taslak',
      yanitlanan: new Set(), etkin: 0, sorular: [bosSoru()],
      gorsel: { surum: null, blob: null, url: null, kaldirildi: false },
    };
    $('#baslik-duzenleyici').innerHTML = $('#aciklama-duzenleyici').innerHTML = '';
    hedefleriCiz([]);
    bas(t('form.yeni.ustbaslik'), t('form.yeni'));
  }

  $('#duzenle-yanitlar').hidden = !id;
  $('#duzenle-yanitlar').textContent = taslak.yanitSayisi
    ? t('form.sekme.yanitlarN', { n: taslak.yanitSayisi }) : t('form.sekme.yanitlar');
  $('#duzenle-yanitlar').href = `#yanitlar/${id}`;
  duzenleSekmesi(sekme === 'ayarlar' ? 'ayarlar' : 'sorular');
  kapagiCiz();

  $('#duzenle-uyari').hidden = !taslak.yanitSayisi;
  $('#duzenle-uyari').textContent = taslak.yanitSayisi ? t('form.uyari.yanitli', { n: taslak.yanitSayisi }) : '';
  durumSeridiCiz();
  $('#sil-form').hidden = !id;
  $('#duzenle-gorunum').hidden = false;
  sorulariCiz();
  kirli = false;
  if (!id) $('#baslik-duzenleyici').focus();
}

/* Durum şeridi: taslak / yayında / kapalı ve o duruma uygun eylem. */
function durumSeridiCiz() {
  const hal = taslak.hal, serit = $('#duzenle-durum');
  const metin = {
    taslak: taslak.id ? t('form.durum.taslak') : t('form.durum.yeni'),
    acik: t('form.durum.acik'),
    kapali: t('form.durum.kapali'),
  }[hal];
  const rozet = { taslak: t('form.hal.taslak'), acik: t('form.hal.acik'), kapali: t('form.hal.kapali') }[hal];
  serit.className = `durum-serit is-${hal}`;
  serit.innerHTML = `<span class="form-rozet is-${hal}">${kacis(rozet)}</span><span>${kacis(metin)}</span>`
    + (taslak.id && hal !== 'taslak' && !taslak.yanitSayisi
      ? `<button type="button" class="metin-bag" data-taslagaal>${kacis(t('form.taslagaAl'))}</button>` : '');
  $('#kaydet-form').textContent = hal === 'taslak' ? t('form.kaydet.taslak') : t('form.kaydet.degisiklik');
  $('#kaydet-form').className = `dugme ${hal === 'taslak' ? 'dugme-ikincil' : 'dugme-birincil'}`;
  $('#yayimla-form').hidden = hal !== 'taslak';
}

/* Sorular / Ayarlar sekmesi: aynı form, yalnızca görünen kartlar değişir. */
function duzenleSekmesi(sekme) {
  for (const dugme of $$('[data-duzenle-sekme]')) dugme.setAttribute('aria-pressed', String(dugme.dataset.duzenleSekme === sekme));
  for (const pano of $$('#duzenle-gorunum [data-pano]')) pano.hidden = pano.dataset.pano !== sekme;
  if (taslak) kapagiCiz();
}

function hedefleriCiz(secili) {
  $('#hedef-kutular').innerHTML = durum.ortaklar.map(o =>
    `<label class="onay"><input type="checkbox" value="${kacis(o.id)}"${secili.includes(o.id) ? ' checked' : ''}> <span>${kacis(o.name)} <small>${kacis(o.short)}</small></span></label>`).join('');
  hedefleriEsitle();
}

function hedefleriEsitle() {
  const secili = $('#duzenle-form').querySelector('[name="hedef-kip"]:checked').value === 'secili';
  $('#hedef-alan').hidden = !secili;
  $('#hedef-sayi').textContent = t('form.hedef.sayi', { n: $$('#hedef-kutular input:checked').length });
}

/* Düğme simgeleri (satır içi SVG: CSP dış kaynağa izin vermiyor). */
const svg = d => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const SIMGE = {
  kopya: svg('M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z'),
  cop: svg('M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5z'),
  yukari: svg('M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z'),
  asagi: svg('M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z'),
  kapat: svg('M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z'),
  arti: svg('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'),
  bolum: svg('M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h12v2H3v-2z'),
  dosya: svg('M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z'),
};

/* Seçenek işareti: tek seçimde daire, çoklu seçimde kare, listede sıra no. */
const secenekIsareti = (type, j) => `<span class="secenek-isaret is-${type}" aria-hidden="true">${type === 'liste' ? `${j + 1}.` : ''}</span>`;

/* Bölüm numarası: form bölümle başlamıyorsa ilk sayfa 1. bölümdür. */
function bolumEtiketi(index) {
  const liste = taslak.sorular;
  const onceki = liste.slice(0, index + 1).filter(bolumMu).length;
  const toplam = liste.filter(bolumMu).length + (bolumMu(liste[0]) ? 0 : 1);
  return t('form.bolum.no', { n: onceki + (bolumMu(liste[0]) ? 0 : 1), toplam });
}

function bolumKarti(q, index) {
  const etkin = index === taslak.etkin;
  const araclar = etkin ? `<div class="soru-alt">
      <span class="soru-araclar">
        <button type="button" class="simge-dugme" data-act="yukari" data-t-etiket="form.tasi.yukari"${index === 0 ? ' disabled' : ''}>${SIMGE.yukari}</button>
        <button type="button" class="simge-dugme" data-act="asagi" data-t-etiket="form.tasi.asagi"${index === taslak.sorular.length - 1 ? ' disabled' : ''}>${SIMGE.asagi}</button>
      </span>
      <span class="soru-araclar">
        <button type="button" class="simge-dugme" data-act="sil" data-t-etiket="form.bolum.sil">${SIMGE.cop}</button>
      </span>
    </div>
    <div class="soru-fab"><button type="button" class="simge-dugme" data-act="araya-soru" data-t-etiket="form.soru.ekle">${SIMGE.arti}</button><button type="button" class="simge-dugme" data-act="araya-bolum" data-t-etiket="form.bolum.ekle">${SIMGE.bolum}</button></div>` : '';
  const govde = etkin
    ? `<input data-field="title" value="${kacis(q.title)}" maxlength="500" placeholder="${kacis(t('form.bolum.baslik'))}" class="bolum-baslik-girdi">
       <input data-field="help" value="${kacis(q.help)}" maxlength="1000" placeholder="${kacis(t('form.soru.aciklama'))}" class="soru-yardim">`
    : `<p class="soru-onizleme-baslik">${q.title ? kacis(q.title) : `<span class="soluk">${kacis(t('form.bolum.basliksiz'))}</span>`}</p>${q.help ? `<p class="doldur-yardim">${kacis(q.help)}</p>` : ''}`;
  return `<article class="soru-kart fp-kart bolum-kart${etkin ? ' is-etkin' : ' is-onizleme'}" data-q="${index}"${etkin ? '' : ' tabindex="0" role="button"'}>
    <span class="bolum-etiket">${kacis(bolumEtiketi(index))}</span>
    ${govde}${araclar}
  </article>`;
}

/* Seçili olmayan soru, ortağın göreceği biçimde önizlenir; tıklanınca düzenlenir. */
function soruOnizleme(q, index) {
  const govde = SECIMLI.includes(q.type)
    ? `<ul class="secenek-liste is-onizleme">${q.options.map((secenek, j) =>
        `<li>${secenekIsareti(q.type, j)}<span>${kacis(secenek) || `<span class="soluk">${kacis(t('form.secenek.no', { n: j + 1 }))}</span>`}</span></li>`).join('')}</ul>`
    : `<p class="soru-onizleme">${kacis(t(`form.onizleme.${q.type}`))}</p>`;
  return `<article class="soru-kart fp-kart is-onizleme" data-q="${index}" tabindex="0" role="button">
    <p class="soru-onizleme-baslik">${q.title ? kacis(q.title) : `<span class="soluk">${kacis(t('form.soru.basliksiz'))}</span>`}${q.required ? ' <b class="zorunlu">*</b>' : ''}</p>
    ${q.help ? `<p class="doldur-yardim">${kacis(q.help)}</p>` : ''}
    ${govde}
  </article>`;
}

/* Kaldırılmış soru: doldurma ekranında yok, raporda duruyor; geri alınabilir. */
const kaldirilmisKart = (q, index) => `<article class="soru-kart fp-kart is-kaldirildi" data-q="${index}">
    <p class="soru-onizleme-baslik">${kacis(q.title)}</p>
    <p class="soluk">${kacis(t('form.soru.kaldirildiNot'))}</p>
    <button type="button" class="metin-bag" data-act="geri-al">${kacis(t('form.soru.geriAl'))}</button>
  </article>`;

function soruKarti(q, index) {
  if (q.archived) return kaldirilmisKart(q, index);
  if (bolumMu(q)) return bolumKarti(q, index);
  if (index !== taslak.etkin) return soruOnizleme(q, index);

  const secimli = SECIMLI.includes(q.type);
  const secenekler = secimli
    ? `<ol class="secenek-liste">${q.options.map((secenek, j) =>
        `<li>${secenekIsareti(q.type, j)}<input data-option="${j}" value="${kacis(secenek)}" maxlength="300" placeholder="${kacis(t('form.secenek.no', { n: j + 1 }))}"><button type="button" class="simge-dugme" data-act="secenek-sil" data-index="${j}" data-t-etiket="form.secenek.sil"${q.options.length < 2 ? ' disabled' : ''}>${SIMGE.kapat}</button></li>`).join('')}
        <li class="secenek-ekle">${secenekIsareti(q.type, q.options.length)}<button type="button" data-act="secenek-ekle">${kacis(t('form.secenek.ekle'))}</button></li></ol>`
    : `<p class="soru-onizleme">${kacis(t(`form.onizleme.${q.type}`))}</p><p class="soru-onizleme-not">${kacis(t('form.onizleme.not'))}</p>`;

  return `<article class="soru-kart fp-kart is-etkin" data-q="${index}">
    <div class="soru-ust">
      <input data-field="title" value="${kacis(q.title)}" maxlength="500" placeholder="${kacis(t('form.soru.metin'))}">
      <select data-field="type"${yanitAldiMi(q) ? ' disabled' : ''}>${TURLER.map(tur =>
        `<option value="${tur}"${tur === q.type ? ' selected' : ''}>${kacis(t(`form.tur.${tur}`))}</option>`).join('')}</select>
    </div>
    ${yanitAldiMi(q) ? `<p class="soru-kilit">${kacis(t('form.soru.kilit'))}${secimli ? ' ' + kacis(t('form.soru.kilitSecenek')) : ''}</p>` : ''}
    <input data-field="help" value="${kacis(q.help)}" maxlength="1000" placeholder="${kacis(t('form.soru.aciklama'))}" class="soru-yardim">
    ${secenekler}
    <div class="soru-alt">
      <span class="soru-araclar">
        <button type="button" class="simge-dugme" data-act="yukari" data-t-etiket="form.tasi.yukari"${index === 0 ? ' disabled' : ''}>${SIMGE.yukari}</button>
        <button type="button" class="simge-dugme" data-act="asagi" data-t-etiket="form.tasi.asagi"${index === taslak.sorular.length - 1 ? ' disabled' : ''}>${SIMGE.asagi}</button>
      </span>
      <span class="soru-araclar">
        <button type="button" class="simge-dugme" data-act="cogalt" data-t-etiket="form.soru.cogalt">${SIMGE.kopya}</button>
        <button type="button" class="simge-dugme" data-act="sil" data-t-etiket="form.soru.sil"${taslak.sorular.filter(x => yanitlanabilir(x) && !x.archived).length < 2 ? ' disabled' : ''}>${SIMGE.cop}</button>
        <span class="soru-ayirac" aria-hidden="true"></span>
        <label class="gf-secenek is-satir"><span>${kacis(t('form.soru.zorunlu'))}</span><input type="checkbox" role="switch" class="gf-anahtar" data-field="required"${q.required ? ' checked' : ''}></label>
      </span>
    </div>
    <div class="soru-fab"><button type="button" class="simge-dugme" data-act="araya-soru" data-t-etiket="form.soru.ekle">${SIMGE.arti}</button><button type="button" class="simge-dugme" data-act="araya-bolum" data-t-etiket="form.bolum.ekle">${SIMGE.bolum}</button></div>
  </article>`;
}

/* Yapı değişince (ekle, sil, taşı, tür, seçili kart) kartlar yeniden çizilir;
   yazarken çizilmez, yoksa imleç kaybolurdu. `odak` yeniden çizimden sonra
   seçilecek kart ve imlecin gideceği alan: [soru sırası, seçici]. */
function sorulariCiz(odak) {
  if (odak) taslak.etkin = odak[0];
  taslak.etkin = Math.min(taslak.etkin, taslak.sorular.length - 1);
  $('#soru-listesi').innerHTML = taslak.sorular.map(soruKarti).join('');
  ceviriyiUygula($('#soru-listesi'));
  if (odak) $(`#soru-listesi [data-q="${odak[0]}"] ${odak[1]}`)?.focus();
}

const kartSirasi = el => Number(el.closest('[data-q]').dataset.q);

/* Seçenek adı düzeltmeleri: { soru: { eskiAd: yeniAd } }. */
function adDegisimleri() {
  const sonuc = {};
  for (const q of taslak.sorular) {
    if (!SECIMLI.includes(q.type) || !q.kokler) continue;
    const ciftler = {};
    q.options.forEach((secenek, j) => {
      const eski = q.kokler[j], yeni = secenek.trim();
      if (eski && yeni && eski !== yeni) ciftler[eski] = yeni;
    });
    if (Object.keys(ciftler).length) sonuc[q.id] = ciftler;
  }
  return sonuc;
}

function duzenleyiciOlaylariniKur() {
  $('#duzenle-gorunum').addEventListener('click', olay => {
    const dugme = olay.target.closest('[data-duzenle-sekme]');
    if (dugme) duzenleSekmesi(dugme.dataset.duzenleSekme);
  });

  $('#duzenle-durum').addEventListener('click', async olay => {
    if (!olay.target.closest('[data-taslagaal]')) return;
    if (kirli && !confirm(t('form.onay.kaydedilmemis'))) return;
    if (!confirm(t('form.onay.taslagaAl'))) return;
    try {
      await api(`api/formlar/${taslak.id}/durum`, { method: 'PUT', body: JSON.stringify({ durum: 'taslak' }) });
      kirli = false;
      await duzenleyiciAc(taslak.id);
    } catch (hata) { $('#duzenle-hata').textContent = hata.message; }
  });

  $('#duzenle-form').addEventListener('change', olay => {
    kirli = true;
    if (olay.target.name === 'hedef-kip' || olay.target.closest('#hedef-kutular')) hedefleriEsitle();
  });
  $('#duzenle-form').addEventListener('input', () => { kirli = true; });
  $('#duzenle-form').addEventListener('submit', olay => olay.preventDefault());
  $('#duzenle-form').addEventListener('click', olay => {
    const dugme = olay.target.closest('[data-hedef]');
    if (!dugme) return;
    for (const etiket of $$('#hedef-kutular label')) etiket.querySelector('input').checked = dugme.dataset.hedef === 'hepsi';
    kirli = true; hedefleriEsitle();
  });

  $('#soru-listesi').addEventListener('input', olay => {
    const hedef = olay.target, q = taslak.sorular[kartSirasi(hedef)];
    kirli = true;
    if (hedef.dataset.option !== undefined) q.options[Number(hedef.dataset.option)] = hedef.value;
    else if (hedef.dataset.field === 'required') q.required = hedef.checked;
    else if (hedef.dataset.field && hedef.dataset.field !== 'type') q[hedef.dataset.field] = hedef.value;
  });

  $('#soru-listesi').addEventListener('change', olay => {
    const hedef = olay.target;
    if (hedef.dataset.field === 'required') { taslak.sorular[kartSirasi(hedef)].required = hedef.checked; kirli = true; }
    if (hedef.dataset.field !== 'type') return;
    const index = kartSirasi(hedef), q = taslak.sorular[index];
    q.type = hedef.value;
    /* Seçenekler tür değişince saklanır: yanlışlıkla "Kısa yanıt"a çevirip geri dönen kaybetmesin. */
    if (SECIMLI.includes(q.type) && !q.options.length) { q.options = ['']; q.kokler = [null]; }
    kirli = true;
    sorulariCiz([index, '[data-field="type"]']);
  });

  const etkinlestir = kart => sorulariCiz([Number(kart.dataset.q), '[data-field="title"]']);

  $('#soru-listesi').addEventListener('click', olay => {
    const onizleme = olay.target.closest('.is-onizleme');
    if (onizleme) return etkinlestir(onizleme);
    const dugme = olay.target.closest('[data-act]');
    if (!dugme) return;
    const index = kartSirasi(dugme), liste = taslak.sorular, q = liste[index];
    const act = dugme.dataset.act;
    kirli = true;

    if (act === 'geri-al') { q.archived = false; return sorulariCiz([index, '[data-field="title"]']); }
    if (act === 'secenek-ekle') { q.options.push(''); q.kokler.push(null); return sorulariCiz([index, `[data-option="${q.options.length - 1}"]`]); }
    if (act === 'secenek-sil') {
      const j = Number(dugme.dataset.index);
      q.options.splice(j, 1); q.kokler.splice(j, 1);
      return sorulariCiz([index, `[data-option="${Math.max(0, j - 1)}"]`]);
    }
    if (act === 'yukari' || act === 'asagi') {
      const hedefSira = act === 'yukari' ? index - 1 : index + 1;
      [liste[index], liste[hedefSira]] = [liste[hedefSira], liste[index]];
      return sorulariCiz([hedefSira, `[data-act="${act}"]:not(:disabled)`]);
    }
    if (act === 'araya-soru') { liste.splice(index + 1, 0, bosSoru(bolumMu(q) ? 'tekli' : q.type)); return sorulariCiz([index + 1, '[data-field="title"]']); }
    if (act === 'araya-bolum') { liste.splice(index + 1, 0, bosSoru('bolum')); return sorulariCiz([index + 1, '[data-field="title"]']); }
    if (act === 'cogalt') {
      liste.splice(index + 1, 0, { ...q, id: yeniId(), options: [...q.options], kokler: q.options.map(() => null) });
      return sorulariCiz([index + 1, '[data-field="title"]']);
    }
    if (act === 'sil') {
      /* Yanıt almış soru silinmez, kaldırılır: yanıtları raporda kalır, geri alınabilir. */
      if (yanitAldiMi(q)) {
        if (!confirm(t('form.onay.soruKaldir', { soru: q.title }))) return;
        q.archived = true; q.required = false;
        const sonraki = liste.findIndex((x, i) => i > index && !x.archived);
        return sorulariCiz([sonraki >= 0 ? sonraki : Math.max(0, liste.findIndex(x => !x.archived)), '[data-field="title"]']);
      }
      if (q.title && !confirm(t(bolumMu(q) ? 'form.onay.bolumSil' : 'form.onay.soruSil', { soru: q.title }))) return;
      liste.splice(index, 1);
      return sorulariCiz([Math.min(index, liste.length - 1), '[data-field="title"]']);
    }
  });

  /* Seçenek alanında Enter bir sonraki seçeneği açar; çok satırlı yapıştırma
     her satırı ayrı seçenek yapar (Excel'den ya da listeden kopyalama). */
  $('#soru-listesi').addEventListener('keydown', olay => {
    const hedef = olay.target;
    if (hedef.classList.contains('is-onizleme') && (olay.key === 'Enter' || olay.key === ' ')) {
      olay.preventDefault();
      return etkinlestir(hedef);
    }
    if (olay.key !== 'Enter' || hedef.tagName !== 'INPUT') return;
    olay.preventDefault();
    if (hedef.dataset.option === undefined) return;
    const index = kartSirasi(hedef), q = taslak.sorular[index], at = Number(hedef.dataset.option) + 1;
    q.options.splice(at, 0, '');
    q.kokler.splice(at, 0, null);
    kirli = true;
    sorulariCiz([index, `[data-option="${at}"]`]);
  });

  $('#soru-listesi').addEventListener('paste', olay => {
    const hedef = olay.target;
    if (hedef.dataset.option === undefined) return;
    const satirlar = olay.clipboardData.getData('text').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (satirlar.length < 2) return;
    olay.preventDefault();
    const index = kartSirasi(hedef), q = taslak.sorular[index], at = Number(hedef.dataset.option);
    const degistir = q.options[at] ? 0 : 1;
    q.options.splice(at, degistir, ...satirlar);
    q.kokler.splice(at, degistir, ...satirlar.map(() => null));
    kirli = true;
    sorulariCiz([index, `[data-option="${at + satirlar.length - 1}"]`]);
  });

  $('#bolum-ekle').onclick = () => {
    taslak.sorular.push(bosSoru('bolum'));
    kirli = true;
    sorulariCiz([taslak.sorular.length - 1, '[data-field="title"]']);
  };

  $('#soru-ekle').onclick = () => {
    /* Yeni soru bir öncekinin türünü alır: art arda aynı tür sorular hızlı girilsin. */
    const son = taslak.sorular.findLast(yanitlanabilir);
    taslak.sorular.push(bosSoru(son ? son.type : 'tekli'));
    kirli = true;
    sorulariCiz([taslak.sorular.length - 1, '[data-field="title"]']);
  };

  $('#kaydet-form').onclick = () => formKaydet();
  $('#yayimla-form').onclick = () => formKaydet({ yayimla: true });
  $('#onizle-form').onclick = taslagiOnizle;

  $('#sil-form').onclick = async () => {
    const baslik = $('#baslik-duzenleyici').textContent.trim();
    if (!confirm(t('form.onay.formSil', { baslik }) + (taslak.yanitSayisi ? ' ' + t('form.onay.formSilYanit', { n: taslak.yanitSayisi }) : ''))) return;
    try {
      await api('api/formlar/' + taslak.id, { method: 'DELETE' });
      kirli = false;
      bildirim = t('form.bildirim.silindi', { baslik });
      git('#');
    } catch (hata) { $('#duzenle-hata').textContent = hata.message; }
  };

  /* Kapak görseli */
  $('#duzenle-gorunum').addEventListener('click', olay => {
    const dugme = olay.target.closest('[data-gorsel]');
    if (!dugme) return;
    if (dugme.dataset.gorsel === 'sec') return $('#gorsel-girdi').click();
    const gorsel = taslak.gorsel;
    if (gorsel.url) URL.revokeObjectURL(gorsel.url);
    Object.assign(gorsel, { blob: null, url: null, kaldirildi: true });
    kirli = true; kapagiCiz();
  });

  $('#gorsel-girdi').addEventListener('change', async olay => {
    const [dosya] = olay.target.files;
    olay.target.value = '';
    if (!dosya) return;
    $('#duzenle-hata').textContent = '';
    try {
      const blob = await gorseliKucult(dosya), gorsel = taslak.gorsel;
      if (gorsel.url) URL.revokeObjectURL(gorsel.url);
      Object.assign(gorsel, { blob, url: URL.createObjectURL(blob), kaldirildi: false });
      kirli = true; kapagiCiz();
    } catch (hata) { $('#duzenle-hata').textContent = hata.message; }
  });
}

function kapagiCiz() {
  const gorsel = taslak.gorsel;
  const kaynak = gorsel.url || (gorsel.surum && !gorsel.kaldirildi ? gorselAdresi(taslak.id, gorsel.surum) : '');
  $('#duzenle-kapak').hidden = !kaynak || $('[data-duzenle-sekme="sorular"]').getAttribute('aria-pressed') !== 'true';
  if (kaynak) $('#duzenle-kapak img').src = kaynak;
  $('#kapak-ekle').hidden = !!kaynak;
}

async function kapagiKaydet() {
  const gorsel = taslak.gorsel;
  if (gorsel.blob) {
    gorsel.surum = await gorselYukle(taslak.id, gorsel.blob);
    URL.revokeObjectURL(gorsel.url);
    Object.assign(gorsel, { blob: null, url: null, kaldirildi: false });
  } else if (gorsel.kaldirildi && gorsel.surum) {
    await api(`api/formlar/${taslak.id}/gorsel`, { method: 'DELETE' });
    Object.assign(gorsel, { surum: null, kaldirildi: false });
  }
}

/* Kaydet: taslakta "Taslağı kaydet", yayında "Değişiklikleri kaydet".
   `yayimla` kaydedip formu ortaklara açar. */
async function formKaydet({ yayimla = false } = {}) {
  const form = $('#duzenle-form'), hata = $('#duzenle-hata');
  const dugme = yayimla ? $('#yayimla-form') : $('#kaydet-form');
  hata.textContent = '';

  const secili = form.querySelector('[name="hedef-kip"]:checked').value === 'secili';
  const hedef = secili ? $$('#hedef-kutular input:checked').map(g => g.value) : [];
  const baslikRich = zenginOku($('#baslik-duzenleyici'), true);
  const aciklamaRich = zenginOku($('#aciklama-duzenleyici'));

  if (!baslikRich) { hata.textContent = t('form.hata.baslikBos'); duzenleSekmesi('sorular'); return $('#baslik-duzenleyici').focus(); }
  if (secili && !hedef.length) { hata.textContent = t('form.hata.hedefBos'); return duzenleSekmesi('ayarlar'); }
  const bos = taslak.sorular.findIndex(q => yanitlanabilir(q) && !q.archived && !q.title.trim());
  if (bos >= 0) { hata.textContent = t('form.hata.soruBos', { n: bos + 1 }); duzenleSekmesi('sorular'); return sorulariCiz([bos, '[data-field="title"]']); }

  const govde = {
    baslik: $('#baslik-duzenleyici').textContent, baslikRich,
    aciklama: $('#aciklama-duzenleyici').innerText, aciklamaRich,
    sonTarih: form.elements.sonTarih.value,
    kapali: form.elements.kapali.checked,
    koordinatorDoldurur: form.elements.koordinatorDoldurur.checked,
    hedef, updated: taslak.updated,
    sorular: taslak.sorular.map(q => ({
      id: q.id, type: q.type, title: q.title, help: q.help, required: q.required,
      ...(q.archived ? { archived: true } : {}),
      ...(SECIMLI.includes(q.type) ? { options: q.options } : {}),
    })),
    renames: adDegisimleri(),
  };

  if (yayimla && !confirm(t('form.onay.yayimla', {
    baslik: govde.baslik.trim(),
    hedef: hedefMetni({ hedef, koordinatorDoldurur: govde.koordinatorDoldurur }),
  }))) return;

  dugme.disabled = true;
  try {
    const yeniMi = !taslak.id;
    const kayit = await api(yeniMi ? 'api/formlar' : 'api/formlar/' + taslak.id,
      { method: yeniMi ? 'POST' : 'PUT', body: JSON.stringify(govde) });
    /* Form kaydedildi; görsel yüklemesi başarısız olursa ikinci "Kaydet"
       aynı formu günceller, kopyasını oluşturmaz. */
    taslak.id = kayit.id; taslak.updated = kayit.updated;
    if (yeniMi) { sonHash = `#duzenle/${kayit.id}`; history.replaceState(null, '', sonHash); }
    await kapagiKaydet();
    if (yayimla) await api(`api/formlar/${taslak.id}/durum`, { method: 'PUT', body: JSON.stringify({ durum: 'yayinda' }) });
    kirli = false;
    const baslik = $('#baslik-duzenleyici').textContent.trim();
    bildirim = yayimla ? t('form.bildirim.yayimlandi', { baslik })
      : taslak.hal === 'taslak' ? t('form.bildirim.taslakKaydedildi', { baslik })
      : t('form.bildirim.guncellendi', { baslik });
    git('#');
  } catch (hataObj) { hata.textContent = hataObj.message; }
  finally { dugme.disabled = false; }
}

/* Önizle: düzenleyicideki hâli (kaydedilmemiş olsa da) ortağın göreceği
   biçimde gösterir. Adres değişmez. */
function taslagiOnizle() {
  const gorsel = taslak.gorsel;
  doldurCiz({
    id: taslak.id,
    baslik: $('#baslik-duzenleyici').textContent.trim() || t('form.basliksiz'),
    baslikRich: zenginOku($('#baslik-duzenleyici'), true),
    aciklama: $('#aciklama-duzenleyici').innerText.trim(),
    aciklamaRich: zenginOku($('#aciklama-duzenleyici')),
    sonTarih: $('#duzenle-form').elements.sonTarih.value,
    acik: true, yanitlarim: {}, gorsel: null,
    gorselKaynak: gorsel.url || (gorsel.surum && !gorsel.kaldirildi ? gorselAdresi(taslak.id, gorsel.surum) : ''),
    sorular: taslak.sorular.filter(q => !q.archived && (bolumMu(q) || q.title.trim()))
      .map(q => ({ ...q, options: (q.options || []).filter(o => o.trim()) })),
  }, true);
  $('#duzenle-gorunum').hidden = true;
  $('#doldur-gorunum').hidden = false;
  window.scrollTo(0, 0);
}

function onizlemeyiKapat() {
  $('#doldur-gorunum').hidden = true;
  $('#duzenle-gorunum').hidden = false;
  bas(taslak.id ? t('form.duzenle.ustbaslik') : t('form.yeni.ustbaslik'),
    $('#baslik-duzenleyici').textContent.trim() || t('form.yeni'));
  window.scrollTo(0, 0);
}

/* ---- Doldurma / önizleme --------------------------------------------------
   `sayfalar`: bölümlere göre sayfalar; `dosyalar`: dosya sorularının o anki
   listesi (soru kimliği → [{ id, ad, boyut }]). */
let dolduruluyor = null, sayfalar = [], sayfa = 0, dosyalar = {}, gonderebilir = false;

function doldurSorusu(q, yanit, kapali) {
  const ad = `q-${q.id}`, kapat = kapali ? ' disabled' : '';
  const zorunlu = q.required ? ` <b class="zorunlu" title="${kacis(t('form.soru.zorunlu'))}">*</b>` : '';
  let alan;

  if (q.type === 'kisa') alan = `<input name="${ad}" maxlength="500" placeholder="${kacis(t('form.yanitiniz.placeholder'))}" value="${kacis(yanit ?? '')}"${kapat}>`;
  else if (q.type === 'paragraf') alan = `<textarea name="${ad}" rows="2" maxlength="5000" placeholder="${kacis(t('form.yanitiniz.placeholder'))}"${kapat}>${kacis(yanit ?? '')}</textarea>`;
  else if (q.type === 'sayi') alan = `<input name="${ad}" inputmode="decimal" placeholder="${kacis(t('form.yanitiniz.placeholder'))}" value="${kacis(yanit ?? '')}"${kapat} class="doldur-dar">`;
  else if (q.type === 'tarih') alan = `<input name="${ad}" type="date" min="1900-01-01" max="2099-12-31" value="${kacis(yanit ?? '')}"${kapat} class="doldur-dar">`;
  else if (q.type === 'liste') alan = `<select name="${ad}"${kapat} class="doldur-dar"><option value="">${kacis(t('form.secin'))}</option>${q.options.map(o => `<option${o === yanit ? ' selected' : ''}>${kacis(o)}</option>`).join('')}</select>`;
  else if (q.type === 'dosya') {
    dosyalar[q.id] = Array.isArray(yanit) ? yanit.filter(d => d && d.id) : [];
    alan = `<div class="dosya-alan" data-dosya="${q.id}"><ul class="dosya-liste"></ul>${kapali
      ? (dosyalar[q.id].length ? '' : `<small class="soluk">${kacis(t('form.dosya.alan'))}</small>`)
      : `<label class="dugme dugme-ikincil dosya-sec">${SIMGE.dosya}<span>${kacis(t('form.dosya.ekle'))}</span><input type="file" multiple accept="${DOSYA_KABUL}" data-yukle="${q.id}" class="gorsel-gizli"></label>
         <small class="soluk">${kacis(t('form.dosya.ipucu', { n: MAX_DOSYA, mb: MAX_DOSYA_MB }))}</small>`}</div>`;
  } else {
    const secili = q.type === 'coklu' ? (Array.isArray(yanit) ? yanit : []) : [yanit];
    alan = `<div class="doldur-secenekler">${q.options.map(o =>
      `<label class="doldur-secenek"><input type="${q.type === 'coklu' ? 'checkbox' : 'radio'}" name="${ad}" value="${kacis(o)}"${secili.includes(o) ? ' checked' : ''}${kapat}> <span>${kacis(o)}</span></label>`).join('')}</div>`
      + (q.type === 'tekli' && !q.required && !kapali ? `<button type="button" class="metin-bag" data-temizle="${ad}">${kacis(t('form.secimiTemizle'))}</button>` : '');
  }

  return `<fieldset class="fp-kart doldur-soru is-${q.type}" data-id="${q.id}">
    <legend>${kacis(q.title)}${zorunlu}</legend>
    ${q.help ? `<p class="doldur-yardim">${kacis(q.help)}</p>` : ''}
    ${alan}
    <p class="doldur-hata" role="alert" hidden></p>
  </fieldset>`;
}

function dosyalariCiz(id) {
  const liste = $(`#doldur-form [data-dosya="${id}"] .dosya-liste`);
  if (!liste) return;
  liste.innerHTML = dosyalar[id].map((d, i) =>
    `<li>${SIMGE.dosya}<a href="api/formlar/${dolduruluyor.id}/dosya/${d.id}" download>${kacis(d.ad)}</a><small>${kacis(boyutMetni(d.boyut))}</small>${
      gonderebilir ? `<button type="button" class="simge-dugme" data-dosya-sil="${id}" data-index="${i}" aria-label="${kacis(t('form.dosya.kaldir'))}">${SIMGE.kapat}</button>` : ''}</li>`).join('');
  const sec = $(`#doldur-form [data-dosya="${id}"] .dosya-sec`);
  if (sec) sec.hidden = dosyalar[id].length >= MAX_DOSYA;
}

/* Form bölümlerden sayfalara ayrılır; bölümle başlamayan ilk kısım 1. sayfadır. */
function sayfalaraAyir(sorular) {
  const sonuc = [];
  for (const q of sorular) {
    if (bolumMu(q) || !sonuc.length) sonuc.push({ bolum: bolumMu(q) ? q : null, sorular: [] });
    if (!bolumMu(q)) sonuc.at(-1).sorular.push(q);
  }
  return sonuc.length ? sonuc : [{ bolum: null, sorular: [] }];
}

async function doldurAc(id) {
  const f = await api('api/formlar/' + id);
  /* Kaldırılmış sorular doldurma ekranında yok (koordinatöre de gelir, burada atılır). */
  f.sorular = f.sorular.filter(q => !q.archived);
  doldurCiz(f);
}

/* `taslakOnizleme`: düzenleyicideki kaydedilmemiş taslağın önizlemesi.
   Sunucuya bir şey gönderilmez; yanıtlar denenebilir ama kaydedilmez. */
function doldurCiz(f, taslakOnizleme = false) {
  dolduruluyor = f; dosyalar = {}; sayfa = 0;
  const onizleme = taslakOnizleme || !f.doldurur;
  gonderebilir = !onizleme && f.acik;
  bas(onizleme ? t('form.onizleme') : t('form.sayfa.baslik'), f.baslik);

  /* Gönderilmemiş taslak, gönderilmiş yanıttan yeniyse o yüklenir. */
  const taslakKullan = gonderebilir && f.taslak && (!f.yanitladi || f.taslak.updated > f.yanitladi);
  const yanitlar = (taslakKullan ? f.taslak.yanitlar : f.yanitlarim) || {};

  const notlar = [];
  if (taslakOnizleme) notlar.push(t('form.not.onizlemeTaslak'));
  else if (f.hal === 'taslak') notlar.push(t('form.not.taslakForm'));
  else if (onizleme) notlar.push(t('form.not.doldurulamaz'));
  else if (f.yanitladi) notlar.push(t('form.not.yanitKaydedildi', { zaman: damga(f.yanitladi) })
    + ' ' + t(f.acik ? 'form.not.degistirebilirsiniz' : 'form.not.degistirilemez'));
  else if (!f.acik) notlar.push(t('form.not.kapali'));
  if (f.acik && f.sonTarih) notlar.push(t('form.not.sonTarih', { gun: gunEtiketi(f.sonTarih) }));

  const zorunluVar = f.sorular.some(q => q.required);
  sayfalar = sayfalaraAyir(f.sorular);

  $('#doldur-form').innerHTML = (taslakOnizleme
      ? `<p class="fp-not">${kacis(t('form.not.onizlemeBicim'))} <button type="button" class="metin-bag" data-duzenlemeye-don>${kacis(t('form.duzenlemeyeDon'))}</button></p>`
      : koordinator ? `<p class="fp-not">${kacis(onizleme ? t('form.not.onizlemeBicim') : t('form.not.koordinatorDolduruyor'))} <a class="metin-bag" href="#duzenle/${f.id}">${kacis(t('form.formuDuzenle'))}</a></p>` : '')
    + (taslakKullan ? `<p class="fp-not fp-bildirim">${kacis(t('form.not.taslakVar', { zaman: damga(f.taslak.updated) }))} <button type="button" class="metin-bag" data-taslak-sil>${kacis(t('form.taslagiSil'))}</button></p>` : '')
    + (f.gorselKaynak || f.gorsel ? `<div class="gf-kapak"><img src="${f.gorselKaynak || gorselAdresi(f.id, f.gorsel)}" alt="${kacis(t('form.kapak.alt'))}"></div>` : '')
    + `<header class="fp-kart gf-bas">
        <h1 class="gf-form-baslik">${zenginHtml(f.baslikRich, f.baslik, true)}</h1>
        ${f.aciklama ? `<div class="gf-form-aciklama">${zenginHtml(f.aciklamaRich, f.aciklama)}</div>` : ''}
        ${notlar.length || zorunluVar ? `<div class="gf-bas-alt">${notlar.map(n => `<p>${kacis(n)}</p>`).join('')}${zorunluVar ? `<p class="zorunlu">${kacis(t('form.zorunluIsaret'))}</p>` : ''}</div>` : ''}
      </header>`
    + sayfalar.map((p, i) => `<div class="doldur-sayfa" data-sayfa="${i}"${i ? ' hidden' : ''}>
        ${p.bolum ? `<div class="fp-kart doldur-bolum">${sayfalar.length > 1 ? `<span class="bolum-etiket">${kacis(t('form.bolum.no', { n: i + 1, toplam: sayfalar.length }))}</span>` : ''}${p.bolum.title ? `<h2>${kacis(p.bolum.title)}</h2>` : ''}${p.bolum.help ? `<p class="doldur-yardim">${kacis(p.bolum.help)}</p>` : ''}</div>` : ''}
        ${p.sorular.map(q => doldurSorusu(q, yanitlar[q.id], taslakOnizleme ? q.type === 'dosya' : !gonderebilir)).join('')}
      </div>`).join('')
    + `<div class="fp-eylem gf-doldur-eylem">
        <p class="hata" role="alert"></p>
        <button type="button" class="dugme dugme-ikincil" data-adim="-1">${kacis(t('form.geri'))}</button>
        <button type="button" class="dugme dugme-birincil" data-adim="1">${kacis(t('form.ileri'))}</button>
        ${gonderebilir ? `<button class="dugme dugme-birincil" type="submit">${kacis(f.yanitladi ? t('form.guncelle') : t('form.gonder'))}</button>` : ''}
        <span class="sayfa-ilerleme"><span class="sayfa-cubuk"><i></i></span><small></small></span>
        <span class="doldur-son">${taslakOnizleme
          ? `<button type="button" class="dugme dugme-ikincil" data-duzenlemeye-don>${kacis(t('form.duzenlemeyeDon'))}</button>`
          : gonderebilir
            ? `<small class="taslak-durum" aria-live="polite"></small><button type="button" class="metin-bag" data-hepsini-temizle>${kacis(t('form.formuTemizle'))}</button>`
            : `<a class="metin-bag" href="#">${kacis(t('form.formlaraDon'))}</a>`}</span>
      </div>`;

  for (const q of f.sorular) if (q.type === 'dosya') dosyalariCiz(q.id);
  sayfaGoster(0, false);
  $('#doldur-gorunum').hidden = false;
}

function sayfaGoster(index, kaydir = true) {
  sayfa = index;
  for (const el of $$('#doldur-form .doldur-sayfa')) el.hidden = Number(el.dataset.sayfa) !== index;
  const son = index === sayfalar.length - 1, coklu = sayfalar.length > 1;
  $('#doldur-form [data-adim="-1"]').hidden = index === 0;
  $('#doldur-form [data-adim="1"]').hidden = son;
  const gonder = $('#doldur-form [type="submit"]');
  if (gonder) gonder.hidden = !son;
  $('#doldur-form .sayfa-ilerleme').hidden = !coklu;
  $('#doldur-form .sayfa-ilerleme small').textContent = t('form.sayfaNo', { n: index + 1, toplam: sayfalar.length });
  $('#doldur-form .sayfa-cubuk i').style.width = `${((index + 1) / sayfalar.length) * 100}%`;
  $('#doldur-form .fp-eylem .hata').textContent = '';
  if (kaydir) $('#doldur-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Yanıtları formdan okur. `denetle` açıkken verilen sorularda zorunluluk ve
 * sayı biçimi denetlenir, hatalı kart işaretlenir; ilk hatalı kart döner.
 */
function yanitlariOku(sorular, denetle) {
  const form = $('#doldur-form'), veri = new FormData(form), yanitlar = {};
  let ilkHata = null;

  for (const q of sorular.filter(yanitlanabilir)) {
    const ad = `q-${q.id}`;
    const deger = q.type === 'dosya' ? (dosyalar[q.id] || []).map(d => d.id)
      : q.type === 'coklu' ? veri.getAll(ad)
      : String(veri.get(ad) ?? '').trim();
    const bos = Array.isArray(deger) ? !deger.length : !deger;

    if (denetle) {
      const kutu = form.querySelector(`[data-id="${q.id}"]`), not = kutu.querySelector('.doldur-hata');
      let sorun = q.required && bos ? (q.type === 'dosya' ? t('form.hata.dosyaGerekli') : t('form.hata.zorunluAlan')) : '';
      if (!sorun && q.type === 'sayi' && !bos && !Number.isFinite(Number(deger.replace(',', '.')))) sorun = t('form.hata.gecerliSayi');
      not.textContent = sorun; not.hidden = !sorun;
      kutu.classList.toggle('hatali', !!sorun);
      if (sorun && !ilkHata) ilkHata = kutu;
    }
    if (!bos) yanitlar[q.id] = deger;
  }
  return { yanitlar, ilkHata };
}

function sorunuGoster(kutu) {
  $('#doldur-form .fp-eylem .hata').textContent = t('form.hata.eksikYanit');
  kutu.scrollIntoView({ behavior: 'smooth', block: 'center' });
  kutu.querySelector('input, textarea, select')?.focus({ preventScroll: true });
}

/* İleri: yalnızca bu sayfanın soruları denetlenir. */
function adim(fark) {
  if (fark > 0) {
    const { ilkHata } = yanitlariOku(sayfalar[sayfa].sorular, gonderebilir);
    if (ilkHata) return sorunuGoster(ilkHata);
  }
  sayfaGoster(Math.min(Math.max(sayfa + fark, 0), sayfalar.length - 1));
}

/* ---- Taslak: yazdıkça birkaç saniyede bir sunucuya kaydedilir ------------- */
const TASLAK_GECIKME = 2000;
let taslakZamanlayici = null;
const taslakDurumu = metin => { const el = $('#doldur-form .taslak-durum'); if (el) el.textContent = metin; };

function taslagiPlanla() {
  if (!gonderebilir) return;
  clearTimeout(taslakZamanlayici);
  taslakDurumu(t('form.taslak.kaydedilmemis'));
  taslakZamanlayici = setTimeout(taslagiKaydet, TASLAK_GECIKME);
}

async function taslagiKaydet({ keepalive = false } = {}) {
  clearTimeout(taslakZamanlayici); taslakZamanlayici = null;
  if (!gonderebilir || !dolduruluyor) return;
  const { yanitlar } = yanitlariOku(dolduruluyor.sorular, false);
  try {
    taslakDurumu(t('form.taslak.kaydediliyor'));
    const kayit = await api(`api/formlar/${dolduruluyor.id}/taslak`, { method: 'PUT', body: JSON.stringify({ yanitlar }), keepalive });
    taslakDurumu(t('form.taslak.kaydedildi', { saat: saatBicim.format(new Date(kayit.updated)) }));
  } catch { taslakDurumu(t('form.taslak.kaydedilemedi')); }
}

/* Sayfadan çıkarken bekleyen taslak kaybolmasın. */
const taslagiBosalt = () => { if (taslakZamanlayici) taslagiKaydet({ keepalive: true }); };

function doldurOlaylariniKur() {
  window.addEventListener('pagehide', taslagiBosalt);
  window.addEventListener('hashchange', taslagiBosalt);
  $('#doldur-form').addEventListener('input', taslagiPlanla);
  $('#doldur-form').addEventListener('change', olay => { if (!olay.target.dataset.yukle) taslagiPlanla(); });

  /* Dosya yükleme */
  $('#doldur-form').addEventListener('change', async olay => {
    const girdi = olay.target;
    if (!girdi.dataset.yukle) return;
    const id = girdi.dataset.yukle, secilenler = [...girdi.files];
    const kutu = girdi.closest('.doldur-soru'), not = kutu.querySelector('.doldur-hata');
    girdi.value = '';
    not.hidden = true;
    const etiket = girdi.closest('.dosya-sec').querySelector('span');

    for (const dosya of secilenler) {
      if (dosyalar[id].length >= MAX_DOSYA) { not.textContent = t('form.hata.cokDosya2', { n: MAX_DOSYA }); not.hidden = false; break; }
      if (dosya.size > MAX_DOSYA_MB * 1024 * 1024) { not.textContent = t('form.hata.dosyaBuyuk', { ad: dosya.name, mb: MAX_DOSYA_MB }); not.hidden = false; continue; }
      etiket.textContent = t('form.dosya.yukleniyor', { ad: dosya.name });
      try {
        const yanit = await fetch(`api/formlar/${dolduruluyor.id}/dosya?soru=${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(dosya.name) },
          body: dosya,
        });
        const veri = await yanit.json().catch(() => ({}));
        if (!yanit.ok) throw Error(durum.sozluk[veri.error] || veri.error || t('form.hata.dosyaYuklenemedi'));
        dosyalar[id].push(veri);
        dosyalariCiz(id);
        kutu.classList.remove('hatali');
      } catch (hata) { not.textContent = hata.message; not.hidden = false; }
    }
    etiket.textContent = t('form.dosya.ekle');
    taslagiPlanla();
  });

  $('#doldur-form').addEventListener('click', async olay => {
    const hedef = olay.target;
    if (hedef.closest('[data-duzenlemeye-don]')) return onizlemeyiKapat();

    const adimDugme = hedef.closest('[data-adim]');
    if (adimDugme) return adim(Number(adimDugme.dataset.adim));

    const kaldir = hedef.closest('[data-dosya-sil]');
    if (kaldir) {
      dosyalar[kaldir.dataset.dosyaSil].splice(Number(kaldir.dataset.index), 1);
      dosyalariCiz(kaldir.dataset.dosyaSil);
      return taslagiPlanla();
    }

    if (hedef.closest('[data-taslak-sil]')) {
      if (!confirm(t('form.onay.taslakSil'))) return;
      clearTimeout(taslakZamanlayici); taslakZamanlayici = null;
      try { await api(`api/formlar/${dolduruluyor.id}/taslak`, { method: 'DELETE' }); await doldurAc(dolduruluyor.id); }
      catch (hata) { $('#doldur-form .fp-eylem .hata').textContent = hata.message; }
      return;
    }

    if (hedef.closest('[data-hepsini-temizle]')) {
      if (!confirm(t('form.onay.formuTemizle'))) return;
      for (const girdi of $$('#doldur-form input, #doldur-form textarea, #doldur-form select')) {
        if (girdi.type === 'checkbox' || girdi.type === 'radio') girdi.checked = false;
        else if (girdi.type !== 'file') girdi.value = '';
      }
      for (const id of Object.keys(dosyalar)) { dosyalar[id] = []; dosyalariCiz(id); }
      sayfaGoster(0);
      return taslagiPlanla();
    }

    const temizle = hedef.closest('[data-temizle]');
    if (!temizle) return;
    for (const girdi of $$(`#doldur-form [name="${temizle.dataset.temizle}"]`)) girdi.checked = false;
    taslagiPlanla();
  });

  $('#doldur-form').addEventListener('submit', async olay => {
    olay.preventDefault();
    /* Ara sayfada Enter "İleri" demektir. */
    if (sayfa < sayfalar.length - 1) return adim(1);
    if (!gonderebilir) return;

    const { yanitlar, ilkHata } = yanitlariOku(dolduruluyor.sorular, true);
    if (ilkHata) {
      /* Hatalı soru başka sayfadaysa oraya dönülür. */
      sayfaGoster(Number(ilkHata.closest('.doldur-sayfa').dataset.sayfa), false);
      return sorunuGoster(ilkHata);
    }

    const hata = $('#doldur-form .fp-eylem .hata'), dugme = $('#doldur-form [type="submit"]');
    hata.textContent = '';
    dugme.disabled = true;
    clearTimeout(taslakZamanlayici); taslakZamanlayici = null;
    try {
      const kayit = await api(`api/formlar/${dolduruluyor.id}/yanit`, { method: 'PUT', body: JSON.stringify({ yanitlar }) });
      dolduruluyor.yanitladi = kayit.yanitladi;
      bildirim = t('form.bildirim.yanitKaydedildi', { baslik: dolduruluyor.baslik });
      git('#');
    } catch (hataObj) { hata.textContent = hataObj.message; dugme.disabled = false; }
  });
}

/* ---- Yanıtlar (koordinatör) ----------------------------------------------- */
const degerMetni = deger => (Array.isArray(deger)
  ? deger.map(x => (x && typeof x === 'object' ? x.ad : x)).join(', ')
  : typeof deger === 'number' ? sayi(deger)
  : /^\d{4}-\d{2}-\d{2}$/.test(deger ?? '') ? gunEtiketi(deger)
  : String(deger ?? ''));
const kim = r => `${ortakKisa(r.partner)} · ${r.ad}`;

async function sonuclariAc(id) {
  sonuclar = await api(`api/formlar/${id}/yanitlar`);
  const { form, yanitlar, bekleyen } = sonuclar;
  bas(t('form.sekme.yanitlar'), form.baslik);
  $('#yanit-sayisi').textContent = t('form.yanitSayisi', { n: yanitlar.length });
  $('#yanit-giris').textContent = `${form.baslik} · ${t('form.bekleyenSayisi', { n: bekleyen.length })} · ${
    form.acik ? (form.sonTarih ? t('form.sonGun', { gun: gunEtiketi(form.sonTarih) }) : t('form.yanitAliyor')) : t('form.yanitKapali')}`;
  $('#yanitlar-ayarlar').href = `#duzenle/${id}/ayarlar`;
  $('#yanit-excel').href = `api/formlar/${id}/yanitlar?bicim=xlsx`;
  $('#yanitlar-duzenle').href = `#duzenle/${id}`;
  $('#bekleyen-sayi').textContent = `(${bekleyen.length})`;
  ozetCiz(); tabloCiz(); bekleyenleriCiz();
  $('#yanitlar-gorunum').hidden = false;
}

/* ---- Özet grafikleri -----------------------------------------------------
   Google Formlar gibi: tek seçimli soruda pasta, çok seçimlide sütun
   grafiği. Renk seçeneğe bağlıdır (formdaki sırası), sayıya göre değişmez.
   Sekiz renkten fazla seçenek pastada okunmaz: o zaman yatay çubuk listesi. */
const SERI = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const PASTA_MAKS = SERI.length, SUTUN_MAKS = 10;
const yuzde = (n, toplam) => (toplam ? Math.round((n / toplam) * 1000) / 10 : 0);
const yuzdeMetni = deger => t('form.yuzde', { n: sayi(deger) });

function secimSayilari(q, verilenler) {
  const sayilar = new Map(q.options.map(o => [o, 0]));
  for (const r of verilenler) for (const deger of [r.yanitlar[q.id]].flat()) sayilar.set(deger, (sayilar.get(deger) || 0) + 1);
  return [...sayilar].map(([secenek, n]) => ({ secenek, n, eski: !q.options.includes(secenek) }));
}
const secenekEtiketi = satir => `${kacis(satir.secenek)}${satir.eski ? ` <small class="soluk">${kacis(t('form.eskiSecenek'))}</small>` : ''}`;

function pastaGrafik(satirlar, toplam) {
  const cx = 100, cy = 100, r = 96;
  let aci = -Math.PI / 2;
  const dilimler = satirlar.map((satir, i) => {
    const renk = SERI[i], ipucu = `${satir.secenek}: ${satir.n} (${yuzdeMetni(yuzde(satir.n, toplam))})`;
    if (!satir.n) return '';
    if (satir.n === toplam) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${renk}"><title>${kacis(ipucu)}</title></circle>`;
    const son = aci + (satir.n / toplam) * Math.PI * 2;
    const [x1, y1, x2, y2] = [cx + r * Math.cos(aci), cy + r * Math.sin(aci), cx + r * Math.cos(son), cy + r * Math.sin(son)];
    const d = `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${son - aci > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
    aci = son;
    return `<path d="${d}" fill="${renk}"><title>${kacis(ipucu)}</title></path>`;
  }).join('');
  /* Lejant aynı zamanda tablo: renk tek başına kimlik taşımasın diye ad, sayı ve yüzde yazılı. */
  const lejant = satirlar.map((satir, i) =>
    `<li><i class="renk" data-renk="${SERI[i]}"></i><span>${secenekEtiketi(satir)}</span><b>${satir.n}</b><small>${kacis(yuzdeMetni(yuzde(satir.n, toplam)))}</small></li>`).join('');
  return `<div class="pasta-grafik"><svg viewBox="0 0 200 200" role="img">${dilimler}</svg><ul class="grafik-lejant">${lejant}</ul></div>`;
}

function sutunGrafik(satirlar, toplam) {
  const maks = Math.max(1, ...satirlar.map(s => s.n));
  const sutunlar = satirlar.map(satir => `<div class="sutun" title="${kacis(`${satir.secenek}: ${satir.n} (${yuzdeMetni(yuzde(satir.n, toplam))})`)}">
      <b>${satir.n}<small>${kacis(yuzdeMetni(yuzde(satir.n, toplam)))}</small></b>
      <span class="sutun-ray"><i data-yukseklik="${(satir.n / maks) * 100}"></i></span>
      <span class="sutun-etiket">${secenekEtiketi(satir)}</span>
    </div>`).join('');
  return `<div class="sutun-grafik" data-adet="${satirlar.length}">${sutunlar}</div>`;
}

function cubukListe(satirlar, toplam) {
  const maks = Math.max(1, ...satirlar.map(s => s.n));
  return `<div class="cubuk-liste">${satirlar.map(satir =>
    `<div class="cubuk-satir"><span class="cubuk-etiket">${secenekEtiketi(satir)}</span><span class="cubuk"><i data-genislik="${(satir.n / maks) * 100}"></i></span><b>${satir.n}</b><small>${kacis(yuzdeMetni(yuzde(satir.n, toplam)))}</small></div>`).join('')}</div>`;
}

/* "Kimler yanıt verdi?": yanıt sırasıyla kurum, ad ve zaman. */
function yanitlayanlarKarti(yanitlar) {
  const satirlar = [...yanitlar].sort((a, b) => a.updated.localeCompare(b.updated));
  return `<section class="fp-kart ozet-kart"><h3>${kacis(t('form.kimlerYanitladi'))}</h3><p class="soluk">${kacis(t('form.kisiSayisi', { n: yanitlar.length }))}</p>
    <ul class="metin-yanitlar yanitlayanlar">${satirlar.map(r => `<li><span>${kacis(kim(r))}</span><small>${kacis(damga(r.updated))}</small></li>`).join('')}</ul></section>`;
}

function ozetCiz() {
  const { form, yanitlar } = sonuclar;
  if (!yanitlar.length) { $('#yanit-ozet').innerHTML = `<p class="bos-durum">${kacis(t('form.yanitYok'))}</p>`; return; }

  $('#yanit-ozet').innerHTML = yanitlayanlarKarti(yanitlar) + form.sorular.filter(yanitlanabilir).map(q => {
    const verilenler = yanitlar.filter(r => r.yanitlar[q.id] !== undefined);
    let govde;
    if (SECIMLI.includes(q.type)) {
      const satirlar = secimSayilari(q, verilenler);
      /* Tek seçimde yüzdeler toplam seçim, çok seçimde yanıt veren kişi sayısına göre. */
      if (q.type !== 'coklu' && satirlar.length <= PASTA_MAKS && verilenler.length) govde = pastaGrafik(satirlar, verilenler.length);
      else if (q.type === 'coklu' && satirlar.length <= SUTUN_MAKS) govde = sutunGrafik(satirlar, verilenler.length);
      else govde = cubukListe(satirlar, verilenler.length);
    } else if (q.type === 'sayi') {
      const degerler = verilenler.map(r => r.yanitlar[q.id]).filter(Number.isFinite);
      const toplam = degerler.reduce((a, b) => a + b, 0);
      govde = degerler.length
        ? `<dl class="sayi-istatistik">${[
            [t('form.sayi.toplam'), toplam], [t('form.sayi.ortalama'), toplam / degerler.length],
            [t('form.sayi.enAz'), Math.min(...degerler)], [t('form.sayi.enCok'), Math.max(...degerler)],
          ].map(([etiket, deger]) => `<div><dt>${kacis(etiket)}</dt><dd>${kacis(sayi(deger))}</dd></div>`).join('')}</dl>` + metinListesi(q, verilenler)
        : '';
    } else govde = metinListesi(q, verilenler);

    return `<section class="fp-kart ozet-kart${q.archived ? ' is-kaldirildi' : ''}"><h3>${kacis(q.title)}${q.archived ? ` <small class="soluk">${kacis(t('form.kaldirildiEki'))}</small>` : ''}</h3>
      <p class="soluk">${kacis(t('form.nYanit', { n: verilenler.length }))}${q.type === 'coklu' ? ' · ' + kacis(t('form.coklu.not')) : ''}</p>
      ${govde || `<p class="soluk">${kacis(t('form.soruYanitsiz'))}</p>`}</section>`;
  }).join('');

  /* CSP satır içi stile izin vermiyor: çubuk boyu ve lejant rengi betikle verilir. */
  for (const c of $$('#yanit-ozet [data-genislik]')) c.style.width = c.dataset.genislik + '%';
  for (const c of $$('#yanit-ozet [data-yukseklik]')) c.style.height = c.dataset.yukseklik + '%';
  for (const c of $$('#yanit-ozet [data-renk]')) c.style.background = c.dataset.renk;
}

/* Yanıt hücresi: dosya sorusunda indirme bağlantıları, ötekilerde düz metin. */
const yanitHtml = (q, deger) => (q.type === 'dosya' && Array.isArray(deger)
  ? deger.map(d => `<a class="dosya-bag" href="api/formlar/${sonuclar.form.id}/dosya/${d.id}" download>${kacis(d.ad)}</a>`).join('<br>')
  : kacis(degerMetni(deger)));

function metinListesi(q, verilenler) {
  if (!verilenler.length) return '';
  const satirlar = [...verilenler].sort((a, b) => siralayici.compare(a.partner, b.partner));
  const oge = r => `<li><small>${kacis(kim(r))}</small>${yanitHtml(q, r.yanitlar[q.id])}</li>`;
  const dahaCok = satirlar.length > METIN_LISTE_SINIRI
    ? `<button type="button" class="metin-bag" data-daha="${q.id}">${kacis(t('form.tumunuGoster', { n: satirlar.length }))}</button>` : '';
  return `<ul class="metin-yanitlar" data-liste="${q.id}">${satirlar.slice(0, METIN_LISTE_SINIRI).map(oge).join('')}</ul>${dahaCok}`;
}

function tabloCiz() {
  const { form, yanitlar } = sonuclar;
  if (!yanitlar.length) { $('#yanit-tablo').innerHTML = `<p class="bos-durum">${kacis(t('form.yanitYok'))}</p>`; return; }
  const satirlar = [...yanitlar].sort((a, b) => siralayici.compare(a.partner, b.partner));
  const sorular = form.sorular.filter(yanitlanabilir);
  $('#yanit-tablo').innerHTML = `<div class="tablo-kaydir"><table class="yanit-tablo">
    <thead><tr><th>${kacis(t('takvim.filtre.ortak'))}</th><th>${kacis(t('form.sutun.kisi'))}</th><th>${kacis(t('form.sutun.zaman'))}</th>${
      sorular.map(q => `<th>${kacis(q.title)}${q.archived ? ` <small>${kacis(t('form.kaldirildiEki'))}</small>` : ''}</th>`).join('')}<th><span class="gorsel-gizli">${kacis(t('genel.sil'))}</span></th></tr></thead>
    <tbody>${satirlar.map(r => `<tr><td>${kacis(ortakAdi(r.partner))}</td><td>${kacis(r.ad)}</td><td class="sarmasiz">${kacis(damga(r.updated))}</td>${
      sorular.map(q => `<td>${yanitHtml(q, r.yanitlar[q.id])}</td>`).join('')}<td><button type="button" class="metin-bag is-tehlike" data-sil="${r.id}" data-ad="${kacis(kim(r))}">${kacis(t('genel.sil'))}</button></td></tr>`).join('')}</tbody>
  </table></div>`;
}

function bekleyenleriCiz() {
  const { bekleyen, hesapsiz, form } = sonuclar;
  const hatirlat = form.acik && bekleyen.length
    ? `<div class="fp-satir hatirlat-cubuk"><button type="button" class="dugme dugme-birincil" data-hatirlat="hepsi">${kacis(t('form.hatirlat.hepsi', { n: bekleyen.length }))}</button><small class="soluk">${kacis(t('form.hatirlat.ipucu'))}</small></div>`
    : '';
  const liste = bekleyen.length
    ? `<ul class="bekleyen-liste">${bekleyen.map(p => `<li><span><strong>${kacis(ortakKisa(p.partner))}</strong> ${kacis(p.ad)}${
        p.hatirlatildi ? `<small class="soluk hatirlatildi">${kacis(t('form.hatirlatildiZaman', { zaman: damga(p.hatirlatildi) }))}</small>` : ''}</span>${
        form.acik ? `<button type="button" class="metin-bag" data-hatirlat="${p.id}">${kacis(p.hatirlatildi ? t('form.hatirlat.yeniden') : t('form.hatirlat.tek'))}</button>` : ''}</li>`).join('')}</ul>`
    : `<p class="bos-durum">${kacis(t('form.herkesYanitladi'))}</p>`;
  const eksik = hesapsiz.length
    ? `<p class="fp-not">${kacis(t('form.hesapsizKurum', { n: hesapsiz.length, kurumlar: hesapsiz.map(ortakAdi).join(', ') }))}</p>` : '';
  $('#yanit-bekleyen').innerHTML = `<section class="fp-kart"><h3>${kacis(t('form.bekleyenBaslik', { n: bekleyen.length }))}</h3>${
    form.acik ? hatirlat : `<p class="soluk">${kacis(t('form.bekleyen.kapali'))}</p>`}${liste}</section>${eksik}`;
}

function yanitSekmesi(sekme) {
  for (const dugme of $$('#yanitlar-gorunum [data-sekme]')) dugme.setAttribute('aria-pressed', String(dugme.dataset.sekme === sekme));
  $('#yanit-ozet').hidden = sekme !== 'ozet';
  $('#yanit-tablo').hidden = sekme !== 'tablo';
  $('#yanit-bekleyen').hidden = sekme !== 'bekleyen';
}

function sonucOlaylariniKur() {
  $('#yanitlar-gorunum').addEventListener('click', olay => {
    const dugme = olay.target.closest('[data-sekme]');
    if (dugme) yanitSekmesi(dugme.dataset.sekme);
  });

  $('#yanit-ozet').addEventListener('click', olay => {
    const dugme = olay.target.closest('[data-daha]');
    if (!dugme) return;
    const q = sonuclar.form.sorular.find(x => x.id === dugme.dataset.daha);
    const verilenler = sonuclar.yanitlar.filter(r => r.yanitlar[q.id] !== undefined)
      .sort((a, b) => siralayici.compare(a.partner, b.partner));
    $(`#yanit-ozet [data-liste="${q.id}"]`).innerHTML = verilenler.map(r =>
      `<li><small>${kacis(kim(r))}</small>${yanitHtml(q, r.yanitlar[q.id])}</li>`).join('');
    dugme.remove();
  });

  $('#yanit-tablo').addEventListener('click', async olay => {
    const dugme = olay.target.closest('[data-sil]');
    if (!dugme || !confirm(t('form.onay.yanitSil', { kim: dugme.dataset.ad }))) return;
    try {
      await api(`api/formlar/${sonuclar.form.id}/yanitlar/${dugme.dataset.sil}`, { method: 'DELETE' });
      await sonuclariAc(sonuclar.form.id);
      yanitSekmesi('tablo');
    } catch (hata) { $('#sayfa-hata').textContent = hata.message; }
  });

  $('#yanit-bekleyen').addEventListener('click', async olay => {
    const dugme = olay.target.closest('[data-hatirlat]');
    if (!dugme) return;
    const hepsi = dugme.dataset.hatirlat === 'hepsi';
    if (hepsi && !confirm(t('form.onay.hatirlat', { n: sonuclar.bekleyen.length }))) return;
    dugme.disabled = true;
    try {
      const gonderildi = await api(`api/formlar/${sonuclar.form.id}/hatirlat`,
        { method: 'POST', body: JSON.stringify(hepsi ? {} : { kisiler: [Number(dugme.dataset.hatirlat)] }) });
      await sonuclariAc(sonuclar.form.id);
      yanitSekmesi('bekleyen');
      bildirimGoster(t('form.bildirim.hatirlatildi', { n: gonderildi.sayi }), '#yanit-bekleyen');
    } catch (hata) { $('#sayfa-hata').textContent = hata.message; dugme.disabled = false; }
  });
}

/* ---- Başlangıç ------------------------------------------------------------ */
(async () => {
  try {
    await baslat();
    ceviriyiUygula();

    if (!durum.kullanici) {
      document.body.classList.remove('gf-modu');
      bas(t('form.sayfa.ustbaslik'), t('form.sayfa.baslik'));
      $('#liste-gorunum').hidden = false;
      $('#form-listesi').innerHTML = `<p class="bos-durum">${kacis(t('form.hata.giris'))} <a class="metin-bag" href="giris.html">${kacis(t('menu.giris'))}</a></p>`;
      return;
    }

    koordinator = !!durum.kullanici.koordinator;
    sayiBicim = new Intl.NumberFormat(durum.dil, { maximumFractionDigits: 2 });
    damgaBicim = new Intl.DateTimeFormat(durum.dil, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    saatBicim = new Intl.DateTimeFormat(durum.dil, { hour: '2-digit', minute: '2-digit' });
    siralayici = new Intl.Collator(durum.dil);

    zenginAlanlariKur();
    listeOlaylariniKur();
    duzenleyiciOlaylariniKur();
    doldurOlaylariniKur();
    sonucOlaylariniKur();
    yanitSekmesi('ozet');

    /* Yer tutucular sözlükten gelir; contenteditable alanlarda CSS ::before
       ile gösterilir (bkz. form.css). */
    $('#baslik-duzenleyici').dataset.yerTutucu = t('form.baslik.yerTutucu');
    $('#aciklama-duzenleyici').dataset.yerTutucu = t('form.aciklama.yerTutucu');

    await yonlendir();
  } catch (hata) {
    $('#sayfa-hata').textContent = hata.message;
  }
})();
