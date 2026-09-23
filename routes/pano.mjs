import { partnerIds, listOf } from '../lib/data.mjs';
import { send } from '../lib/http.mjs';
import { accepting, fills } from '../lib/forms.mjs';
import { dosyaOzetleri, durumBekliyor, teslimBekliyor } from '../lib/faaliyet.mjs';
import { CIKTILAR } from '../lib/cikti.mjs';

/**
 * Kişisel çalışma panosu: GET /api/pano.
 *
 * Girişten sonra açılan ekran. Hepsi TÜRETİLİR (hatırlatıcılardaki karar):
 * görev tamamlanınca, form yanıtlanınca, dosya yüklenince pano kendiliğinden
 * boşalır. Kapsam kullanıcının KURUMUDUR; koordinatör ayrıca kurumlar arası
 * genel durumu görür.
 */
const YAKIN_GUN = 60;

export function panoRoutes({ db }) {
  const bugun = () => new Date().toISOString().slice(0, 10);
  const gunEkle = (gun, n) => new Date(Date.parse(gun + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const acikGorev = g => g.durum !== 'tamamlandi' && g.durum !== 'iptal';

  return async function handle({ req, res, url, user }) {
    if (url.pathname !== '/api/pano' || req.method !== 'GET') return;
    if (!user) return send(res, 401, { error: 'genel.girisGerekli' });

    const simdi = bugun();
    const kurum = user.partner;
    const ozet = await dosyaOzetleri(db);

    /* --- Etkinlikler ----------------------------------------------------- */
    const etkinlikler = (await db.all('SELECT id,slug,kod,wp,tur,baslik,lider,katilimcilar,baslangic,bitis,durum FROM events'))
      .map(e => ({ ...e, baslangic: String(e.baslangic).slice(0, 10), bitis: String(e.bitis).slice(0, 10),
        katilimcilar: listOf(e.katilimcilar), dosya: ozet[e.id] || null }));
    const kisa = e => ({ id: e.id, slug: e.slug, kod: e.kod, wp: e.wp, tur: e.tur, baslik: e.baslik, lider: e.lider,
      baslangic: e.baslangic, bitis: e.bitis, durum: e.durum, dosya: e.dosya });

    /* Kurumun yaklaşan işleri: önümüzdeki 60 günde başlayan ya da süren,
       kurumun lider OLDUĞU (hazırlık onun işi) ya da katıldığı faaliyetler. */
    const yaklasan = etkinlikler
      .filter(e => e.durum !== 'ertelendi' && e.bitis >= simdi && e.baslangic <= gunEkle(simdi, YAKIN_GUN))
      .filter(e => e.lider === kurum || e.katilimcilar.includes(kurum))
      .sort((a, b) => a.baslangic.localeCompare(b.baslangic))
      .map(e => ({ ...kisa(e), rol: e.lider === kurum ? 'lider' : 'katilimci' }));

    /* Faaliyet dosyası eksik: başlamış (belge toplanmaya başlanmış olmalı)
       ve kurumun lider olduğu faaliyetler. Koordinatör hepsini görür. */
    const eksikDosya = etkinlikler
      .filter(e => e.dosya && e.dosya.tamam < e.dosya.toplam && e.baslangic <= simdi && e.durum !== 'ertelendi')
      .filter(e => user.koordinator || e.lider === kurum)
      .sort((a, b) => a.baslangic.localeCompare(b.baslangic))
      .map(kisa);

    /* --- Görevler ------------------------------------------------------------ */
    const gorevler = (await db.all('SELECT id,partner,baslik,son_tarih,durum,ilerleme FROM tasks'))
      .map(g => ({ ...g, son_tarih: g.son_tarih ? String(g.son_tarih).slice(0, 10) : null, ilerleme: Number(g.ilerleme || 0) }));
    const kurumGorevleri = gorevler.filter(g => g.partner === kurum && acikGorev(g));
    const geciken = gorevler
      .filter(g => acikGorev(g) && g.son_tarih && g.son_tarih < simdi && (g.partner === kurum || user.koordinator))
      .sort((a, b) => a.son_tarih.localeCompare(b.son_tarih));
    const yaklasanGorev = kurumGorevleri
      .filter(g => g.son_tarih && g.son_tarih >= simdi && g.son_tarih <= gunEkle(simdi, YAKIN_GUN))
      .sort((a, b) => a.son_tarih.localeCompare(b.son_tarih));

    /* --- Formlar --------------------------------------------------------------- */
    const formlar = await db.all("SELECT id,baslik,son_tarih,durum,kapali,hedef,koordinator_doldurur FROM forms WHERE silindi=''");
    const yanitlar = await db.all('SELECT form_id,user_id FROM form_yanitlar');
    const acikFormlar = formlar.filter(f => accepting(f, new Date()));
    const bekleyenForm = acikFormlar
      .filter(f => fills(f, user) && !yanitlar.some(y => y.form_id === f.id && y.user_id === user.id))
      .map(f => ({ id: f.id, baslik: f.baslik, sonTarih: f.son_tarih || null }))
      .sort((a, b) => (a.sonTarih || '9999').localeCompare(b.sonTarih || '9999'));

    /* --- Dosyalar: kurumun son yükledikleri (klasörler) ------------------------ */
    const dosyalar = (await db.all(
      `SELECT d.id, d.klasor, d.ad, d.updated, u.ad AS yukleyen_ad, u.username
         FROM klasor_dosya d LEFT JOIN users u ON u.id=d.yukleyen
        WHERE d.partner=? ORDER BY d.updated DESC LIMIT 6`, [kurum]))
      .map(d => ({ id: d.id, klasor: d.klasor, ad: d.ad, updated: d.updated, yukleyen: d.yukleyen_ad || d.username || '' }));

    /* --- Çıktılar: kurumun sorumlu olduğu ----------------------------------------- */
    const ciktiSatir = new Map((await db.all('SELECT slug,durum,sorumlu,teslim FROM outputs')).map(r => [r.slug, r]));
    const ciktilar = CIKTILAR.map(t => {
      const s = ciktiSatir.get(t.slug);
      const e = t.etkinlik ? etkinlikler.find(x => x.slug === t.etkinlik) : null;
      return { slug: t.slug, anahtar: t.anahtar, araUrun: !!t.araUrun, durum: s?.durum,
        sorumlu: e ? e.lider : s?.sorumlu || null, teslim: e ? e.bitis : s?.teslim || null };
    });
    const benimCiktilar = ciktilar.filter(c => c.sorumlu === kurum);

    /* Durumu güncellenecekler: bitmiş ama "tamamlandı" yapılmamış faaliyet,
       teslim tarihi geçmiş ama "teslim edildi" yapılmamış çıktı. Kurum
       kendi sorumluluğundakileri, koordinatör hepsini görür. */
    const durumGuncelle = [
      ...etkinlikler.filter(e => durumBekliyor(e, simdi) && (user.koordinator || e.lider === kurum))
        .map(e => ({ tur: 'etkinlik', ...kisa(e) })),
      ...ciktilar.filter(c => teslimBekliyor(c, simdi) && (user.koordinator || c.sorumlu === kurum))
        .map(c => ({ tur: 'cikti', ...c })),
    ];

    /* --- Koordinatör: kurumlar arası genel durum --------------------------------- */
    let genel = null;
    if (user.koordinator) {
      const kisiler = await db.all('SELECT id,partner,koordinator FROM users');
      genel = partnerIds.map(p => {
        const gorev = gorevler.filter(g => g.partner === p && acikGorev(g));
        const bekleyen = kisiler.filter(k => k.partner === p)
          .reduce((n, k) => n + acikFormlar.filter(f => fills(f, k) && !yanitlar.some(y => y.form_id === f.id && y.user_id === k.id)).length, 0);
        const lider = etkinlikler.filter(e => e.lider === p && e.dosya && e.baslangic <= simdi && e.durum !== 'ertelendi');
        const sorumlu = ciktilar.filter(c => c.sorumlu === p && !c.araUrun);
        return {
          partner: p,
          acikGorev: gorev.length,
          gecikenGorev: gorev.filter(g => g.son_tarih && g.son_tarih < simdi).length,
          bekleyenYanit: bekleyen,
          eksikFaaliyet: lider.filter(e => e.dosya.tamam < e.dosya.toplam).length,
          durumBekleyen: etkinlikler.filter(e => e.lider === p && durumBekliyor(e, simdi)).length
            + ciktilar.filter(c => c.sorumlu === p && teslimBekliyor(c, simdi)).length,
          ciktiTeslim: sorumlu.filter(c => c.durum === 'teslim').length,
          ciktiToplam: sorumlu.length,
        };
      });
    }

    return send(res, 200, {
      kurum, yaklasan, yaklasanGorev, geciken, bekleyenForm, dosyalar, eksikDosya,
      ciktilar: benimCiktilar, durumGuncelle, genel,
    });
  };
}
