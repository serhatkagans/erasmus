/**
 * Faaliyet dosyası (Faz 2): her faaliyetin tamamlandığını gösteren belgeler.
 *
 * Parçalar faaliyetin türüne göre değişir. Yüz yüze buluşmalarda (TPM, LTTA,
 * konferans, çoğaltıcı etkinlik) altı parça; sanal toplantıda bilgi paketi ve
 * fotoğraf beklenmez. "Çıktı üretim dönemi" bir buluşma değildir, faaliyet
 * dosyası yoktur — onun belgesi çıktı kütüphanesindeki dosyadır.
 *
 * Dört parça yüklenen dosyadır (`event_files.tur`). Fotoğraflar mevcut
 * galeriden (`event_photos`), memnuniyet anketi Formlar'dan (`forms.event_id`)
 * TÜRETİLİR: aynı belge iki yere yüklenmez.
 *
 * Yoklama: gençlerin katıldığı faaliyetlerde (LTTA, pilot, çoğaltıcı) asıl
 * kaynak Faz 3'teki katılımcı kaydı olacak (DURUM.md kararı). O kayıt
 * gelene kadar imzalı liste dosya olarak yüklenir.
 */
export const DOSYA_TURLERI = ['infopack', 'gundem', 'yoklama', 'tutanak'];

const YUZ_YUZE = ['infopack', 'gundem', 'yoklama', 'tutanak', 'foto', 'anket'];
const PARCALAR = {
  tpm: YUZ_YUZE, ltta: YUZ_YUZE, konferans: YUZ_YUZE, cogaltici: YUZ_YUZE, toplanti: YUZ_YUZE,
  sanal: ['gundem', 'yoklama', 'tutanak', 'anket'],
  cikti: [],
};
export const parcalar = tur => PARCALAR[tur] || YUZ_YUZE;

/**
 * Bütün faaliyetlerin dosya özeti tek seferde: {etkinlikId: {tamam, toplam, eksik[]}}.
 * Takvim listesi, ana sayfa ve pano aynı hesabı kullanır.
 */
export async function dosyaOzetleri(db) {
  const olaylar = await db.all('SELECT id,tur FROM events');
  const dosyalar = await db.all('SELECT DISTINCT event_id, tur FROM event_files');
  const fotolar = new Set((await db.all('SELECT DISTINCT event_id FROM event_photos')).map(r => r.event_id));
  const anketler = new Set((await db.all("SELECT DISTINCT event_id FROM forms WHERE event_id IS NOT NULL AND silindi=''")).map(r => r.event_id));
  const var_ = new Set(dosyalar.map(r => `${r.event_id}:${r.tur}`));
  const ozet = {};
  for (const e of olaylar) {
    const liste = parcalar(e.tur);
    if (!liste.length) continue;
    const tamamMi = p => (p === 'foto' ? fotolar.has(e.id) : p === 'anket' ? anketler.has(e.id) : var_.has(`${e.id}:${p}`));
    const eksik = liste.filter(p => !tamamMi(p));
    ozet[e.id] = { tamam: liste.length - eksik.length, toplam: liste.length, eksik };
  }
  return ozet;
}

/**
 * Durumu güncellenmeyi bekleyen faaliyet: bitiş günü GEÇMİŞ ama hâlâ
 * "planlandı" ya da "devam ediyor". Ana sayfadaki "Tamamlanan faaliyetler"
 * çubuğu elle ilerliyor (kullanıcı kararı, 23 Eylül 2026: kendiliğinden
 * tamamlama yok, hatırlatma var); unutulan faaliyet çubuğu olduğundan geride
 * gösterirdi. Bitiş günü kapsanan son gündür, o gün henüz beklenmez.
 */
export const durumBekliyor = (e, bugun) =>
  String(e.bitis).slice(0, 10) < bugun && (e.durum === 'planlandi' || e.durum === 'devam');

/** Çıktı için aynısı: teslim tarihi geçmiş, "teslim edildi" yapılmamış. */
export const teslimBekliyor = (c, bugun) => !!c.teslim && c.teslim < bugun && c.durum !== 'teslim';
