import { zip } from './zip.mjs';
import { PROJECT, partnerOf, daysBetween, VIRTUAL } from './data.mjs';

/**
 * Faaliyet raporu — Word (.docx) çıktısı.
 *
 * Belge elle yazılmış WordprocessingML'dir (bkz. lib/zip.mjs). Word, XML
 * öğelerinin SIRASI konusunda katıdır: `w:pPr`, `w:rPr`, `w:tcPr`, `w:tblPr`
 * içindeki öğeler şemadaki sırayla yazılmazsa dosya "bozuk" diye açılmaz.
 * Aşağıdaki yardımcılar bu sırayı korur; yeni biçim eklerken şemaya bakın.
 *
 * Sayfa A4 YATAY: sekiz sütunlu program tablosu dikey sayfaya sığmıyor.
 *
 * BELGEDE DÜZ METİN YOKTUR. Her etiket `locales/*.json` sözlüğünden gelir
 * (bkz. lib/i18n.mjs), tarihler de seçili dilin Intl biçimiyle yazılır —
 * rapor, arayüz hangi dildeyse o dilde iner. Renkler public/style.css
 * paletinden: yeşil girişimcilik, mavi Avrupa boyutu.
 *
 * ERASMUS+ GÖRSEL KİMLİĞİ zorunludur: finansman ibaresi her sayfanın
 * altbilgisinde, resmî sorumluluk reddi belgenin sonundadır.
 */
const GREEN = '12795C', DARKGREEN = '0D5C46', BLUE = '123A6B', INK = '17241F', MUTED = '6F807A';
const BORDER = 'E2E8E6', TINT = 'EAF4F0', SUBTLE = 'F7F9F8', AMBER = '8A5A00';
const PAGE = { width: 16838, height: 11906, margin: 850 };
const WIDTH = PAGE.width - 2 * PAGE.margin; // yazı alanı (twip)

/* İş paketi renkleri arayüzdekilerle aynı (--wp1..--wp4). */
const WP_COLOR = { WP1: '5B6B7A', WP2: '12795C', WP3: '2F6FBF', WP4: 'C9820A' };

/* Durum rengi: tamamlanan koyu yeşil, süren mavi, ertelenen amber. */
const STATUS_STYLE = {
  planlandi: { color: MUTED },
  devam: { color: BLUE, bold: true },
  tamamlandi: { color: DARKGREEN, bold: true },
  ertelendi: { color: AMBER, bold: true },
};

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/* XML 1.0'da geçersiz denetim karakterleri (yapıştırılmış açıklama metninden
   gelebilir) Word'ün dosyayı hiç açmamasına yol açar; ayıklanır. */
const esc = value => String(value ?? '')
  .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---- WordprocessingML yardımcıları ------------------------------------- */

/** Metin parçası. Satır sonları `w:br` olur. rPr sırası: b, i, strike, color, spacing, sz. */
function run(text, o = {}) {
  const props = [
    o.bold && '<w:b/><w:bCs/>',
    o.italic && '<w:i/><w:iCs/>',
    o.strike && '<w:strike/>',
    o.color && `<w:color w:val="${o.color}"/>`,
    o.spacing && `<w:spacing w:val="${o.spacing}"/>`,
    o.size && `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>`,
  ].filter(Boolean).join('');
  const body = String(text ?? '').split(/\r?\n/).map(line => `<w:t xml:space="preserve">${esc(line)}</w:t>`).join('<w:br/>');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${body}</w:r>`;
}

const lineBreak = '<w:r><w:br/></w:r>';

/* Tablodan hemen sonra gelen başlığın "önce boşluk" değeri Word'de tabloya
   yapışık görünüyor; araya küçük boş bir paragraf konur. */
const SPACER = '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="12"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>';

/** Paragraf. pPr sırası: pStyle, keepNext, pBdr, spacing, jc. */
function para(runs = [], o = {}) {
  const props = [
    o.style && `<w:pStyle w:val="${o.style}"/>`,
    o.keepNext && '<w:keepNext/>',
    o.border && `<w:pBdr><w:bottom w:val="single" w:sz="${o.border.size}" w:space="${o.border.space ?? 4}" w:color="${o.border.color}"/></w:pBdr>`,
    `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 0}"/>`,
    o.align && `<w:jc w:val="${o.align}"/>`,
  ].filter(Boolean).join('');
  return `<w:p><w:pPr>${props}</w:pPr>${[].concat(runs).join('')}</w:p>`;
}

