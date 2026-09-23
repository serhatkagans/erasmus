import { randomBytes } from 'node:crypto';
import { ValidationError, checkPassword, hashPassword, verifyPassword, normalizeUsername } from '../lib/data.mjs';
import { send, body, digest, sessionCookie, sessionToken, clientIp, tooManyAttempts, clearAttempts } from '../lib/http.mjs';
import { SESSION_HOURS } from '../lib/ayar.mjs';

/**
 * Oturum uçları: giriş, çıkış ve parola değiştirme.
 *
 * Oturum jetonu istemciye ham gönderilir, veritabanında yalnızca SHA-256
 * özeti durur: veritabanı kopyası sızsa bile jetonlar doğrudan kullanılamaz.
 */
export function oturumRoutes({ db }) {
  const newSession = async userId => {
    const token = randomBytes(32).toString('hex');
    const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
    await db.run('INSERT INTO sessions (token,user_id,expires) VALUES (?,?,?)', [digest(token), userId, expires]);
    /* Süresi dolmuş kayıtlar burada temizlenir; ayrı bir zamanlayıcıya
       gerek kalmıyor, tablo da şişmiyor. */
    await db.run('DELETE FROM sessions WHERE expires<?', [Date.now()]);
    return token;
  };

  return async function handle({ req, res, url, user, token }) {
    if (url.pathname === '/api/giris' && req.method === 'POST') {
      const data = await body(req);
      const username = normalizeUsername(data.kullanici).slice(0, 100);
      const ip = clientIp(req);
      /* Kullanıcı+adres çifti dar, adres tek başına geniş sınıra tabi:
         biri tek hesabı hedefleyen denemeyi, öteki dağınık taramayı keser. */
      const keys = [[`u:${username}:${ip}`, 5], [`ip:${ip}`, 30]];
      if (tooManyAttempts(keys)) return send(res, 429, { error: 'giris.cokdeneme' });

      const account = await db.get('SELECT id,password FROM users WHERE username=?', [username]);
      /* Hesap yoksa da parola doğrulaması kadar süre harcanmalı ki yanıt
         süresinden hesabın varlığı anlaşılmasın. */
      const ok = account ? verifyPassword(String(data.parola || ''), account.password)
        : verifyPassword(String(data.parola || ''), hashPassword('bos'));
      if (!account || !ok) return send(res, 401, { error: 'giris.hata' });

      clearAttempts(keys.map(([key]) => key));
      res.setHeader('Set-Cookie', sessionCookie(await newSession(account.id), SESSION_HOURS * 3600));
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/cikis' && req.method === 'POST') {
      if (token) await db.run('DELETE FROM sessions WHERE token=?', [digest(token)]);
      res.setHeader('Set-Cookie', sessionCookie('', 0));
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/parola' && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'Önce giriş yapın.' });
      const data = await body(req);
      const account = await db.get('SELECT password FROM users WHERE id=?', [user.id]);
      if (!verifyPassword(String(data.mevcut || ''), account.password)) {
        throw new ValidationError('Mevcut parolanız hatalı.');
      }
      const next = checkPassword(data.yeni);
      if (next === String(data.mevcut)) throw new ValidationError('Yeni parola eskisinden farklı olmalı.');
      await db.run('UPDATE users SET password=? WHERE id=?', [hashPassword(next), user.id]);
      /* Parola değişince diğer cihazlardaki oturumlar kapanır; bu oturum
         yeni bir jetonla sürdürülür ki kullanıcı kendi ekranından atılmasın. */
      await db.run('DELETE FROM sessions WHERE user_id=?', [user.id]);
      res.setHeader('Set-Cookie', sessionCookie(await newSession(user.id), SESSION_HOURS * 3600));
      return send(res, 200, { ok: true });
    }
  };
}

export { sessionToken };
