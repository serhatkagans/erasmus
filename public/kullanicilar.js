import { baslat, iste, t, durum, ortakAdi, ortakKisa } from './ortak.js';

/**
 * Kullanıcılar: proje yöneticisi hesapları görür, açar, düzenler, siler.
 * Sunucu da yalnızca koordinatöre izin verir; buradaki gizleme kolaylıktır,
 * kural değil.
 */
const $ = id => document.getElementById(id);

/* Ad soyaddan kullanıcı adı önerisi: "Serhat Kağan Şahin" → "serhatkagansahin".
   Aksanlar düşer (ş→s, ğ→g, ș→s, ã→a); ayrışmayan harfler elle eşlenir. */
const ELLE = { ı: 'i', ø: 'o', æ: 'ae', å: 'a', ß: 'ss', đ: 'd', ł: 'l' };
const oner = ad => ad.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[ıøæåßđł]/g, h => ELLE[h]).replace(/[^a-z0-9]/g, '').slice(0, 40);

let kullanicilar = [];

/* Okunaklı rastgele parola: karışan harfler (0/O, 1/l/I) yok. 16 karakter,
   ~95 bit; kişi ilk girişte kendi parolasına geçer. */
const ABECE = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const parolaUret = () => [...crypto.getRandomValues(new Uint32Array(16))]
  .map(n => ABECE[n % ABECE.length]).join('').replace(/(.{4})(?!$)/g, '$1-');

/* --- Parola sıfırlama kutusu ----------------------------------------------- */
let sifirlanan = null;
function sifirlaAc(k) {
  sifirlanan = k;
  const form = $('sifirla-form');
  form.reset();
  form.parola.value = parolaUret();
  form.parola.readOnly = false;
  $('sifirla-kim').textContent = `${k.ad || k.kullanici} (${k.kullanici})`;
  $('sifirla-hata').textContent = '';
  $('sifirla-tamam').hidden = true;
  $('sifirla-kaydet').hidden = false;
  $('sifirla-uret').hidden = false;
  $('sifirla-vazgec').textContent = t('genel.vazgec');
  $('sifirla-kutu').showModal();
  form.parola.select();
}

function ciz() {
  $('kullanicilar-govde').replaceChildren(...kullanicilar.map(k => {
    const satir = document.createElement('tr');
    const hucre = (metin, sinif) => {
      const td = document.createElement('td');
      if (sinif) td.className = sinif;
      td.textContent = metin;
      satir.append(td);
      return td;
    };
    hucre(k.ad || '—');
    hucre(k.kullanici, 'kullanicilar-kod');
    hucre(ortakKisa(k.partner)).title = ortakAdi(k.partner);

    const rozet = document.createElement('span');
    rozet.className = k.koordinator ? 'yetki-rozet yetki-tam' : 'yetki-rozet';
    rozet.textContent = t(k.koordinator ? 'kullanicilar.yetki.tam' : 'kullanicilar.yetki.kurum');
    hucre('').append(rozet);

    const bag = document.createElement('a');
    bag.className = 'metin-bag';
    bag.href = `profil.html?u=${encodeURIComponent(k.kullanici)}`;
    bag.textContent = t('kullanicilar.profilAc');
    hucre('').append(bag);

    const duzenle = document.createElement('button');
    duzenle.type = 'button';
    duzenle.className = 'dugme dugme-hayalet dugme-kucuk';
    duzenle.textContent = t('kullanicilar.duzenle');
    duzenle.addEventListener('click', () => kutuyuAc(k));

    const sifirla = document.createElement('button');
    sifirla.type = 'button';
    sifirla.className = 'dugme dugme-hayalet dugme-kucuk';
    sifirla.textContent = t('kullanicilar.sifirla');
    sifirla.addEventListener('click', () => sifirlaAc(k));
    const islem = hucre('', 'kullanicilar-islem');
    islem.append(duzenle, sifirla);

    /* Kendi hesabını silme düğmesi yok; sunucu da reddeder. */
    if (k.id !== durum.kullanici.id) {
      const sil = document.createElement('button');
      sil.type = 'button';
      sil.className = 'dugme dugme-hayalet dugme-kucuk dugme-tehlike';
      sil.textContent = t('kullanicilar.sil');
      sil.addEventListener('click', () => hesapSil(k));
      islem.append(sil);
    }
    return satir;
  }));
}

/* Ekleme ve düzenleme aynı kutuyu kullanır; `duzenlenen` null ise ekleme. */
let duzenlenen = null;
let kutuyuAc = () => {};

async function hesapSil(k) {
  if (!confirm(t('kullanicilar.silOnay', { ad: k.ad || k.kullanici, kullanici: k.kullanici }))) return;
  try {
    await iste(`api/kullanicilar/${k.id}`, { method: 'DELETE' });
    await yukle();
  } catch (err) {
    alert(err.message);
  }
}

