import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ValidationError, PROJECT, partners, workPackages, types, statuses, venues, languages, MIN_PASSWORD } from './lib/data.mjs';
import { openDb } from './lib/db.mjs';
import { send, digest, sessionToken, sameOrigin, langCookie } from './lib/http.mjs';
import { dictionary, negotiate, coverage } from './lib/i18n.mjs';
import { port, origin, basePath } from './lib/ayar.mjs';
import { etkinlikRoutes } from './routes/etkinlik.mjs';
import { oturumRoutes } from './routes/oturum.mjs';
import { ekipRoutes } from './routes/ekip.mjs';
import { formRoutes } from './routes/form.mjs';
import { hatirlaticiRoutes } from './routes/hatirlatici.mjs';
import { raporRoutes } from './routes/rapor.mjs';
import { belgeRoutes } from './routes/belge.mjs';
import { klasorRoutes } from './routes/klasor.mjs';
import { profilRoutes } from './routes/profil.mjs';
import { kullanicilarRoutes } from './routes/kullanicilar.mjs';
import { ciktiRoutes } from './routes/cikti.mjs';
import { faaliyetRoutes } from './routes/faaliyet.mjs';
import { panoRoutes } from './routes/pano.mjs';

/**
 * HTTP sunucusu: ortak başlıklar, oturum ve dil çözümü, yönlendirme zinciri
 * ve statik dosyalar. Uçların kendisi `routes/` altındadır.
 *
 * Yönlendirme zinciri sırayla denenir: bir işleyici isteği karşıladıysa
 * DOĞRU döner (lib/http.mjs `send` bunu sağlar), karşılamadıysa hiçbir şey
 * döndürmez ve sıra bir sonrakine geçer. Sonunda hiçbiri sahiplenmezse
 * statik dosyalara, oradan da 404'e düşülür.
 *
 * PLATFORM DIŞARIYA KAPALIDIR (kullanıcı kararı, 23 Eylül 2026: "ziyaretçi
 * yok, herkes üye olacak"). Oturumsuz istek yalnızca giriş sayfasına ve
 * NFC profil kartlarına ulaşır; kart, dağıtıldığı kişilerin girişi
 * olmadığı için bilinçli istisnadır. Kural route'lara tek tek yazılmadı,
 * aşağıdaki KAPI'da durur: yeni eklenen bir uç ya da sayfa kendiliğinden
 * kapalı doğar, açmak için bu listeye eklemek gerekir.
 */
const ACIK_API = new Set(['/api/acilis', '/api/giris', '/api/cikis', '/api/profil', '/api/profil/foto']);
const ACIK_SAYFA = new Set(['/giris.html', '/profil.html']);
const db = await openDb();

const etkinlik = etkinlikRoutes({ db });
const oturum = oturumRoutes({ db });
const ekip = ekipRoutes({ db });
const form = formRoutes({ db }).handle;
const hatirlatici = hatirlaticiRoutes({ db });
const rapor = raporRoutes({ db });
const belge = belgeRoutes({ db });
const klasorler = klasorRoutes({ db });
const profil = profilRoutes({ db });
const kullanicilar = kullanicilarRoutes({ db });
const cikti = ciktiRoutes({ db });
const faaliyet = faaliyetRoutes({ db });
const pano = panoRoutes({ db });

