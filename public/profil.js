import { baslat, iste, t, durum, ortakAdi, ortakKisa, yerAdi } from './ortak.js';

/**
 * Herkese açık profil kartı: `profil.html?u=<kullanici>`. Oturum istemez;
 * adres NFC etiketine ya da QR koda yazılıp dağıtılır. Kişinin adı ve
 * kurumu dışında her şey projenin ortak tanıtımıdır.
 */

/* Simgeler sabit SVG metnidir (dışarıdan yüklenmez, CSP 'self'). */
const SIMGE = {
  linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10.5v6M8 7.5v.01M11.5 16.5v-6M11.5 13.2a2.7 2.7 0 0 1 5 1.3v2"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.3 6.7v.01"/>',
  x: '<path d="M4 4l11.7 16H20L8.3 4z"/><path d="M19.5 4l-6.2 7M10.7 13L4.5 20"/>',
};

const bas = ad => ad.trim().split(/\s+/).filter(Boolean)
  .filter((_, i, dizi) => i === 0 || i === dizi.length - 1)
  .map(s => s[0]).join('').toLocaleUpperCase(durum.dil);

/* Seçilen görsel tarayıcıda kare kırpılıp 600 piksele küçültülür ve JPEG
   olarak gönderilir: telefondan gelen 5 MB'lık fotoğraf ~100 KB'a iner,
   kart mobil veride de hızlı açılır. Görselin yönünü (EXIF) tarayıcı
   createImageBitmap ile zaten düzeltir. */
const KENAR = 600;
async function kareKucult(dosya) {
  const resim = await createImageBitmap(dosya);
  const kisa = Math.min(resim.width, resim.height);
  const tuval = document.createElement('canvas');
  tuval.width = tuval.height = Math.min(KENAR, kisa);
  tuval.getContext('2d').drawImage(resim,
    (resim.width - kisa) / 2, (resim.height - kisa) / 2, kisa, kisa, 0, 0, tuval.width, tuval.height);
  resim.close();
  return new Promise((coz, reddet) => tuval.toBlob(b => (b ? coz(b) : reddet(new Error(t('profil.hata.tur')))), 'image/jpeg', 0.86));
}

function avatariCiz(kisi) {
  const avatar = document.getElementById('profil-avatar');
  if (kisi.foto) {
    const img = document.createElement('img');
    img.src = `api/profil/foto?u=${encodeURIComponent(kisi.kullanici)}&v=${encodeURIComponent(kisi.foto)}`;
    img.alt = kisi.ad;
    avatar.replaceChildren(img);
    avatar.classList.add('profil-avatar-foto');
  } else {
    avatar.textContent = bas(kisi.ad);
    avatar.classList.remove('profil-avatar-foto');
  }
}

(async () => {
  await baslat();

  const kart = document.getElementById('profil-kart');
  const kullanici = new URLSearchParams(location.search).get('u') || '';

  let kisi;
  try {
    kisi = await iste(`api/profil?u=${encodeURIComponent(kullanici)}`);
  } catch (err) {
    kart.hidden = true;
    const yok = document.getElementById('profil-yok');
    yok.textContent = err.message;
    yok.hidden = false;
    return;
  }

  document.title = `${kisi.ad} · ${t('site.ad')}`;
  avatariCiz(kisi);

  /* Kişinin kendisi ve proje yöneticisi fotoğrafı değiştirebilir; sunucu
     da aynı kuralı ayrıca uygular. */
  const yetkili = durum.kullanici && (durum.kullanici.kullanici === kisi.kullanici || durum.kullanici.koordinator);
  if (yetkili) {
    const eylem = document.getElementById('profil-foto-eylem');
    const dosya = document.getElementById('profil-foto-dosya');
    const kaldir = document.getElementById('profil-foto-kaldir');
    const hata = document.getElementById('profil-foto-hata');
    const yol = `api/profil/foto?u=${encodeURIComponent(kisi.kullanici)}`;
    eylem.hidden = false;
    kaldir.hidden = !kisi.foto;

    dosya.addEventListener('change', async () => {
      const secilen = dosya.files[0];
      dosya.value = '';
      if (!secilen) return;
      hata.textContent = '';
      try {
        const veri = await kareKucult(secilen).catch(() => { throw new Error(t('profil.hata.tur')); });
        ({ foto: kisi.foto } = await iste(yol, { method: 'PUT', body: veri, headers: { 'Content-Type': 'image/jpeg' } }));
        avatariCiz(kisi);
        kaldir.hidden = false;
      } catch (err) {
        hata.textContent = err.message;
      }
    });

    kaldir.addEventListener('click', async () => {
      if (!confirm(t('profil.foto.kaldirOnay'))) return;
      hata.textContent = '';
      try {
        ({ foto: kisi.foto } = await iste(yol, { method: 'DELETE' }));
        avatariCiz(kisi);
        kaldir.hidden = true;
      } catch (err) {
        hata.textContent = err.message;
      }
    });
  }
  document.getElementById('profil-ad').textContent = kisi.ad;

  const kurum = durum.ortaklar.find(o => o.id === kisi.partner);
  const kurumSatir = document.getElementById('profil-kurum');
  kurumSatir.textContent = ortakAdi(kisi.partner);
  if (kurum) {
    const ulke = document.createElement('span');
    ulke.textContent = `${ortakKisa(kisi.partner)} · ${yerAdi(kurum.country)}`;
    kurumSatir.append(ulke);
  }

  const sosyal = document.getElementById('profil-sosyal');
  for (const hesap of durum.proje.sosyal || []) {
    const bag = document.createElement('a');
    bag.className = `profil-sosyal-bag profil-sosyal-${hesap.id}`;
    bag.href = hesap.url;
    bag.target = '_blank';
    bag.rel = 'noopener noreferrer';
    bag.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${SIMGE[hesap.id] || ''}</svg>`;
    const ad = document.createElement('span');
    ad.textContent = hesap.ad;
    bag.append(ad);
    sosyal.append(bag);
  }

  /* Paylaş: telefonda sistemin paylaşım menüsü, masaüstünde panoya kopyalama. */
  const paylas = document.getElementById('profil-paylas');
  const adres = new URL(`profil.html?u=${encodeURIComponent(kisi.kullanici)}`, location.href).toString();
  paylas.addEventListener('click', async () => {
    try {
      if (navigator.share) return await navigator.share({ title: `${kisi.ad} · ${t('site.ad')}`, url: adres });
      await navigator.clipboard.writeText(adres);
      paylas.textContent = t('profil.kopyalandi');
      setTimeout(() => { paylas.textContent = t('profil.paylas'); }, 2000);
    } catch { /* Kullanıcı paylaşımı kapattı; yapılacak bir şey yok. */ }
  });

  kart.removeAttribute('aria-busy');
})();
