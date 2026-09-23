import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Test yardımcıları.
 *
 * İki ayrı katman var ve ikisi bilerek ayrı duruyor:
 *
 *   · SAF TESTLER (`data`, `belge`) hiçbir şey açmaz: kural dosyalarını
 *     doğrudan çağırır, milisaniyede biter.
 *   · UÇTAN UCA TESTLER (`yetki`) GERÇEK SUNUCUYU başlatır ve `fetch` ile
 *     konuşur. Yetki kuralları tek bir işlevde durmuyor — oturum, CSRF,
 *     route ve veritabanı birlikte karar veriyor. Bu kuralları işlevleri
 *     tek tek çağırarak denemek, asıl sorulan soruyu ("bu istek geçer mi")
 *     sormamak olurdu.
 *
 * Her sunucu KENDİ GEÇİCİ VERİTABANINI alır (`DATA_DIR`): testler
 * birbirinin ve geliştirme verisinin üstüne yazmaz.
 */

const KOK = fileURLToPath(new URL('..', import.meta.url));

/** Kullanılabilir bir port: 0'a bağlanıp çekirdeğin verdiği numarayı alır. */
async function bosPort() {
  const { createServer } = await import('node:net');
  return new Promise((coz, at) => {
    const s = createServer();
    s.on('error', at);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => coz(port));
    });
  });
}

const calistir = (dosya, argumanlar, env) => new Promise((coz, at) => {
  const c = spawn(process.execPath, [dosya, ...argumanlar], { cwd: KOK, env: { ...process.env, ...env } });
  let cikti = '';
  c.stdout.on('data', p => { cikti += p; });
  c.stderr.on('data', p => { cikti += p; });
  c.on('close', kod => (kod === 0 ? coz(cikti) : at(new Error(`${dosya} ${kod} ile bitti:\n${cikti}`))));
});

/**
 * Geçici veritabanıyla bir sunucu başlatır, hesapları açar ve adresi verir.
 * `kapat()` çağrılınca süreç durdurulur ve geçici dizin silinir.
 */
export async function sunucuBaslat({ hesaplar = [] } = {}) {
  const dizin = mkdtempSync(join(tmpdir(), 'eyp-test-'));
  const port = await bosPort();
  const env = { DATA_DIR: dizin, PORT: String(port), DATABASE_URL: '', PUBLIC_ORIGIN: `http://127.0.0.1:${port}` };

  /* Hesaplar sunucudan önce açılır: aynı SQLite dosyasına iki süreç aynı
     anda yazmaya çalışmasın. */
  for (const h of hesaplar) {
    await calistir('scripts/kullanici.mjs',
      ['ekle', h.kullanici, h.kurum, h.parola, ...(h.koordinator ? ['--koordinator'] : []), '--ad', h.ad || h.kullanici],
      env);
  }

  const surec = spawn(process.execPath, ['server.mjs'], { cwd: KOK, env: { ...process.env, ...env } });
  let gunluk = '';
  surec.stdout.on('data', p => { gunluk += p; });
  surec.stderr.on('data', p => { gunluk += p; });

  const taban = `http://127.0.0.1:${port}`;
  /* Sunucunun dinlemeye başlamasını bekler: sabit bir uyku yerine gerçek
     bir isteğin yanıt vermesi beklenir. */
  for (let deneme = 0; deneme < 100; deneme++) {
    if (surec.exitCode !== null) throw new Error(`Sunucu başlamadı:\n${gunluk}`);
    try {
      await fetch(`${taban}/api/acilis`);
      break;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return {
    taban,
    gunluk: () => gunluk,
    async kapat() {
      surec.kill();
      await new Promise(r => surec.on('close', r));
      rmSync(dizin, { recursive: true, force: true });
    },
  };
}

/**
 * Oturum açmış bir istemci.
 *
 * Çerezi kendisi taşır ve YAZMA İSTEKLERİNE `Origin` EKLER — sunucu CSRF
 * koruması için bu başlığı arar (bkz. lib/http.mjs · sameOrigin). Başlığın
 * eksik olduğu durumu ayrıca sınamak için `origin: false` geçilir.
 */
export async function istemci(sunucu, kimlik = null) {
  let cerez = '';

  const iste = async (yol, { method = 'GET', body, ham, origin = true, headers = {} } = {}) => {
    const h = { ...headers };
    if (cerez) h.cookie = cerez;
    if (body !== undefined) h['content-type'] = 'application/json';
    if (origin && method !== 'GET') h.origin = sunucu.taban;

    /* `ham`: JSON olmayan gövde (dosya yükleme). */
    const yanit = await fetch(sunucu.taban + yol, {
      method, headers: h,
      body: ham !== undefined ? ham : body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const kur = yanit.headers.getSetCookie?.() || [];
    for (const satir of kur) if (satir.startsWith('session=')) cerez = satir.split(';')[0];

    /* Gövde burada bir kez okunur: JSON ise çözülür, değilse ham bayt
       kalır (rapor çıktıları zip paketidir). Çağıran `yanit.json()`
       çağırmaya kalkarsa "body already read" alırdı. */
    const tur = yanit.headers.get('content-type') || '';
    const veri = tur.includes('json') ? await yanit.json() : Buffer.from(await yanit.arrayBuffer());
    return { durum: yanit.status, veri, tur, basliklar: yanit.headers };
  };

  if (kimlik) {
    const giris = await iste('/api/giris', { method: 'POST', body: kimlik });
    if (giris.durum !== 200) throw new Error(`Giriş başarısız (${giris.durum}): ${JSON.stringify(giris.veri)}`);
  }
  return { iste };
}

/** Testlerde kullanılan sabit hesaplar. */
export const HESAPLAR = [
  { kullanici: 'test-koordinator', kurum: 'hbv', parola: 'TestParolasi2026!', koordinator: true, ad: 'Test Koordinatör' },
  { kullanici: 'test-ortak', kurum: 'geoclub', parola: 'TestParolasi2026!', ad: 'Test Ortak' },
  /* İkinci ortak: "başka kurumun dosyasını değiştiremez" gibi iki ortak
     arasındaki sınırlar ancak iki ortak hesabıyla sınanabilir. */
  { kullanici: 'test-cecf', kurum: 'cecf', parola: 'TestParolasi2026!', ad: 'Test CECF' },
];
export const KOORDINATOR = { kullanici: 'test-koordinator', parola: 'TestParolasi2026!' };
export const ORTAK = { kullanici: 'test-ortak', parola: 'TestParolasi2026!' };
export const ORTAK2 = { kullanici: 'test-cecf', parola: 'TestParolasi2026!' };
