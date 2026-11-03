// Sunucunun farklı dosyalarında ortak kullanılan küçük yardımcılar.
// Rotalar (routes/*.js) bunları buradan alır.

import crypto from "node:crypto";
import {
  User,
  Product,
  Cart,
  Event,
  Setting,
  Coupon,
  AuditLog,
  Notification,
} from "./db.js";
import { MSG, DEFAULT_SETTINGS, priceSummary } from "./rules.js";

export const isId = (v) => typeof v === "string" && /^[a-f\d]{24}$/.test(v);
export const STAFF = ["manager", "admin"];
export const BUYERS = ["customer", "admin"];
export const fail = (res, status, error, extra = {}) =>
  res.status(status).json({ error, ...extra });

/* ─── Ayarlar (SRS 5) ─── */
export async function getSettings() {
  let doc = await Setting.findOne({ key: "global" }).lean();
  if (!doc) {
    try {
      doc = (
        await Setting.create({ key: "global", ...DEFAULT_SETTINGS })
      ).toObject();
    } catch {
      doc = await Setting.findOne({ key: "global" }).lean();
    }
  }
  const merged = { version: doc.version, updatedAt: doc.updatedAt };
  for (const g of Object.keys(DEFAULT_SETTINGS))
    merged[g] = { ...DEFAULT_SETTINGS[g], ...(doc[g] || {}) };
  return merged;
}

/* ─── Denetim kaydı (SRS 8.1) — parola, kart ve fotoğraf yazılmaz ─── */
export const audit = (req, eventType, targetId, before, after, result = "ok") =>
  AuditLog.create({
    actorId: req?.currentUser?._id || null,
    role: req?.currentUser?.role || "system",
    eventType,
    targetId: targetId ? String(targetId) : undefined,
    before,
    after,
    result,
    correlationId: req?.correlationId,
  }).catch((e) => console.error("audit:", e.message));
/* ─── Bildirimler (SRS 7) ─── */
export const notifyUser = (recipientId, type, message) =>
  Notification.create({ recipientId, audience: "user", type, message }).catch(
    () => {},
  );
export const notifyStaff = (type, message, audience = "staff") =>
  Notification.create({ audience, type, message }).catch(() => {});
export const orderNo = (o) => "#" + String(o._id).slice(-8).toUpperCase();

/* ─── Davranış olayları (FR-019, BR-012, BR-015) ─── */
let lastRetentionSweep = 0;
export const trackEvent = async (req, eventType, extra = {}) => {
  try {
    const s = await getSettings();
    if (!s.analytics.optionalAnalytics) return false;
    // VAL-015: izin yoksa olay kaydedilmez. extra.sessionId yalnızca ödeme
    // başlatılırken izin verilmiş oturumun satın alma olayı için kullanılır.
    const sessionId =
      extra.sessionId ||
      (req.session?.analyticsConsent && req.session.analyticsSid);
    if (!sessionId) return false;
    await Event.create({
      eventId: extra.eventId || crypto.randomUUID(),
      eventType,
      sessionId,
      productId: extra.productId || null,
      userId: extra.userId || req.session?.user?.id || null,
      orderId: extra.orderId || null,
      consentState: "granted",
      occurredAt: new Date(),
    });
    if (Date.now() - lastRetentionSweep > 3600000) {
      lastRetentionSweep = Date.now();
      await Event.deleteMany({
        occurredAt: {
          $lt: new Date(Date.now() - s.analytics.eventRetentionDays * 86400000),
        },
      });
    }
    return true;
  } catch (e) {
    if (e.code === 11000) return false; // aynı eventId: mükerrer olay yok sayılır
    console.error("event:", e.message);
    return false;
  }
};

/* ─── Kimlik ve yetki (FR-018, BR-010, VAL-010) ─── */
export const auth = async (req, res, next) => {
  if (!req.session.user)
    return fail(
      res,
      401,
      req.path.startsWith("/api/designs") ? MSG.VAL019 : "Önce giriş yapın",
    );
  const u = await User.findById(req.session.user.id);
  if (!u) return fail(res, 401, "Önce giriş yapın");
  req.currentUser = u;
  next();
};
export const roles =
  (...allowed) =>
  async (req, res, next) => {
    if (!allowed.includes(req.currentUser?.role)) {
      await audit(
        req,
        "unauthorized_access",
        req.originalUrl,
        undefined,
        {
          method: req.method,
        },
        "denied",
      );
      return fail(res, 403, MSG.VAL010);
    }
    next();
  };
export const userView = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
});

export const loadCart = async (userId) =>
  (await Cart.findOne({ userId })) || new Cart({ userId, items: [] });
export const findCoupon = async (code, commerce) =>
  commerce.couponEnabled && typeof code === "string" && code.trim()
    ? Coupon.findOne({ code: code.trim().toUpperCase(), isActive: true })
    : null;
export const cartView = async (cart, couponCode) => {
  const s = await getSettings();
  const ids = cart.items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: ids } });
  const items = cart.items
    .map((i) => {
      const p = products.find((x) => x._id.equals(i.productId));
      return p
        ? {
            productId: p.id,
            quantity: i.quantity,
            name: p.name,
            price: p.price,
            stock: p.stock,
            image: p.image,
            isActive: p.status === "published",
          }
        : null;
    })
    .filter(Boolean);
  const coupon = await findCoupon(couponCode, s.commerce);
  const valid = items.filter((i) => i.isActive);
  const summary = priceSummary(valid, s.commerce, coupon);
  return {
    items,
    summary: {
      ...summary,
      couponValid: couponCode ? Boolean(summary.couponCode) : undefined,
    },
  };
};
export const checkLine = (p, quantity) => {
  if (!p || p.status !== "published" || p.stock < 1) return MSG.VAL004;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > p.stock)
    return MSG.VAL003;
  return null;
};

export const cleanAddress = (b) => {
  const pick = (k, max) =>
    typeof b[k] === "string" ? b[k].trim().slice(0, max) : "";
  const a = {
    title: pick("title", 40) || "Adresim",
    fullName: pick("fullName", 80),
    city: pick("city", 40),
    district: pick("district", 40),
    line: pick("line", 300),
  };
  return a.fullName && a.city && a.district && a.line.length >= 10 ? a : null;
};
export const addressText = (a) =>
  `${a.fullName}, ${a.line}, ${a.district}/${a.city}`;
