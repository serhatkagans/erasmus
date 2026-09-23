import {
  partners, partnerIds, listOf,
  GOREV_YAKIN_GUN, FORM_YAKIN_GUN, ETKINLIK_YAKIN_GUN,
} from '../lib/data.mjs';
import { send } from '../lib/http.mjs';
import { accepting, fills } from '../lib/forms.mjs';
import { durumBekliyor, teslimBekliyor } from '../lib/faaliyet.mjs';
import { CIKTILAR } from '../lib/cikti.mjs';

/**
 * Uygulama içi hatırlatıcılar.
 *
 * TÜRETİLMİŞTİR: hatırlatıcılar bir tabloda birikmez, her istekte mevcut
 * veriden hesaplanır. Bir görev tamamlanınca ya da form yanıtlanınca
 * hatırlatıcı kendiliğinden kaybolur — "okundu" işaretlemek, temizlemek
 * ya da bayat bildirim ayıklamak gerekmez. Tek istisna koordinatörün elle
 * gönderdiği dürtmedir; o bir eylemdir, veriden çıkarılamaz.
 *
 * E-POSTA GÖNDERİLMEZ. Uygulamanın dış bağımlılığı ve SMTP yapılandırması
 * yok; hatırlatıcı, kişi giriş yaptığında ekranda görünür.
 *
 * KAPSAM kullanıcının kurumudur: ortak yalnızca kendi kurumunu ilgilendiren
 * hatırlatıcıları görür. Koordinatör bunlara ek olarak projenin genelini
 * görür (hangi kurum hangi formu yanıtlamadı, kimde gecikmiş görev var).
 */