async function yukle() {
  ({ kullanicilar } = await iste('api/kullanicilar'));
  ciz();
}

(async () => {
  await baslat();

  const uyari = $('kullanicilar-uyari');
  if (!durum.kullanici?.koordinator) {
    uyari.textContent = t(durum.kullanici ? 'kullanicilar.hata.yetki' : 'kullanicilar.hata.giris');
    uyari.hidden = false;
    return;
  }

  $('kullanicilar-kart').hidden = false;
  $('kullanici-ekle').hidden = false;
  await yukle();

  const kutu = $('kullanici-kutu');
  const form = $('kullanici-form');
  const hata = $('kullanici-hata');

  form.partner.replaceChildren(...durum.ortaklar.map(o => new Option(`${o.short} — ${o.name}`, o.id)));
  form.parola.minLength = durum.minParola;
  for (const kapat of kutu.querySelectorAll('[data-kapat]')) kapat.addEventListener('click', () => kutu.close());

  const sifirlaKutu = $('sifirla-kutu');
  const sifirlaForm = $('sifirla-form');
  sifirlaForm.parola.minLength = durum.minParola;
  for (const kapat of sifirlaKutu.querySelectorAll('[data-kapat]')) kapat.addEventListener('click', () => sifirlaKutu.close());
  $('sifirla-uret').addEventListener('click', () => { sifirlaForm.parola.value = parolaUret(); });
  sifirlaForm.addEventListener('submit', async olay => {
    olay.preventDefault();
    $('sifirla-hata').textContent = '';
    const dugme = $('sifirla-kaydet');
    dugme.disabled = true;
    try {
      await iste(`api/kullanicilar/${sifirlanan.id}/parola`, {
        method: 'POST', body: JSON.stringify({ parola: sifirlaForm.parola.value }),
      });
      /* Kutu kapanmaz: yönetici parolayı kopyalayıp kişiye iletecek. */
      sifirlaForm.parola.readOnly = true;
      sifirlaForm.parola.select();
      $('sifirla-tamam').textContent = t('kullanicilar.sifirlandi', { kullanici: sifirlanan.kullanici });
      $('sifirla-tamam').hidden = false;
      dugme.hidden = true;
      $('sifirla-uret').hidden = true;
      $('sifirla-vazgec').textContent = t('genel.kapat');
    } catch (err) {
      $('sifirla-hata').textContent = err.message;
    } finally {
      dugme.disabled = false;
    }
  });

  /* Kullanıcı adı elle değiştirilene kadar addan önerilir. */
  let elle = false;
  form.ad.addEventListener('input', () => { if (!elle) form.kullanici.value = oner(form.ad.value); });
  form.kullanici.addEventListener('input', () => {
    elle = form.kullanici.value !== '';
    form.kullanici.value = form.kullanici.value.toLowerCase();
  });

  kutuyuAc = (k = null) => {
    duzenlenen = k;
    form.reset();
    hata.textContent = '';
    $('kullanici-baslik').textContent = t(k ? 'kullanicilar.duzenle' : 'kullanicilar.ekle');
    /* Parola yalnızca eklemede; düzenlemede "Parolayı sıfırla" kullanılır. */
    $('kullanici-parola-alan').hidden = !!k;
    form.parola.required = !k;
    $('kullanici-nfc').hidden = !k;
    if (k) {
      form.ad.value = k.ad;
      form.kullanici.value = k.kullanici;
      form.partner.value = k.partner;
      form.koordinator.checked = k.koordinator;
      /* Kendi yetkisini kaldıramaz; sunucu da reddeder. */
      form.koordinator.disabled = k.id === durum.kullanici.id;
      elle = true;
    } else {
      form.partner.value = durum.kullanici.partner;
      form.koordinator.disabled = false;
      elle = false;
    }
    kutu.showModal();
  };
  $('kullanici-ekle').addEventListener('click', () => kutuyuAc());

  form.addEventListener('submit', async olay => {
    olay.preventDefault();
    hata.textContent = '';
    const dugme = form.querySelector('button[type="submit"]');
    dugme.disabled = true;
    try {
      const govde = {
        ad: form.ad.value, kullanici: form.kullanici.value, partner: form.partner.value,
        koordinator: form.koordinator.checked,
      };
      if (duzenlenen) {
        await iste(`api/kullanicilar/${duzenlenen.id}`, { method: 'PUT', body: JSON.stringify(govde) });
        /* Kendi adını ya da kurumunu değiştirdiyse üst banttaki rozet de güncellensin. */
        if (duzenlenen.id === durum.kullanici.id) { location.reload(); return; }
      } else {
        await iste('api/kullanicilar', { method: 'POST', body: JSON.stringify({ ...govde, parola: form.parola.value }) });
      }
      kutu.close();
      await yukle();
    } catch (err) {
      hata.textContent = err.message;
    } finally {
      dugme.disabled = false;
    }
  });
})();
