import { ValidationError } from '../lib/data.mjs';
import { send, body, rawBody, ekGonder, basliktanOku } from '../lib/http.mjs';
import { CIKTILAR, ciktiTanimi, ciktiDogrula, dilDogrula, CIKTI_DURUMLARI, CIKTI_DILLERI } from '../lib/cikti.mjs';
import { dosyaBilgisi, MAX_KLASOR_BYTES } from '../lib/klasor.mjs';

/**
 * Çıktı kütüphanesi (iç): bkz. lib/cikti.mjs.
 *
 *   GET    /api/ciktilar                    liste + dil dil sürümler
 *   PUT    /api/ciktilar/:slug              durum, dış adres, not (+ sorumlu/teslim: koordinatör)
 *   POST   /api/ciktilar/:slug/dosya?dil=   yeni sürüm (ham gövde, X-File-Name)
 *   GET    /api/ciktilar/dosya/:id          sürümü indir
 *   DELETE /api/ciktilar/dosya/:id          sürümü sil
 *
 * YETKİ: görmek ve indirmek her üyeye açık. Durum güncellemek ve dosya
 * yüklemek çıktının SORUMLU kurumuna ve koordinatöre; sorumluyu ve teslim
 * tarihini değiştirmek yalnızca koordinatöre.
 */
export function ciktiRoutes({ db }) {
  const simdi = () => new Date().toISOString();

  /** Tanım + veritabanı satırı + (varsa) etkinlikten türeyen sorumlu ve tarih. */
  async function hepsi() {
    const satirlar = new Map((await db.all('SELECT * FROM outputs')).map(r => [r.slug, r]));
    const etkinlikler = new Map((await db.all("SELECT id,slug,lider,baslangic,bitis FROM events WHERE resmi=1")).map(e => [e.slug, e]));
    const dosyalar = await db.all(
      `SELECT f.id, f.output_id, f.dil, f.no, f.ad, f.boyut, f.created, u.ad AS yukleyen_ad, u.username
         FROM output_files f LEFT JOIN users u ON u.id=f.yukleyen ORDER BY f.no DESC`);
    return CIKTILAR.map(t => {
      const s = satirlar.get(t.slug);
      const e = t.etkinlik ? etkinlikler.get(t.etkinlik) : null;
      const kendi = dosyalar.filter(d => d.output_id === s.id);
      const diller = [...new Set(kendi.map(d => d.dil))].map(dil => ({
        dil,
        surumler: kendi.filter(d => d.dil === dil).map(d => ({
          id: d.id, no: Number(d.no), ad: d.ad, boyut: Number(d.boyut), created: d.created,
          yukleyen: d.yukleyen_ad || d.username || '',
        })),
      }));
      return {
        id: s.id, slug: t.slug, kod: t.kod, wp: t.wp, anahtar: t.anahtar, klasor: t.klasor, araUrun: !!t.araUrun,
        etkinlikId: e?.id ?? null,
        sorumlu: e ? e.lider : s.sorumlu,
        baslangic: e ? String(e.baslangic).slice(0, 10) : null,
        teslim: e ? String(e.bitis).slice(0, 10) : s.teslim,
        durum: s.durum, disUrl: s.dis_url, not: s.notlar, updated: s.updated,
        diller,
      };
    });
  }

  const yetkili = (user, c) => user.koordinator || (!!c.sorumlu && user.partner === c.sorumlu);

  return async function handle({ req, res, url, user, readOnly }) {
    if (!url.pathname.startsWith('/api/ciktilar')) return;
    if (!user) return send(res, 401, { error: 'genel.girisGerekli' });
    const parca = url.pathname.slice('/api/ciktilar'.length).split('/').filter(Boolean);

    if (!parca.length) {
      if (!readOnly) return send(res, 405, { error: 'klasor.hata.islem' });
      const liste = (await hepsi()).map(c => ({ ...c, yetkili: yetkili(user, c) }));
      return send(res, 200, { ciktilar: liste, durumlar: CIKTI_DURUMLARI, diller: CIKTI_DILLERI });
    }

    /* --- Tek sürüm: indir / sil --------------------------------------------- */
    if (parca[0] === 'dosya' && parca.length === 2) {
      const id = Number(parca[1]);
      const d = Number.isInteger(id) && await db.get('SELECT * FROM output_files WHERE id=?', [id]);
      if (!d) return send(res, 404, { error: 'klasor.hata.dosyaYok' });
      if (readOnly) return ekGonder(req, res, d);
      if (req.method !== 'DELETE') return send(res, 405, { error: 'klasor.hata.islem' });
      const c = (await hepsi()).find(x => x.id === d.output_id);
      if (!yetkili(user, c)) return send(res, 403, { error: 'cikti.hata.yetki' });
      await db.run('DELETE FROM output_files WHERE id=?', [id]);
      return send(res, 200, { ok: true });
    }

    const tanim = ciktiTanimi(parca[0]);
    if (!tanim || parca.length > 2) return send(res, 404, { error: 'cikti.hata.yok' });
    const c = (await hepsi()).find(x => x.slug === tanim.slug);
    if (!yetkili(user, c)) return send(res, 403, { error: 'cikti.hata.yetki' });

    /* --- Durum ve bilgiler --------------------------------------------------- */
    if (parca.length === 1 && req.method === 'PUT') {
      const yeni = ciktiDogrula(await body(req), tanim);
      /* Sorumluyu ve tarihi yalnızca koordinatör değiştirir; sorumlu kurum
         kendi durumunu günceller ama işi başkasına devredemez. */
      const satir = await db.get('SELECT sorumlu,teslim FROM outputs WHERE id=?', [c.id]);
      if (!user.koordinator) { yeni.sorumlu = satir.sorumlu; yeni.teslim = satir.teslim; }
      await db.run('UPDATE outputs SET durum=?,sorumlu=?,teslim=?,dis_url=?,notlar=?,updated=? WHERE id=?',
        [yeni.durum, yeni.sorumlu, yeni.teslim, yeni.disUrl, yeni.not, simdi(), c.id]);
      return send(res, 200, { ok: true });
    }

    /* --- Yeni sürüm ------------------------------------------------------------ */
    if (parca[1] === 'dosya' && req.method === 'POST') {
      const dil = dilDogrula(url.searchParams.get('dil'));
      const bilgi = dosyaBilgisi(basliktanOku(req, 'x-file-name'));
      const veri = await rawBody(req, MAX_KLASOR_BYTES);
      if (!veri.length) throw new ValidationError('klasor.hata.bos');
      const son = await db.get('SELECT MAX(no) AS n FROM output_files WHERE output_id=? AND dil=?', [c.id, dil]);
      const no = Number(son?.n || 0) + 1;
      const id = await db.insert(
        'INSERT INTO output_files (output_id,dil,no,ad,tur,boyut,veri,yukleyen,created) VALUES (?,?,?,?,?,?,?,?,?)',
        [c.id, dil, no, bilgi.ad, bilgi.tur, veri.length, veri, user.id, simdi()]);
      /* İlk dosya gelince "planlandı" kendiliğinden "hazırlanıyor" olur. */
      await db.run("UPDATE outputs SET durum='hazirlaniyor', updated=? WHERE id=? AND durum='planlandi'", [simdi(), c.id]);
      return send(res, 201, { id: Number(id), no });
    }

    return send(res, 405, { error: 'klasor.hata.islem' });
  };
}