const FILES = {
  '/index.html': ['index.html', 'text/html'],
  '/takvim.html': ['takvim.html', 'text/html'],
  '/giris.html': ['giris.html', 'text/html'],
  '/ekip.html': ['ekip.html', 'text/html'],
  '/formlar.html': ['formlar.html', 'text/html'],
  '/belge.html': ['belge.html', 'text/html'],
  '/klasorler.html': ['klasorler.html', 'text/html'],
  '/profil.html': ['profil.html', 'text/html'],
  '/profil.js': ['profil.js', 'text/javascript'],
  '/kullanicilar.html': ['kullanicilar.html', 'text/html'],
  '/kullanicilar.js': ['kullanicilar.js', 'text/javascript'],
  '/ciktilar.html': ['ciktilar.html', 'text/html'],
  '/ciktilar.js': ['ciktilar.js', 'text/javascript'],
  '/pano.html': ['pano.html', 'text/html'],
  '/pano.js': ['pano.js', 'text/javascript'],
  '/ortak.js': ['ortak.js', 'text/javascript'],
  '/anasayfa.js': ['anasayfa.js', 'text/javascript'],
  '/takvim.js': ['takvim.js', 'text/javascript'],
  '/giris.js': ['giris.js', 'text/javascript'],
  '/ekip.js': ['ekip.js', 'text/javascript'],
  '/formlar.js': ['formlar.js', 'text/javascript'],
  '/belge.js': ['belge.js', 'text/javascript'],
  '/klasorler.js': ['klasorler.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/belge.css': ['belge.css', 'text/css'],
  '/klasorler.css': ['klasorler.css', 'text/css'],
  '/form.css': ['form.css', 'text/css'],
  '/logo.png': ['logo.png', 'image/png'],
  '/logo-tam.jpg': ['logo-tam.jpg', 'image/jpeg'],
  '/ab-amblem.svg': ['ab-amblem.svg', 'image/svg+xml'],
};

async function staticFile(req, res, url, readOnly) {
  const wanted = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!FILES[wanted] || !readOnly) return;
  const [file, type] = FILES[wanted];
  const content = await readFile(new URL('./public/' + file, import.meta.url));
  const etag = '"' + createHash('sha256').update(content).digest('hex').slice(0, 32) + '"';
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
  const charset = type.startsWith('text/') || type.endsWith('javascript') || type.endsWith('svg+xml') ? '; charset=utf-8' : '';
  res.writeHead(200, { 'Content-Type': type + charset, 'Content-Length': content.length });
  return res.end(req.method === 'HEAD' ? undefined : content);
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  /* Kapalı platform arama motorlarında görünmesin (profil kartları dahil). */
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");

  try {
    const url = new URL(req.url, origin);
    const readOnly = ['GET', 'HEAD'].includes(req.method);
    if (!readOnly && !sameOrigin(req)) {
      return send(res, 403, { error: `İstek kaynağı doğrulanamadı. Sayfayı ${origin}${basePath} adresinden açın.` });
    }
    if (!readOnly) res.setHeader('Cache-Control', 'no-store');

    const token = sessionToken(req);
    const user = token
      ? await db.get('SELECT u.id,u.username,u.ad,u.partner,u.koordinator FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',
          [digest(token), Date.now()])
      : undefined;
    if (user) user.koordinator = !!user.koordinator;

    const dil = negotiate(req, url);
    /* Adres çubuğundan seçilen dil çereze yazılır ki sonraki sayfalarda
       `?dil=` taşımak gerekmesin. */
    if (url.searchParams.get('dil') === dil) res.setHeader('Set-Cookie', langCookie(dil));

    /* KAPI: oturumsuz istek. Sayfa istendiyse girişe yönlendirilir ve
       girişten sonra geri dönülecek adres taşınır; API 401 alır. Görsel,
       stil ve betik dosyaları açıktır — veri taşımazlar, giriş sayfası da
       onlarla çiziliyor. */
    if (!user) {
      const sayfa = url.pathname === '/' ? '/index.html' : url.pathname;
      if (url.pathname.startsWith('/api/') ? !ACIK_API.has(url.pathname) : url.pathname === '/takvim.ics') {
        return send(res, 401, { error: 'genel.girisGerekli' });
      }
      if (FILES[sayfa]?.[1] === 'text/html' && !ACIK_SAYFA.has(sayfa)) {
        const geri = sayfa === '/index.html' ? '' : `?geri=${encodeURIComponent(sayfa.slice(1) + url.search)}`;
        res.writeHead(302, { Location: `giris.html${geri}`, 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
    }

    const ctx = { req, res, url, user, token, readOnly, dil };

    if (url.pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');

    /* Arayüzün açılışta ihtiyaç duyduğu her şey tek istekte: sözlük, proje
       künyesi, listeler ve oturum durumu. Ayrı ayrı çağrılsaydı sayfa
       çizilene kadar dört gidiş-dönüş beklenirdi. */
    if (url.pathname === '/api/acilis' && req.method === 'GET') {
      const { sozluk, eksik } = await dictionary(dil);
      return send(res, 200, {
        dil,
        sozluk,
        eksikCeviri: eksik,
        /* Tüm diller gönderilir, yayında olmayanlar da: arayüz onları
           "yakında" diye gösterir. Hangilerinin geleceğini görmek, listenin
           bir gün uzayacağını bilmekten daha yararlı. */
        diller: languages.map(({ code, name, ready }) => ({ code, name, ready })),
        proje: PROJECT,
        ortaklar: partners,
        ispaketleri: workPackages.map(w => w.id),
        turler: types,
        durumlar: statuses,
        yerler: venues,
        minParola: MIN_PASSWORD,
        kullanici: user ? { id: user.id, kullanici: user.username, ad: user.ad, partner: user.partner, koordinator: user.koordinator } : null,
      });
    }

    /* Çeviri durumu: hangi dil ne kadar tamam. Yeni dil eklerken bakılır. */
    if (url.pathname === '/api/ceviri-durumu' && req.method === 'GET') {
      return send(res, 200, { diller: await coverage() });
    }

    if (await etkinlik(ctx)) return;
    if (await oturum(ctx)) return;
    if (await ekip(ctx)) return;
    if (await form(ctx)) return;
    if (await hatirlatici(ctx)) return;
    if (await rapor(ctx)) return;
    if (await belge(ctx)) return;
    if (await klasorler(ctx)) return;
    if (await profil(ctx)) return;
    if (await kullanicilar(ctx)) return;
    if (await cikti(ctx)) return;
    if (await faaliyet(ctx)) return;
    if (await pano(ctx)) return;
    if (await staticFile(req, res, url, readOnly)) return;

    send(res, 404, { error: 'Sayfa bulunamadı.' });
  } catch (err) {
    if (err instanceof ValidationError) return send(res, 400, { error: err.message });
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'İşlem tamamlanamadı.' });
  }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, process.env.HOST || '127.0.0.1',
  () => console.log(`${PROJECT.acronym} platformu: ${origin}${basePath} (${db.kind})`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(async () => { await db.close(); process.exit(0); }));
}
