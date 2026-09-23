import { ValidationError, partnerIds, checkUsername, checkPassword, hashPassword, requireText } from '../lib/data.mjs';
import { send, body, digest } from '../lib/http.mjs';
import { hesabiSil } from '../lib/hesap.mjs';

/**
 * Kullanıcı yönetimi: yalnızca proje yöneticisi (koordinatör).
 *
 * Hesaplar önce yalnızca komut satırından (`scripts/kullanici.mjs`)
 * açılıyordu; kullanıcı isteğiyle (23 Eylül 2026) arayüze de geldi.
 * Liste, ekleme, düzenleme, parola sıfırlama ve silme burada.
 *
 * Yanıtta parola özeti ASLA yoktur. Hata iletileri çeviri anahtarıdır;
 * arayüz onları isteğin dilinde gösterir.
 */
export function kullanicilarRoutes({ db }) {
  const shape = r => ({ id: r.id, kullanici: r.username, ad: r.ad, partner: r.partner, koordinator: !!r.koordinator });

  const sifirlaYolu = /^\/api\/kullanicilar\/(\d+)\/parola$/;
  const hesapYolu = /^\/api\/kullanicilar\/(\d+)$/;

  return async function handle({ req, res, url, user, token }) {
    const sifirla = sifirlaYolu.exec(url.pathname);
    const hesap = hesapYolu.exec(url.pathname);
    if (url.pathname !== '/api/kullanicilar' && !sifirla && !hesap) return;
    if (!user) return send(res, 401, { error: 'kullanicilar.hata.giris' });
    if (!user.koordinator) return send(res, 403, { error: 'kullanicilar.hata.yetki' });

    /* Parola sıfırlama: yönetici yeni parolayı belirler ve kişiye iletir.
       Eski parolayı bilmek gerekmez — unutulan parolanın tek çaresi budur.
       Kişinin açık oturumları kapanır; yönetici kendi parolasını buradan
       sıfırlarsa yalnızca bu oturumu korunur. */
    if (sifirla) {
      if (req.method !== 'POST') return;
      const hedef = await db.get('SELECT id FROM users WHERE id=?', [Number(sifirla[1])]);
      if (!hedef) return send(res, 404, { error: 'kullanicilar.hata.yok' });
      const veri = await body(req);
      let parola;
      try { parola = checkPassword(veri.parola); }
      catch { throw new ValidationError('kullanicilar.hata.parola'); }
      await db.run('UPDATE users SET password=? WHERE id=?', [hashPassword(parola), hedef.id]);
      await db.run('DELETE FROM sessions WHERE user_id=? AND token<>?', [hedef.id, token ? digest(token) : '']);
      return send(res, 200, { ok: true });
    }

    /* Silme. Yönetici KENDİNİ silemez: son yönetici kendini silerse kimse
       hesap açamaz, parola sıfırlayamaz — kurtarmak sunucuya erişim ister.
       Kendini silme yasağı "en az bir yönetici kalır"ı da kendiliğinden
       sağlar: silen kişi her zaman yöneticidir ve yerinde kalır. */
    /* Düzenleme: ad, kullanıcı adı, kurum, yetki. Parola buradan değişmez
       (ayrı uç: sıfırlama). Yönetici KENDİ tam yetkisini kaldıramaz — son
       yönetici kendini kurum hesabına düşürürse kimse geri veremez. */
    if (hesap && req.method === 'PUT') {
      const hedef = await db.get('SELECT id,username,koordinator FROM users WHERE id=?', [Number(hesap[1])]);
      if (!hedef) return send(res, 404, { error: 'kullanicilar.hata.yok' });
      const veri = await body(req);
      const ad = requireText(veri.ad, 'Ad soyad', { max: 120 });
      let kullanici;
      try { kullanici = checkUsername(veri.kullanici); }
      catch { throw new ValidationError('kullanicilar.hata.kullaniciAdi'); }
      if (!partnerIds.includes(veri.partner)) throw new ValidationError('kullanicilar.hata.kurum');
      const koordinator = veri.koordinator === true;
      if (hedef.id === user.id && !koordinator) return send(res, 400, { error: 'kullanicilar.hata.kendiYetki' });
      if (kullanici !== hedef.username && await db.get('SELECT id FROM users WHERE username=?', [kullanici])) {
        return send(res, 409, { error: 'kullanicilar.hata.var' });
      }
      await db.run('UPDATE users SET username=?,ad=?,partner=?,koordinator=? WHERE id=?',
        [kullanici, ad, veri.partner, koordinator ? 1 : 0, hedef.id]);
      return send(res, 200, shape(await db.get('SELECT id,username,ad,partner,koordinator FROM users WHERE id=?', [hedef.id])));
    }

    if (hesap) {
      if (req.method !== 'DELETE') return;
      const hedef = await db.get('SELECT id FROM users WHERE id=?', [Number(hesap[1])]);
      if (!hedef) return send(res, 404, { error: 'kullanicilar.hata.yok' });
      if (hedef.id === user.id) return send(res, 400, { error: 'kullanicilar.hata.kendini' });
      await hesabiSil(db, hedef.id);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET') {
      const satirlar = await db.all('SELECT id,username,ad,partner,koordinator FROM users ORDER BY partner, ad, username');
      return send(res, 200, { kullanicilar: satirlar.map(shape) });
    }

    if (req.method === 'POST') {
      const veri = await body(req);
      const ad = requireText(veri.ad, 'Ad soyad', { max: 120 });
      let kullanici;
      try { kullanici = checkUsername(veri.kullanici); }
      catch { throw new ValidationError('kullanicilar.hata.kullaniciAdi'); }
      if (!partnerIds.includes(veri.partner)) throw new ValidationError('kullanicilar.hata.kurum');
      let parola;
      try { parola = checkPassword(veri.parola); }
      catch { throw new ValidationError('kullanicilar.hata.parola'); }
      if (await db.get('SELECT id FROM users WHERE username=?', [kullanici])) {
        return send(res, 409, { error: 'kullanicilar.hata.var' });
      }
      const id = await db.insert('INSERT INTO users (username,password,ad,partner,koordinator) VALUES (?,?,?,?,?)',
        [kullanici, hashPassword(parola), ad, veri.partner, veri.koordinator === true ? 1 : 0]);
      return send(res, 201, shape(await db.get('SELECT id,username,ad,partner,koordinator FROM users WHERE id=?', [id])));
    }
  };
}