const side = (name, size, color) => `<w:${name} w:val="${size ? 'single' : 'nil'}"${size ? ` w:sz="${size}" w:space="0" w:color="${color}"` : ''}/>`;

/** Hücre. İçerik paragraf(lar)dır; iç içe tablo varsa sonuna paragraf eklenir (Word şartı). */
function cell(content, width, o = {}) {
  const props = [
    `<w:tcW w:w="${width}" w:type="dxa"/>`,
    o.borders && `<w:tcBorders>${o.borders}</w:tcBorders>`,
    o.fill && `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`,
    o.margin && `<w:tcMar><w:top w:w="${o.margin}" w:type="dxa"/><w:bottom w:w="${o.margin}" w:type="dxa"/></w:tcMar>`,
    `<w:vAlign w:val="${o.vAlign || 'top'}"/>`,
  ].filter(Boolean).join('');
  return `<w:tc><w:tcPr>${props}</w:tcPr>${[].concat(content).join('') || '<w:p/>'}</w:tc>`;
}

/** Tablo satırı. Başlık satırı her sayfada tekrarlanır; satır sayfa sonunda bölünmez. */
const row = (cells, o = {}) => `<w:tr><w:trPr><w:cantSplit/>${o.header ? '<w:tblHeader/>' : ''}</w:trPr>${cells.join('')}</w:tr>`;

/** Tablo. tblPr sırası: tblW, tblBorders, tblLayout, tblCellMar. */
function table(rows, widths, o = {}) {
  const b = o.borders || {};
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map(name => side(name, b[name]?.[0], b[name]?.[1])).join('');
  const pad = o.padding ?? 80;
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, c) => a + c, 0)}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/>`
    + `<w:tblCellMar><w:top w:w="${pad}" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="${pad}" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

/* ---- Dile duyarlı metin ve tarih ---------------------------------------- */

/**
 * Sözlük erişimi ve tarih biçimleri, seçili dille. Arayüzdeki `t()` ile aynı
 * sözleşme: anahtar bulunamazsa anahtarın kendisi görünür, `%{ad}` yer
 * tutucuları doldurulur (bkz. public/ortak.js).
 */
export function metinler(sozluk = {}, dil = 'tr') {
  const t = (anahtar, degerler) => {
    let metin = sozluk[anahtar];
    if (metin == null) return anahtar;
    if (degerler) for (const [ad, deger] of Object.entries(degerler)) metin = metin.replaceAll(`%{${ad}}`, deger);
    return metin;
  };
  const bicim = secenek => new Intl.DateTimeFormat(dil, { timeZone: 'UTC', ...secenek });
  const gun = anahtar => new Date(anahtar + 'T00:00:00Z');
  return {
    t,
    dil,
    tamTarih: g => bicim({ day: 'numeric', month: 'long', year: 'numeric' }).format(gun(g)),
    gunAy: g => bicim({ day: 'numeric', month: 'long' }).format(gun(g)),
    ayYil: g => bicim({ month: 'long', year: 'numeric' }).format(gun(g)),
    /* Aralığı Intl kurar: ortak olan ay ve yıl tekrarlanmaz ve SIRA DİLE
       GÖRE değişir — Türkçe "15–16 Aralık 2026" derken İngilizce
       "December 15 – 16, 2026" der. Aralık elle birleştirildiğinde
       İngilizce çıktı "15–December 16, 2026" oluyordu. */
    aralik: (a, b) => {
      const bicimleyici = bicim({ day: 'numeric', month: 'long', year: 'numeric' });
      return a === b ? bicimleyici.format(gun(a)) : bicimleyici.formatRange(gun(a), gun(b));
    },
    sayi: n => Number(n).toLocaleString(dil),
    /* Etkinliğin adı: resmî aktivitelerde sözlükten, yerel kayıtlarda
       veritabanından — arayüzdeki kuralın aynısı. */
    baslik: e => (e.slug && sozluk[`etkinlik.${e.slug}.baslik`]) || e.baslik || e.kod || e.wp,
    ozet: e => (e.slug && sozluk[`etkinlik.${e.slug}.ozet`]) || e.ozet || '',
    yer: kod => t(`ulke.${kod}`),
    ortak: id => partnerOf(id)?.name || id,
    ortakKisa: id => partnerOf(id)?.short || id,
  };
}

