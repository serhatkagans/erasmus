import { ValidationError } from '../lib/data.mjs';
import { send, body, rawBody, ekGonder, basliktanOku } from '../lib/http.mjs';
import { DOSYA_TURLERI, parcalar } from '../lib/faaliyet.mjs';
import { dosyaBilgisi, MAX_KLASOR_BYTES, parcaKlasoru } from '../lib/klasor.mjs';

/**
 * Faaliyet dosyası: bkz. lib/faaliyet.mjs.
 *
 *   GET    /api/etkinlikler/:id/dosya          parçalar ve dosyaları
 *   POST   /api/etkinlikler/:id/dosya?tur=     dosya ekle (ham gövde, X-File-Name)
 *   PUT    /api/etkinlikler/:id/anket          memnuniyet anketini bağla {formId|null}
 *   GET    /api/faaliyet-dosya/:fid            indir
 *   DELETE /api/faaliyet-dosya/:fid            sil
 *
 * Toplantı klasörlerinin iç klasörleri (05.x) bu dosyaları gösterir; bağ
 * kurulmadan önce oraya klasör dosyası olarak yüklenmiş belgeler de parçada
 * `klasorde` altında listelenir ve parçayı tamamlar (bkz. lib/klasor.mjs).
 *
 * YETKİ etkinliğinkiyle aynı: lider kurum ve koordinatör yükler/siler/bağlar;
 * her üye görür ve indirir.
 */
