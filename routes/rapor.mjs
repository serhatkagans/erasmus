import {
  PROJECT, partnerIds, partnerOf, wpIds, types, statuses,
  listOf, requireDay, daysBetween, ValidationError,
} from '../lib/data.mjs';
import { send, DOCX, XLSX, ZIP } from '../lib/http.mjs';
import { dictionary } from '../lib/i18n.mjs';
import { raporYaz, metinler, donemBilgisi } from '../lib/rapor.mjs';
import { excelYaz } from '../lib/excel.mjs';
import { zip } from '../lib/zip.mjs';

/**
 * Faaliyet raporu: seçilen dönemin etkinlik programı Word, Excel ya da
 * fotoğraf arşivi olarak iner.
 *
 * BELGE, İSTEĞİN DİLİNDE ÜRETİLİR — sözlük sunucuda çözülür (lib/i18n.mjs),
 * çünkü resmî aktivitelerin başlığı veritabanında değil sözlüktedir. Rapor
 * arayüzle aynı dili konuşur; dil değiştirilip yeniden indirilirse ortaklara
 * kendi dillerinde rapor gönderilebilir.
 *
 * SÜZGEÇLER VERİTABANINDA DEĞİL BELLEKTE uygulanır. Sebebi aynı: resmî
 * aktivitelerin adı `events.baslik` sütununda boştur, çeviri dosyasından
 * gelir — `WHERE baslik LIKE ...` bu kayıtları hiç bulamazdı. Program 24 ayda
 * birkaç düzine satır; tarih aralığı SQL'de süzüldükten sonra kalanı
 * bellekte elemek ölçülemeyecek kadar ucuz.
 *
 * Rapor GİRİŞ İSTER. Program herkese açıktır, ama rapor projenin kurum içi
 * çıktısıdır: kimin ürettiği belgenin altbilgisinde yazar.
 */

/* Dönem en fazla bu kadar gün olabilir: proje 24 ay, sınır rahat bir pay
   bırakır ve yazım hatasıyla girilen 2099 tarihini eler. */
const MAX_DONEM_GUN = 1200;

/* Bir arşive giren en fazla fotoğraf: tümü belleğe alınıp paketlendiği için
   sınırsız bırakılamaz. Aşılırsa arşiv sessizce eksik inmesin diye durum
   içindekiler dosyasının başına yazılır. */
const MAX_ARSIV_FOTO = 400;

