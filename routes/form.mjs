import { ValidationError, partners, partnerIds, listOf, sniffPhoto } from '../lib/data.mjs';
import {
  validateForm, validateAnswers, questionsOf, answersOf, accepting, stateOf, targets, fills,
  answerable, live, protectQuestions, validRenames, renameAnswers,
  fileInfo, MAX_FILES, MAX_FILE_BYTES,
} from '../lib/forms.mjs';
import { send, body, rawBody, XLSX } from '../lib/http.mjs';
import { dictionary } from '../lib/i18n.mjs';
import { metinler } from '../lib/rapor.mjs';
import { formExcel } from '../lib/excel.mjs';

/**
 * Form uçları (kurallar için bkz. lib/forms.mjs):
 *   /api/formlar                     liste (GET), yeni form (POST, koordinatör)
 *   /api/formlar/:id                 form (GET), düzenle (PUT) / sil (DELETE)
 *   /api/formlar/:id/yanit           kendi yanıtını gönder / düzelt (PUT)
 *   /api/formlar/:id/yanitlar        yanıtlar ve bekleyenler (GET; ?bicim=xlsx)
 *   /api/formlar/:id/yanitlar/:rid   yanıtı sil (DELETE, koordinatör)
 *   /api/formlar/:id/gorsel          kapak görseli (GET; PUT / DELETE)
 *   /api/formlar/:id/durum           yayımla / taslağa al (PUT { durum })
 *   /api/formlar/:id/taslak          gönderilmemiş yanıtı kaydet (PUT) / sil (DELETE)
 *   /api/formlar/:id/hatirlat        bekleyenlere hatırlatma (POST, koordinatör)
 *   /api/formlar/:id/dosya           dosya sorusuna dosya yükle (POST; ?soru=kimlik)
 *   /api/formlar/:id/dosya/:fid      dosyayı indir (GET; koordinatör ya da yükleyen)
 *
 * Formu yalnızca KOORDİNATÖR hazırlar ve yanıtlarını görür. Ortak kurum
 * kullanıcısı hedef kitlesinde olmadığı formu hiç göremez (404).
 *
 * İLETİLER İSTEĞİN DİLİNDE kurulur (bkz. routes/belge.mjs'deki aynı karar):
 * doğrulama kuralları bir `t` alır, çünkü "3. soru başlığı boş bırakılamaz"
 * gibi iletiler yer tutucu taşır ve istemcide sözlükten çözülemezdi.
 */
