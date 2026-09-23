/**
 * Ortam ayarları tek yerde toplanır; sunucu ve route dosyaları buradan okur.
 * Değerler süreç başlarken bir kez çözülür — aynı ayarın iki dosyada farklı
 * yorumlanması (ör. BASE_PATH'in sonundaki eğik çizgi) böylece engellenir.
 */
export const port = Number(process.env.PORT || 3020);
export const origin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
export const secure = process.env.COOKIE_SECURE === 'true';

/* Alt dizin kurulumu (ör. aiotechs.cloud/eyouthpreneur). Uygulama öneki
   bilmez: vekil öneki soyarak köke iletir, arayüz göreli adres kullanır.
   Önek yalnızca çerez yolu için gerekir — aynı alan adındaki başka
   uygulamalara bu projenin oturum çerezi gitmesin. */
export const basePath = (process.env.BASE_PATH || '').replace(/\/+$/, '');

/* Ters vekil arkasında her istek 127.0.0.1'den gelir; istemci adresi ancak
   vekilin yazdığı başlıktan okunabilir. Başlık dışarıdan taklit
   edilebildiğinden yalnızca açıkça güvenilen kurulumda dikkate alınır. */
export const trustProxy = process.env.TRUST_PROXY === 'true';

export const SESSION_HOURS = 8;
