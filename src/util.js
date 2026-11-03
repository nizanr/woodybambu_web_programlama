export const money = (n) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
export async function api(url, opts) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await r
    .json()
    .catch(() => ({ error: "Sunucu yanıtı alınamadı" }));
  if (!r.ok) throw Error(data.error || "İşlem başarısız");
  return data;
}
export const ROLE_LABELS = {
  customer: "Üye",
  manager: "Yönetici",
  admin: "Admin",
};
export const STATUS_LABELS = {
  pending: "Ödeme bekliyor",
  processing: "Ödeme doğrulanıyor",
  paid: "Ödendi",
  demo_paid: "Ödendi (demo)",
  preparing: "Hazırlanıyor",
  shipped: "Kargolandı",
  delivered: "Teslim edildi",
  cancelled: "İptal edildi",
  stock_conflict: "Stok sorunu — iade gerekli",
};
export const NEXT_STATUS = {
  paid: "preparing",
  demo_paid: "preparing",
  preparing: "shipped",
  shipped: "delivered",
};
export const MODEL_TYPES = {
  "builtin:chair": "Temsili sandalye",
  "builtin:sofa": "Temsili oturma grubu",
  "builtin:table": "Temsili masa",
  "builtin:lounger": "Temsili şezlong",
};
// SRS 3.3 — istemci tarafında da kullanılan mesajlar
export const VAL = {
  VAL004: "Bu ürün şu anda satın alınamıyor.",
  VAL016: "Lütfen JPEG veya PNG biçiminde bir fotoğraf yükleyiniz.",
  VAL017:
    "Fotoğraf yüklenemedi; dosya boyutu sınırı aşıldı veya dosya okunamadı.",
  VAL018: "Bu ürün için 3D önizleme şu anda kullanılamıyor.",
  VAL019:
    "Yerleşimi kaydetmek veya satın almak için hesap oluşturup giriş yapınız.",
};
export const istanbulDate = (d) =>
  new Date(d).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
