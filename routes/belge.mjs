import { ValidationError, partners, partnerOf, PROJECT } from '../lib/data.mjs';
import { send } from '../lib/http.mjs';
import { dictionary } from '../lib/i18n.mjs';
import { metinler, tarihAraligi } from '../lib/rapor.mjs';
import {
  belgeTuruMu, belgeMetniUret, aliciAdiniCoz, imzaBilgisiniCoz,
  imzaUnvaniOner, ozelMetniCoz, topluAlicilariSec, MAX_BELGE,
} from '../lib/belge.mjs';

/**
 * Katılım ve teşekkür belgesi üretimi.
 *
 * Uç, HAZIR BELGE METNİNİ döndürür; sayfa onu kâğıda dizip yazdırır
 * (bkz. public/belge.js). Metnin sunucuda kurulmasının iki sebebi var:
 *
 *   · ALICININ ADI VERİTABANINDAN ÇÖZÜLÜR, adresten değil. Adres çubuğundaki
 *     adla basılsaydı belge "Ana Popescu" yerine yanlış yazılmış bir adla
 *     çıkabilir ve kimin belgesi olduğu belirsizleşirdi. Kimliğin gerçekten
 *     kayıtlı bir ekip üyesine ait olduğu ayrıca doğrulanır.
 *   · Belge, isteğin DİLİNDE üretilir (bkz. routes/rapor.mjs'deki aynı karar):
 *     kalıp cümleler sözlükten gelir, tarihler seçili dilin biçimiyle yazılır.
 *
 * YETKİ
 * - Koordinatör her kuruma ve her kişiye belge üretir.
 * - Ortak hesabı yalnızca KENDİ KURUMUNUN ekibine ve kendi kurumuna üretir.
 * - Listede olmayan kişi (konuşmacı, destek veren) için serbest ad herkese
 *   açıktır: o kişinin kaydı yoktur ve olması da beklenmez.
 *
 * ÖN KOŞUL YOKTUR — GençTek'teki "rapor yazılmadan, yoklama alınmadan belge
 * üretilemez" kapısı buraya taşınmadı. Orada belge bir katılımın kanıtıydı ve
 * kişinin profiline katılım düşürüyordu; burada öyle bir bağ yok, belge
 * etkinlikten bağımsız olarak da (proje geneline) üretilebiliyor.
 */
export function belgeRoutes({ db }) {
  /** Virgüllü kimlik listesi; boş parametre "hiçbiri" demektir. */
  const kimlikler = ham => {
    const metin = (ham || '').trim();
    if (!metin) return [];
    if (!/^[^,]+(,[^,]+)*$/.test(metin)) throw new ValidationError('belge.hata.secim');
    return [...new Set(metin.split(','))];
  };

  return async function handle({ req, res, url, user, dil }) {
    if (url.pathname !== '/api/belge' || req.method !== 'GET') return;
    if (!user) return send(res, 401, { error: 'belge.hata.giris' });

    const tur = url.searchParams.get('tur') || 'katilim';
    if (!belgeTuruMu(tur)) throw new ValidationError('belge.hata.tur');

    const { sozluk } = await dictionary(dil);
    const m = metinler(sozluk, dil);
    const t = m.t;

    /* --- Etkinlik (isteğe bağlı) ---------------------------------------
       Seçilmezse belge projenin kendisine yazılır; asıl istenen bu. */
    const etkinlikId = url.searchParams.get('etkinlik') || '';
    let etkinlik = null;
    if (etkinlikId) {
      if (!/^\d{1,9}$/.test(etkinlikId)) throw new ValidationError('belge.hata.etkinlik');
      const row = await db.get(
        'SELECT id,slug,wp,kod,baslik,ozet,baslangic,bitis FROM events WHERE id=?', [Number(etkinlikId)]);
      if (!row) throw new ValidationError('belge.hata.etkinlik');
      const kayit = { ...row, baslangic: String(row.baslangic).slice(0, 10), bitis: String(row.bitis).slice(0, 10) };
      etkinlik = {
        id: kayit.id,
        baslik: m.baslik(kayit),
        tarih: tarihAraligi(m, kayit.baslangic, kayit.bitis),
      };
    }

    /* --- Alıcılar ------------------------------------------------------
       Adaylar KAYITLI olanlardır: ekip üyeleri ve ortak kurumlar. Anahtar
       "uye:12" / "kurum:hbv" biçiminde; iki liste tek seçim kutusunda yan
       yana durduğu için tek anahtar alanı ikisini de taşır. */
    const uyeler = await db.all('SELECT id,partner,ad,rol,aktif FROM team ORDER BY partner, ad');
    const adaylar = [
      ...uyeler.map(u => ({
        anahtar: `uye:${u.id}`,
        partner: u.partner,
        ad: u.ad,
        /* Kişinin altına kurumu ve ülkesi yazılır: belgeyi okuyan, kişinin
           hangi ortak kurumdan katıldığını görmeli. */
        altAd: [partnerOf(u.partner)?.name, t(`ulke.${partnerOf(u.partner)?.country}`)].filter(Boolean).join(' · '),
      })),
      ...partners.map(p => ({
        anahtar: `kurum:${p.id}`,
        partner: p.id,
        ad: p.name,
        altAd: t(`ulke.${p.country}`),
      })),
    ];

    const istenenler = kimlikler(url.searchParams.get('alicilar'));
    for (const anahtar of istenenler) {
      const aday = adaylar.find(a => a.anahtar === anahtar);
      if (!aday) throw new ValidationError('belge.hata.secim');
      /* Ortak hesabı başka kurumun kişisine belge basamaz; koordinatör
         serbesttir. Arayüz zaten yalnızca kendi kurumunu gösteriyor, bu
         satır adresi elle yazana karşı. */
      if (!user.koordinator && aday.partner !== user.partner) {
        return send(res, 403, { error: 'belge.hata.yetki' });
      }
    }

    /* Listede olmayan kişi: serbest ad. Her satır bir belge. */
    const serbest = url.searchParams.getAll('ad')
      .flatMap(deger => String(deger).split('\n'))
      .map(deger => deger.trim())
      .filter(Boolean)
      .map(deger => ({ anahtar: null, ad: aliciAdiniCoz(deger), altAd: '' }));

    const alicilar = topluAlicilariSec({ adaylar, istenenler, serbest, dil });

    const ozelMetin = ozelMetniCoz(url.searchParams.get('metin'));
    const imza = imzaBilgisiniCoz({
      ad: url.searchParams.get('imzaAd'),
      unvan: url.searchParams.get('imzaUnvan'),
      varsayilanUnvan: imzaUnvaniOner(user, t),
    });

    const belgeler = alicilar.map(alici => belgeMetniUret({
      tur, ad: alici.ad, altAd: alici.altAd, etkinlik, ozelMetin, t,
    }));

    return send(res, 200, {
      belgeler,
      imza,
      etkinlik,
      azami: MAX_BELGE,
      kunye: {
        proje: t('site.ad'),
        program: t('altbilgi.program'),
        projeNo: PROJECT.formId,
        finanse: t('ab.finanse'),
        feragat: t('altbilgi.feragat'),
      },
    });
  };
}
