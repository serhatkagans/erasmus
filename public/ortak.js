/**
 * Tüm sayfaların paylaştığı kabuk: açılış verisini çeker, çeviriyi uygular,
 * dil değiştiriciyi ve oturum düğmelerini kurar.
 *
 * ÇEVİRİ NASIL UYGULANIR
 * HTML'de metin yazılmaz, anahtar yazılır:
 *   <h1 data-t="anasayfa.baslik"></h1>
 *   <input data-t-yer="takvim.ara.ipucu">      → placeholder
 *   <button data-t-etiket="takvim.onceki">     → aria-label
 *   <a data-t-baslik="genel.web">              → title
 *   <body data-t-sayfa="takvim.baslik">        → sekme başlığı
 * Böylece yeni bir dil eklemek yalnızca `locales/<kod>.json` yazmaktır;
 * hiçbir şablona dokunulmaz.
 */

export const durum = {
  dil: 'tr',
  sozluk: {},
  proje: null,
  ortaklar: [],
  ispaketleri: [],
  turler: [],
  durumlar: [],
  yerler: [],
  diller: [],
  kullanici: null,
  minParola: 12,
};

/** Sözlükten metin. `%{n}` gibi yer tutucular `degerler` ile doldurulur. */
export function t(anahtar, degerler) {
  let metin = durum.sozluk[anahtar];
  /* Anahtarın kendisi görünürse çeviri eksiği hemen fark edilir; boş
     bırakmak sessizce bozuk bir arayüz üretirdi. */
  if (metin == null) return anahtar;
  if (degerler) for (const [ad, deger] of Object.entries(degerler)) metin = metin.replaceAll(`%{${ad}}`, deger);
  return metin;
}

export const ortakAdi = id => durum.ortaklar.find(o => o.id === id)?.name || id;
export const ortakKisa = id => durum.ortaklar.find(o => o.id === id)?.short || id;
export const yerAdi = kod => t(`ulke.${kod}`);

/** Resmî aktivitelerin başlığı sözlükten, ortakların eklediği etkinliklerin
 *  başlığı kayıttan gelir — aynı listede yan yana durabilsinler diye. */
export const etkinlikBaslik = e => (e.slug && durum.sozluk[`etkinlik.${e.slug}.baslik`]) || e.baslik || e.kod || e.wp;
export const etkinlikOzet = e => (e.slug && durum.sozluk[`etkinlik.${e.slug}.ozet`]) || e.ozet || '';

/* --- Tarih biçimlendirme ------------------------------------------------
   Intl, seçili dile göre ay adlarını kendi verir; ayrı bir ay adı sözlüğü
   tutmak gerekmez. Tarihler UTC olarak saklanır ve UTC olarak gösterilir:
   yerel saat dilimi uygulanırsa gün kayabilir. */