/** "15–16 Aralık 2026" gibi: ortak olan ay ve yıl tekrarlanmaz (bkz. `aralik`). */
export const tarihAraligi = (m, baslangic, bitis) => m.aralik(baslangic, bitis);

/**
 * Rapor döneminin başlığı ve dosya adı parçası. Tam proje süresi kendi
 * adıyla, tam bir ay "Ekim 2026", ay başından ay sonuna dönem
 * "Ekim 2026 – Ocak 2027", diğerleri gün gün yazılır.
 */
export function donemBilgisi(m, from, to) {
  const next = new Date(Date.parse(to + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  if (from === PROJECT.start && to === PROJECT.end) {
    return { baslik: m.t('rapor.donem.proje'), slug: 'tum-proje' };
  }
  if (from.endsWith('-01') && next.endsWith('-01')) {
    const aylar = (Number(next.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(next.slice(5, 7)) - Number(from.slice(5, 7));
    if (aylar === 1) return { baslik: m.ayYil(from), slug: from.slice(0, 7) };
    return { baslik: `${m.ayYil(from)} – ${m.ayYil(to)}`, slug: `${from.slice(0, 7)}_${to.slice(0, 7)}` };
  }
  return { baslik: `${m.tamTarih(from)} – ${m.tamTarih(to)}`, slug: `${from}_${to}` };
}

/* ---- Belge bölümleri ---------------------------------------------------- */

function baslikBandi(m, { baslik, kapsam }) {
  const sag = 5200, sol = WIDTH - sag;
  return table([row([
    cell([
      para(run(m.t('rapor.belge.ustbaslik').toLocaleUpperCase(m.dil), { bold: true, color: GREEN, size: 16, spacing: 20 }), { after: 40 }),
      para(run(baslik, { bold: true, color: INK, size: 44 }), { after: 40 }),
      para(run(kapsam, { color: MUTED, size: 17 })),
    ], sol, { vAlign: 'center' }),
    cell([
      para(run(m.t('site.ad'), { bold: true, color: BLUE, size: 24 }), { align: 'right', after: 30 }),
      para(run(m.t('altbilgi.kunye'), { color: MUTED, size: 15 }), { align: 'right', after: 20 }),
      para(run(m.t('altbilgi.sure'), { color: MUTED, size: 15 }), { align: 'right' }),
    ], sag, { vAlign: 'center' }),
  ])], [sol, sag], { padding: 0 })
    + para([], { border: { size: 18, color: GREEN, space: 1 }, after: 280 });
}

/** Üstteki sayaç kartları: etkinlik sayısı, durum dağılımı, kurum ve ülke. */
function sayaclar(m, events) {
  const say = durum => events.filter(e => e.durum === durum).length;
  const kurumlar = new Set(events.flatMap(e => [e.lider, ...e.katilimcilar]));
  const ulkeler = new Set(events.map(e => e.yer).filter(yer => yer !== VIRTUAL));
  const kartlar = [
    [events.length, m.t('rapor.sayac.etkinlik')],
    [say('tamamlandi'), m.t('durum.tamamlandi')],
    [say('devam'), m.t('durum.devam')],
    [say('planlandi'), m.t('durum.planlandi')],
    [events.filter(e => e.resmi).length, m.t('rapor.sayac.resmi')],
    [kurumlar.size, m.t('rapor.sayac.ortak')],
    [ulkeler.size, m.t('rapor.sayac.ulke')],
  ];
  /* Kartların arası kenarlıkla değil boş sütunla açılır: tablo düzeyindeki
     bir insideV kenarlığı, çakışmada daha kalın olan kazandığı için
     kartların yeşil sol şeridini eziyordu. */
  const bosluk = 200, kart = Math.floor((WIDTH - bosluk * (kartlar.length - 1)) / kartlar.length);
  const widths = [], cells = [];
  kartlar.forEach(([deger, etiket], i) => {
    const son = i === kartlar.length - 1;
    const genislik = son ? WIDTH - (kart + bosluk) * (kartlar.length - 1) : kart;
    widths.push(genislik);
    cells.push(cell([
      para(run(m.sayi(deger), { bold: true, color: GREEN, size: 40 })),
      para(run(etiket, { color: MUTED, size: 16 })),
    ], genislik, { fill: TINT, margin: 120, borders: side('left', 36, GREEN) }));
    if (!son) { widths.push(bosluk); cells.push(cell(para(), bosluk)); }
  });
  return table([row(cells)], widths, { padding: 0 });
}

const PROGRAM_WIDTHS = [2000, 4000, 1500, 1500, 1300, 1300, 2238, 1300];

function program(m, events) {
  const basliklar = [
    m.t('etkinlik.tarih'), m.t('form.ad'), m.t('etkinlik.ispaketi'), m.t('etkinlik.tur'),
    m.t('etkinlik.yer'), m.t('etkinlik.lider'), m.t('etkinlik.katilimci'), m.t('etkinlik.durum'),
  ];
  const head = row(basliklar.map((etiket, i) =>
    cell(para(run(etiket.toLocaleUpperCase(m.dil), { bold: true, color: 'FFFFFF', size: 15, spacing: 10 })), PROGRAM_WIDTHS[i], { fill: GREEN, vAlign: 'center' })), { header: true });

  const body = events.map((e, index) => {
    const fill = index % 2 ? SUBTLE : undefined;
    const sure = daysBetween(e.baslangic, e.bitis) + 1;
    const stil = STATUS_STYLE[e.durum] || STATUS_STYLE.planlandi;
    const altSatir = [e.kod, e.resmi ? m.t('rapor.resmi.kisa') : ''].filter(Boolean).join('  ·  ');
    return row([
      cell(para([
        run(tarihAraligi(m, e.baslangic, e.bitis), { bold: true, color: INK }),
        lineBreak,
        run(sure > 1 ? `${m.sayi(sure)} ${m.t('genel.gun')}` : m.t('rapor.tekgun'), { color: MUTED, size: 15 }),
      ]), PROGRAM_WIDTHS[0], { fill }),
      cell(para([
        run(m.baslik(e), { bold: true, color: INK }),
        ...(altSatir ? [lineBreak, run(altSatir, { color: MUTED, size: 15 })] : []),
      ]), PROGRAM_WIDTHS[1], { fill }),
      cell(para(run(e.wp, { bold: true, color: WP_COLOR[e.wp] || INK })), PROGRAM_WIDTHS[2], { fill }),
      cell(para(run(m.t(`tur.${e.tur}`))), PROGRAM_WIDTHS[3], { fill }),
      cell(para(run(m.yer(e.yer))), PROGRAM_WIDTHS[4], { fill }),
      cell(para(run(m.ortakKisa(e.lider), { bold: true })), PROGRAM_WIDTHS[5], { fill }),
      cell(para(run(e.katilimcilar.map(m.ortakKisa).join(', ') || '—', { color: MUTED, size: 16 })), PROGRAM_WIDTHS[6], { fill }),
      cell(para(run(m.t(`durum.${e.durum}`), { color: stil.color, bold: stil.bold, size: 16 })), PROGRAM_WIDTHS[7], { fill }),
    ]);
  });
  return table([head, ...body], PROGRAM_WIDTHS, { borders: { bottom: [8, BORDER], insideH: [4, BORDER] } });
}

/** "Adet" sütunlu küçük sayım tablosu. */
function sayimTablosu(m, baslik, sayimlar, genislik) {
  const adet = 900, etiket = genislik - adet;
  const satirlar = [...sayimlar].filter(([, n]) => n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], m.dil));
  return table([
    row([
      cell(para(run(baslik.toLocaleUpperCase(m.dil), { bold: true, color: INK, size: 15, spacing: 10 })), etiket, { fill: SUBTLE }),
      cell(para(run(m.t('rapor.adet').toLocaleUpperCase(m.dil), { bold: true, color: INK, size: 15, spacing: 10 }), { align: 'right' }), adet, { fill: SUBTLE }),
    ], { header: true }),
    ...satirlar.map(([ad, n]) => row([
      cell(para(run(ad)), etiket),
      cell(para(run(m.sayi(n), { bold: true, color: GREEN }), { align: 'right' }), adet),
    ])),
  ], [etiket, adet], { borders: { bottom: [8, BORDER], insideH: [4, BORDER] }, padding: 60 });
}

function dagilim(m, events) {
  const say = anahtarlar => events.reduce((harita, e) => {
    for (const anahtar of anahtarlar(e)) harita.set(anahtar, (harita.get(anahtar) || 0) + 1);
    return harita;
  }, new Map());
  const wp = say(e => [`${e.wp} · ${m.t(`wp.${e.wp}.kisa`)}`]);
  const tur = say(e => [m.t(`tur.${e.tur}`)]);
  /* Kurum sayımı liderliği ve katılımı birlikte sayar: sunucu lideri
     katılımcı listesinden çıkardığı için çifte sayım olmaz. */
  const ortak = say(e => [e.lider, ...e.katilimcilar].map(m.ortakKisa));
  const yer = say(e => [m.yer(e.yer)]);

  const bosluk = 600, sutun = Math.floor((WIDTH - bosluk) / 2), ic = sutun - 220;
  return table([row([
    cell([
      sayimTablosu(m, m.t('etkinlik.ispaketi'), wp, ic), para([], { after: 160 }),
      sayimTablosu(m, m.t('etkinlik.tur'), tur, ic), para(),
    ], sutun, { borders: '' }),
    cell(para(), bosluk),
    cell([
      sayimTablosu(m, m.t('rapor.dagilim.ortak'), ortak, ic), para([], { after: 160 }),
      sayimTablosu(m, m.t('etkinlik.yer'), yer, ic), para(),
    ], sutun),
  ])], [sutun, bosluk, sutun], { padding: 0 });
}

function ayrintilar(m, events) {
  const anlatilan = events.filter(e => m.ozet(e) || e.url || e.fotoSayisi);
  if (!anlatilan.length) return '';
  const etiketli = (etiket, metin, after = 60) => para([run(etiket + ': ', { bold: true, color: INK }), run(metin)], { after });
  return SPACER + para(run(m.t('rapor.bolum.ayrinti')), { style: 'Heading1' })
    + anlatilan.map(e => {
      const sure = daysBetween(e.baslangic, e.bitis) + 1;
      const kunye = [
        tarihAraligi(m, e.baslangic, e.bitis) + (sure > 1 ? ` (${m.sayi(sure)} ${m.t('genel.gun')})` : ''),
        `${e.wp} · ${m.t(`wp.${e.wp}.kisa`)}`,
        m.t(`tur.${e.tur}`),
        m.yer(e.yer),
        m.t(`durum.${e.durum}`),
        e.resmi ? m.t('rapor.resmi.kisa') : '',
      ].filter(Boolean).join('  ·  ');
      const katilimcilar = e.katilimcilar.map(m.ortak).join(', ');
      return para(run(m.baslik(e), { bold: true, color: INK, size: 20 }), { keepNext: true, before: 200, after: 20 })
        + para(run(kunye, { color: MUTED, size: 16 }), { keepNext: true, after: 80 })
        + etiketli(m.t('etkinlik.lider'), m.ortak(e.lider))
        + (katilimcilar ? etiketli(m.t('etkinlik.katilimci'), katilimcilar) : '')
        + (m.ozet(e) ? etiketli(m.t('etkinlik.ozet'), m.ozet(e)) : '')
        + (e.url ? etiketli(m.t('etkinlik.baglanti'), e.url) : '')
        + (e.fotoSayisi ? etiketli(m.t('foto.baslik'), m.t('rapor.foto.adet', { n: m.sayi(e.fotoSayisi) })) : '')
        + para([], { border: { size: 4, color: BORDER, space: 6 }, after: 40 });
    }).join('');
}

/* ---- Paket parçaları ---------------------------------------------------- */

const STYLES = `${XML}<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:eastAsia="Segoe UI" w:cs="Segoe UI"/><w:color w:val="${INK}"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="400" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="${GREEN}"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

const SETTINGS = `${XML}<w:settings ${NS}><w:defaultTabStop w:val="708"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

const CONTENT_TYPES = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
  + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
  + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';

const ROOT_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
  + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';

const DOCUMENT_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'
  + '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>';

/** Altbilgi: solda Erasmus+ finansman ibaresi ve künye, sağda sayfa numarası. */
function altbilgi(m, kunye) {
  const kucuk = { color: MUTED, size: 15 };
  const alan = kod => `<w:fldSimple w:instr=" ${kod} ">${run('1', kucuk)}</w:fldSimple>`;
  return `${XML}<w:ftr ${NS}><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="${BORDER}"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${WIDTH}"/></w:tabs></w:pPr>`
    + run(kunye, kucuk) + '<w:r><w:tab/></w:r>' + run(m.t('rapor.sayfa') + ' ', kucuk) + alan('PAGE') + run(' / ', kucuk) + alan('NUMPAGES') + '</w:p></w:ftr>';
}

/**
 * @param {object} p
 * @param {string} p.from          dönemin ilk günü "2026-10-01"
 * @param {string} p.to            dönemin son günü (dahil) "2027-01-31"
 * @param {object[]} p.events      döneme değen etkinlikler (başlangıca göre sıralı)
 * @param {object} p.filtreler     {wp, tur, ortak, durum, arama}
 * @param {string} p.olusturan     raporu indiren kişi
 * @param {object} p.sozluk        seçili dilin sözlüğü (bkz. lib/i18n.mjs)
 * @param {string} p.dil           dil kodu
 * @returns {Buffer} .docx
 */
export function raporYaz({ from, to, events, filtreler = {}, olusturan, sozluk, dil = 'tr', now = new Date() }) {
  const m = metinler(sozluk, dil);
  const { baslik } = donemBilgisi(m, from, to);

  const kapsam = [
    filtreler.wp ? `${filtreler.wp} · ${m.t(`wp.${filtreler.wp}.kisa`)}` : m.t('rapor.kapsam.wp'),
    filtreler.tur ? m.t(`tur.${filtreler.tur}`) : m.t('rapor.kapsam.tur'),
    filtreler.ortak ? m.ortak(filtreler.ortak) : m.t('rapor.kapsam.ortak'),
    filtreler.durum ? m.t(`durum.${filtreler.durum}`) : m.t('rapor.kapsam.durum'),
    filtreler.arama && m.t('rapor.kapsam.arama', { q: filtreler.arama }),
  ].filter(Boolean).join('  ·  ');

  const uretildi = new Intl.DateTimeFormat(dil, { timeZone: 'Europe/Istanbul', dateStyle: 'long', timeStyle: 'short' }).format(now);
  const say = durum => events.filter(e => e.durum === durum).length;

  const notlar = [];
  if (events.length) {
    notlar.push(m.t('rapor.not.durum', {
      tamam: m.sayi(say('tamamlandi')), devam: m.sayi(say('devam')),
      planli: m.sayi(say('planlandi')), ertelendi: m.sayi(say('ertelendi')),
    }));
  }
  /* Dönem sınırını aşan çok günlük kayıtlar rapora tam tarihiyle girer;
     okuyan, 12 Ocak'ta biten bir çıktı döneminin neden Aralık raporunda
     göründüğünü bu notla anlar. */
  const tasan = events.filter(e => e.baslangic < from || e.bitis > to).length;
  if (tasan) notlar.push(m.t('rapor.not.tasan', { n: m.sayi(tasan) }));

  let govde = baslikBandi(m, { baslik, kapsam }) + sayaclar(m, events);
  if (notlar.length) govde += para(run(notlar.join('  ·  '), { color: MUTED, size: 16 }), { before: 120 });

  govde += SPACER + para(run(m.t('rapor.bolum.program')), { style: 'Heading1' });
  govde += events.length
    ? program(m, events) + SPACER + para(run(m.t('rapor.bolum.dagilim')), { style: 'Heading1' }) + dagilim(m, events) + ayrintilar(m, events)
    : para(run(m.t('rapor.bos'), { color: MUTED }));

  /* Erasmus+ sorumluluk reddi belgenin sonunda: rapor dışarıya
     gönderildiğinde ibare de onunla birlikte gider. */
  govde += SPACER + para([], { border: { size: 4, color: BORDER, space: 6 }, before: 200, after: 120 })
    + para(run(m.t('altbilgi.feragat'), { color: MUTED, size: 14, italic: true }));

  const documentXml = `${XML}<w:document ${NS}><w:body>${govde}<w:p/>`
    + `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}" w:orient="landscape"/>`
    + `<w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin + 250}" w:left="${PAGE.margin}" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${esc(`${PROJECT.acronym} — ${m.t('rapor.baslik')} (${baslik})`)}</dc:title><dc:creator>${esc(olusturan)}</dc:creator><dc:language>${esc(dil)}</dc:language>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
  const app = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${esc(PROJECT.acronym)}</Application></Properties>`;

  const kunye = [m.t('ab.finanse'), `${PROJECT.acronym} · ${PROJECT.formId}`, m.t('rapor.olusturan', { ad: olusturan, tarih: uretildi })].join('  ·  ');

  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/settings.xml', data: SETTINGS },
    { name: 'word/footer1.xml', data: altbilgi(m, kunye) },
    { name: 'word/_rels/document.xml.rels', data: DOCUMENT_RELS },
  ], now);
}
