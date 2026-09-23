import { zip } from './zip.mjs';
import { daysBetween, answerable, partnerOf } from './data.mjs';
import { questionsOf, answersOf } from './forms.mjs';
import { metinler } from './rapor.mjs';

/**
 * Faaliyet listesi — Excel (.xlsx) çıktısı.
 *
 * Word raporu gibi elle yazılmış OOXML (bkz. lib/zip.mjs): tek sayfa, her
 * satır bir etkinlik. Tarihler metin değil gerçek Excel tarihi olarak
 * yazılır ki sıralama ve süzme çalışsın; başlık satırı sabit ve otomatik
 * süzgeçlidir. Metinler satır içi ("inlineStr"): paylaşılan dize tablosu
 * gerekmez.
 *
 * Sütun başlıkları da sözlükten gelir — çalışma kitabı, raporu indiren
 * kişinin arayüz diliyle iner.
 */
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/* XML 1.0'da geçersiz denetim karakterleri Excel'in dosyayı açmamasına yol açar. */
const esc = value => String(value ?? '')
  .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Excel tarihi: 30 Aralık 1899'dan bu yana geçen gün sayısı. */
export const excelTarih = gun => Math.round((Date.parse(gun + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);

/* styles.xml içindeki cellXfs sırası */
const STYLE = { header: 1, date: 2, text: 3, number: 4 };

/** Sütun harfi: 0 → A, 25 → Z, 26 → AA. */
const sutunAdi = index => (index >= 26 ? sutunAdi(Math.floor(index / 26) - 1) : '') + String.fromCharCode(65 + (index % 26));

function hucre(ref, tur, deger) {
  if (deger === '' || deger === null || deger === undefined) return '';
  if (tur === 'text') return `<c r="${ref}" s="${STYLE.text}" t="inlineStr"><is><t xml:space="preserve">${esc(deger)}</t></is></c>`;
  return `<c r="${ref}" s="${STYLE[tur]}"><v>${deger}</v></c>`;
}

const STYLES = `${XML}<styleSheet xmlns="${MAIN}">`
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF12795C"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

const CONTENT_TYPES = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';

const ROOT_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>`
  + `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`;

/* Sayfa adı en fazla 31 karakter olabilir ve []:*?/\ içeremez; çeviri uzun
   gelirse kısaltılır. */
const sayfaAdi = ad => String(ad).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Program';

/**
 * Tek sayfalık çalışma kitabı: sütun tanımı + satırlar.
 *
 * Sütun = [başlık, genişlik, tür ('text' | 'number' | 'date'), al(satır)].
 * Faaliyet listesi ve form yanıtları aynı plumbing'i paylaşsın diye ayrıldı:
 * OOXML iskeletini iki kez yazmak, birinde düzeltilen bir hatanın öbüründe
 * kalması demekti.
 */
export function sayfaYaz({ ad, sutunlar, satirlar, now = new Date() }) {
  const sayfa = sayfaAdi(ad);
  const aralik = `$A$1:$${sutunAdi(sutunlar.length - 1)}$${satirlar.length + 1}`;
  const baslikSatiri = `<row r="1">${sutunlar.map(([etiket], i) => `<c r="${sutunAdi(i)}1" s="${STYLE.header}" t="inlineStr"><is><t>${esc(etiket)}</t></is></c>`).join('')}</row>`;
  const govde = satirlar.map((satir, index) => `<row r="${index + 2}">${sutunlar.map(([, , tur, al], i) => hucre(`${sutunAdi(i)}${index + 2}`, tur, al(satir))).join('')}</row>`).join('');

  const sheet = `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${REL}">`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols>${sutunlar.map(([, genislik], i) => `<col min="${i + 1}" max="${i + 1}" width="${genislik}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${baslikSatiri}${govde}</sheetData><autoFilter ref="${aralik.replace(/\$/g, '')}"/></worksheet>`;
  const workbook = `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${esc(sayfa)}" sheetId="1" r:id="rId1"/></sheets>`
    + `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${esc(sayfa)}'!${aralik}</definedName></definedNames></workbook>`;

  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: WORKBOOK_RELS },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    { name: 'xl/styles.xml', data: STYLES },
  ], now);
}