export function formRoutes({ db }) {
  /* Kapak görselinin sürümü: istemci adrese ekler, görsel değişince
     tarayıcı önbelleği kendiliğinden tazelenir. */
  const GORSEL = '(SELECT g.updated FROM form_gorsel g WHERE g.form_id=forms.id) AS gorsel';
  const HATIRLATMA = '(SELECT h.created FROM form_hatirlatma h WHERE h.form_id=forms.id AND h.user_id=?) AS hatirlatildi';
  const MAX_GORSEL_BYTES = 5 * 1024 * 1024;

  const kisiAdi = k => k.ad || k.username;

  const formGorunum = form => ({
    id: form.id,
    baslik: form.baslik,
    aciklama: form.aciklama,
    baslikRich: form.baslik_rich || '',
    aciklamaRich: form.aciklama_rich || '',
    gorsel: form.gorsel || null,
    koordinatorDoldurur: !!form.koordinator_doldurur,
    durum: form.durum || 'yayinda',
    hal: stateOf(form),
    yayinlandi: form.yayinlandi || null,
    sonTarih: form.son_tarih,
    kapali: !!form.kapali,
    hedef: listOf(form.hedef),
    created: form.created,
    updated: form.updated,
    acik: accepting(form),
  });

  /* Formlar koordinatör hesapları arasında ortak havuzdur: her koordinatör
     bütün formları görür ve düzenler; kartta yalnızca kimin açtığı yazar. */
  const acan = (kisiler, form) => {
    const kisi = kisiler.find(k => k.id === form.olusturan);
    return kisi ? kisiAdi(kisi) : '';
  };

  const formKisileri = () => db.all('SELECT id,username,ad,partner,koordinator FROM users ORDER BY partner, ad');

  /**
   * Dosya sorusu yanıtını doğrular ve zenginleştirir: istemcinin gönderdiği
   * dosya kimlikleri bu kişinin bu soruya yüklediği dosyalarla eşleştirilir,
   * yanıta ad ve boyutla yazılır. Başkasının dosyası bağlanamaz. `katı`
   * gönderimde zorunlu dosya sorusunun gerçekten dolu olduğunu da denetler.
   */
  async function dosyalariBagla(formId, userId, sorular, json, t, kati = false) {
    const yanitlar = JSON.parse(json);
    const dosyaSorulari = sorular.filter(q => q.type === 'dosya');
    if (!dosyaSorulari.length) return json;

    const satirlar = await db.all('SELECT id,soru_id,ad,boyut FROM form_dosya WHERE form_id=? AND user_id=?', [formId, userId]);
    for (const q of dosyaSorulari) {
      const dosyalar = (yanitlar[q.id] || [])
        .map(id => satirlar.find(r => Number(r.id) === id && r.soru_id === q.id))
        .filter(Boolean)
        .map(r => ({ id: Number(r.id), ad: r.ad, boyut: Number(r.boyut) }));
      if (dosyalar.length) yanitlar[q.id] = dosyalar; else delete yanitlar[q.id];
      if (kati && q.required && !dosyalar.length) throw new ValidationError(t('form.hata.dosyaEkle', { soru: q.title }));
    }
    return JSON.stringify(yanitlar);
  }

  /** Formun yanıt sayısı ve en az bir yanıt almış soru kimlikleri. */
  async function yanitAlanSorular(formId) {
    const satirlar = await db.all('SELECT yanitlar FROM form_yanitlar WHERE form_id=?', [formId]);
    return { sayi: satirlar.length, idler: new Set(satirlar.flatMap(r => Object.keys(answersOf(r)))) };
  }

  /** Yanıtta artık geçmeyen dosyaları siler (gönderimde ya da yanıt silinince). */
  async function dosyalariBudama(formId, userId, yanitlarJson) {
    const kalanlar = Object.values(answersOf({ yanitlar: yanitlarJson })).flat()
      .filter(v => v && typeof v === 'object' && v.id).map(v => v.id);
    await db.run(
      `DELETE FROM form_dosya WHERE form_id=? AND user_id=?${kalanlar.length ? ` AND id NOT IN (${kalanlar.map(() => '?').join(',')})` : ''}`,
      [formId, userId, ...kalanlar]);
  }

  /**
   * Form listesi. Koordinatör: bütün formlar, yanıt ve beklenen kişi
   * sayısıyla. Ortak: hedef kitlesinde olduğu yayındaki formlar. İkisinde de
   * kendi yanıt zamanı ve kendisine gelen hatırlatma yazılır.
   */
  async function formListesi(user) {
    const [satirlar, kisiler] = await Promise.all([
      db.all(`SELECT forms.*,
                (SELECT CAST(count(*) AS INTEGER) FROM form_yanitlar r WHERE r.form_id=forms.id) AS yanitSayisi,
                (SELECT r.updated FROM form_yanitlar r WHERE r.form_id=forms.id AND r.user_id=?) AS yanitladi,
                ${HATIRLATMA}, ${GORSEL}
              FROM forms WHERE silindi='' ORDER BY created DESC, id DESC`, [user.id, user.id]),
      formKisileri(),
    ]);

    const ortak = form => ({
      ...formGorunum(form),
      soruSayisi: questionsOf(form).filter(q => answerable(q) && live(q)).length,
      yanitladi: form.yanitladi || null,
      hatirlatildi: form.hatirlatildi || null,
    });

    if (user.koordinator) {
      return satirlar.map(form => ({
        ...ortak(form),
        yanitSayisi: Number(form.yanitSayisi),
        beklenen: kisiler.filter(k => fills(form, k)).length,
        acanAd: acan(kisiler, form),
      }));
    }
    /* Taslak form ortağa görünmez. */
    return satirlar.filter(form => targets(form, user.partner) && form.durum !== 'taslak').map(ortak);
  }

  const handle = async function ({ req, res, url, user, readOnly, dil }) {
    const yol = url.pathname.match(/^\/api\/formlar(?:\/(\d{1,9})(?:\/(yanit|yanitlar|gorsel|taslak|hatirlat|dosya|durum)(?:\/(\d{1,9}))?)?)?$/);
    if (!yol) return;
    if (!user) return send(res, 401, { error: 'form.hata.giris' });

    const { sozluk } = await dictionary(dil);
    const t = metinler(sozluk, dil).t;

    const koordinator = !!user.koordinator;
    const formId = Number(yol[1]);
    const bolum = yol[2];
    const altId = Number(yol[3]);
    const yalnizKoordinator = () => send(res, 403, { error: 'form.hata.yalnizKoordinator' });

    /* --- Liste ve yeni form --------------------------------------------- */
    if (!formId) {
      if (req.method === 'GET') return send(res, 200, await formListesi(user));
      if (req.method !== 'POST') return send(res, 405, { error: 'form.hata.islem' });
      if (!koordinator) return yalnizKoordinator();

      const f = validateForm(await body(req, 400000), t);
      const now = new Date().toISOString();
      /* Yeni form TASLAK başlar: koordinatör kontrol edip yayımlayana kadar
         ortaklar görmez. */
      const id = await db.insert(
        `INSERT INTO forms (baslik,aciklama,baslik_rich,aciklama_rich,koordinator_doldurur,sorular,hedef,son_tarih,kapali,olusturan,created,updated,durum)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'taslak')`,
        [f.baslik, f.aciklama, f.baslikRich, f.aciklamaRich, f.koordinatorDoldurur, f.sorular, f.hedef, f.sonTarih, f.kapali, user.id, now, now]);
      return send(res, 201, { id: Number(id), updated: now });
    }

    const form = await db.get(`SELECT forms.*, ${GORSEL} FROM forms WHERE id=? AND silindi=''`, [formId]);
    if (!form || (!koordinator && (!targets(form, user.partner) || form.durum === 'taslak'))) {
      return send(res, 404, { error: 'form.hata.bulunamadi' });
    }

    /* --- Tek form: oku, düzenle, sil ------------------------------------ */
    if (!bolum) {
      if (req.method === 'GET') {
        const benim = await db.get('SELECT yanitlar,updated FROM form_yanitlar WHERE form_id=? AND user_id=?', [formId, user.id]);
        const taslak = await db.get('SELECT yanitlar,updated FROM form_taslak WHERE form_id=? AND user_id=?', [formId, user.id]);
        const gorunum = {
          ...formGorunum(form),
          sorular: questionsOf(form),
          yanitlarim: benim ? answersOf(benim) : null,
          yanitladi: benim?.updated || null,
          taslak: taslak ? { yanitlar: answersOf(taslak), updated: taslak.updated } : null,
          doldurur: fills(form, user),
        };
        /* Kaldırılmış sorular yalnızca koordinatörde (düzenleyici ve rapor) görünür. */
        if (!koordinator) return send(res, 200, { ...gorunum, sorular: gorunum.sorular.filter(live) });
        const yanitlanan = await yanitAlanSorular(formId);
        return send(res, 200, { ...gorunum, yanitSayisi: yanitlanan.sayi, yanitAlanSorular: [...yanitlanan.idler] });
      }

      if (!koordinator) return yalnizKoordinator();
      const now = new Date().toISOString();

      if (req.method === 'DELETE') {
        /* Yanıtlar silinmez; form yalnızca işaretlenir, veritabanından geri alınabilir. */
        await db.run('UPDATE forms SET silindi=?,updated=? WHERE id=?', [now, now, formId]);
        return send(res, 200, { ok: true });
      }

      if (req.method === 'PUT') {
        const veri = await body(req, 400000);
        if (typeof veri.updated !== 'string') throw new ValidationError(t('form.hata.surum'));
        const f = validateForm(veri, t);

        /* Yanıt almış sorular korunur; seçenek adı düzeltmesi eski yanıtlara da işlenir. */
        const once = questionsOf(form), yanitlanan = await yanitAlanSorular(formId);
        f.sorular = protectQuestions(once, f.sorular, yanitlanan.idler, t);
        const renames = validRenames(veri.renames, once, JSON.parse(f.sorular));

        /* Etkinliklerdeki gibi: arada başka bir koordinatör kaydettiyse ezilmez. */
        const oncekiSurum = await db.get('SELECT updated FROM forms WHERE id=?', [formId]);
        if (oncekiSurum.updated !== veri.updated) return send(res, 409, { error: 'form.hata.cakisma' });

        await db.run(
          `UPDATE forms SET baslik=?,aciklama=?,baslik_rich=?,aciklama_rich=?,koordinator_doldurur=?,sorular=?,hedef=?,son_tarih=?,kapali=?,updated=? WHERE id=?`,
          [f.baslik, f.aciklama, f.baslikRich, f.aciklamaRich, f.koordinatorDoldurur, f.sorular, f.hedef, f.sonTarih, f.kapali, now, formId]);

        if (Object.keys(renames).length) {
          for (const tablo of ['form_yanitlar', 'form_taslak']) {
            for (const satir of await db.all(`SELECT user_id,yanitlar FROM ${tablo} WHERE form_id=?`, [formId])) {
              const sonraki = renameAnswers(satir.yanitlar, renames);
              if (sonraki) await db.run(`UPDATE ${tablo} SET yanitlar=? WHERE form_id=? AND user_id=?`, [sonraki, formId, satir.user_id]);
            }
          }
        }
        return send(res, 200, { id: formId, updated: now });
      }
      return send(res, 405, { error: 'form.hata.islem' });
    }

    /* --- Kapak görseli ---------------------------------------------------
       Formu görebilen herkes görür, koordinatör değiştirir. Formun `updated`
       sürümüne dokunmaz; açık düzenleyici çakışma vermez. */
    if (bolum === 'gorsel' && !altId) {
      if (readOnly) {
        const gorsel = await db.get('SELECT tur,veri FROM form_gorsel WHERE form_id=?', [formId]);
        if (!gorsel) return send(res, 404, { error: 'form.hata.gorselYok' });
        const veri = Buffer.from(gorsel.veri);
        res.writeHead(200, { 'Content-Type': gorsel.tur, 'Content-Length': veri.length, 'Cache-Control': 'private, max-age=604800, immutable' });
        return res.end(req.method === 'HEAD' ? undefined : veri);
      }
      if (!koordinator) return yalnizKoordinator();
      if (req.method === 'DELETE') {
        await db.run('DELETE FROM form_gorsel WHERE form_id=?', [formId]);
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'PUT') return send(res, 405, { error: 'form.hata.islem' });

      const veri = await rawBody(req, MAX_GORSEL_BYTES);
      /* Tür baytlardan çıkarılır: kapak görseli aynı kökenden gösterildiği
         için SVG kabul edilmez (bkz. lib/data.mjs · sniffPhoto). */
      const tur = sniffPhoto(veri);
      if (!tur || tur === 'image/gif') throw new ValidationError(t('form.hata.gorselTuru'));
      const now = new Date().toISOString();
      await db.run('DELETE FROM form_gorsel WHERE form_id=?', [formId]);
      await db.run('INSERT INTO form_gorsel (form_id,tur,veri,updated) VALUES (?,?,?,?)', [formId, tur, veri, now]);
      return send(res, 200, { gorsel: now });
    }

    /* --- Yanıt gönderme -------------------------------------------------- */
    if (bolum === 'yanit' && !altId && req.method === 'PUT') {
      if (!fills(form, user)) return send(res, 403, { error: 'form.hata.doldurmaYetkisi' });
      if (!accepting(form)) throw new ValidationError(t('form.hata.kapali'));

      const sorular = questionsOf(form);
      let yanitlar = await dosyalariBagla(formId, user.id, sorular,
        validateAnswers(sorular, (await body(req, 400000)).yanitlar, t), t, true);

      /* Kaldırılmış soruya daha önce verilen yanıt, düzeltmede silinmez. */
      const onceki = await db.get('SELECT yanitlar FROM form_yanitlar WHERE form_id=? AND user_id=?', [formId, user.id]);
      if (onceki) {
        const korunan = answersOf(onceki), birlesik = JSON.parse(yanitlar);
        for (const q of sorular) if (q.archived && korunan[q.id] !== undefined) birlesik[q.id] = korunan[q.id];
        yanitlar = JSON.stringify(birlesik);
      }

      const now = new Date().toISOString();
      /* Kişi başına tek satır: ikinci gönderim yanıtı günceller. */
      if (onceki) {
        await db.run('UPDATE form_yanitlar SET partner=?,yanitlar=?,updated=? WHERE form_id=? AND user_id=?',
          [user.partner, yanitlar, now, formId, user.id]);
      } else {
        await db.run('INSERT INTO form_yanitlar (form_id,user_id,partner,yanitlar,created,updated) VALUES (?,?,?,?,?,?)',
          [formId, user.id, user.partner, yanitlar, now, now]);
      }
      /* Taslak ve hatırlatma yanıtla birlikte kapanır; yanıtta kalmayan dosyalar silinir. */
      await db.run('DELETE FROM form_taslak WHERE form_id=? AND user_id=?', [formId, user.id]);
      await db.run('DELETE FROM form_hatirlatma WHERE form_id=? AND user_id=?', [formId, user.id]);
      await dosyalariBudama(formId, user.id, yanitlar);
      return send(res, 200, { ok: true, yanitladi: now });
    }

    /* --- Durum: taslak ↔ yayında -----------------------------------------
       Yanıt almış form taslağa geri alınamaz (ortaklar doldurdukları formu
       birden göremez olurdu); kapatmak için "Yanıt almayı durdur". */
    if (bolum === 'durum' && !altId && req.method === 'PUT') {
      if (!koordinator) return yalnizKoordinator();
      const { durum } = await body(req);
      if (!['taslak', 'yayinda'].includes(durum)) throw new ValidationError(t('form.hata.durum'));
      if (durum === 'taslak' && (await yanitAlanSorular(formId)).sayi) throw new ValidationError(t('form.hata.taslagaAlinamaz'));
      const now = new Date().toISOString();
      await db.run('UPDATE forms SET durum=?,yayinlandi=?,updated=? WHERE id=?',
        [durum, durum === 'yayinda' ? (form.yayinlandi || now) : form.yayinlandi, now, formId]);
      return send(res, 200, { durum, updated: now });
    }

    /* --- Taslak yanıt ---------------------------------------------------- */
    if (bolum === 'taslak' && !altId) {
      if (!fills(form, user)) return send(res, 403, { error: 'form.hata.doldurmaYetkisi' });
      if (req.method === 'DELETE') {
        await db.run('DELETE FROM form_taslak WHERE form_id=? AND user_id=?', [formId, user.id]);
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'PUT') return send(res, 405, { error: 'form.hata.islem' });
      if (!accepting(form)) throw new ValidationError(t('form.hata.kapali'));

      const sorular = questionsOf(form);
      const yanitlar = await dosyalariBagla(formId, user.id, sorular,
        validateAnswers(sorular, (await body(req, 400000)).yanitlar, t, { partial: true }), t);
      const now = new Date().toISOString();
      const varMi = await db.get('SELECT 1 AS v FROM form_taslak WHERE form_id=? AND user_id=?', [formId, user.id]);
      if (varMi) await db.run('UPDATE form_taslak SET yanitlar=?,updated=? WHERE form_id=? AND user_id=?', [yanitlar, now, formId, user.id]);
      else await db.run('INSERT INTO form_taslak (form_id,user_id,yanitlar,updated) VALUES (?,?,?,?)', [formId, user.id, yanitlar, now]);
      return send(res, 200, { updated: now });
    }

    /* --- Hatırlatma ------------------------------------------------------ */
    if (bolum === 'hatirlat' && !altId && req.method === 'POST') {
      if (!koordinator) return yalnizKoordinator();
      if (!accepting(form)) throw new ValidationError(t('form.hata.hatirlatKapali'));

      const veri = await body(req);
      const yanitlayan = new Set((await db.all('SELECT user_id FROM form_yanitlar WHERE form_id=?', [formId])).map(r => r.user_id));
      let kisiler = (await formKisileri()).filter(k => fills(form, k) && !yanitlayan.has(k.id));
      if (Array.isArray(veri.kisiler)) kisiler = kisiler.filter(k => veri.kisiler.includes(k.id));

      const now = new Date().toISOString();
      for (const k of kisiler) {
        await db.run('DELETE FROM form_hatirlatma WHERE form_id=? AND user_id=?', [formId, k.id]);
        await db.run('INSERT INTO form_hatirlatma (form_id,user_id,gonderen,created) VALUES (?,?,?,?)', [formId, k.id, user.id, now]);
      }
      return send(res, 200, { sayi: kisiler.length, hatirlatildi: now });
    }

    /* --- Dosya -----------------------------------------------------------
       Yükleme gönderimden önce yapılır; dosya yanıta bağlanana kadar
       yalnızca yükleyene aittir. İndirme yalnızca koordinatöre ve
       yükleyene açık, her zaman EK olarak. */
    if (bolum === 'dosya') {
      if (readOnly && altId) {
        const dosya = await db.get('SELECT user_id,ad,tur,veri FROM form_dosya WHERE id=? AND form_id=?', [altId, formId]);
        if (!dosya || (!koordinator && dosya.user_id !== user.id)) return send(res, 404, { error: 'form.hata.dosyaYok' });
        const veri = Buffer.from(dosya.veri);
        const ascii = dosya.ad.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
        res.writeHead(200, {
          'Content-Type': dosya.tur, 'Content-Length': veri.length, 'Cache-Control': 'private, no-store',
          'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(dosya.ad)}`,
        });
        return res.end(req.method === 'HEAD' ? undefined : veri);
      }
      if (req.method !== 'POST' || altId) return send(res, 405, { error: 'form.hata.islem' });
      if (!fills(form, user)) return send(res, 403, { error: 'form.hata.doldurmaYetkisi' });
      if (!accepting(form)) throw new ValidationError(t('form.hata.kapali'));

      const soru = questionsOf(form).find(q => q.id === url.searchParams.get('soru') && q.type === 'dosya');
      if (!soru) throw new ValidationError(t('form.hata.dosyaSorusu'));

      let hamAd = '';
      try { hamAd = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { /* bozuk başlık: ad boş kalır */ }
      const bilgi = fileInfo(hamAd, t);

      /* Yanıta bağlanmamış eski yüklemeler de sayılır: sınırsız yükleme olmasın. */
      const { n } = await db.get('SELECT CAST(count(*) AS INTEGER) AS n FROM form_dosya WHERE form_id=? AND user_id=? AND soru_id=?',
        [formId, user.id, soru.id]);
      if (Number(n) >= MAX_FILES * 4) throw new ValidationError(t('form.hata.cokYukleme'));

      const veri = await rawBody(req, MAX_FILE_BYTES);
      if (!veri.length) throw new ValidationError(t('form.hata.bosDosya'));
      const id = await db.insert(
        'INSERT INTO form_dosya (form_id,user_id,soru_id,ad,tur,boyut,veri,created) VALUES (?,?,?,?,?,?,?,?)',
        [formId, user.id, soru.id, bilgi.name, bilgi.type, veri.length, veri, new Date().toISOString()]);
      return send(res, 201, { id: Number(id), ad: bilgi.name, boyut: veri.length });
    }

    /* --- Yanıtlar (koordinatör) ------------------------------------------ */
    if (bolum === 'yanitlar') {
      if (!koordinator) return yalnizKoordinator();

      if (req.method === 'DELETE' && altId) {
        const silinen = await db.get('SELECT user_id FROM form_yanitlar WHERE id=? AND form_id=?', [altId, formId]);
        if (!silinen) return send(res, 404, { error: 'form.hata.yanitYok' });
        await db.run('DELETE FROM form_yanitlar WHERE id=?', [altId]);
        await dosyalariBudama(formId, silinen.user_id, '{}');
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'GET' || altId) return send(res, 405, { error: 'form.hata.islem' });

      const satirlar = await db.all(
        `SELECT r.id,r.user_id,r.partner,r.yanitlar,r.updated,u.username,u.ad
           FROM form_yanitlar r LEFT JOIN users u ON u.id=r.user_id WHERE r.form_id=? ORDER BY r.updated`, [formId]);
      const yanitlar = satirlar.map(r => ({
        id: r.id,
        partner: r.partner,
        ad: r.username ? kisiAdi(r) : t('form.silinmisHesap'),
        updated: r.updated,
        yanitlar: r.yanitlar,
      }));

      const bicim = url.searchParams.get('bicim');
      if (bicim === 'xlsx') {
        const dosya = formExcel({ form, yanitlar, t, dil });
        res.writeHead(200, {
          'Content-Type': XLSX,
          'Content-Disposition': `attachment; filename="eyouthpreneur-form-${formId}.xlsx"`,
          'Content-Length': dosya.length,
        });
        return res.end(dosya);
      }
      if (bicim) throw new ValidationError(t('form.hata.bicim2'));

      /* Bekleyenler: hedef kitledeki kişiler. Hiç hesabı olmayan kurumlar ayrıca. */
      const yanitlayan = new Set(satirlar.map(r => r.user_id));
      const kisiler = (await formKisileri()).filter(k => fills(form, k));
      const hatirlatilan = new Map((await db.all('SELECT user_id,created FROM form_hatirlatma WHERE form_id=?', [formId]))
        .map(r => [r.user_id, r.created]));
      const hedeflenen = form.hedef ? listOf(form.hedef) : partnerIds;

      return send(res, 200, {
        form: { ...formGorunum(form), sorular: questionsOf(form) },
        yanitlar: yanitlar.map(r => ({ ...r, yanitlar: answersOf({ yanitlar: r.yanitlar }) })),
        /* Sıralama burada: SQL'in ORDER BY'ı Türkçe harfleri bilmez. */
        bekleyen: kisiler.filter(k => !yanitlayan.has(k.id))
          .map(k => ({ id: k.id, ad: kisiAdi(k), partner: k.partner, hatirlatildi: hatirlatilan.get(k.id) || null }))
          .sort((a, b) => partnerIds.indexOf(a.partner) - partnerIds.indexOf(b.partner) || a.ad.localeCompare(b.ad, dil)),
        hesapsiz: hedeflenen.filter(id => !kisiler.some(k => k.partner === id)),
        ortaklar: partners.map(p => ({ id: p.id, name: p.name, short: p.short, country: p.country })),
      });
    }

    return send(res, 405, { error: 'form.hata.islem' });
  };

  return { handle, formListesi };
}