const bicim = (secenek) => new Intl.DateTimeFormat(durum.dil, { timeZone: 'UTC', ...secenek });
export const gunAy = gun => bicim({ day: 'numeric', month: 'long' }).format(new Date(gun + 'T00:00:00Z'));
export const tamTarih = gun => bicim({ day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(gun + 'T00:00:00Z'));
export const ayYil = (yil, ay) => bicim({ month: 'long', year: 'numeric' }).format(new Date(Date.UTC(yil, ay, 1)));

/**
 * "15–16 Aralık 2026" gibi: ortak olan ay ve yıl tekrarlanmaz.
 *
 * Aralığı Intl kurar, çünkü SIRA DİLE GÖRE DEĞİŞİR: Türkçe "15–16 Aralık
 * 2026" derken İngilizce "December 15 – 16, 2026" der. Parçalar elle
 * birleştirildiğinde İngilizce çıktı "15–December 16, 2026" oluyordu.
 */
export function tarihAraligi(baslangic, bitis) {
  if (baslangic === bitis) return tamTarih(baslangic);
  return bicim({ day: 'numeric', month: 'long', year: 'numeric' })
    .formatRange(new Date(baslangic + 'T00:00:00Z'), new Date(bitis + 'T00:00:00Z'));
}

export const bugun = () => new Date().toISOString().slice(0, 10);
export const gunFarki = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const gunEkle = (gun, n) => new Date(Date.parse(gun + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/* --- Sunucu çağrıları ---------------------------------------------------- */
export async function iste(yol, secenek = {}) {
  const yanit = await fetch(yol, {
    headers: secenek.body ? { 'Content-Type': 'application/json' } : undefined,
    ...secenek,
  });
  const veri = await yanit.json().catch(() => ({}));
  if (!yanit.ok) {
    /* Sunucu bazı hataları çeviri anahtarı olarak döndürür (ör. giris.hata);
       sözlükte karşılığı varsa o gösterilir, yoksa metin olduğu gibi. */
    throw new Error(durum.sozluk[veri.error] || veri.error || t('genel.hata'));
  }
  return veri;
}

/* --- Çeviriyi sayfaya uygula --------------------------------------------- */
const OZNITELIK = { 'data-t-yer': 'placeholder', 'data-t-etiket': 'aria-label', 'data-t-baslik': 'title' };

export function ceviriyiUygula(kok = document) {
  for (const el of kok.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const [veri, oznitelik] of Object.entries(OZNITELIK)) {
    for (const el of kok.querySelectorAll(`[${veri}]`)) el.setAttribute(oznitelik, t(el.getAttribute(veri)));
  }

  /* Sekme başlığı: sayfanın adı çevrilir, proje adı sabit kalır. Ana
     sayfada anahtar yoktur — orada başlık zaten yalnızca proje adıdır. */
  const sayfa = document.body?.dataset.tSayfa;
  if (sayfa) document.title = `${t(sayfa)} · ${t('site.ad')}`;

  document.documentElement.lang = durum.dil;
}

/* --- Kabuk: dil değiştirici ve oturum düğmeleri --------------------------- */
function dilDegistiriciyiKur() {
  const kutu = document.getElementById('dil-secici');
  if (!kutu) return;

  const yayinda = durum.diller.filter(d => d.ready);
  /* Tek dil yayındayken seçici gereksiz gürültüdür; ikinci dil açıldığı an
     kendiliğinden görünür. */
  if (yayinda.length < 2) { kutu.hidden = true; return; }
  kutu.hidden = false;
  kutu.replaceChildren();

  const secim = document.createElement('select');
  secim.className = 'dil-secim';
  secim.setAttribute('aria-label', t('menu.dil'));

  for (const { code, name, ready } of durum.diller) {
    const secenek = document.createElement('option');
    secenek.value = code;
    /* Hazır olmayan diller listede durur ama seçilemez: neyin geleceğini
       göstermek, listeyi bir gün uzayacak diye saklamaktan iyidir.
       Çevirisi tamamlanıp `ready: true` yapıldığında kendiliğinden açılır. */
    secenek.textContent = ready ? name : `${name} — ${t('menu.dil.yakinda')}`;
    secenek.disabled = !ready;
    secim.append(secenek);
  }
  secim.value = durum.dil;

  /* Sunucu dili çereze yazsın diye sayfa `?dil=` ile yeniden yüklenir;
     istemcide sözlüğü değiştirmek yeterli olurdu ama sonraki sayfa
     açılışları yine eski dile dönerdi. */
  secim.addEventListener('change', () => {
    const adres = new URL(location.href);
    adres.searchParams.set('dil', secim.value);
    location.href = adres.toString();
  });

  kutu.append(secim);
}

/* --- Hatırlatıcılar -------------------------------------------------------
   Zil ve paneli her sayfaya ortak kabuk kurar: kullanıcı hangi sayfada
   olursa olsun bekleyeni görsün. Hatırlatıcılar sunucuda TÜRETİLİR
   (bkz. routes/hatirlatici.mjs); burada yalnızca çizilir. */
function hatirlaticiMetni(h) {
  /* Etkinlik hatırlatıcısında başlık resmî aktivitelerde sözlükten gelir:
     sunucu `slug` gönderir, çeviriyi burada çözeriz ki dil değişince
     hatırlatıcı da doğru dilde okunsun. */
  const degerler = { ...h.degerler };
  if (degerler.slug) degerler.baslik = durum.sozluk[`etkinlik.${degerler.slug}.baslik`] || degerler.baslik;
  if (degerler.anahtar) degerler.baslik = t(`${degerler.anahtar}.baslik`);
  return t(h.anahtar, degerler);
}

async function hatirlaticilariKur() {
  const kutu = document.getElementById('hatirlatici');
  if (!kutu || !durum.kullanici) return;

  let veri;
  try { veri = await iste('api/hatirlaticilar'); }
  catch { return; }

  kutu.hidden = false;
  kutu.replaceChildren();

  const dugme = document.createElement('button');
  dugme.type = 'button';
  dugme.className = 'hatirlatici-dugme';
  dugme.setAttribute('aria-expanded', 'false');
  dugme.setAttribute('aria-label', t('hatirlatici.ac'));
  dugme.title = t('hatirlatici.baslik');
  dugme.textContent = '🔔';

  if (veri.acilSayisi) {
    const rozet = document.createElement('span');
    rozet.className = 'hatirlatici-sayi';
    rozet.textContent = String(veri.acilSayisi);
    dugme.append(rozet);
  }

  const panel = document.createElement('div');
  panel.className = 'hatirlatici-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', t('hatirlatici.baslik'));

  const bas = document.createElement('p');
  bas.className = 'hatirlatici-bas';
  bas.textContent = t('hatirlatici.baslik');
  panel.append(bas);

  if (!veri.hatirlaticilar.length) {
    const bos = document.createElement('p');
    bos.className = 'hatirlatici-bos';
    bos.textContent = t('hatirlatici.yok');
    panel.append(bos);
  } else {
    for (const h of veri.hatirlaticilar) {
      const satir = document.createElement('a');
      satir.className = 'hatirlatici-satir';
      satir.dataset.oncelik = h.oncelik;
      satir.href = h.bag;
      satir.textContent = hatirlaticiMetni(h);
      panel.append(satir);
    }
  }

  dugme.addEventListener('click', () => {
    const acik = panel.hidden;
    panel.hidden = !acik;
    dugme.setAttribute('aria-expanded', String(acik));
  });

  /* Panel dışına tıklayınca kapanır; açık kalan panel sayfayı örtüyordu. */
  document.addEventListener('click', olay => {
    if (!panel.hidden && !kutu.contains(olay.target)) {
      panel.hidden = true;
      dugme.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', olay => {
    if (olay.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      dugme.setAttribute('aria-expanded', 'false');
      dugme.focus();
    }
  });

  kutu.append(dugme, panel);
}
/* --- Menü -----------------------------------------------------------------
   Tek liste, her sayfada aynı sıra ve aynı öğeler. Eskiden her HTML kendi
   menüsünü yazıyordu; ana sayfada iki bağlantı fazlaydı ve sayfa değişince
   menü kayıyordu. `sayfa`: aria-current için karşılaştırılan dosya adı.
   Kişiye ait bağlantılar (profil, parola, çıkış) burada değil, hesap
   menüsündedir. */
const MENU = [
  { anahtar: 'menu.pano', href: 'pano.html' },
  { anahtar: 'menu.anasayfa', href: './', sayfa: 'index.html' },
  { anahtar: 'menu.takvim', href: 'takvim.html' },
  { anahtar: 'menu.ciktilar', href: 'ciktilar.html' },
  { anahtar: 'menu.ekip', href: 'ekip.html' },
  { anahtar: 'menu.formlar', href: 'formlar.html' },
  { anahtar: 'menu.belgeler', href: 'belge.html' },
  { anahtar: 'menu.klasorler', href: 'klasorler.html' },
  { anahtar: 'menu.kullanicilar', href: 'kullanicilar.html', koordinator: true },
];

function menuyuKur() {
  const nav = document.getElementById('gezinme');
  const ac = document.getElementById('menu-dugme');
  if (!nav) return;
  /* Oturumsuz kişi yalnızca giriş ve profil kartını görebilir; menüdeki
     her bağlantı onu girişe geri yollardı. */
  if (!durum.kullanici) { nav.hidden = true; return; }
  const burasi = location.pathname.split('/').pop() || 'index.html';
  /* Yönetici öğeleri yalnızca koordinatöre görünür; sunucu da ayrıca denetler. */
  const ogeler = MENU.filter(o => !o.koordinator || durum.kullanici.koordinator);
  nav.replaceChildren(...ogeler.map(o => {
    const a = document.createElement('a');
    a.href = o.href;
    a.textContent = t(o.anahtar);
    if ((o.sayfa || o.href) === burasi) a.setAttribute('aria-current', 'page');
    return a;
  }));

  /* Telefon: menü bir düğmenin arkasında açılır-kapanır. Genişlik CSS'te
     belirlenir; düğme dar ekranda görünür, geniş ekranda gizlidir. */
  if (!ac) return;
  ac.hidden = false;
  const ust = ac.closest('.ust');
  const kapat = () => { ust.classList.remove('menu-acik'); ac.setAttribute('aria-expanded', 'false'); };
  ac.addEventListener('click', () => {
    const acik = ust.classList.toggle('menu-acik');
    ac.setAttribute('aria-expanded', String(acik));
  });
  document.addEventListener('keydown', o => { if (o.key === 'Escape' && ust.classList.contains('menu-acik')) { kapat(); ac.focus(); } });
}

/* --- Ortak onay kutusu ------------------------------------------------------
   Tarayıcının confirm() kutusunun yerine: sitenin görünümünde, çevrilmiş
   düğmelerle ve silme gibi geri alınamaz işlemlerde kırmızı onay düğmesiyle.
   Söz (Promise) döner: `if (!(await onayla(metin))) return;` */
let onayKutusu = null;
export function onayla(metin, { baslik = '', evet = t('genel.tamam'), tehlike = false } = {}) {
  if (!onayKutusu) {
    onayKutusu = document.createElement('dialog');
    onayKutusu.className = 'onay-kutusu';
    onayKutusu.innerHTML = `
      <form method="dialog" class="kutu-ic">
        <h2 class="onay-baslik"></h2>
        <p class="onay-metin"></p>
        <div class="kutu-eylem">
          <button value="evet" class="dugme onay-evet"></button>
          <button value="hayir" class="dugme dugme-ikincil onay-hayir"></button>
        </div>
      </form>`;
    document.body.append(onayKutusu);
  }
  const k = onayKutusu;
  k.querySelector('.onay-baslik').textContent = baslik;
  k.querySelector('.onay-baslik').hidden = !baslik;
  k.querySelector('.onay-metin').textContent = metin;
  const evetDugme = k.querySelector('.onay-evet');
  evetDugme.textContent = evet;
  evetDugme.className = `dugme onay-evet ${tehlike ? 'dugme-tehlike-dolu' : 'dugme-birincil'}`;
  k.querySelector('.onay-hayir').textContent = t('genel.vazgec');
  k.returnValue = 'hayir';
  return new Promise(coz => {
    k.addEventListener('close', () => coz(k.returnValue === 'evet'), { once: true });
    k.showModal();
    /* Tehlikeli işlemde odak "Vazgeç"te başlar: Enter'a yanlışlıkla basmak silmesin. */
    k.querySelector(tehlike ? '.onay-hayir' : '.onay-evet').focus();
  });
}

/* --- Kısa bildirim ---------------------------------------------------------
   "Kaydedildi" gibi geri bildirimler ve alert() ile gösterilen hatalar
   için. Ekranın altında belirir, kendiliğinden kaybolur; hata daha uzun
   kalır ve ekran okuyucuya hemen okunur (role=alert). */
export function bildir(metin, tur = 'basari') {
  let yigin = document.getElementById('bildirimler');
  if (!yigin) {
    yigin = document.createElement('div');
    yigin.id = 'bildirimler';
    yigin.className = 'bildirimler';
    document.body.append(yigin);
  }
  const not = document.createElement('div');
  not.className = `bildirim bildirim-${tur}`;
  not.setAttribute('role', tur === 'hata' ? 'alert' : 'status');
  const yazi = document.createElement('span');
  yazi.textContent = metin;
  const kapat = document.createElement('button');
  kapat.type = 'button';
  kapat.className = 'bildirim-kapat';
  kapat.textContent = '×';
  kapat.setAttribute('aria-label', t('genel.kapat'));
  const kaldir = () => not.remove();
  kapat.addEventListener('click', kaldir);
  not.append(yazi, kapat);
  yigin.append(not);
  setTimeout(kaldir, tur === 'hata' ? 8000 : 3500);
}

/* --- Kaydedilmemiş değişiklik koruması ---------------------------------------
   `data-koru` işaretli düzenleme kutularında bir alan değiştiyse, kutuyu
   Vazgeç, × ya da Esc ile kapatmadan önce sorulur. Kaydedince sayfa kutuyu
   close() ile kapatır; o yol sorulmaz. Formlar düzenleyicisinin kendi
   (sayfa düzeyinde) koruması vardır, bu onun kutulardaki karşılığıdır. */
function kutuyuKoru(kutu) {
  let kirli = false;
  const ac = kutu.showModal.bind(kutu);
  kutu.showModal = () => { kirli = false; ac(); };
  kutu.addEventListener('input', () => { kirli = true; });
  kutu.addEventListener('change', () => { kirli = true; });
  kutu.addEventListener('close', () => { kirli = false; });
  const sor = async () => {
    if (await onayla(t('genel.kaydedilmemis'), { evet: t('genel.vazgecKapat'), tehlike: true })) {
      kirli = false;
      kutu.close();
    }
  };
  kutu.addEventListener('cancel', olay => { if (kirli) { olay.preventDefault(); sor(); } });
  /* Yakalama evresinde: sayfanın kapat düğmesine bağladığı dinleyiciden önce çalışır. */
  kutu.addEventListener('click', olay => {
    if (kirli && olay.target.closest('[data-kapat]')) {
      olay.preventDefault();
      olay.stopImmediatePropagation();
      sor();
    }
  }, true);
}

/* --- Parola değiştirme ------------------------------------------------------
   Kutu burada kurulur ki her sayfada hesap menüsünden açılabilsin. */
let parolaAc = () => {};
function parolaKutusunuKur() {
  if (!durum.kullanici) return;

  const kutu = document.createElement('dialog');
  kutu.id = 'parola-kutu';
  kutu.dataset.koru = '';
  kutu.innerHTML = `
    <form class="kutu-ic">
      <div class="kutu-ust">
        <h2 data-t="parola.baslik"></h2>
        <button type="button" class="kapat" data-kapat data-t-etiket="genel.kapat">×</button>
      </div>
      <p class="kutu-aciklama" data-t="parola.ipucu"></p>
      <label class="alan"><span data-t="parola.mevcut"></span><input name="mevcut" type="password" autocomplete="current-password" required></label>
      <label class="alan"><span data-t="parola.yeni"></span><input name="yeni" type="password" autocomplete="new-password" required></label>
      <p class="hata" role="alert"></p>
      <div class="kutu-eylem">
        <button type="submit" class="dugme dugme-birincil" data-t="parola.guncelle"></button>
        <button type="button" class="dugme dugme-ikincil" data-kapat data-t="genel.vazgec"></button>
      </div>
    </form>`;
  document.body.append(kutu);
  ceviriyiUygula(kutu);
  kutuyuKoru(kutu);

  const form = kutu.querySelector('form');
  const hata = kutu.querySelector('.hata');
  form.yeni.minLength = durum.minParola;
  for (const kapat of kutu.querySelectorAll('[data-kapat]')) kapat.addEventListener('click', () => kutu.close());

  parolaAc = () => {
    form.reset();
    hata.textContent = '';
    kutu.showModal();
  };

  form.addEventListener('submit', async olay => {
    olay.preventDefault();
    hata.textContent = '';
    try {
      await iste('api/parola', {
        method: 'POST',
        body: JSON.stringify({ mevcut: form.mevcut.value, yeni: form.yeni.value }),
      });
      kutu.close();
      bildir(t('parola.tamam'));
    } catch (err) {
      hata.textContent = err.message;
    }
  });
}

/* --- Hesap menüsü -------------------------------------------------------------
   Ad rozeti bir düğmedir; altında kişiye ait her şey: profil kartı, parola,
   çıkış. Üst bantta üç ayrı düğme yerine tek giriş noktası. */
function oturumuKur() {
  const giris = document.getElementById('giris-baglanti');
  const kutu = document.getElementById('hesap');
  const acik = !!durum.kullanici;
  /* Giriş sayfasında kendine bağlantı gereksiz. */
  if (giris) giris.hidden = acik || location.pathname.endsWith('/giris.html');
  if (!kutu || !acik) return;

  const k = durum.kullanici;
  const ad = k.ad || k.kullanici;
  const bas = ad.trim().split(/\s+/).filter((_, i, d) => i === 0 || i === d.length - 1)
    .map(s => s[0]).join('').toLocaleUpperCase(durum.dil);

  const dugme = document.createElement('button');
  dugme.type = 'button';
  dugme.className = 'hesap-dugme';
  dugme.setAttribute('aria-expanded', 'false');
  dugme.setAttribute('aria-haspopup', 'true');
  dugme.setAttribute('aria-label', t('hesap.ac', { ad }));
  const avatar = document.createElement('span');
  avatar.className = 'hesap-avatar';
  avatar.textContent = bas;
  const yazi = document.createElement('span');
  yazi.className = 'hesap-ad';
  yazi.textContent = `${ad} · ${ortakKisa(k.partner)}`;
  dugme.append(avatar, yazi);

  const panel = document.createElement('div');
  panel.className = 'hesap-panel';
  panel.hidden = true;
  const kim = document.createElement('div');
  kim.className = 'hesap-kim';
  const kimAd = document.createElement('strong');
  kimAd.textContent = ad;
  const kimAlt = document.createElement('span');
  kimAlt.textContent = `${k.kullanici} · ${ortakAdi(k.partner)}${k.koordinator ? ` · ${t('kullanicilar.yetki.tam')}` : ''}`;
  kim.append(kimAd, kimAlt);

  const profil = document.createElement('a');
  profil.href = `profil.html?u=${encodeURIComponent(k.kullanici)}`;
  profil.textContent = t('menu.profil');
  const parola = document.createElement('button');
  parola.type = 'button';
  parola.textContent = t('menu.parola');
  parola.addEventListener('click', () => { kapat(); parolaAc(); });
  const cikis = document.createElement('button');
  cikis.type = 'button';
  cikis.textContent = t('menu.cikis');
  cikis.addEventListener('click', async () => {
    await iste('api/cikis', { method: 'POST' });
    location.href = 'giris.html';
  });
  panel.append(kim, profil, parola, cikis);

  const kapat = () => { panel.hidden = true; dugme.setAttribute('aria-expanded', 'false'); };
  dugme.addEventListener('click', () => {
    const acilsin = panel.hidden;
    panel.hidden = !acilsin;
    dugme.setAttribute('aria-expanded', String(acilsin));
  });
  document.addEventListener('click', o => { if (!panel.hidden && !kutu.contains(o.target)) kapat(); });
  document.addEventListener('keydown', o => { if (o.key === 'Escape' && !panel.hidden) { kapat(); dugme.focus(); } });

  kutu.replaceChildren(dugme, panel);
  kutu.hidden = false;
}

/** Her sayfa bunu çağırır: açılış verisini çeker, çeviriyi uygular, kabuğu kurar. */
export async function baslat() {
  const veri = await iste('api/acilis');
  Object.assign(durum, veri);
  menuyuKur();
  ceviriyiUygula();
  dilDegistiriciyiKur();
  parolaKutusunuKur();
  oturumuKur();
  for (const kutu of document.querySelectorAll('dialog[data-koru]:not(#parola-kutu)')) kutuyuKoru(kutu);
  /* Hatırlatıcılar ayrı bir çağrı ister; sayfanın çizilmesini bekletmesin
     diye beklenmeden başlatılır. */
  hatirlaticilariKur();
  return durum;
}