/**
 * Form yanıtları — Excel: her satır bir kişi, her sütun bir soru (formdaki
 * sırayla). Sayı ve tarih soruları gerçek Excel sayısı / tarihi olur.
 * Kaldırılmış soru raporda kalır, başlığında belirtilir.
 */
export function formExcel({ form, yanitlar, t, dil = 'tr', now = new Date() }) {
  const al = (satir, q) => answersOf({ yanitlar: satir.yanitlar })[q.id];
  const sutunlar = [
    [t('form.sutun.zaman'), 18, 'text', r => new Intl.DateTimeFormat(dil, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(r.updated))],
    [t('takvim.filtre.ortak'), 30, 'text', r => partnerOf(r.partner)?.name || r.partner],
    [t('form.sutun.kisi'), 24, 'text', r => r.ad],
    ...questionsOf(form).filter(answerable).map(q => {
      const baslik = q.archived ? t('form.soru.kaldirildi', { soru: q.title }) : q.title;
      if (q.type === 'sayi') return [baslik, 14, 'number', r => al(r, q)];
      if (q.type === 'dosya') return [baslik, 36, 'text', r => (al(r, q) || []).map(d => d.ad).join('; ')];
      if (q.type === 'tarih') return [baslik, 14, 'date', r => (al(r, q) ? excelTarih(al(r, q)) : '')];
      return [baslik, q.type === 'paragraf' ? 50 : 28, 'text', r => {
        const deger = al(r, q);
        return Array.isArray(deger) ? deger.join('; ') : deger;
      }];
    }),
  ];
  return sayfaYaz({ ad: t('form.yanitlar.baslik'), sutunlar, satirlar: yanitlar, now });
}

/**
 * @param {object} p
 * @param {object[]} p.events  dönemdeki etkinlikler (başlangıca göre sıralı)
 * @param {object} p.sozluk    seçili dilin sözlüğü
 * @param {string} p.dil       dil kodu
 * @returns {Buffer} .xlsx
 */
export function excelYaz({ events, sozluk, dil = 'tr', now = new Date() }) {
  const m = metinler(sozluk, dil);
  const evet = m.t('rapor.evet'), hayir = m.t('rapor.hayir');

  const sutunlar = [
    [m.t('form.baslangic'), 14, 'date', e => excelTarih(e.baslangic)],
    [m.t('form.bitis'), 14, 'date', e => excelTarih(e.bitis)],
    [m.t('etkinlik.sure'), 10, 'number', e => daysBetween(e.baslangic, e.bitis) + 1],
    [m.t('form.ad'), 46, 'text', e => m.baslik(e)],
    [m.t('rapor.sutun.kod'), 12, 'text', e => e.kod],
    [m.t('etkinlik.ispaketi'), 12, 'text', e => e.wp],
    [m.t('etkinlik.tur'), 26, 'text', e => m.t(`tur.${e.tur}`)],
    [m.t('etkinlik.yer'), 16, 'text', e => m.yer(e.yer)],
    [m.t('etkinlik.lider'), 30, 'text', e => m.ortak(e.lider)],
    [m.t('etkinlik.katilimci'), 34, 'text', e => e.katilimcilar.map(m.ortakKisa).join(', ')],
    [m.t('etkinlik.durum'), 16, 'text', e => m.t(`durum.${e.durum}`)],
    [m.t('rapor.sutun.resmi'), 14, 'text', e => (e.resmi ? evet : hayir)],
    [m.t('foto.baslik'), 10, 'number', e => e.fotoSayisi || 0],
    [m.t('etkinlik.baglanti'), 38, 'text', e => e.url],
    [m.t('etkinlik.ozet'), 60, 'text', e => m.ozet(e)],
  ];

  return sayfaYaz({ ad: m.t('takvim.baslik'), sutunlar, satirlar: events, now });
}
