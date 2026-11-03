/* SRS 3.3 — sistem validasyon mesajları (VAL-xxx). */
export const MSG = {
  VAL001: "Geçerli bir e-posta adresi giriniz.",
  VAL002: "Bu e-posta adresiyle kayıtlı bir hesap bulunmaktadır.",
  VAL003: "Seçilen miktar kullanılabilir stok aralığında olmalıdır.",
  VAL004: "Bu ürün şu anda satın alınamıyor.",
  VAL005: "Teslimat adresinizi tamamlayınız.",
  VAL006: "Devam etmek için gerekli metinleri onaylayınız.",
  VAL007: "Ödemeniz tamamlanamadı; siparişiniz ödenmiş sayılmadı.",
  VAL008: "Ödeme doğrulanıyor.",
  VAL009: "Fiyat sıfırdan büyük ve stok negatif olmayan tam sayı olmalıdır.",
  VAL010: "Bu işlem için yetkiniz yok.",
  VAL011: "Başlangıç tarihi bitiş tarihinden sonra olamaz.",
  VAL012: "Rapor için tarih aralığı seçiniz.",
  VAL013: "Kayıt engellendi; alanları kontrol ediniz.",
  VAL014: "Bu sipariş için seçilen durum geçişine izin verilmiyor.",
  VAL015: "Analitik izni olmadığı için olay kaydedilmedi.",
  VAL016: "Lütfen JPEG veya PNG biçiminde bir fotoğraf yükleyiniz.",
  VAL017: "Fotoğraf yüklenemedi; dosya boyutu sınırı aşıldı veya dosya okunamadı.",
  VAL018: "Bu ürün için 3D önizleme şu anda kullanılamıyor.",
  VAL019: "3D önizlemeyi kullanmak için hesap oluşturup giriş yapınız.",
  VAL020: "Kayıtlı yerleşim bulunamadı.",
};

/* SRS 5 — parametre varsayılanları (onay bekleyenler “önerilen başlangıç kuralı”). */
export const DEFAULT_SETTINGS = {
  commerce: {
    shippingFee: 300, // num_shipping_fee (DEC-02)
    freeShipThreshold: 15000, // num_free_ship_threshold, 0 → kural kapalı
    couponEnabled: false, // chk_coupon_enabled
    pageSize: 8, // num_page_size
    inventoryGate: true, // chk_inventory_gate — kapatılamaz
    lowStockThreshold: 3, // Bildirim eşiği (SRS 7, onay bekliyor)
  },
  analytics: {
    abandonmentHours: 24, // num_abandonment_hours
    eventRetentionDays: 180, // num_event_retention_days (DEC-04)
    optionalAnalytics: true, // chk_optional_analytics
    reportTimezone: "Europe/Istanbul", // cmb_report_timezone
  },
  preview: {
    enabled: true, // chk_preview_enabled
    maxPhotoMb: 8, // num_max_photo_mb (DEC-08)
    loadTargetSec: 5, // num_preview_load_sec (NFR-11)
    saveLayoutEnabled: true, // chk_save_layout_enabled
  },
};
export const TIMEZONES = ["Europe/Istanbul", "UTC"];

const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const money = (v) => Number.isFinite(v) && v >= 0 && v <= 1e7;
const bool = (v) => typeof v === "boolean";
const RULES = {
  commerce: {
    shippingFee: money,
    freeShipThreshold: money,
    couponEnabled: bool,
    pageSize: (v) => int(v, 1, 100),
    inventoryGate: (v) => v === true,
    lowStockThreshold: (v) => int(v, 0, 1000),
  },
  analytics: {
    abandonmentHours: (v) => int(v, 1, 720),
    eventRetentionDays: (v) => int(v, 1, 3650),
    optionalAnalytics: bool,
    reportTimezone: (v) => TIMEZONES.includes(v),
  },
  preview: {
    enabled: bool,
    maxPhotoMb: (v) => int(v, 1, 15),
    loadTargetSec: (v) => int(v, 1, 60),
    saveLayoutEnabled: bool,
  },
};
/* Gelen kısmi ayarı doğrular; hatalı alan adlarını döndürür. */
export function validateSettings(body) {
  const errors = [];
  const out = {};
  for (const group of Object.keys(RULES)) {
    if (body[group] === undefined) continue;
    if (typeof body[group] !== "object" || body[group] === null) {
      errors.push(group);
      continue;
    }
    out[group] = {};
    for (const [k, v] of Object.entries(body[group])) {
      if (!RULES[group][k] || !RULES[group][k](v)) errors.push(group + "." + k);
      else out[group][k] = v;
    }
  }
  return { errors, values: out };
}

/* BR-003 — parasal hesaplama, kuruş cinsinden tam sayılarla yapılır. */
export const toKurus = (v) => Math.round(v * 100);
export const fromKurus = (k) => Math.round(k) / 100;
export function priceSummary(lines, commerce, coupon) {
  const subtotalK = lines.reduce(
    (s, l) => s + toKurus(l.price) * l.quantity,
    0,
  );
  let discountK = 0;
  if (coupon && commerce.couponEnabled && coupon.isActive)
    discountK =
      coupon.type === "percent"
        ? Math.round((subtotalK * coupon.value) / 100)
        : toKurus(coupon.value);
  discountK = Math.min(discountK, subtotalK);
  const afterDiscount = Math.max(0, subtotalK - discountK);
  const freeShip =
    commerce.freeShipThreshold > 0 &&
    subtotalK >= toKurus(commerce.freeShipThreshold);
  const shippingK = !lines.length || freeShip ? 0 : toKurus(commerce.shippingFee);
  return {
    subtotal: fromKurus(subtotalK),
    discount: fromKurus(discountK),
    shipping: fromKurus(shippingK),
    total: fromKurus(afterDiscount + shippingK),
    couponCode: discountK > 0 ? coupon.code : undefined,
  };
}

/* BR-009 — sipariş durum geçişleri; geriye veya atlayarak geçiş yok. */
export const ORDER_TRANSITIONS = {
  paid: ["preparing"],
  demo_paid: ["preparing"],
  preparing: ["shipped"],
  shipped: ["delivered"],
};
export const canTransition = (from, to) =>
  (ORDER_TRANSITIONS[from] || []).includes(to);

/* BR-018 — rapor tarihlerini seçili saat diliminde gün başlangıcına çevirir. */
function tzOffsetMs(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return asUtc - date.getTime();
}
export function zonedDayStart(ymd, timeZone) {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  if (guess.getUTCDate() !== d) return null;
  return new Date(guess.getTime() - tzOffsetMs(guess, timeZone));
}
