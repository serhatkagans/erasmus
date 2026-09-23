import { baslat, iste } from './ortak.js';

/**
 * Giriş. Platform dışarıya kapalı: oturumsuz her sayfa isteği buraya
 * `?geri=<sayfa>` ile yönlenir, girişten sonra o sayfaya dönülür.
 */
(async () => {
  await baslat();

  const form = document.getElementById('giris-form');
  const hata = document.getElementById('giris-hata');

  form.addEventListener('submit', async olay => {
    olay.preventDefault();
    const dugme = form.querySelector('button[type="submit"]');
    hata.textContent = '';
    dugme.disabled = true;
    try {
      await iste('api/giris', {
        method: 'POST',
        body: JSON.stringify({ kullanici: form.kullanici.value, parola: form.parola.value }),
      });
      /* Kapıdan yönlendirilen kişi istediği sayfaya döner. Yalnızca bu
         sitenin sayfa adı kabul edilir; `geri=https://...` ile dışarı
         yönlendirme (açık yönlendirme) mümkün olmasın. */
      const geri = new URLSearchParams(location.search).get('geri') || '';
      location.href = /^[a-z]+\.html(\?[\w=&%.-]*)?$/.test(geri) ? geri : 'pano.html';
    } catch (err) {
      hata.textContent = err.message;
      form.parola.value = '';
      form.parola.focus();
    } finally {
      dugme.disabled = false;
    }
  });
})();
