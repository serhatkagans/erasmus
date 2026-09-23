import { PROJECT, shiftDay } from './data.mjs';

/**
 * iCalendar (RFC 5545) akışı: program Google Takvim, Outlook ya da telefon
 * takvimine abone olunarak eklenebilir. Program değiştikçe abone olan takvim
 * kendiliğinden güncellenir.
 *
 * Etkinlikler gün bazlıdır, bu yüzden VALUE=DATE kullanılır. DTEND iCalendar'da
 * DIŞLAYICIDIR: veritabanındaki `bitis` kapsanan son gün olduğu için bir gün
 * ileri alınır — yoksa çok günlü etkinlikler takvimde bir gün eksik görünür.
 */

/* Satır katlama (RFC 5545 §3.1): 75 sekizliden uzun satırlar bir boşlukla
   başlayan devam satırlarına bölünür. Uzun açıklamalar olmadan Outlook
   kaydı bozuk okuyabiliyor. */
const fold = line => {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    /* UTF-8 devam baytının ortasından bölmemek için geri sarılır. */
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push((start === 0 ? '' : ' ') + bytes.slice(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n');
};

/* Metin alanlarında ters bölü, noktalı virgül, virgül ve satır sonu kaçırılır. */
const escape = value => String(value ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const day = value => String(value).slice(0, 10).replace(/-/g, '');

/**
 * @param events  `bitis` alanı kapsanan son gün olan etkinlik kayıtları.
 * @param label   Takvimin adı (dile göre çevrilmiş).
 * @param text    Bir etkinliği {baslik, ozet, yer} olarak çözen işlev —
 *                çeviri arayüzde yapıldığı için buraya dışarıdan verilir.
 */
export function buildIcs(events, label, text) {
  const now = stamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${PROJECT.acronym}//${PROJECT.formId}//TR`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(label)}`,
    'X-PUBLISHED-TTL:PT6H',
  ];

  for (const e of events) {
    const { baslik, ozet, yer } = text(e);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}.${PROJECT.formId}@e-youthpreneur`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${day(e.baslangic)}`,
      `DTEND;VALUE=DATE:${day(shiftDay(String(e.bitis).slice(0, 10), 1))}`,
      `SUMMARY:${escape(baslik)}`,
      `LOCATION:${escape(yer)}`,
      `DESCRIPTION:${escape(ozet)}`,
      `CATEGORIES:${escape(e.wp)}`,
      'TRANSP:TRANSPARENT',
    );
    if (e.url) lines.push(`URL:${escape(e.url)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