export function faaliyetRoutes({ db }) {
  const mayEdit = (user, e) => user.koordinator || user.partner === e.lider;
  const simdi = () => new Date().toISOString();

  return async function handle({ req, res, url, user, readOnly }) {
    const ic = /^\/api\/etkinlikler\/(\d{1,9})\/(dosya|anket)$/.exec(url.pathname);
    const tek = /^\/api\/faaliyet-dosya\/(\d{1,9})$/.exec(url.pathname);
    if (!ic && !tek) return;
    if (!user) return send(res, 401, { error: 'genel.girisGerekli' });

    if (tek) {
      const d = await db.get('SELECT * FROM event_files WHERE id=?', [Number(tek[1])]);
      if (!d) return send(res, 404, { error: 'klasor.hata.dosyaYok' });
      if (readOnly) return ekGonder(req, res, { ad: d.ad, tur: d.mime, veri: d.veri });
      if (req.method !== 'DELETE') return send(res, 405, { error: 'klasor.hata.islem' });
      const e = await db.get('SELECT lider FROM events WHERE id=?', [d.event_id]);
      if (!mayEdit(user, e)) return send(res, 403, { error: 'faaliyet.hata.yetki' });
      await db.run('DELETE FROM event_files WHERE id=?', [d.id]);
      return send(res, 200, { ok: true });
    }

    const e = await db.get('SELECT id,slug,tur,lider FROM events WHERE id=?', [Number(ic[1])]);
    if (!e) return send(res, 404, { error: 'faaliyet.hata.yok' });
    const liste = parcalar(e.tur);

    if (ic[2] === 'dosya' && readOnly) {
      const dosyalar = await db.all(
        `SELECT f.id, f.tur, f.ad, f.boyut, f.created, u.ad AS yukleyen_ad, u.username
           FROM event_files f LEFT JOIN users u ON u.id=f.yukleyen WHERE f.event_id=? ORDER BY f.created`, [e.id]);
      const foto = Number((await db.get('SELECT CAST(count(*) AS INTEGER) AS n FROM event_photos WHERE event_id=?', [e.id])).n);
      const anket = await db.get("SELECT id,baslik FROM forms WHERE event_id=? AND silindi='' ORDER BY id LIMIT 1", [e.id]);
      const eskiler = await db.all(
        `SELECT d.id, d.klasor, d.ad, s.id AS surum_id, s.boyut, s.created, u.ad AS yukleyen_ad, u.username
           FROM klasor_dosya d
           JOIN klasor_surum s ON s.dosya_id=d.id AND s.no=(SELECT max(no) FROM klasor_surum y WHERE y.dosya_id=d.id)
           LEFT JOIN users u ON u.id=d.yukleyen
          WHERE d.klasor IN (${liste.map(() => '?').join(',') || 'NULL'}) ORDER BY d.created`,
        liste.map(tur => parcaKlasoru(e.slug, tur) || ''));
      const klasorde = tur => eskiler.filter(d => d.klasor === parcaKlasoru(e.slug, tur)).map(d => ({
        id: d.id, klasor: d.klasor, surumId: d.surum_id, ad: d.ad, boyut: Number(d.boyut), created: d.created,
        yukleyen: d.yukleyen_ad || d.username || '',
      }));
      const yetkili = mayEdit(user, e);
      /* Bağlanabilecek formlar yalnızca bağlama yetkisi olana gönderilir. */
      const secenekler = yetkili
        ? await db.all("SELECT id,baslik FROM forms WHERE silindi='' AND durum<>'taslak' AND (event_id IS NULL OR event_id=?) ORDER BY id DESC", [e.id])
        : [];
      return send(res, 200, {
        yetkili,
        parcalar: liste.map(tur => {
          const eski = klasorde(tur);
          if (tur === 'foto') return { tur, tamam: foto > 0 || eski.length > 0, sayi: foto, klasorde: eski };
          if (tur === 'anket') return { tur, tamam: !!anket || eski.length > 0, form: anket || null, klasorde: eski };
          const kendi = dosyalar.filter(d => d.tur === tur).map(d => ({
            id: d.id, ad: d.ad, boyut: Number(d.boyut), created: d.created, yukleyen: d.yukleyen_ad || d.username || '',
          }));
          return { tur, tamam: kendi.length > 0 || eski.length > 0, dosyalar: kendi, klasorde: eski };
        }),
        secenekler,
      });
    }

    if (!mayEdit(user, e)) return send(res, 403, { error: 'faaliyet.hata.yetki' });

    if (ic[2] === 'dosya' && req.method === 'POST') {
      const tur = url.searchParams.get('tur');
      if (!DOSYA_TURLERI.includes(tur) || !liste.includes(tur)) throw new ValidationError('faaliyet.hata.tur');
      const bilgi = dosyaBilgisi(basliktanOku(req, 'x-file-name'));
      const veri = await rawBody(req, MAX_KLASOR_BYTES);
      if (!veri.length) throw new ValidationError('klasor.hata.bos');
      const id = await db.insert(
        'INSERT INTO event_files (event_id,tur,ad,mime,boyut,veri,yukleyen,created) VALUES (?,?,?,?,?,?,?,?)',
        [e.id, tur, bilgi.ad, bilgi.tur, veri.length, veri, user.id, simdi()]);
      return send(res, 201, { id: Number(id) });
    }

    /* Anket bağlama: bir faaliyete bir form. Başka faaliyete bağlı form
       buraya taşınmaz — yanlışlıkla iki faaliyetin anketi karışmasın. */
    if (ic[2] === 'anket' && req.method === 'PUT') {
      if (!liste.includes('anket')) throw new ValidationError('faaliyet.hata.tur');
      const { formId } = await body(req);
      if (formId != null) {
        const f = await db.get("SELECT id,event_id FROM forms WHERE id=? AND silindi=''", [Number(formId)]);
        if (!f) throw new ValidationError('faaliyet.hata.form');
        if (f.event_id && f.event_id !== e.id) throw new ValidationError('faaliyet.hata.formBaska');
      }
      await db.run('UPDATE forms SET event_id=NULL WHERE event_id=?', [e.id]);
      if (formId != null) await db.run('UPDATE forms SET event_id=? WHERE id=?', [e.id, Number(formId)]);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'klasor.hata.islem' });
  };
}
