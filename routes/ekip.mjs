import {
  ValidationError, partnerIds, wpIds, taskStatuses, DEFAULT_TASK_STATUS,
  requireDay, requireOneOf, requireText, requireProgress, PROGRESS_STEP, PROJECT,
} from '../lib/data.mjs';
import { send, body } from '../lib/http.mjs';

/**
 * Ülke ekipleri ve görev tanımlama.
 *
 * EKİP her ortak kurumun kendi kadrosudur: ad, rol, e-posta. Kurum kendi
 * ekibini yönetir, koordinatör hepsini görür ve düzenleyebilir.
 *
 * GÖREV bir KURUMA tanımlanır, kişiye bağlanması isteğe bağlıdır. 24 aylık
 * bir projede kişiler değişir; görev kurumda kalmalı ki devir sırasında
 * kaybolmasın. Kişi silindiğinde görevin `uye_id` alanı NULL olur
 * (şemadaki ON DELETE SET NULL), görev durur.
 *
 * YETKİ
 * - Koordinatör: her kuruma görev tanımlar, her ekibi düzenler.
 * - Ortak: yalnızca kendi kurumunun ekibini ve görevlerini yönetir.
 *   Kendisine tanımlanmış bir görevi silemez — yalnızca durumunu günceller;
 *   görevi kaldırmak onu tanımlayanın işidir.
 */
