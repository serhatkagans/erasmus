import { baslat, iste } from './ortak.js';

/**
 * Ortak girişi. Başarılı girişten sonra takvime yönlendirilir — giriş
 * yapmanın tek sebebi program üzerinde çalışmaktır.
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
      location.href = 'takvim.html';
    } catch (err) {
      hata.textContent = err.message;
      form.parola.value = '';
      form.parola.focus();
    } finally {
      dugme.disabled = false;
    }
  });
})();
