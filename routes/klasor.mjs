import { ValidationError } from '../lib/data.mjs';
import { send, body, rawBody } from '../lib/http.mjs';
import {
  KLASORLER, klasorDogrula, adAnahtari, yukleyebilir, dosyaYetkisi,
  dosyaBilgisi, aciklamaDogrula, MAX_KLASOR_BYTES, KLASOR_TURLERI, MAX_ACIKLAMA, BUTCE, TAKVIM, bagliParca,
} from '../lib/klasor.mjs';
import { parcalar, DOSYA_TURLERI } from '../lib/faaliyet.mjs';

/**
 * Proje klasörleri (kurallar için bkz. lib/klasor.mjs):
 *   /api/klasorler                          ağaç + dosyalar (GET)
 *   /api/klasorler/dosya?klasor=01.1        yeni dosya (POST, ham gövde)
 *   /api/klasorler/dosya/:id                taşı / açıklama (PUT), sil (DELETE)
 *   /api/klasorler/dosya/:id/surum          yeni sürüm (POST, ham gövde)
 *   /api/klasorler/dosya/:id/surumler       sürüm geçmişi (GET)
 *   /api/klasorler/dosya/:id/kisayol        kısayol ekle (POST { klasor })
 *   /api/klasorler/dosya/:id/kisayol/:k     kısayolu kaldır (DELETE)
 *   /api/klasorler/surum/:sid               sürümü indir (GET)
 *
 * Hepsi giriş ister. Hata iletileri çeviri anahtarıdır; istemci sözlükten
 * çözer (bkz. public/ortak.js · iste).
 *
 * Toplantı klasörlerinin faaliyet dosyasına bağlı iç klasörleri (bkz.
 * lib/klasor.mjs · IC_PARCA) kendi dosyası tutmaz: listede faaliyetin
 * dosyaları görünür, yükleme ve silme /api/etkinlikler/:id/dosya ve
 * /api/faaliyet-dosya/:id üzerinden, faaliyetin yetkisiyle yapılır. Bu
 * klasörlere klasör dosyası yüklenemez, taşınamaz, kısayol konamaz.
 *
 * Liste sorgusu dosya İÇERİĞİNİ taşımaz — fotoğraflardaki karar: yüzlerce
 * belgeyle liste megabaytlarca olurdu. İçerik sürüm sürüm ayrı iner.
 */
