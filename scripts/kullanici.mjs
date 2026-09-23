import { openDb } from '../lib/db.mjs';
import { hesabiSil } from '../lib/hesap.mjs';
import { partners, partnerIds, hashPassword, checkPassword, checkUsername, normalizeUsername, ValidationError } from '../lib/data.mjs';

/**
 * Komut satırından hesap yönetimi. Aynı işlemler Kullanıcılar sayfasında
 * da var (yalnızca koordinatör); bu betik sunucuya erişilemediğinde içindir.
 *
 *   node scripts/kullanici.mjs listele
 *   node scripts/kullanici.mjs ekle <kullanici> <kurum> <parola> [--koordinator] [--ad "Ad Soyad"]
 *   node scripts/kullanici.mjs parola <kullanici> <yeni-parola>
 *   node scripts/kullanici.mjs sil <kullanici>
 */
const [komut, ...argumanlar] = process.argv.slice(2);

const bayrak = ad => {
  const indeks = argumanlar.indexOf(`--${ad}`);
  if (indeks === -1) return null;
  /* `--koordinator` değer almaz; `--ad "X"` alır. */
  return argumanlar[indeks + 1]?.startsWith('--') === false ? argumanlar[indeks + 1] : true;
};
const konum = argumanlar.filter((deger, i) =>
  !deger.startsWith('--') && !(i > 0 && argumanlar[i - 1].startsWith('--') && deger !== argumanlar[0]));

const kullanim = () => {
  console.log(`Kullanım:
  listele
  ekle <kullanici> <kurum> <parola> [--koordinator] [--ad "Ad Soyad"]
  parola <kullanici> <yeni-parola>
  sil <kullanici>

Kurumlar: ${partnerIds.join(', ')}`);
};

const db = await openDb();

try {
  if (komut === 'listele') {
    const satirlar = await db.all('SELECT username,ad,partner,koordinator FROM users ORDER BY username');
    if (!satirlar.length) console.log('Hesap yok.');
    for (const s of satirlar) {
      const kurum = partners.find(p => p.id === s.partner);
      console.log(`${s.username.padEnd(20)} ${(kurum?.short || s.partner).padEnd(12)} ${s.koordinator ? 'koordinatör' : 'ortak'}  ${s.ad || ''}`);
    }

  } else if (komut === 'ekle') {
    const [ham, kurum, parola] = konum;
    if (!ham || !kurum || !parola) throw new ValidationError('Kullanıcı adı, kurum ve parola gerekli.');
    const kullanici = checkUsername(ham);
    if (!partnerIds.includes(kurum)) throw new ValidationError(`Kurum şunlardan biri olmalı: ${partnerIds.join(', ')}`);
    checkPassword(parola);
    if (await db.get('SELECT id FROM users WHERE username=?', [kullanici])) {
      throw new ValidationError('Bu kullanıcı adı zaten var.');
    }
    await db.run('INSERT INTO users (username,password,ad,partner,koordinator) VALUES (?,?,?,?,?)',
      [kullanici, hashPassword(parola), typeof bayrak('ad') === 'string' ? bayrak('ad') : '', kurum, bayrak('koordinator') ? 1 : 0]);
    console.log(`Hesap açıldı: ${kullanici} (${kurum})`);

  } else if (komut === 'parola') {
    const [ham, parola] = konum;
    const kullanici = normalizeUsername(ham);
    if (!kullanici || !parola) throw new ValidationError('Kullanıcı adı ve yeni parola gerekli.');
    checkPassword(parola);
    const hesap = await db.get('SELECT id FROM users WHERE username=?', [kullanici]);
    if (!hesap) throw new ValidationError('Hesap bulunamadı.');
    await db.run('UPDATE users SET password=? WHERE id=?', [hashPassword(parola), hesap.id]);
    /* Parola değişince o hesabın tüm oturumları kapanır. */
    await db.run('DELETE FROM sessions WHERE user_id=?', [hesap.id]);
    console.log(`Parola güncellendi: ${kullanici}`);

  } else if (komut === 'sil') {
    const kullanici = normalizeUsername(konum[0]);
    const hesap = await db.get('SELECT id FROM users WHERE username=?', [kullanici]);
    if (!hesap) throw new ValidationError('Hesap bulunamadı.');
    await hesabiSil(db, hesap.id);
    console.log(`Hesap silindi: ${kullanici}`);

  } else {
    kullanim();
  }
} catch (err) {
  console.error(err instanceof ValidationError ? `Hata: ${err.message}` : err);
  process.exitCode = 1;
} finally {
  await db.close();
}
