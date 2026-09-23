import { ValidationError, normalizeUsername, sniffPhoto, PHOTO_TYPES } from '../lib/data.mjs';
import { send, rawBody } from '../lib/http.mjs';

/**
 * Herkese açık kişi profili (dijital kartvizit): `profil.html?u=<kullanici>`.
 *
 * Oturum istemez — adres NFC etiketine yazılıp dağıtılır. Bu yüzden
 * yalnızca kartta görünen alanlar döner: ad, kullanıcı adı, kurum ve
 * fotoğrafın sürümü. Parola özeti, koordinatör bayrağı ve hesap numarası
 * ASLA bu uçtan çıkmaz; kimlik numarası zaten hiçbir yerde tutulmuyor.
 *
 * FOTOĞRAF herkese açık okunur; yalnızca kişinin kendisi ve proje
 * yöneticisi (koordinatör) yükler ya da kaldırır. Tarayıcı fotoğrafı
 * yüklemeden önce kare kırpıp küçültür (~100 KB); sunucudaki sınır buna
 * göre dardır ve tür yine baytlardan çıkarılır.
 */
export const MAX_PROFIL_FOTO = 2 * 1024 * 1024;

export function profilRoutes({ db }) {
  const kisiBul = async u => {
    const kullanici = normalizeUsername(u).slice(0, 100);
    return kullanici ? db.get('SELECT id,username,ad,partner FROM users WHERE username=?', [kullanici]) : null;
  };

  return async function handle({ req, res, url, user, readOnly }) {
    if (url.pathname === '/api/profil' && readOnly) {
      const kisi = await kisiBul(url.searchParams.get('u'));
      if (!kisi) return send(res, 404, { error: 'profil.yok' });
      const foto = await db.get('SELECT updated FROM user_photos WHERE user_id=?', [kisi.id]);
      return send(res, 200, { kullanici: kisi.username, ad: kisi.ad || kisi.username, partner: kisi.partner, foto: foto?.updated || null });
    }

    if (url.pathname !== '/api/profil/foto') return;
    const kisi = await kisiBul(url.searchParams.get('u'));

    if (readOnly) {
      const foto = kisi && await db.get('SELECT tur,veri FROM user_photos WHERE user_id=?', [kisi.id]);
      if (!foto) return send(res, 404, { error: 'profil.yok' });
      const veri = Buffer.isBuffer(foto.veri) ? foto.veri : Buffer.from(foto.veri);
      res.writeHead(200, {
        'Content-Type': foto.tur,
        'Content-Length': veri.length,
        /* Adres `&v=<sürüm>` taşır; yeni fotoğraf yeni adres demektir. */
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': 'inline',
      });
      res.end(req.method === 'HEAD' ? undefined : veri);
      return true;
    }

    if (!user) return send(res, 401, { error: 'kullanicilar.hata.giris' });
    if (!kisi) return send(res, 404, { error: 'profil.yok' });
    if (user.id !== kisi.id && !user.koordinator) return send(res, 403, { error: 'profil.hata.yetki' });

    if (req.method === 'PUT') {
      const veri = await rawBody(req, MAX_PROFIL_FOTO);
      const tur = veri.length ? sniffPhoto(veri) : null;
      if (!tur || !PHOTO_TYPES[tur]) throw new ValidationError('profil.hata.tur');
      const updated = new Date().toISOString();
      await db.run('DELETE FROM user_photos WHERE user_id=?', [kisi.id]);
      await db.run('INSERT INTO user_photos (user_id,tur,veri,updated) VALUES (?,?,?,?)', [kisi.id, tur, veri, updated]);
      return send(res, 200, { foto: updated });
    }

    if (req.method === 'DELETE') {
      await db.run('DELETE FROM user_photos WHERE user_id=?', [kisi.id]);
      return send(res, 200, { foto: null });
    }
  };
}