export function hatirlaticiRoutes({ db }) {
  const bugun = () => new Date().toISOString().slice(0, 10);
  const gunFarki = (a, b) =>
    Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

  const cozumle = (metin, yedek) => {
    try {
      const deger = JSON.parse(metin || '');
      return deger && typeof deger === 'object' ? deger : yedek;
    } catch { return yedek; }
  };

  /**
   * Bir hatırlatıcı kaydı. `metin` değil ANAHTAR taşınır: arayüz onu
   * seçili dilde çözer, böylece hatırlatıcılar da çok dilli olur.
   */
  const yap = (tur, oncelik, anahtar, degerler, bag) => ({ tur, oncelik, anahtar, degerler, bag });

  return async function handle({ req, res, url, user }) {
    if (url.pathname !== '/api/hatirlaticilar' || req.method !== 'GET') return;
    if (!user) return send(res, 401, { error: 'Önce giriş yapın.' });

    const simdi = bugun();
    const liste = [];

    /* --- Formlar ---------------------------------------------------------
       Yalnızca yayında ve son tarihi geçmemiş formlar yanıt bekler. */
    const formlar = await db.all("SELECT id,baslik,son_tarih,durum,kapali,hedef,koordinator_doldurur FROM forms WHERE silindi=''");
    const yanitlar = await db.all('SELECT form_id,user_id FROM form_yanitlar');
    const durtmeler = await db.all('SELECT form_id,user_id,created FROM form_hatirlatma');

    /* Yanıt almaya açık olmak yetmez, KULLANICININ DOLDURACAĞI form olmalı:
       hedef kitlede olmadığı bir form için hatırlatıcı almamalı
       (bkz. lib/forms.mjs · accepting, fills). */
    const acikMi = f => accepting(f, new Date());
    const benimMi = f => fills(f, user);

    for (const f of formlar.filter(f => acikMi(f) && benimMi(f))) {
      const yanitladi = yanitlar.some(y => y.form_id === f.id && y.user_id === user.id);
      if (yanitladi) continue;

      const kalan = f.son_tarih ? gunFarki(simdi, f.son_tarih) : null;
      const durtuldu = durtmeler.some(d => d.form_id === f.id && d.user_id === user.id);

      /* Koordinatörün dürtmesi, son tarih uzak olsa bile öne çıkar:
         karşı taraf bilerek bir şey istemiş demektir. */
      if (durtuldu) {
        liste.push(yap('form', 'acil', 'hatirlatici.form.durtme',
          { baslik: f.baslik }, `formlar.html#form-${f.id}`));
      } else if (kalan !== null && kalan <= FORM_YAKIN_GUN) {
        liste.push(yap('form', kalan <= 3 ? 'acil' : 'uyari', 'hatirlatici.form.yaklasiyor',
          { baslik: f.baslik, n: kalan }, `formlar.html#form-${f.id}`));
      } else {
        liste.push(yap('form', 'bilgi', 'hatirlatici.form.bekliyor',
          { baslik: f.baslik }, `formlar.html#form-${f.id}`));
      }
    }

    /* --- Görevler --------------------------------------------------------- */
    const gorevler = await db.all('SELECT id,partner,baslik,son_tarih,durum FROM tasks');
    const acikGorev = g => g.durum !== 'tamamlandi' && g.durum !== 'iptal';

    for (const g of gorevler.filter(g => g.partner === user.partner && acikGorev(g) && g.son_tarih)) {
      const kalan = gunFarki(simdi, g.son_tarih);
      if (kalan < 0) {
        liste.push(yap('gorev', 'acil', 'hatirlatici.gorev.gecikti',
          { baslik: g.baslik, n: Math.abs(kalan) }, 'ekip.html'));
      } else if (kalan <= GOREV_YAKIN_GUN) {
        liste.push(yap('gorev', kalan <= 3 ? 'acil' : 'uyari', 'hatirlatici.gorev.yaklasiyor',
          { baslik: g.baslik, n: kalan }, 'ekip.html'));
      }
    }

    /* --- Etkinlikler ------------------------------------------------------
       Yalnızca kullanıcının kurumunun LİDER olduğu etkinlikler: hazırlık
       o kurumun işidir. Katılımcı olunan her etkinlik hatırlatılsaydı
       liste herkeste aynı ve işe yaramaz olurdu. */
    const etkinlikler = await db.all(
      'SELECT id,slug,baslik,kod,wp,lider,baslangic,durum FROM events WHERE lider=? AND baslangic>=? AND durum<>?',
      [user.partner, simdi, 'ertelendi']);

    for (const e of etkinlikler) {
      const kalan = gunFarki(simdi, String(e.baslangic).slice(0, 10));
      if (kalan > ETKINLIK_YAKIN_GUN) continue;
      liste.push(yap('etkinlik', kalan <= 7 ? 'uyari' : 'bilgi', 'hatirlatici.etkinlik.yaklasiyor',
        /* Başlık resmî aktivitelerde sözlükten gelir; arayüz `slug` varsa
           onu çevirir, yoksa kayıttaki adı kullanır. */
        { slug: e.slug || '', baslik: e.baslik || e.kod || e.wp, n: kalan },
        `takvim.html#etkinlik-${e.id}`));
    }

    /* --- Durumu güncellenmemiş faaliyet ve çıktı --------------------------
       Bitmiş ama "tamamlandı" yapılmamış faaliyet lider kuruma, teslim tarihi
       geçmiş ama "teslim edildi" yapılmamış çıktı sorumlu kuruma hatırlatılır.
       Karar insanda kalır; hatırlatıcı yalnızca unutulmasın diye. */
    const tumEtkinlik = await db.all('SELECT id,slug,baslik,kod,wp,lider,bitis,durum FROM events');
    const bekleyenEtkinlik = tumEtkinlik.filter(e => durumBekliyor(e, simdi));
    for (const e of bekleyenEtkinlik.filter(e => e.lider === user.partner)) {
      liste.push(yap('etkinlik-durum', 'uyari', 'hatirlatici.etkinlik.durum',
        { slug: e.slug || '', baslik: e.baslik || e.kod || e.wp }, `takvim.html#etkinlik-${e.id}`));
    }
    const ciktiSatir = new Map((await db.all('SELECT slug,durum,sorumlu,teslim FROM outputs')).map(c => [c.slug, c]));
    const ciktilar = CIKTILAR.map(t => {
      const s = ciktiSatir.get(t.slug) || {};
      const e = t.etkinlik ? tumEtkinlik.find(x => x.slug === t.etkinlik) : null;
      return { slug: t.slug, anahtar: t.anahtar, durum: s.durum,
        sorumlu: e ? e.lider : s.sorumlu, teslim: e ? String(e.bitis).slice(0, 10) : s.teslim };
    });
    const bekleyenCikti = ciktilar.filter(c => teslimBekliyor(c, simdi));
    for (const c of bekleyenCikti.filter(c => c.sorumlu === user.partner)) {
      liste.push(yap('cikti-durum', 'uyari', 'hatirlatici.cikti.durum', { anahtar: c.anahtar }, `ciktilar.html#${c.slug}`));
    }

    /* --- Koordinatöre özel --------------------------------------------- */
    if (user.koordinator) {
      const kisiler = await db.all('SELECT id,partner,koordinator FROM users');
      for (const f of formlar.filter(acikMi)) {
        const yanitlayan = yanitlar.filter(y => y.form_id === f.id).length;
        /* Beklenen kişi sayısı hedef kitleden gelir: yalnızca üç kuruma
           açılmış bir formda "yedi kurumdan dördü yanıtlamadı" demek yanlış
           olurdu. */
        const beklenen = kisiler.filter(k => fills(f, k)).length;
        const eksik = beklenen - yanitlayan;
        if (!eksik) continue;
        const kalan = f.son_tarih ? gunFarki(simdi, f.son_tarih) : null;
        if (kalan !== null && kalan <= FORM_YAKIN_GUN) {
          liste.push(yap('form-ozet', kalan <= 3 ? 'acil' : 'uyari', 'hatirlatici.form.eksikYanit',
            { baslik: f.baslik, n: eksik, gun: kalan }, `formlar.html#form-${f.id}`));
        }
      }

      /* Başka kurumlarda durumu güncellenmemiş faaliyet ve çıktılar. */
      const baskaDurum = bekleyenEtkinlik.filter(e => e.lider !== user.partner).length
        + bekleyenCikti.filter(c => c.sorumlu !== user.partner).length;
      if (baskaDurum) {
        liste.push(yap('durum-ozet', 'bilgi', 'hatirlatici.durum.baskaKurum', { n: baskaDurum }, 'pano.html'));
      }

      /* Başka kurumlarda gecikmiş görevler: koordinatörün izleme görevi. */
      const gecikmis = gorevler.filter(g =>
        g.partner !== user.partner && acikGorev(g) && g.son_tarih && gunFarki(simdi, g.son_tarih) < 0);
      if (gecikmis.length) {
        const kurumlar = [...new Set(gecikmis.map(g => g.partner))]
          .map(id => partners.find(p => p.id === id)?.short || id);
        liste.push(yap('gorev-ozet', 'uyari', 'hatirlatici.gorev.baskaKurum',
          { n: gecikmis.length, kurumlar: kurumlar.join(', ') }, 'ekip.html'));
      }
    }

    /* Acil olanlar üstte; aynı öncelikte tür sırası korunur. */
    const sira = { acil: 0, uyari: 1, bilgi: 2 };
    liste.sort((a, b) => sira[a.oncelik] - sira[b.oncelik]);

    return send(res, 200, {
      hatirlaticilar: liste,
      /* Rozetteki sayı yalnızca eyleme çağıran maddeleri sayar: "bilgi"
         düzeyindekiler listede durur ama kırmızı rozet üretmez. */
      acilSayisi: liste.filter(h => h.oncelik !== 'bilgi').length,
    });
  };
}

export { listOf };