const UZANTI = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/* Windows ve macOS'ta dosya adında kullanılamayan karakterler ayıklanır. */
const dosyaAdi = value => String(value).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export function raporRoutes({ db }) {
  const SELECT = 'SELECT id,slug,wp,kod,tur,yer,lider,katilimcilar,baslik,ozet,baslangic,bitis,durum,url,resmi FROM events';

  const shape = row => ({
    ...row,
    katilimcilar: listOf(row.katilimcilar),
    baslangic: String(row.baslangic).slice(0, 10),
    bitis: String(row.bitis).slice(0, 10),
    resmi: !!row.resmi,
  });

  /** Dönem: `bas`–`bit` (iki gün de dahil). Verilmezse tüm proje süresi. */
  function donem(url) {
    const bas = url.searchParams.get('bas') || PROJECT.start;
    const bit = url.searchParams.get('bit') || PROJECT.end;
    const from = requireDay(bas, 'Başlangıç tarihi');
    const to = requireDay(bit, 'Bitiş tarihi');
    if (to < from) throw new ValidationError('rapor.hata.tarih');
    if (daysBetween(from, to) > MAX_DONEM_GUN) throw new ValidationError('rapor.hata.donem');
    return { from, to };
  }

  /** Süzgeçler; tanınmayan değer sessizce geçilmez, istek reddedilir. */
  function filtreler(url) {
    const al = (ad, izinli) => {
      const deger = url.searchParams.get(ad) || '';
      if (deger && !izinli.includes(deger)) throw new ValidationError('rapor.hata.suzgec');
      return deger;
    };
    const arama = (url.searchParams.get('ara') || '').trim();
    if (arama.length === 1 || arama.length > 100) throw new ValidationError('rapor.hata.arama');
    return {
      wp: al('wp', wpIds),
      tur: al('tur', types),
      ortak: al('ortak', partnerIds),
      durum: al('durum', statuses),
      arama,
    };
  }

  /**
   * Fotoğraf arşivi: her etkinlik kendi klasöründe, dosyalar yükleme
   * sırasına göre numaralı. Fotoğraflar diskte değil `event_photos`
   * tablosunda durduğu için doğrudan oradan paketlenir.
   */
  async function fotoArsivi(m, events) {
    if (!events.length) return [];
    const idler = events.map(e => e.id);
    const rows = await db.all(
      `SELECT event_id,tur,veri FROM event_photos WHERE event_id IN (${idler.map(() => '?').join(',')}) ORDER BY event_id,id`, idler);
    if (!rows.length) return [];

    /* Aynı gün başlayan iki etkinliğin adı aynıysa klasörler karışmasın. */
    const klasorler = new Map(), kullanilan = new Set();
    for (const e of events) {
      const taban = `${e.baslangic} ${dosyaAdi(m.baslik(e)) || e.wp}`;
      const ad = kullanilan.has(taban) ? `${taban} (${e.id})` : taban;
      kullanilan.add(ad);
      klasorler.set(e.id, ad);
    }

    /* Dosya adı da etkinliği taşır: arşiv düz açılsa ya da tek fotoğraf
       başka bir klasöre sürüklense bile hangi etkinliğe ait olduğu
       kaybolmaz. */
    const sayaclar = new Map();
    const disarida = Math.max(0, rows.length - MAX_ARSIV_FOTO);
    const girdiler = rows.slice(0, MAX_ARSIV_FOTO).map(row => {
      const klasor = klasorler.get(row.event_id);
      const sira = (sayaclar.get(row.event_id) || 0) + 1;
      sayaclar.set(row.event_id, sira);
      const veri = Buffer.isBuffer(row.veri) ? row.veri : Buffer.from(row.veri);
      return { name: `${klasor}/${klasor} - ${sira}.${UZANTI[row.tur] || 'jpg'}`, data: veri };
    });

    const icindekiler = events.filter(e => sayaclar.get(e.id)).map(e => [
      `${m.t('rapor.arsiv.klasor')}: ${klasorler.get(e.id)}`,
      `${m.t('form.ad')}: ${m.baslik(e)}`,
      `${m.t('etkinlik.tarih')}: ${e.baslangic} – ${e.bitis}`,
      `${m.t('etkinlik.ispaketi')}: ${e.wp} · ${m.t(`wp.${e.wp}.kisa`)}`,
      `${m.t('etkinlik.tur')}: ${m.t(`tur.${e.tur}`)}`,
      `${m.t('etkinlik.lider')}: ${m.ortak(e.lider)}`,
      `${m.t('etkinlik.durum')}: ${m.t(`durum.${e.durum}`)}`,
      `${m.t('foto.baslik')}: ${sayaclar.get(e.id)}`,
    ].join('\n')).join('\n\n');
    const uyari = disarida ? m.t('rapor.arsiv.uyari', { toplam: rows.length, n: disarida, sinir: MAX_ARSIV_FOTO }) + '\n\n' : '';
    /* Baştaki BOM, dosyayı Not Defteri'nde açan kişide Türkçe karakterlerin
       bozuk görünmesini engeller. */
    girdiler.unshift({ name: 'icindekiler.txt', data: Buffer.from('﻿' + uyari + icindekiler + '\n', 'utf8') });
    return girdiler;
  }

  return async function handle({ req, res, url, user, dil }) {
    if (url.pathname !== '/api/rapor' || req.method !== 'GET') return;
    if (!user) return send(res, 401, { error: 'rapor.hata.giris' });

    const { from, to } = donem(url);
    const suzgec = filtreler(url);
    const bicim = url.searchParams.get('bicim') || 'docx';
    if (!['docx', 'xlsx', 'zip'].includes(bicim)) throw new ValidationError('rapor.hata.bicim');

    const { sozluk } = await dictionary(dil);
    const m = metinler(sozluk, dil);

    /* Döneme DEĞEN her kayıt girer: sınırı aşan çok günlük çıktı dönemleri
       de raporda görünsün (aşanlar belgede ayrıca not edilir). */
    const rows = (await db.all(`${SELECT} WHERE baslangic<=? AND bitis>=? ORDER BY baslangic, wp, kod`, [to, from])).map(shape);

    /* Arayüzde aramayla eşleşip işaretli bırakılan kayıtlar: arama yerine
       yalnızca bu kimlikler girer. */
    const idler = url.searchParams.get('idler');
    if (idler !== null && !/^\d{1,9}(,\d{1,9}){0,499}$/.test(idler)) throw new ValidationError('rapor.hata.secim');
    const secili = idler === null ? null : new Set(idler.split(',').map(Number));

    const ara = suzgec.arama.toLocaleLowerCase(dil);
    const events = rows.filter(e => {
      if (secili) return secili.has(e.id);
      if (suzgec.wp && e.wp !== suzgec.wp) return false;
      if (suzgec.tur && e.tur !== suzgec.tur) return false;
      if (suzgec.durum && e.durum !== suzgec.durum) return false;
      if (suzgec.ortak && e.lider !== suzgec.ortak && !e.katilimcilar.includes(suzgec.ortak)) return false;
      if (!ara) return true;
      return [m.baslik(e), e.kod, m.ozet(e)].join(' ').toLocaleLowerCase(dil).includes(ara);
    });

    if (bicim === 'zip') {
      const girdiler = await fotoArsivi(m, events);
      if (!girdiler.length) return send(res, 400, { error: 'rapor.hata.fotoyok' });
      const arsiv = zip(girdiler);
      res.writeHead(200, {
        'Content-Type': ZIP,
        'Content-Disposition': `attachment; filename="e-youthpreneur-fotograflar-${donemBilgisi(m, from, to).slug}.zip"`,
        'Content-Length': arsiv.length,
      });
      res.end(arsiv);
      return true;
    }

    /* Fotoğraf sayısı hem Word ayrıntılarında hem Excel sütununda geçiyor;
       görsellerin kendisi çekilmez, yalnızca sayılır. */
    if (events.length) {
      const idListesi = events.map(e => e.id);
      const sayimlar = await db.all(
        `SELECT event_id, CAST(count(*) AS INTEGER) AS n FROM event_photos WHERE event_id IN (${idListesi.map(() => '?').join(',')}) GROUP BY event_id`, idListesi);
      const harita = new Map(sayimlar.map(s => [s.event_id, Number(s.n)]));
      for (const e of events) e.fotoSayisi = harita.get(e.id) || 0;
    }

    const olusturan = [user.ad, partnerOf(user.partner)?.short].filter(Boolean).join(' · ') || user.username;
    const dosya = bicim === 'xlsx'
      ? excelYaz({ events, sozluk, dil })
      : raporYaz({ from, to, events, filtreler: suzgec, olusturan, sozluk, dil });

    res.writeHead(200, {
      'Content-Type': bicim === 'xlsx' ? XLSX : DOCX,
      'Content-Disposition': `attachment; filename="e-youthpreneur-faaliyet-${donemBilgisi(m, from, to).slug}.${bicim}"`,
      'Content-Length': dosya.length,
    });
    res.end(dosya);
    return true;
  };
}