export function ekipRoutes({ db }) {
  const uyeShape = r => ({ id: r.id, partner: r.partner, ad: r.ad, rol: r.rol, eposta: r.eposta, aktif: !!r.aktif });
  const gorevShape = r => ({
    id: r.id, partner: r.partner, uyeId: r.uye_id, wp: r.wp, etkinlikId: r.event_id,
    baslik: r.baslik, aciklama: r.aciklama, sonTarih: r.son_tarih, durum: r.durum,
    ilerleme: Number(r.ilerleme ?? 0),
    olusturan: r.olusturan, updated: r.updated,
  });

  /** Kullanıcı bu kurum adına işlem yapabilir mi? */
  const yetkili = (user, partner) => user.koordinator || user.partner === partner;

  const uyeYukle = async id => {
    const row = await db.get('SELECT * FROM team WHERE id=?', [Number(id)]);
    if (!row) throw new ValidationError('Ekip üyesi bulunamadı.');
    return row;
  };
  const gorevYukle = async id => {
    const row = await db.get('SELECT * FROM tasks WHERE id=?', [Number(id)]);
    if (!row) throw new ValidationError('Görev bulunamadı.');
    return row;
  };

  /** Seçilen kişi gerçekten o kurumun ekibinde mi? Değilse görev başka bir
   *  kurumun çalışanına iliştirilmiş olurdu. */
  const uyeDogrula = async (uyeId, partner) => {
    if (uyeId == null || uyeId === '') return null;
    const id = Number(uyeId);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Ekip üyesi seçimi geçersiz.');
    const uye = await db.get('SELECT partner FROM team WHERE id=?', [id]);
    if (!uye || uye.partner !== partner) throw new ValidationError('Seçilen kişi bu kurumun ekibinde değil.');
    return id;
  };

  /**
   * Durum ile ilerlemeyi tutarlı tutar ve `[durum, ilerleme]` döndürür.
   *
   * İkisi aynı bilginin iki ölçeğidir; ayrı ayrı serbest bırakılsaydı
   * "Tamamlandı ama %30" gibi kendi kendisiyle çelişen kayıtlar oluşurdu.
   * Bu yüzden uçlar birbirine bağlanır: tamamlanan görev %100, henüz
   * başlamamış görev %0'dır. Aradaki değerler serbesttir; ilerleme
   * bildirilen bir göreve "devam ediyor" denir.
   */
  const durumVeIlerleme = (durumDegeri, ilerlemeDegeri) => {
    let durum = requireOneOf(durumDegeri, taskStatuses, 'Durum');
    let ilerleme = requireProgress(ilerlemeDegeri ?? 0);
    if (durum === 'tamamlandi') ilerleme = 100;
    else if (ilerleme === 100) durum = 'tamamlandi';
    else if (durum === 'bekliyor' && ilerleme > 0) durum = 'devam';
    if (durum === 'iptal') ilerleme = 0;
    return [durum, ilerleme];
  };

  return async function handle({ req, res, url, user }) {
    if (!url.pathname.startsWith('/api/ekip') && !url.pathname.startsWith('/api/gorevler')) return;
    /* Ekip ve görevler proje içi çalışma bilgisidir; kamuya açık değil. */
    if (!user) return send(res, 401, { error: 'Önce giriş yapın.' });

    /* --- Birleşik okuma -------------------------------------------------
       Ekip ve görevler her zaman birlikte gösterilir (görev bir kişiye
       bağlı); tek çağrı iki gidiş-dönüşü bire indirir. */
    if (url.pathname === '/api/ekip' && req.method === 'GET') {
      const uyeler = (await db.all('SELECT * FROM team ORDER BY partner, ad')).map(uyeShape);
      const gorevler = (await db.all('SELECT * FROM tasks ORDER BY son_tarih, id')).map(gorevShape);
      return send(res, 200, { uyeler, gorevler, gorevDurumlari: taskStatuses, ilerlemeAdimi: PROGRESS_STEP });
    }

    /* --- Ekip üyeleri ---------------------------------------------------- */
    if (url.pathname === '/api/ekip/uye' && req.method === 'POST') {
      const veri = await body(req);
      const partner = requireOneOf(veri.partner, partnerIds, 'Kurum');
      if (!yetkili(user, partner)) return send(res, 403, { error: 'Yalnızca kendi kurumunuzun ekibini düzenleyebilirsiniz.' });
      const id = await db.insert(
        'INSERT INTO team (partner,ad,rol,eposta,aktif,updated) VALUES (?,?,?,?,1,?)',
        [partner,
         requireText(veri.ad, 'Ad soyad', { max: 120 }),
         requireText(veri.rol, 'Rol', { max: 120, required: false }),
         requireText(veri.eposta, 'E-posta', { max: 200, required: false }),
         new Date().toISOString()]);
      return send(res, 201, uyeShape(await uyeYukle(id)));
    }

    if (url.pathname.startsWith('/api/ekip/uye/')) {
      const id = Number(url.pathname.slice('/api/ekip/uye/'.length));
      if (!Number.isInteger(id) || id <= 0) return;
      const mevcut = await uyeYukle(id);
      if (!yetkili(user, mevcut.partner)) return send(res, 403, { error: 'Bu ekip üyesini düzenleme yetkiniz yok.' });

      if (req.method === 'PUT') {
        const veri = await body(req);
        await db.run('UPDATE team SET ad=?,rol=?,eposta=?,aktif=?,updated=? WHERE id=?',
          [requireText(veri.ad, 'Ad soyad', { max: 120 }),
           requireText(veri.rol, 'Rol', { max: 120, required: false }),
           requireText(veri.eposta, 'E-posta', { max: 200, required: false }),
           veri.aktif === false ? 0 : 1,
           new Date().toISOString(), id]);
        return send(res, 200, uyeShape(await uyeYukle(id)));
      }

      if (req.method === 'DELETE') {
        /* Görevler silinmez: şemadaki ON DELETE SET NULL sayesinde kuruma
           ait kalır, yalnızca kişi bağı kopar. */
        await db.run('DELETE FROM team WHERE id=?', [id]);
        return send(res, 200, { ok: true });
      }
    }

    /* --- Görevler --------------------------------------------------------- */
    if (url.pathname === '/api/gorevler' && req.method === 'POST') {
      const veri = await body(req);
      const partner = requireOneOf(veri.partner, partnerIds, 'Kurum');
      /* Ortak kendi kurumuna görev tanımlayabilir (iç iş bölümü);
         başka kuruma tanımlamak koordinatörün işidir. */
      if (!yetkili(user, partner)) return send(res, 403, { error: 'Başka bir kuruma görev tanımlayamazsınız.' });

      const sonTarih = veri.sonTarih ? requireDay(veri.sonTarih, 'Son tarih') : '';
      if (sonTarih && (sonTarih < PROJECT.start || sonTarih > PROJECT.end)) {
        throw new ValidationError(`Son tarih proje süresi içinde olmalı (${PROJECT.start} – ${PROJECT.end}).`);
      }

      const id = await db.insert(
        'INSERT INTO tasks (partner,uye_id,wp,event_id,baslik,aciklama,son_tarih,durum,ilerleme,olusturan,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [partner,
         await uyeDogrula(veri.uyeId, partner),
         veri.wp ? requireOneOf(veri.wp, wpIds, 'İş paketi') : '',
         veri.etkinlikId ? Number(veri.etkinlikId) : null,
         requireText(veri.baslik, 'Görev başlığı', { max: 200 }),
         requireText(veri.aciklama, 'Açıklama', { required: false }),
         sonTarih,
         ...durumVeIlerleme(veri.durum ?? DEFAULT_TASK_STATUS, veri.ilerleme),
         user.id, new Date().toISOString()]);
      return send(res, 201, gorevShape(await gorevYukle(id)));
    }

    if (url.pathname.startsWith('/api/gorevler/')) {
      const id = Number(url.pathname.slice('/api/gorevler/'.length));
      if (!Number.isInteger(id) || id <= 0) return;
      const mevcut = await gorevYukle(id);
      if (!yetkili(user, mevcut.partner)) return send(res, 403, { error: 'Bu görev başka bir kuruma ait.' });

      if (req.method === 'PUT') {
        const veri = await body(req);
        /* Görevi TANIMLAYAN değiştirebilir; görevi ÜSTLENEN yalnızca
           durumunu ilerletir. Koordinatör her ikisini de yapar. */
        const sadeceDurum = !user.koordinator && mevcut.olusturan !== user.id;
        if (sadeceDurum) {
          /* Görevi üstlenen kişi işin ne kadarını bitirdiğini de bildirir:
             durum ve ilerleme aynı bilginin kaba ve ince hâlidir. */
          await db.run('UPDATE tasks SET durum=?,ilerleme=?,updated=? WHERE id=?',
            [...durumVeIlerleme(veri.durum, veri.ilerleme), new Date().toISOString(), id]);
          return send(res, 200, gorevShape(await gorevYukle(id)));
        }

        const sonTarih = veri.sonTarih ? requireDay(veri.sonTarih, 'Son tarih') : '';
        if (sonTarih && (sonTarih < PROJECT.start || sonTarih > PROJECT.end)) {
          throw new ValidationError(`Son tarih proje süresi içinde olmalı (${PROJECT.start} – ${PROJECT.end}).`);
        }
        await db.run(
          'UPDATE tasks SET uye_id=?,wp=?,event_id=?,baslik=?,aciklama=?,son_tarih=?,durum=?,ilerleme=?,updated=? WHERE id=?',
          [await uyeDogrula(veri.uyeId, mevcut.partner),
           veri.wp ? requireOneOf(veri.wp, wpIds, 'İş paketi') : '',
           veri.etkinlikId ? Number(veri.etkinlikId) : null,
           requireText(veri.baslik, 'Görev başlığı', { max: 200 }),
           requireText(veri.aciklama, 'Açıklama', { required: false }),
           sonTarih,
           ...durumVeIlerleme(veri.durum, veri.ilerleme),
           new Date().toISOString(), id]);
        return send(res, 200, gorevShape(await gorevYukle(id)));
      }

      if (req.method === 'DELETE') {
        /* Görevi yalnızca tanımlayan ya da koordinatör kaldırır: üstlenen
           kişi kendisine verilen işi silememeli. */
        if (!user.koordinator && mevcut.olusturan !== user.id) {
          return send(res, 403, { error: 'Görevi yalnızca tanımlayan kişi ya da koordinatör silebilir.' });
        }
        await db.run('DELETE FROM tasks WHERE id=?', [id]);
        return send(res, 200, { ok: true });
      }
    }
  };
}
