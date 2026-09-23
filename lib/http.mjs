import { createHash } from 'node:crypto';
import { ValidationError } from './data.mjs';
import { origin, basePath, secure, trustProxy } from './ayar.mjs';

/**
 * HTTP katmanının ortak parçaları: yanıt yazımı, gövde okuma, köken denetimi
 * ve giriş denemesi sayacı. `routes/*.mjs` bunları paylaşır.
 *
 * `send` ve `res.end` bilerek DOĞRU (truthy) döner: bir route işleyicisi
 * "bu isteği ben karşıladım" bilgisini `return send(...)` yazarak verir,
 * karşılamadığında hiçbir şey döndürmez ve sıra bir sonrakine geçer
 * (bkz. server.mjs yönlendirme zinciri).
 */
export const send = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
  return true;
};

export const ICS = 'text/calendar; charset=utf-8';

/* Rapor çıktılarının MIME türleri (bkz. routes/rapor.mjs). */
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const ZIP = 'application/zip';

export const digest = token => createHash('sha256').update(token).digest('hex');

export const sessionCookie = (token, age) =>
  `session=${token}; HttpOnly; SameSite=Strict; Path=${basePath || '/'}; Max-Age=${age}${secure ? '; Secure' : ''}`;

/* Dil tercihi gizli değildir ve istemci betiği de okur: HttpOnly değil. */
export const langCookie = code =>
  `dil=${code}; SameSite=Lax; Path=${basePath || '/'}; Max-Age=${60 * 60 * 24 * 365}${secure ? '; Secure' : ''}`;

/** İstekteki oturum çerezi (ham jeton; veritabanında yalnızca özeti durur). */
export const sessionToken = req =>
  (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8) || '';

/**
 * Vekil (nginx, Apache mod_proxy) gördüğü adresi X-Forwarded-For zincirinin
 * SONUNA ekler; baştaki değerleri istemci kendisi yazmış olabilir. Bu yüzden
 * son eleman alınır. X-Real-IP okunmaz: taklit edilebildiği için giriş
 * denemesi sayacı başlık değiştirilerek atlatılabilirdi.
 */
export function clientIp(req) {
  if (!trustProxy) return req.socket.remoteAddress || 'bilinmiyor';
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  return chain.at(-1) || req.socket.remoteAddress || 'bilinmiyor';
}

/**
 * CSRF koruması: yazma isteklerinde tarayıcının yazdığı `Origin` başlığı
 * denetlenir.
 *
 * Yalnızca PUBLIC_ORIGIN ile karşılaştırmak yetmez — sunucuyu
 * `http://127.0.0.1:3020` yazarak açan kişide giriş 403 dönerdi, çünkü
 * varsayılan köken `http://localhost:3020`. Bu yüzden isteğin kendi `Host`
 * başlığıyla eşleşme de kabul edilir: başka bir siteden gelen istekte
 * `Origin` saldırganın alan adı, `Host` hedef sunucu olacağı için bu ikisi
 * asla uyuşmaz; koruma zayıflamaz.
 *
 * Origin hiç yoksa istek reddedilir: tarayıcılar aynı köken içindeki
 * POST/PUT/DELETE isteklerinde bu başlığı gönderir.
 */
export function sameOrigin(req) {
  const source = req.headers.origin;
  if (!source) return false;
  if (source === origin) return true;
  try { return !!req.headers.host && new URL(source).host === req.headers.host; } catch { return false; }
}

export async function body(req, limit = 64000) {
  let data = '';
  for await (const part of req) {
    data += part;
    if (Buffer.byteLength(data) > limit) throw new ValidationError('İstek çok büyük.');
  }
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new ValidationError('Geçersiz istek.'); }
}

const attempts = new Map();

/**
 * Sabit pencereli giriş denemesi sayacı.
 *
 * Anahtar hem adresi hem kullanıcı adını içerir: tek bir saldırganın yanlış
 * parolayla bütün ortakların girişini kilitlemesi böylece engellenir. Adres
 * başına daha geniş ikinci bir sayaç dağınık denemeleri sınırlar. Sayaç
 * süreç içi bellektedir; uygulama tek kopya çalıştığı sürece doğrudur.
 */
export function tooManyAttempts(keys) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  for (const [key, limit] of keys) {
    const record = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (record.count >= limit) return true;
    record.count++; attempts.set(key, record);
  }
  return false;
}

/** Başarılı girişte o kullanıcının ve adresin sayacı sıfırlanır. */
export const clearAttempts = keys => { for (const key of keys) attempts.delete(key); };

/** Fotoğraf yüklemesi: ham gövde. Sınırı aşan istek okunmayı bitirmeden
 *  reddedilir — tüm dosyayı belleğe alıp sonra bakmak gereksiz yük olurdu. */
export async function rawBody(req, limit) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw new ValidationError(`Dosya en fazla ${Math.round(limit / 1048576)} MB olabilir.`);
    parts.push(part);
  }
  return Buffer.concat(parts);
}
