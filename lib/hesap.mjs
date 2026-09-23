/**
 * Hesap silme — komut satırı (`scripts/kullanici.mjs sil`) ve Kullanıcılar
 * sayfası aynı işlevi kullanır.
 *
 * Hesabın eklediği etkinlik, form, görev ve dosyalar kalır, yalnızca "kim
 * ekledi" bilgisi düşer; kişinin kendi kayıtları (yanıt, taslak, oturum,
 * profil fotoğrafı) şemadaki CASCADE ile silinir. Hesaba bakan sütunlar
 * elle listelenmiyor, ŞEMADAN okunuyor: liste iki kez eksik kaldı (göçten
 * kalan form_durtme ve form_yanit) ve silme yabancı anahtar hatasıyla
 * yarıda kesildi. CASCADE ve SET NULL'u veritabanı kendisi yapar; burada
 * yalnızca kuralı olmayan (NO ACTION) sütunlar boşaltılır.
 */
export async function hesabiSil(db, id) {
  const bagli = db.kind === 'sqlite'
    ? (await Promise.all((await db.all("SELECT name FROM sqlite_master WHERE type='table'"))
        .map(async ({ name }) => (await db.all(`PRAGMA foreign_key_list(${name})`))
          .filter(fk => fk.table === 'users' && /NO ACTION|RESTRICT/i.test(fk.on_delete))
          .map(fk => [name, fk.from])))).flat()
    : (await db.all(`SELECT kcu.table_name AS tablo, kcu.column_name AS sutun
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.constraint_name
        WHERE ccu.table_name = 'users' AND rc.delete_rule IN ('NO ACTION', 'RESTRICT')`))
        .map(r => [r.tablo, r.sutun]);
  for (const [tablo, sutun] of bagli) {
    await db.run(`UPDATE ${tablo} SET ${sutun}=NULL WHERE ${sutun}=?`, [id]);
  }
  await db.run('DELETE FROM users WHERE id=?', [id]);
}
