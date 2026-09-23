import {
  ValidationError, partnerIds, partnerOf, venues, wpIds, types, statuses, DEFAULT_STATUS,
  listOf, packList, daysBetween, requireDay, requireOneOf, requireText, requirePartners,
  MAX_RANGE_DAYS, MAX_TITLE, PROJECT,
} from '../lib/data.mjs';
import { MAX_PHOTOS, MAX_PHOTO_BYTES, PHOTO_TYPES, sniffPhoto } from '../lib/data.mjs';
import { send, body, rawBody, ICS } from '../lib/http.mjs';
import { buildIcs } from '../lib/ics.mjs';
import { dictionary } from '../lib/i18n.mjs';

/**
 * Etkinlik uçları: listeleme, ekleme, düzenleme, silme ve takvim aboneliği.
 *
 * YETKİ MODELİ
 * - Koordinatör hesabı (`koordinator=1`) her kaydı düzenler.
 * - Ortak hesabı yalnızca KENDİ KURUMUNUN lider olduğu kayıtlara dokunur.
 * - Başvuru formundaki resmî aktiviteler (`resmi=1`) silinemez ve tarihleri
 *   koordinatör dışında değiştirilemez: bunlar projenin taahhüdüdür. Lider
 *   ortak yalnızca durumu ve ilgili bağlantıyı günceller.
 */