export function klasorRoutes({ db }) {
  const MAX_SURUM = 50;
  const simdi = () => new Date().toISOString();

  /** Ham gövdeli yüklemede ad ve açıklama başlıkta gelir (URL kodlu). */
  const baslik = (req, ad) => {
    try { return decodeURIComponent(String(req.headers[ad] || '')); } catch { return ''; }
  };

  async function surumEkle(dosyaId, no, bilgi, veri, userId) {
    await db.run(
      'INSERT INTO klasor_surum (dosya_id,no,ad,tur,boyut,veri,yukleyen,created) VALUES (?,?,?,?,?,?,?,?)',
      [dosyaId, no, bilgi.ad, bilgi.tur, veri.length, veri, userId, simdi()]);
  }

  const resmiEtkinlikler = async () => new Map((await db.all('SELECT id,slug,tur,lider,baslangic,bitis,yer FROM events WHERE resmi=1'))
    .map(e => [e.slug, e]));

  /** Faaliyet dosyasına bağlı klasörler: klasör kimliği → {etkinlik, parca}.
   *  Bağ, faaliyetin türü o parçayı istiyorsa kurulur. */
  function baglar(etkinlikler) {
    const harita = new Map();
    for (const k of KLASORLER) {
      const b = bagliParca(k.id);
      const e = b && etkinlikler.get(b.etkinlik);
      if (e && parcalar(e.tur).includes(b.parca)) harita.set(k.id, { etkinlik: e, parca: b.parca });
    }
    return harita;
  }
  const faaliyetYetkisi = (user, e) => !!user && (user.koordinator || user.partner === e.lider);

  /** Klasör dosyası konabilecek bir hedef mi: bağlı klasör değil. */
  async function bagliDegil(klasorId) {
    if (baglar(await resmiEtkinlikler()).has(klasorId)) throw new ValidationError('klasor.hata.bagli');
  }

  async function liste(user) {
    /* Etkinliğe bağlı klasörler tarihlerini VERİTABANINDAN alır, tohumdan
       değil: koordinatör bir toplantının tarihini değiştirirse klasör de
       yeni tarihi göstermeli. */
    const etkinlikler = await resmiEtkinlikler();
    const bag = baglar(etkinlikler);
    const kimlikler = [...new Set([...bag.values()].map(b => b.etkinlik.id))];
    const yer = kimlikler.map(() => '?').join(',') || 'NULL';
    const fotolar = new Map((await db.all(
      `SELECT event_id, CAST(count(*) AS INTEGER) AS n FROM event_photos WHERE event_id IN (${yer}) GROUP BY event_id`, kimlikler))
      .map(r => [r.event_id, Number(r.n)]));
    const anketler = new Map((await db.all(
      `SELECT id, baslik, event_id FROM forms WHERE silindi='' AND event_id IN (${yer}) ORDER BY id`, kimlikler))
      .reverse().map(f => [f.event_id, { id: f.id, baslik: f.baslik }]));

    const klasorler = KLASORLER.map(k => {
      const e = k.etkinlik ? etkinlikler.get(k.etkinlik) : null;
      const b = bag.get(k.id);
      return {
        id: k.id, ust: k.ust, derinlik: k.derinlik, sahip: k.sahip, wp: k.wp, kurum: k.kurum, etiket: k.etiket,
        anahtar: adAnahtari(k),
        etkinlik: e ? { slug: e.slug, baslangic: e.baslangic, bitis: e.bitis, yer: e.yer } : null,
        /* Bağlı klasöre yükleme faaliyetin kuralındadır (lider kurum ve
           koordinatör); fotoğraf ve anket buradan yüklenmez, takvimden
           eklenir. */
        yukleyebilir: b ? DOSYA_TURLERI.includes(b.parca) && faaliyetYetkisi(user, b.etkinlik) : yukleyebilir(user, k.id),
        bagli: b ? {
          etkinlikId: b.etkinlik.id, parca: b.parca, lider: b.etkinlik.lider,
          ...(b.parca === 'foto' ? { sayi: fotolar.get(b.etkinlik.id) || 0 } : {}),
          ...(b.parca === 'anket' ? { form: anketler.get(b.etkinlik.id) || null } : {}),
        } : null,
      };
    });

    /* Her dosyanın GEÇERLİ sürümü: en yüksek numara. Geçmiş ayrı istenir. */
    const satirlar = await db.all(
      `SELECT d.id, d.klasor, d.ad, d.aciklama, d.partner, d.created, d.updated,
              u.ad AS yukleyen_ad, u.username AS yukleyen_kullanici,
              s.id AS surum_id, s.no, s.boyut, s.tur, s.created AS surum_tarih,
              (SELECT CAST(count(*) AS INTEGER) FROM klasor_surum x WHERE x.dosya_id=d.id) AS surum_sayisi
         FROM klasor_dosya d
         JOIN klasor_surum s ON s.dosya_id=d.id AND s.no=(SELECT max(no) FROM klasor_surum y WHERE y.dosya_id=d.id)
         LEFT JOIN users u ON u.id=d.yukleyen
        ORDER BY d.klasor, lower(d.ad), d.id`);
    const kisayollar = await db.all('SELECT dosya_id, klasor FROM klasor_kisayol ORDER BY klasor');

    const dosyalar = satirlar.map(r => ({
      id: r.id, klasor: r.klasor, ad: r.ad, aciklama: r.aciklama, partner: r.partner,
      yukleyen: r.yukleyen_ad || r.yukleyen_kullanici || '',
      created: r.created, updated: r.updated,
      surum: { id: r.surum_id, no: Number(r.no), boyut: Number(r.boyut), tur: r.tur, created: r.surum_tarih },
      surumSayisi: Number(r.surum_sayisi),
      kisayollar: kisayollar.filter(k => k.dosya_id === r.id).map(k => k.klasor),
      duzenleyebilir: dosyaYetkisi(user, r),
    }));

    /* Faaliyet dosyaları, bağlı oldukları klasörde. Sürüm, taşıma ve
       kısayol faaliyet dosyasında yoktur. */
    const klasorunu = new Map([...bag].filter(([, b]) => DOSYA_TURLERI.includes(b.parca))
      .map(([id, b]) => [`${b.etkinlik.id}:${b.parca}`, { id, e: b.etkinlik }]));
    const faaliyet = await db.all(
      `SELECT f.id, f.event_id, f.tur, f.ad, f.mime, f.boyut, f.created, u.ad AS yukleyen_ad, u.username, u.partner
         FROM event_files f LEFT JOIN users u ON u.id=f.yukleyen
        WHERE f.event_id IN (${yer}) ORDER BY f.created`, kimlikler);
    for (const f of faaliyet) {
      const hedef = klasorunu.get(`${f.event_id}:${f.tur}`);
      if (!hedef) continue;
      dosyalar.push({
        id: f.id, kaynak: 'faaliyet', etkinlikId: f.event_id, klasor: hedef.id, ad: f.ad, aciklama: '',
        partner: f.partner || hedef.e.lider, yukleyen: f.yukleyen_ad || f.username || '',
        created: f.created, updated: f.created,
        surum: { id: null, no: 1, boyut: Number(f.boyut), tur: f.mime, created: f.created },
        surumSayisi: 1, kisayollar: [], duzenleyebilir: faaliyetYetkisi(user, hedef.e),
      });
    }

    return {
      klasorler, dosyalar, butce: BUTCE, takvim: TAKVIM,
      sinir: { bayt: MAX_KLASOR_BYTES, uzantilar: Object.keys(KLASOR_TURLERI), aciklama: MAX_ACIKLAMA },
    };
  }

  return async function handle({ req, res, url, user, readOnly }) {
    const yol = url.pathname.match(/^\/api\/klasorler(?:\/(dosya|surum)(?:\/(\d{1,9})(?:\/(surum|surumler|kisayol)(?:\/([0-9A-Za-z.]{1,30}))?)?)?)?$/);
    if (!yol) return;
    if (!user) return send(res, 401, { error: 'klasor.hata.giris' });

    const [, tur, idMetni, bolum, altKlasor] = yol;
    const id = Number(idMetni);

    if (!tur) {
      if (!readOnly) return send(res, 405, { error: 'klasor.hata.islem' });
      return send(res, 200, await liste(user));
    }

    /* --- İndirme -----------------------------------------------------------
       Her zaman EK olarak ve sandbox başlığıyla: klasörde SVG ve HTML'e
       benzeyen belgeler de durabilir, aynı kökende açılmamalı. */
    if (tur === 'surum') {
      if (!readOnly || !id || bolum) return send(res, 405, { error: 'klasor.hata.islem' });
      const s = await db.get('SELECT ad,tur,veri FROM klasor_surum WHERE id=?', [id]);
      if (!s) return send(res, 404, { error: 'klasor.hata.dosyaYok' });
      const veri = Buffer.from(s.veri);
      const ascii = s.ad.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      res.writeHead(200, {
        'Content-Type': s.tur, 'Content-Length': veri.length, 'Cache-Control': 'private, no-store',
        'Content-Security-Policy': 'sandbox',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(s.ad)}`,
      });
      return res.end(req.method === 'HEAD' ? undefined : veri);
    }

    /* --- Yeni dosya ------------------------------------------------------- */
    if (!id) {
      if (req.method !== 'POST') return send(res, 405, { error: 'klasor.hata.islem' });
      const hedef = klasorDogrula(url.searchParams.get('klasor'));
      await bagliDegil(hedef);
      if (!yukleyebilir(user, hedef)) return send(res, 403, { error: 'klasor.hata.yetki' });
      const bilgi = dosyaBilgisi(baslik(req, 'x-file-name'));
      const aciklama = aciklamaDogrula(baslik(req, 'x-aciklama'));
      const veri = await rawBody(req, MAX_KLASOR_BYTES);
      if (!veri.length) throw new ValidationError('klasor.hata.bos');

      const an = simdi();
      const dosyaId = await db.insert(
        'INSERT INTO klasor_dosya (klasor,ad,aciklama,partner,yukleyen,created,updated) VALUES (?,?,?,?,?,?,?)',
        [hedef, bilgi.ad, aciklama, user.partner, user.id, an, an]);
      await surumEkle(dosyaId, 1, bilgi, veri, user.id);
      return send(res, 201, { id: Number(dosyaId) });
    }

    const dosya = await db.get('SELECT * FROM klasor_dosya WHERE id=?', [id]);
    if (!dosya) return send(res, 404, { error: 'klasor.hata.dosyaYok' });

    if (bolum === 'surumler') {
      if (!readOnly) return send(res, 405, { error: 'klasor.hata.islem' });
      const surumler = await db.all(
        `SELECT s.id, s.no, s.ad, s.boyut, s.created, u.ad AS yukleyen_ad, u.username
           FROM klasor_surum s LEFT JOIN users u ON u.id=s.yukleyen
          WHERE s.dosya_id=? ORDER BY s.no DESC`, [id]);
      return send(res, 200, {
        surumler: surumler.map(s => ({ id: s.id, no: Number(s.no), ad: s.ad, boyut: Number(s.boyut), created: s.created, yukleyen: s.yukleyen_ad || s.username || '' })),
      });
    }

    /* --- Kısayollar ---------------------------------------------------------
       Kısayolu HEDEF klasöre yükleme yetkisi olan ekler: kısayol o klasörün
       içeriğini değiştirir. Dosyanın sahibi olmak gerekmez — belgedeki
       örnekte ilgili başlığın sahibi kısayolu kendisi koyar. */
    if (bolum === 'kisayol') {
      if (req.method === 'POST' && !altKlasor) {
        const hedef = klasorDogrula((await body(req)).klasor);
        await bagliDegil(hedef);
        if (!yukleyebilir(user, hedef)) return send(res, 403, { error: 'klasor.hata.yetki' });
        if (hedef === dosya.klasor) throw new ValidationError('klasor.hata.kendiKlasoru');
        const var_ = await db.get('SELECT 1 AS x FROM klasor_kisayol WHERE dosya_id=? AND klasor=?', [id, hedef]);
        if (!var_) await db.run('INSERT INTO klasor_kisayol (dosya_id,klasor,ekleyen,created) VALUES (?,?,?,?)', [id, hedef, user.id, simdi()]);
        return send(res, 201, { ok: true });
      }
      if (req.method === 'DELETE' && altKlasor) {
        const hedef = klasorDogrula(altKlasor);
        if (!yukleyebilir(user, hedef) && !dosyaYetkisi(user, dosya)) return send(res, 403, { error: 'klasor.hata.yetki' });
        await db.run('DELETE FROM klasor_kisayol WHERE dosya_id=? AND klasor=?', [id, hedef]);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'klasor.hata.islem' });
    }

    /* Buradan sonrası dosyanın kendisini değiştirir: koordinatör ya da
       yükleyen kurum. */
    if (!dosyaYetkisi(user, dosya)) return send(res, 403, { error: 'klasor.hata.dosyaYetki' });

    if (bolum === 'surum') {
      if (req.method !== 'POST') return send(res, 405, { error: 'klasor.hata.islem' });
      const bilgi = dosyaBilgisi(baslik(req, 'x-file-name'));
      const { n, son } = await db.get('SELECT CAST(count(*) AS INTEGER) AS n, max(no) AS son FROM klasor_surum WHERE dosya_id=?', [id]);
      if (Number(n) >= MAX_SURUM) throw new ValidationError('klasor.hata.cokSurum');
      const veri = await rawBody(req, MAX_KLASOR_BYTES);
      if (!veri.length) throw new ValidationError('klasor.hata.bos');
      await surumEkle(id, Number(son || 0) + 1, bilgi, veri, user.id);
      /* Dosyanın adı geçerli sürümün adını izler. */
      await db.run('UPDATE klasor_dosya SET ad=?, updated=? WHERE id=?', [bilgi.ad, simdi(), id]);
      return send(res, 201, { no: Number(son || 0) + 1 });
    }

    if (bolum) return send(res, 405, { error: 'klasor.hata.islem' });

    if (req.method === 'PUT') {
      const veri = await body(req);
      let hedef = dosya.klasor;
      /* Taşıma: yeni klasöre de yükleme yetkisi gerekir — yoksa bir ortak
         dosyasını koordinatörün sözleşme klasörüne "taşıyarak" yükleyebilirdi. */
      if (veri.klasor !== undefined && veri.klasor !== dosya.klasor) {
        hedef = klasorDogrula(veri.klasor);
        await bagliDegil(hedef);
        if (!yukleyebilir(user, hedef)) return send(res, 403, { error: 'klasor.hata.yetki' });
        /* Taşındığı yerde kısayolu varsa artık gereksiz. */
        await db.run('DELETE FROM klasor_kisayol WHERE dosya_id=? AND klasor=?', [id, hedef]);
      }
      const aciklama = veri.aciklama !== undefined ? aciklamaDogrula(veri.aciklama) : dosya.aciklama;
      await db.run('UPDATE klasor_dosya SET klasor=?, aciklama=?, updated=? WHERE id=?', [hedef, aciklama, simdi(), id]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      await db.run('DELETE FROM klasor_dosya WHERE id=?', [id]);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'klasor.hata.islem' });
  };
}