export function etkinlikRoutes({ db }) {
  const SELECT = `SELECT id,slug,wp,kod,tur,yer,lider,katilimcilar,baslik,ozet,baslangic,bitis,durum,url,resmi,owner,updated FROM events`;

  const shape = row => ({
    id: row.id,
    slug: row.slug || null,
    wp: row.wp,
    kod: row.kod,
    tur: row.tur,
    yer: row.yer,
    lider: row.lider,
    katilimcilar: listOf(row.katilimcilar),
    baslik: row.baslik,
    ozet: row.ozet,
    baslangic: String(row.baslangic).slice(0, 10),
    bitis: String(row.bitis).slice(0, 10),
    durum: row.durum,
    url: row.url,
    resmi: !!row.resmi,
    updated: row.updated,
  });

  const load = async id => {
    const row = await db.get(`${SELECT} WHERE id=?`, [Number(id)]);
    if (!row) throw new ValidationError('Etkinlik bulunamadı.');
    return row;
  };

  /** Kullanıcı bu kaydı düzenleyebilir mi? Koordinatör her zaman, ortak
   *  yalnızca kendi kurumu lider olduğunda. */
  const mayEdit = (user, row) => !!user && (user.koordinator || user.partner === row.lider);

  /**
   * Formdaki alanları doğrular. `mevcut` verilirse düzenleme, verilmezse
   * yeni kayıt kuralları uygulanır.
   *
   * Resmî aktivitelerde koordinatör olmayan kullanıcıya yalnızca `durum` ve
   * `url` geçer; gönderdiği başka alanlar sessizce yok sayılmaz, mevcut
   * değerle değiştirilir — böylece arayüzdeki kilit sunucuda da geçerlidir.
   */
  const validate = (data, user, mevcut) => {
    const kisitli = mevcut?.resmi && !user.koordinator;
    if (kisitli) {
      return {
        ...shape(mevcut),
        durum: requireOneOf(data.durum, statuses, 'Durum'),
        url: requireText(data.url, 'Bağlantı', { max: 500, required: false }),
      };
    }

    const baslangic = requireDay(data.baslangic, 'Başlangıç tarihi');
    const bitis = requireDay(data.bitis, 'Bitiş tarihi');
    if (bitis < baslangic) throw new ValidationError('Bitiş tarihi başlangıçtan önce olamaz.');
    const span = daysBetween(baslangic, bitis) + 1;
    if (span > MAX_RANGE_DAYS) throw new ValidationError(`Bir etkinlik en fazla ${MAX_RANGE_DAYS} gün sürebilir.`);
    /* Program dışına düşen tarih büyük ihtimalle yazım hatasıdır; sessizce
       kabul edilirse takvimde kimsenin görmediği bir yere düşer. */
    if (baslangic < PROJECT.start || bitis > PROJECT.end) {
      throw new ValidationError(`Tarihler proje süresi içinde olmalı (${PROJECT.start} – ${PROJECT.end}).`);
    }

    const lider = requireOneOf(data.lider, partnerIds, 'Lider kurum');
    /* Ortak hesabı başka bir kurumu lider göstererek yetki alanının dışına
       çıkamaz; koordinatör serbesttir. */
    if (!user.koordinator && lider !== user.partner) {
      throw new ValidationError('Yalnızca kendi kurumunuzun lider olduğu etkinlikleri düzenleyebilirsiniz.');
    }

    return {
      wp: requireOneOf(data.wp, wpIds, 'İş paketi'),
      kod: requireText(data.kod, 'Kod', { max: 12, required: false }),
      tur: requireOneOf(data.tur, types, 'Tür'),
      yer: requireOneOf(data.yer, venues, 'Yer'),
      lider,
      katilimcilar: requirePartners(data.katilimcilar, 'Katılımcı kurumlar').filter(id => id !== lider),
      baslik: requireText(data.baslik, 'Etkinlik adı', { max: MAX_TITLE }),
      ozet: requireText(data.ozet, 'Açıklama', { required: false }),
      baslangic,
      bitis,
      durum: requireOneOf(data.durum ?? DEFAULT_STATUS, statuses, 'Durum'),
      url: requireText(data.url, 'Bağlantı', { max: 500, required: false }),
    };
  };

  /** Resmî kayıtların başlığı ve özeti sözlükten, yerel kayıtlarınki
   *  veritabanından gelir. ICS akışı da bunu kullanır. */
  const translator = sozluk => e => {
    const key = e.slug ? `etkinlik.${e.slug}.` : null;
    return {
      baslik: (key && sozluk[key + 'baslik']) || e.baslik || e.kod || e.wp,
      ozet: (key && sozluk[key + 'ozet']) || e.ozet || '',
      yer: sozluk[`ulke.${e.yer}`] || e.yer,
    };
  };

  return async function handle({ req, res, url, user, dil }) {
    /* --- Takvim aboneliği ------------------------------------------------
       Program herkese açıktır, jeton gerekmez: içerikte kişisel veri yok. */
    if (url.pathname === '/takvim.ics' && ['GET', 'HEAD'].includes(req.method)) {
      const { sozluk } = await dictionary(dil);
      const rows = (await db.all(`${SELECT} ORDER BY baslangic`)).map(shape);
      const wp = url.searchParams.get('wp');
      const ortak = url.searchParams.get('ortak');
      const filtered = rows.filter(e =>
        (!wp || e.wp === wp) &&
        (!ortak || e.lider === ortak || e.katilimcilar.includes(ortak)));
      const label = [sozluk['site.ad'], sozluk['takvim.baslik']].filter(Boolean).join(' — ');
      const text = buildIcs(filtered, label, translator(sozluk));
      res.writeHead(200, { 'Content-Type': ICS, 'Content-Disposition': 'inline; filename="e-youthpreneur.ics"', 'Cache-Control': 'public, max-age=1800' });
      res.end(req.method === 'HEAD' ? undefined : text);
      return true;
    }

    /* --- Fotoğraf gösterimi ---------------------------------------------
       Program herkese açık olduğu için fotoğraflar da açıktır. Gövde
       doğrudan veritabanından gelir; tür sütundan okunur, istemcinin
       bildirdiği değerden değil (yükleme sırasında baytlara bakılmıştı). */
    if (url.pathname.startsWith('/api/foto/') && ['GET', 'HEAD'].includes(req.method)) {
      const fotoId = Number(url.pathname.slice('/api/foto/'.length));
      if (!Number.isInteger(fotoId) || fotoId <= 0) return send(res, 404, { error: 'Fotoğraf bulunamadı.' });
      const foto = await db.get('SELECT tur,veri FROM event_photos WHERE id=?', [fotoId]);
      if (!foto) return send(res, 404, { error: 'Fotoğraf bulunamadı.' });
      const veri = Buffer.isBuffer(foto.veri) ? foto.veri : Buffer.from(foto.veri);
      res.writeHead(200, {
        'Content-Type': foto.tur,
        'Content-Length': veri.length,
        /* İçerik değişmez (yeni fotoğraf yeni kimlik alır), uzun önbellek
           güvenli. `nosniff` başlığı sunucu genelinde zaten yazılıyor. */
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': 'inline',
      });
      res.end(req.method === 'HEAD' ? undefined : veri);
      return true;
    }

    if (url.pathname.startsWith('/api/foto/') && req.method === 'DELETE') {
      if (!user) return send(res, 401, { error: 'Önce giriş yapın.' });
      const fotoId = Number(url.pathname.slice('/api/foto/'.length));
      const foto = await db.get('SELECT event_id FROM event_photos WHERE id=?', [fotoId]);
      if (!foto) return send(res, 404, { error: 'Fotoğraf bulunamadı.' });
      const sahip = await load(foto.event_id);
      if (!mayEdit(user, sahip)) return send(res, 403, { error: 'Bu fotoğrafı silme yetkiniz yok.' });
      await db.run('DELETE FROM event_photos WHERE id=?', [fotoId]);
      return send(res, 200, { ok: true });
    }

    if (!url.pathname.startsWith('/api/etkinlikler')) return;

    const rest = url.pathname.slice('/api/etkinlikler'.length);

    if (rest === '' && req.method === 'GET') {
      const rows = (await db.all(`${SELECT} ORDER BY baslangic, wp, kod`)).map(shape);
      /* Fotoğrafların kendisi değil, yalnızca kimlikleri listeye girer:
         her kart için sekiz megabaytlık veriyi taşımak listeyi kullanılmaz
         hâle getirirdi. Görseller `/api/foto/<id>` ile tek tek çekilir. */
      const fotolar = await db.all('SELECT id,event_id,ad FROM event_photos ORDER BY id');
      for (const e of rows) {
        e.fotolar = fotolar.filter(f => f.event_id === e.id).map(f => ({ id: f.id, ad: f.ad }));
      }
      return send(res, 200, { etkinlikler: rows, maxFoto: MAX_PHOTOS });
    }

    if (rest === '' && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'Önce giriş yapın.' });
      const fields = validate(await body(req), user, null);
      const id = await db.insert(
        `INSERT INTO events (slug,wp,kod,tur,yer,lider,katilimcilar,baslik,ozet,baslangic,bitis,durum,url,resmi,owner,updated)
         VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
        [fields.wp, fields.kod, fields.tur, fields.yer, fields.lider, packList(fields.katilimcilar),
         fields.baslik, fields.ozet, fields.baslangic, fields.bitis, fields.durum, fields.url,
         user.id, new Date().toISOString()]);
      return send(res, 201, shape(await load(id)));
    }

    /* `/12` ve `/12/foto` biçimlerinin ikisi de kabul edilir; başka bir
       ek yol tanınmaz ve istek 404'e düşer. */
    const parcalar = rest.split('/').filter(Boolean);
    const id = Number(parcalar[0]);
    if (!Number.isInteger(id) || id <= 0) return;
    if (parcalar.length > 2 || (parcalar.length === 2 && parcalar[1] !== 'foto')) return;

    /* --- Fotoğraf yükleme -------------------------------------------------
       Gövde ham dosyadır (çok parçalı form yerine): tek dosya gönderiliyor,
       ayrıştırıcı yazmaya değmez. Dosya adı başlıktan gelir.

       Resmî aktivitelere de fotoğraf eklenebilir — kilit aktivitenin
       tanımına (ad, tarih, lider) aittir; etkinliğin nasıl geçtiğini
       belgelemek lider ortağın işidir. */
    if (rest === `/${id}/foto` && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'Önce giriş yapın.' });
      const row = await load(id);
      if (!mayEdit(user, row)) return send(res, 403, { error: 'Bu etkinliğe fotoğraf ekleme yetkiniz yok.' });

      const adet = await db.get('SELECT CAST(count(*) AS INTEGER) AS n FROM event_photos WHERE event_id=?', [id]);
      if (Number(adet.n) >= MAX_PHOTOS) {
        throw new ValidationError(`Bir etkinliğe en fazla ${MAX_PHOTOS} fotoğraf eklenebilir.`);
      }

      const veri = await rawBody(req, MAX_PHOTO_BYTES);
      if (!veri.length) throw new ValidationError('Dosya boş.');
      /* Türü baytlardan çıkarırız: Content-Type başlığı da uzantı da
         istemci tarafından serbestçe yazılabilir. */
      const tur = sniffPhoto(veri);
      if (!tur || !PHOTO_TYPES[tur]) {
        throw new ValidationError(`Yalnızca ${Object.values(PHOTO_TYPES).join(', ')} biçiminde görsel yüklenebilir.`);
      }
      const ad = requireText(decodeURIComponent(req.headers['x-dosya-adi'] || ''), 'Dosya adı', { max: 200, required: false })
        || `foto.${PHOTO_TYPES[tur]}`;

      const fotoId = await db.insert(
        'INSERT INTO event_photos (event_id,ad,tur,boyut,veri,yukleyen,yuklendi) VALUES (?,?,?,?,?,?,?)',
        [id, ad, tur, veri.length, veri, user.id, new Date().toISOString()]);
      return send(res, 201, { id: fotoId, ad });
    }

    if (req.method === 'PUT') {
      if (!user) return send(res, 401, { error: 'Önce giriş yapın.' });
      const row = await load(id);
      if (!mayEdit(user, row)) return send(res, 403, { error: 'Bu etkinliği düzenleme yetkiniz yok.' });
      const fields = validate(await body(req), user, row);
      await db.run(
        `UPDATE events SET wp=?,kod=?,tur=?,yer=?,lider=?,katilimcilar=?,baslik=?,ozet=?,baslangic=?,bitis=?,durum=?,url=?,updated=? WHERE id=?`,
        [fields.wp, fields.kod, fields.tur, fields.yer, fields.lider,
         packList(Array.isArray(fields.katilimcilar) ? fields.katilimcilar : listOf(fields.katilimcilar)),
         fields.baslik, fields.ozet, fields.baslangic, fields.bitis, fields.durum, fields.url,
         new Date().toISOString(), id]);
      return send(res, 200, shape(await load(id)));
    }

    if (req.method === 'DELETE') {
      if (!user) return send(res, 401, { error: 'Önce giriş yapın.' });
      const row = await load(id);
      if (!mayEdit(user, row)) return send(res, 403, { error: 'Bu etkinliği silme yetkiniz yok.' });
      /* Resmî program taahhüttür: koordinatör bile silemez, yalnızca
         "Ertelendi" durumuna alabilir. */
      if (row.resmi) return send(res, 403, { error: 'Başvuru formundaki resmî aktiviteler silinemez.' });
      await db.run('DELETE FROM events WHERE id=?', [id]);
      return send(res, 200, { ok: true });
    }
  };
}

export { partnerOf };
