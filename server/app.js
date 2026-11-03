import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import bcrypt from "bcryptjs";
import Iyzipay from "iyzipay";
import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  User,
  Product,
  Category,
  Cart,
  Order,
  Payment,
  Event,
  Design,
  DesignPhoto,
  Setting,
  Coupon,
  AuditLog,
  Notification,
  ROLES,
  PRODUCT_STATUSES,
} from "./db.js";
import {
  MSG,
  DEFAULT_SETTINGS,
  validateSettings,
  priceSummary,
  canTransition,
  zonedDayStart,
} from "./rules.js";

const isId = (v) => typeof v === "string" && /^[a-f\d]{24}$/.test(v);
const STAFF = ["manager", "admin"];
const BUYERS = ["customer", "admin"];
const fail = (res, status, error, extra = {}) =>
  res.status(status).json({ error, ...extra });

/* ─── Ayarlar (SRS 5) ─── */
export async function getSettings() {
  let doc = await Setting.findOne({ key: "global" }).lean();
  if (!doc) {
    try {
      doc = (await Setting.create({ key: "global", ...DEFAULT_SETTINGS })).toObject();
    } catch {
      doc = await Setting.findOne({ key: "global" }).lean();
    }
  }
  const merged = { version: doc.version, updatedAt: doc.updatedAt };
  for (const g of Object.keys(DEFAULT_SETTINGS))
    merged[g] = { ...DEFAULT_SETTINGS[g], ...(doc[g] || {}) };
  return merged;
}

export function createApp(uri, { paymentClient } = {}) {
  const app = express();
  const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.get("/api/health", (req, res) =>
    res
      .status(mongoose.connection.readyState === 1 ? 200 : 503)
      .json({ ok: mongoose.connection.readyState === 1 }),
  );
  const iyzico =
    paymentClient ||
    (process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY
      ? new Iyzipay({
          apiKey: process.env.IYZICO_API_KEY,
          secretKey: process.env.IYZICO_SECRET_KEY,
          uri: "https://sandbox-api.iyzipay.com",
        })
      : null);
  const gateway = (method, body) =>
    new Promise((resolve, reject) =>
      iyzico.checkoutForm[method](body, (e, r) =>
        e
          ? reject(e)
          : r.status === "success"
            ? resolve(r)
            : reject(Error(r.errorMessage || "Ödeme sağlayıcısı hatası")),
      ),
    );
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  )
    throw Error(
      "SESSION_SECRET must contain at least 32 characters in production",
    );
  app.locals.sessionStore = MongoStore.create({ mongoUrl: uri });
  app.use(express.json({ limit: "100kb" }));
  app.use(
    session({
      secret:
        process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
      resave: false,
      saveUninitialized: false,
      store: app.locals.sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 86400000,
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    req.correlationId = crypto.randomUUID();
    if (
      req.path !== "/payment/callback" &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      ![`${req.protocol}://${req.get("host")}`, appUrl].includes(
        req.headers.origin,
      )
    )
      return fail(res, 403, "Geçersiz kaynak");
    next();
  });

  /* ─── Denetim kaydı (SRS 8.1) — parola, kart ve fotoğraf yazılmaz ─── */
  const audit = (req, eventType, targetId, before, after, result = "ok") =>
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
  const notifyUser = (recipientId, type, message) =>
    Notification.create({ recipientId, audience: "user", type, message }).catch(
      () => {},
    );
  const notifyStaff = (type, message, audience = "staff") =>
    Notification.create({ audience, type, message }).catch(() => {});
  const orderNo = (o) => "#" + String(o._id).slice(-8).toUpperCase();

  /* ─── Davranış olayları (FR-019, BR-012, BR-015) ─── */
  let lastRetentionSweep = 0;
  const trackEvent = async (req, eventType, extra = {}) => {
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
            $lt: new Date(
              Date.now() - s.analytics.eventRetentionDays * 86400000,
            ),
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
  const auth = async (req, res, next) => {
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
  const roles =
    (...allowed) =>
    async (req, res, next) => {
      if (!allowed.includes(req.currentUser?.role)) {
        await audit(req, "unauthorized_access", req.originalUrl, undefined, {
          method: req.method,
        }, "denied");
        return fail(res, 403, MSG.VAL010);
      }
      next();
    };
  const view = (u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
  });
  const keepAcrossLogin = (req) => ({
    analyticsConsent: req.session.analyticsConsent,
    analyticsSid: req.session.analyticsSid,
  });

  const attempts = new Map();
  app.post("/api/auth/:action", async (req, res) => {
    const { name, email, password } = req.body;
    const key = req.ip;
    const a = attempts.get(key) || { count: 0, time: Date.now() };
    if (Date.now() - a.time > 600000) {
      a.count = 0;
      a.time = Date.now();
    }
    attempts.set(key, a);
    if (++a.count > 30)
      return fail(res, 429, "Çok fazla deneme. 10 dakika sonra tekrar deneyin.");
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim()))
      return fail(res, 400, MSG.VAL001);
    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    )
      return fail(res, 400, "Şifre 8–128 karakter olmalıdır.");
    const normalized = email.trim().toLowerCase();
    let u;
    if (req.params.action === "register") {
      if (typeof name !== "string" || !name.trim())
        return fail(res, 400, "Adınızı girin");
      if (await User.exists({ email: normalized }))
        return fail(res, 409, MSG.VAL002);
      try {
        u = await User.create({
          name: name.trim().slice(0, 80),
          email: normalized,
          password: await bcrypt.hash(password, 12),
        });
      } catch (e) {
        if (e.code === 11000) return fail(res, 409, MSG.VAL002);
        throw e;
      }
    } else if (req.params.action === "login") {
      u = await User.findOne({ email: normalized });
      if (!u || !(await bcrypt.compare(password, u.password)))
        return fail(res, 401, "E-posta veya şifre hatalı");
    } else return res.sendStatus(404);
    const kept = keepAcrossLogin(req);
    await new Promise((resolve, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : resolve())),
    );
    Object.assign(req.session, kept);
    req.session.user = view(u);
    res.json(view(u));
  });
  app.get("/api/me", async (req, res) => {
    const u = req.session.user && (await User.findById(req.session.user.id));
    res.json(u ? view(u) : null);
  });
  app.post("/api/logout", (req, res) => {
    const kept = keepAcrossLogin(req);
    req.session.regenerate(() => {
      if (kept.analyticsConsent !== undefined) Object.assign(req.session, kept);
      res.json({ ok: true });
    });
  });

  /* ─── Analitik izin tercihi (BR-015) ─── */
  app.get("/api/consent", (req, res) =>
    res.json({
      analytics:
        req.session.analyticsConsent === undefined
          ? null
          : req.session.analyticsConsent,
    }),
  );
  app.post("/api/consent", (req, res) => {
    if (typeof req.body.analytics !== "boolean")
      return fail(res, 400, "Tercih belirtilmeli");
    req.session.analyticsConsent = req.body.analytics;
    req.session.analyticsSid = req.body.analytics
      ? req.session.analyticsSid || crypto.randomUUID()
      : undefined;
    res.json({ analytics: req.body.analytics });
  });

  /* ─── Genel ayarlar ─── */
  app.get("/api/settings/public", async (req, res) => {
    const s = await getSettings();
    res.json({
      commerce: {
        couponEnabled: s.commerce.couponEnabled,
        pageSize: s.commerce.pageSize,
        shippingFee: s.commerce.shippingFee,
        freeShipThreshold: s.commerce.freeShipThreshold,
      },
      analytics: { optionalAnalytics: s.analytics.optionalAnalytics },
      preview: s.preview,
    });
  });

  /* ─── Katalog (FR-001/002/003, BR-001) ─── */
  app.get("/api/categories", async (req, res) =>
    res.json(await Category.find({ isActive: true }).sort({ name: 1 })),
  );
  app.get("/api/products", async (req, res) => {
    const filter = { status: "published" };
    if (typeof req.query.category === "string" && req.query.category)
      filter.category = req.query.category;
    if (typeof req.query.q === "string" && req.query.q.trim())
      filter.name = {
        $regex: req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    res.json(await Product.find(filter).sort({ createdAt: 1 }));
  });
  app.get("/api/products/:id", async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const p = await Product.findById(req.params.id);
    // Taslak ürün dışarıya açılmaz; pasif ürün görünür ama satın alınamaz.
    if (!p || p.status === "draft") return res.sendStatus(404);
    res.json(p);
  });

  /* ─── 3D önizleme (FR-027/028, VAL-018): ziyaretçi dahil herkese açık.
     Yerleşim kaydı ve sepet oturum ister (BR-024, VAL-019). ─── */
  app.get("/api/preview/:productId", async (req, res) => {
    const s = await getSettings();
    if (!s.preview.enabled) return fail(res, 404, MSG.VAL018);
    if (!isId(req.params.productId)) return fail(res, 404, MSG.VAL018);
    const p = await Product.findOne({
      _id: req.params.productId,
      status: "published",
    });
    if (!p || !p.model3dUrl) return fail(res, 404, MSG.VAL018);
    res.json({
      productId: p.id,
      name: p.name,
      color: p.color,
      model3dUrl: p.model3dUrl,
      price: p.price,
      stock: p.stock,
    });
  });

  /* ─── İstemci kaynaklı analitik olayı: yalnızca product_view ─── */
  app.post("/api/events", async (req, res) => {
    const { eventType, productId, eventId } = req.body;
    if (eventType !== "product_view" || !isId(productId))
      return fail(res, 400, "Geçersiz olay");
    if (eventId !== undefined && (typeof eventId !== "string" || eventId.length > 64))
      return fail(res, 400, "Geçersiz olay");
    if (!(await Product.exists({ _id: productId, status: { $ne: "draft" } })))
      return res.sendStatus(404);
    const recorded = await trackEvent(req, "product_view", { productId, eventId });
    res.status(recorded ? 201 : 202).json({
      recorded,
      ...(recorded ? {} : { reason: MSG.VAL015 }),
    });
  });

  /* ─── Sepet (FR-005/006/007, BR-004, VAL-003/004) ─── */
  const loadCart = async (userId) =>
    (await Cart.findOne({ userId })) ||
    new Cart({ userId, items: [] });
  const findCoupon = async (code, commerce) =>
    commerce.couponEnabled && typeof code === "string" && code.trim()
      ? Coupon.findOne({ code: code.trim().toUpperCase(), isActive: true })
      : null;
  const cartView = async (cart, couponCode) => {
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
  const checkLine = (p, quantity) => {
    if (!p || p.status !== "published" || p.stock < 1) return MSG.VAL004;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > p.stock)
      return MSG.VAL003;
    return null;
  };
  app.get("/api/cart", auth, roles(...BUYERS), async (req, res) =>
    res.json(await cartView(await loadCart(req.currentUser._id), req.query.coupon)),
  );
  app.post("/api/cart/items", auth, roles(...BUYERS), async (req, res) => {
    const { productId } = req.body;
    const add = req.body.quantity === undefined ? 1 : req.body.quantity;
    if (!isId(productId)) return fail(res, 400, MSG.VAL004);
    if (!Number.isInteger(add) || add < 1) return fail(res, 400, MSG.VAL003);
    const p = await Product.findById(productId);
    const cart = await loadCart(req.currentUser._id);
    const line = cart.items.find((i) => i.productId.equals(productId));
    const next = (line?.quantity || 0) + add;
    const err = checkLine(p, next);
    if (err) return fail(res, 409, err);
    if (line) line.quantity = next;
    else cart.items.push({ productId, quantity: next });
    await cart.save();
    await trackEvent(req, "add_to_cart", { productId });
    res.json(await cartView(cart));
  });
  app.patch(
    "/api/cart/items/:productId",
    auth,
    roles(...BUYERS),
    async (req, res) => {
      const cart = await loadCart(req.currentUser._id);
      const line = cart.items.find(
        (i) => String(i.productId) === req.params.productId,
      );
      if (!line) return res.sendStatus(404);
      const err = checkLine(
        await Product.findById(req.params.productId),
        req.body.quantity,
      );
      if (err) return fail(res, err === MSG.VAL003 ? 400 : 409, err);
      line.quantity = req.body.quantity;
      await cart.save();
      res.json(await cartView(cart));
    },
  );
  app.delete(
    "/api/cart/items/:productId",
    auth,
    roles(...BUYERS),
    async (req, res) => {
      const cart = await loadCart(req.currentUser._id);
      const before = cart.items.length;
      cart.items = cart.items.filter(
        (i) => String(i.productId) !== req.params.productId,
      );
      if (cart.items.length !== before) {
        await cart.save();
        await trackEvent(req, "remove_from_cart", {
          productId: req.params.productId,
        });
      }
      res.json(await cartView(cart));
    },
  );

  /* ─── Adresler (FR-008, BR-010) ─── */
  const cleanAddress = (b) => {
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
  const addressText = (a) =>
    `${a.fullName}, ${a.line}, ${a.district}/${a.city}`;
  app.get("/api/addresses", auth, (req, res) =>
    res.json(req.currentUser.addresses),
  );
  app.post("/api/addresses", auth, async (req, res) => {
    const a = cleanAddress(req.body);
    if (!a) return fail(res, 400, MSG.VAL005);
    if (req.currentUser.addresses.length >= 10)
      return fail(res, 400, "En fazla 10 adres kaydedebilirsiniz");
    req.currentUser.addresses.push(a);
    await req.currentUser.save();
    res.json(req.currentUser.addresses.at(-1));
  });
  app.patch("/api/addresses/:id", auth, async (req, res) => {
    const existing = req.currentUser.addresses.id(req.params.id);
    if (!existing) return res.sendStatus(404);
    const a = cleanAddress({ ...existing.toObject(), ...req.body });
    if (!a) return fail(res, 400, MSG.VAL005);
    existing.set(a);
    await req.currentUser.save();
    res.json(existing);
  });
  app.delete("/api/addresses/:id", auth, async (req, res) => {
    const existing = req.currentUser.addresses.id(req.params.id);
    if (!existing) return res.sendStatus(404);
    existing.deleteOne();
    await req.currentUser.save();
    res.json({ ok: true });
  });

  /* ─── Sipariş ve ödeme (FR-010…FR-013, FR-017, BR-002…BR-008) ─── */
  app.get("/api/payment-config", (req, res) =>
    res.json({
      provider: iyzico ? "iyzico" : "demo",
      label: iyzico
        ? "iyzico test ödemesi"
        : "Demo ödeme — gerçek para çekilmez",
    }),
  );
  app.post("/api/orders", auth, roles(...BUYERS), async (req, res) => {
    const { addressId, acceptTerms, couponCode } = req.body;
    let { items, address } = req.body;
    const fromCart = items === undefined;
    if (fromCart)
      items = (await loadCart(req.currentUser._id)).items.map((i) => ({
        id: String(i.productId),
        quantity: i.quantity,
      }));
    if (!Array.isArray(items) || !items.length || items.length > 30)
      return fail(res, 400, "Sepetiniz boş");
    if (addressId !== undefined) {
      const a = req.currentUser.addresses.id(addressId);
      if (!a) return fail(res, 400, MSG.VAL005);
      address = addressText(a);
    }
    if (typeof address !== "string" || address.trim().length < 10)
      return fail(res, 400, MSG.VAL005);
    if (acceptTerms !== true) return fail(res, 400, MSG.VAL006);
    const lines = [];
    const seen = new Set();
    for (const i of items) {
      if (!isId(i?.id) || seen.has(i.id) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99)
        return fail(res, 400, MSG.VAL003);
      seen.add(i.id);
      const p = await Product.findById(i.id);
      // FR-017: yetersiz stokta ödeme başlatma engellenir.
      if (!p || p.status !== "published" || p.stock < 1)
        return fail(res, 409, MSG.VAL004, { productId: i.id });
      if (p.stock < i.quantity)
        return fail(res, 409, MSG.VAL003, { productId: i.id });
      lines.push({ id: p.id, name: p.name, price: p.price, quantity: i.quantity });
    }
    if (iyzico && !appUrl)
      return fail(res, 503, "Ödeme için APP_URL ayarlanmalı");
    const s = await getSettings();
    const coupon = await findCoupon(couponCode, s.commerce);
    if (couponCode && !coupon && s.commerce.couponEnabled)
      return fail(res, 400, "İndirim kodu geçersiz");
    // BR-002: tutar sunucuda hesaplanır, istemcinin toplamı yok sayılır.
    const summary = priceSummary(lines, s.commerce, coupon);
    const o = await Order.create({
      user: req.currentUser._id,
      items: lines,
      ...summary,
      address: address.trim().slice(0, 500),
      paymentMode: iyzico ? "iyzico" : "demo",
      settingsVersion: s.version,
      analyticsSid:
        (req.session.analyticsConsent && req.session.analyticsSid) || undefined,
    });
    await Payment.create({
      orderId: o._id,
      provider: o.paymentMode,
      amount: o.total,
    });
    await trackEvent(req, "checkout_start", { orderId: o._id });
    if (iyzico) {
      const u = req.currentUser;
      let r;
      try {
        r = await gateway("initialize", {
          locale: "tr",
          conversationId: o.id,
          price: String(summary.subtotal),
          paidPrice: String(summary.total),
          currency: "TRY",
          basketId: o.id,
          paymentGroup: "PRODUCT",
          callbackUrl: appUrl + "/api/payment/callback",
          buyer: {
            id: u.id,
            name: u.name.split(" ")[0],
            surname: u.name.split(" ").slice(1).join(" ") || "Test",
            gsmNumber: "+905350000000",
            email: u.email,
            identityNumber: "74300864791",
            registrationAddress: o.address,
            ip: req.ip,
            city: "Istanbul",
            country: "Turkey",
          },
          shippingAddress: {
            contactName: u.name,
            city: "Istanbul",
            country: "Turkey",
            address: o.address,
          },
          billingAddress: {
            contactName: u.name,
            city: "Istanbul",
            country: "Turkey",
            address: o.address,
          },
          basketItems: lines.map((i) => ({
            id: i.id,
            name: i.name,
            category1: "Bahçe Mobilyası",
            itemType: "PHYSICAL",
            price: String(Math.round(i.price * i.quantity * 100) / 100),
          })),
        });
      } catch {
        await Order.updateOne({ _id: o.id }, { $set: { status: "cancelled" } });
        await Payment.updateOne({ orderId: o._id }, { $set: { status: "failed" } });
        // FR-026: sağlayıcı kesintisinde anlaşılır durum gösterilir.
        return fail(
          res,
          503,
          "Ödeme servisi başlatılamadı; ödeme alınmadı. Yeniden deneyin.",
        );
      }
      o.paymentToken = r.token;
      await o.save();
      return res.json({ order: o, url: r.paymentPageUrl });
    }
    res.json({ order: o });
  });

  /* Ödemeyi doğrular ve siparişi bir kez tamamlar (FR-012/013, BR-005/007/008). */
  const finalizeOrder = async (req, o) => {
    if (o.status === "cancelled")
      return { status: 409, error: "İptal edilen sipariş ödenemez" };
    if (o.status !== "pending") return { order: o };
    let providerRef;
    if (o.paymentMode === "iyzico") {
      let r;
      try {
        r = await gateway("retrieve", {
          locale: "tr",
          conversationId: o.id,
          token: o.paymentToken,
        });
      } catch {
        // FR-026: belirsiz sonuç başarılı sayılmaz.
        return { status: 409, error: MSG.VAL008 };
      }
      if (r.paymentStatus === "FAILURE") {
        await Payment.updateOne({ orderId: o._id }, { $set: { status: "failed" } });
        await audit(req, "payment_verification", o.id, "pending", "failed", "failed");
        return { status: 409, error: MSG.VAL007 };
      }
      if (r.paymentStatus !== "SUCCESS" || Number(r.paidPrice) !== o.total)
        return { status: 409, error: MSG.VAL008 };
      providerRef = "iyzico:" + (r.paymentId || o.paymentToken);
    } else providerRef = "demo:" + o.id;
    // Siparişi tek bir işlemcinin sahiplenmesi: tekrar eden callback'ler beklemeye düşer.
    const claimed = await Order.findOneAndUpdate(
      { _id: o._id, status: "pending" },
      { $set: { status: "processing" } },
      { new: true },
    );
    if (!claimed) return { order: await Order.findById(o._id) };
    try {
      await Payment.updateOne(
        { orderId: o._id },
        { $set: { providerRef, status: "success" } },
      );
    } catch (e) {
      if (e.code !== 11000) throw e;
      // Aynı sağlayıcı referansı başka siparişte kullanılmış (BR-007).
      await Order.updateOne({ _id: o._id }, { $set: { status: "pending" } });
      return { status: 409, error: MSG.VAL008 };
    }
    // BR-005: stok yalnızca doğrulanmış ödemeden sonra ve koşullu atomik güncellemeyle düşer.
    const applied = [];
    for (const line of claimed.items) {
      const p = await Product.findOneAndUpdate(
        { _id: line.id, stock: { $gte: line.quantity } },
        { $inc: { stock: -line.quantity } },
        { new: true },
      );
      if (!p) break;
      applied.push([line, p]);
    }
    if (applied.length !== claimed.items.length) {
      for (const [line] of applied)
        await Product.updateOne({ _id: line.id }, { $inc: { stock: line.quantity } });
      const status = o.paymentMode === "iyzico" ? "stock_conflict" : "cancelled";
      await Order.updateOne({ _id: o._id }, { $set: { status } });
      await audit(req, "payment_verification", o.id, "pending", status, "stock_conflict");
      if (status === "stock_conflict")
        await notifyStaff(
          "stock_conflict",
          `${orderNo(o)} ödemesi alındı fakat stok yetersiz; iade/mutabakat gerekiyor.`,
        );
      return { status: 409, error: MSG.VAL004 };
    }
    const finalStatus = o.paymentMode === "iyzico" ? "paid" : "demo_paid";
    const done = await Order.findOneAndUpdate(
      { _id: o._id, status: "processing" },
      { $set: { status: finalStatus, stockApplied: true } },
      { new: true },
    );
    await audit(req, "payment_verification", o.id, "pending", finalStatus);
    for (const [line, p] of applied)
      await audit(req, "stock_change", line.id, { stock: p.stock + line.quantity }, { stock: p.stock }, "order:" + o.id);
    await Cart.updateOne(
      { userId: o.user },
      { $pull: { items: { productId: { $in: claimed.items.map((i) => i.id) } } } },
    );
    if (o.analyticsSid)
      await trackEvent(req, "purchase", {
        orderId: o._id,
        sessionId: o.analyticsSid,
        userId: o.user,
        eventId: "purchase:" + o.id,
      });
    await notifyUser(
      o.user,
      "payment_success",
      `${orderNo(o)} siparişiniz alındı. Sipariş detayları hesabınızda.`,
    );
    await notifyStaff("order_created", `${orderNo(o)} numaralı yeni sipariş oluşturuldu.`);
    const s = await getSettings();
    for (const [, p] of applied)
      if (p.stock <= s.commerce.lowStockThreshold)
        await notifyStaff("low_stock", `${p.name} stok miktarı eşik altında (${p.stock}).`);
    return { order: done };
  };
  app.post("/api/orders/:id/pay", auth, async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const o = await Order.findOne({ _id: req.params.id, user: req.currentUser._id });
    if (!o) return res.sendStatus(404);
    const r = await finalizeOrder(req, o);
    if (r.error) return fail(res, r.status, r.error);
    res.json(r.order);
  });
  app.post(
    "/api/payment/callback",
    express.urlencoded({ extended: false }),
    async (req, res) => {
      if (!iyzico || typeof req.body.token !== "string")
        return res.sendStatus(400);
      const o = await Order.findOne({ paymentToken: req.body.token });
      if (!o) return res.sendStatus(404);
      // Dönüş tek başına kanıt değildir; sonuç sağlayıcıdan sorgulanır.
      await finalizeOrder(req, o).catch((e) => console.error(e.message));
      res.redirect("/?payment=" + o.id);
    },
  );
  app.post("/api/orders/:id/cancel", auth, async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const o = await Order.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.currentUser._id,
        status: "pending",
        paymentMode: "demo",
      },
      { $set: { status: "cancelled" } },
      { new: true },
    );
    if (!o)
      return fail(
        res,
        409,
        "Yalnızca ödeme bekleyen demo sipariş iptal edilebilir. iyzico siparişinde sağlayıcı mutabakatı gerekir",
      );
    await Payment.updateOne({ orderId: o._id }, { $set: { status: "failed" } });
    await notifyUser(o.user, "order_status", `${orderNo(o)} siparişinizin durumu: İptal edildi.`);
    res.json(o);
  });
  app.get("/api/orders", auth, async (req, res) =>
    res.json(
      await Order.find({ user: req.currentUser._id }).sort({ createdAt: -1 }),
    ),
  );
  app.get("/api/orders/:id", auth, async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const query = { _id: req.params.id };
    if (!STAFF.includes(req.currentUser.role)) query.user = req.currentUser._id;
    const o = await Order.findOne(query);
    if (!o) return res.sendStatus(404);
    res.json(o);
  });

  /* ─── Kayıtlı yerleşimler (FR-032, BR-022, VAL-020) ─── */
  const ownDesign = (req) =>
    isId(req.params.id)
      ? Design.findOne({ _id: req.params.id, user: req.currentUser._id })
      : null;
  app.get("/api/designs", auth, async (req, res) =>
    res.json(await Design.find({ user: req.currentUser._id }).sort({ createdAt: -1 })),
  );
  app.get("/api/designs/:id", auth, async (req, res) => {
    const d = await ownDesign(req);
    if (!d) return fail(res, 404, MSG.VAL020);
    res.json(d);
  });
  app.post("/api/designs", auth, roles(...BUYERS), async (req, res) => {
    const s = await getSettings();
    if (!s.preview.enabled || !s.preview.saveLayoutEnabled)
      return fail(res, 403, "Yerleşim kaydetme şu anda kapalı");
    const { name, productId, x, y, scale, rotation } = req.body;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      !isId(productId) ||
      !(await Product.exists({ _id: productId, status: "published" })) ||
      ![x, y, scale, rotation].every(Number.isFinite) ||
      Math.abs(x) > 10 ||
      Math.abs(y) > 10 ||
      scale < 0.2 ||
      scale > 3 ||
      rotation < 0 ||
      rotation > 360
    )
      return fail(res, 400, "Geçersiz tasarım");
    if ((await Design.countDocuments({ user: req.currentUser._id })) >= 50)
      return fail(res, 400, "En fazla 50 yerleşim kaydedebilirsiniz");
    res.json(
      await Design.create({
        user: req.currentUser._id,
        name: name.trim().slice(0, 80),
        productId,
        x,
        y,
        scale,
        rotation,
      }),
    );
  });
  app.delete("/api/designs/:id", auth, async (req, res) => {
    const d = await ownDesign(req);
    if (!d) return fail(res, 404, MSG.VAL020);
    await DesignPhoto.deleteMany({ designId: d._id });
    await d.deleteOne();
    res.json({ ok: true });
  });
  /* Bahçe fotoğrafı: yalnızca üye kaydetmeyi seçerse; tür/boyut sunucuda
     doğrulanır, dosya yalnızca görüntü olarak geri verilir (BR-020/021, NFR-13). */
  const sniffImage = (buf) => {
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
      return "image/jpeg";
    if (
      buf.length > 8 &&
      buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
      return "image/png";
    return null;
  };
  app.put(
    "/api/designs/:id/photo",
    auth,
    express.raw({ type: () => true, limit: "16mb" }),
    async (req, res) => {
      const d = await ownDesign(req);
      if (!d) return fail(res, 404, MSG.VAL020);
      const s = await getSettings();
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const declared = (req.get("content-type") || "").split(";")[0];
      const type = sniffImage(buf);
      if (!["image/jpeg", "image/png"].includes(declared) || !type || type !== declared)
        return fail(res, 415, MSG.VAL016);
      if (buf.length > s.preview.maxPhotoMb * 1024 * 1024)
        return fail(res, 413, MSG.VAL017);
      await DesignPhoto.deleteMany({ designId: d._id });
      const photo = await DesignPhoto.create({
        user: req.currentUser._id,
        designId: d._id,
        contentType: type,
        data: buf,
        size: buf.length,
      });
      d.photoRef = String(photo._id);
      await d.save();
      res.json(d);
    },
  );
  app.get("/api/designs/:id/photo", auth, async (req, res) => {
    const d = await ownDesign(req);
    if (!d || !d.photoRef) return fail(res, 404, MSG.VAL020);
    const photo = await DesignPhoto.findOne({ _id: d.photoRef, user: req.currentUser._id });
    if (!photo) return fail(res, 404, MSG.VAL020);
    res.set({
      "Content-Type": photo.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'",
    });
    res.send(photo.data);
  });

  /* ─── Bildirimler ─── */
  const notificationQuery = (u) => ({
    $or: [
      { recipientId: u._id },
      ...(STAFF.includes(u.role) ? [{ audience: "staff" }] : []),
      ...(u.role === "admin" ? [{ audience: "admin" }] : []),
    ],
  });
  app.get("/api/notifications", auth, async (req, res) =>
    res.json(
      await Notification.find(notificationQuery(req.currentUser))
        .sort({ createdAt: -1 })
        .limit(50),
    ),
  );
  app.post("/api/notifications/:id/read", auth, async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...notificationQuery(req.currentUser) },
      { $set: { read: true } },
      { new: true },
    );
    if (!n) return res.sendStatus(404);
    res.json(n);
  });

  /* ─── Yönetim (FR-015/016/018, BR-009/011) ─── */
  app.get("/api/admin", auth, roles(...STAFF), async (req, res) =>
    res.json({
      products: await Product.find().sort({ createdAt: 1 }),
      categories: await Category.find().sort({ name: 1 }),
      orders: await Order.find().sort({ createdAt: -1 }).limit(500),
      users:
        req.currentUser.role === "admin"
          ? await User.find().select("name email role createdAt")
          : [],
    }),
  );
  const MODEL_URL =
    /^(|builtin:(chair|sofa|table|lounger)|https:\/\/[^\s"'<>]+\.(glb|gltf)(\?[^\s"'<>]*)?)$/;
  const productError = (p) => {
    if (
      !Number.isFinite(p.price) ||
      p.price <= 0 ||
      !Number.isInteger(p.stock) ||
      p.stock < 0
    )
      return MSG.VAL009;
    if (
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 120 ||
      !PRODUCT_STATUSES.includes(p.status) ||
      typeof p.image !== "string" ||
      !(
        /^https:\/\/\S+$/.test(p.image) ||
        /^\/images\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(p.image)
      ) ||
      typeof (p.model3dUrl ?? "") !== "string" ||
      !MODEL_URL.test(p.model3dUrl ?? "") ||
      (p.color !== undefined && p.color !== null && !/^#[0-9a-fA-F]{6}$/.test(p.color)) ||
      (p.description !== undefined && p.description !== null && (typeof p.description !== "string" || p.description.length > 1000))
    )
      return MSG.VAL013;
    return null;
  };
  const resolveCategory = async (body) => {
    if (isId(body.categoryId)) return Category.findById(body.categoryId);
    if (typeof body.category === "string")
      return Category.findOne({ name: body.category });
    return null;
  };
  const PRODUCT_FIELDS = [
    "name",
    "price",
    "stock",
    "status",
    "image",
    "description",
    "color",
    "model3dUrl",
  ];
  const pickProduct = (b) =>
    Object.fromEntries(
      PRODUCT_FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]),
    );
  const duplicateName = (name, exceptId) =>
    Product.exists({
      name: { $regex: "^" + name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", $options: "i" },
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    });
  app.post("/api/admin/products", auth, roles(...STAFF), async (req, res) => {
    const data = { status: "published", model3dUrl: "", ...pickProduct(req.body) };
    const err = productError(data);
    if (err) return fail(res, 400, err);
    const c = await resolveCategory(req.body);
    if (!c) return fail(res, 400, MSG.VAL013, { field: "categoryId" });
    if (await duplicateName(data.name))
      return fail(res, 400, MSG.VAL013, { field: "name" });
    const p = await Product.create({
      ...data,
      name: data.name.trim(),
      categoryId: c._id,
      category: c.name,
    });
    await audit(req, "product_create", p.id, undefined, pickProduct(p.toObject()));
    res.json(p);
  });
  app.patch("/api/admin/products/:id", auth, roles(...STAFF), async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const p = await Product.findById(req.params.id);
    if (!p) return res.sendStatus(404);
    const before = pickProduct(p.toObject());
    const data = { ...before, ...pickProduct(req.body) };
    const err = productError(data);
    if (err) return fail(res, 400, err);
    let c = null;
    if (req.body.categoryId !== undefined || req.body.category !== undefined) {
      c = await resolveCategory(req.body);
      if (!c) return fail(res, 400, MSG.VAL013, { field: "categoryId" });
    }
    if (await duplicateName(data.name, p._id))
      return fail(res, 400, MSG.VAL013, { field: "name" });
    // Stok yarışını önlemek için stok değişimi koşullu güncellemeyle yapılır.
    const update = { ...data, name: data.name.trim() };
    if (c) Object.assign(update, { categoryId: c._id, category: c.name });
    const saved = await Product.findOneAndUpdate(
      { _id: p._id, stock: before.stock },
      { $set: update },
      { new: true },
    );
    if (!saved)
      return fail(res, 409, "Stok bu sırada değişti; sayfayı yenileyip tekrar deneyin");
    // BR-011: stok/fiyat/durum değişimi denetim kaydına yazılır.
    const after = pickProduct(saved.toObject());
    const changed = Object.keys(after).filter(
      (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]),
    );
    if (changed.length)
      await audit(
        req,
        changed.some((k) => ["stock", "price"].includes(k))
          ? "stock_price_change"
          : "product_update",
        p.id,
        Object.fromEntries(changed.map((k) => [k, before[k]])),
        Object.fromEntries(changed.map((k) => [k, after[k]])),
      );
    res.json(saved);
  });
  app.post("/api/admin/categories", auth, roles(...STAFF), async (req, res) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 40) return fail(res, 400, MSG.VAL013);
    if (await Category.exists({ name })) return fail(res, 400, MSG.VAL013);
    const c = await Category.create({ name });
    await audit(req, "category_create", c.id, undefined, { name });
    res.json(c);
  });
  app.patch("/api/admin/categories/:id", auth, roles(...STAFF), async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const c = await Category.findById(req.params.id);
    if (!c) return res.sendStatus(404);
    const before = { name: c.name, isActive: c.isActive };
    if (req.body.name !== undefined) {
      const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
      if (!name || name.length > 40 || (await Category.exists({ name, _id: { $ne: c._id } })))
        return fail(res, 400, MSG.VAL013);
      c.name = name;
    }
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") return fail(res, 400, MSG.VAL013);
      c.isActive = req.body.isActive;
    }
    await c.save();
    await Product.updateMany({ categoryId: c._id }, { $set: { category: c.name } });
    await audit(req, "category_update", c.id, before, { name: c.name, isActive: c.isActive });
    res.json(c);
  });
  const STATUS_TEXT = {
    preparing: "Hazırlanıyor",
    shipped: "Kargolandı",
    delivered: "Teslim edildi",
  };
  app.patch("/api/admin/orders/:id", auth, roles(...STAFF), async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const o = await Order.findById(req.params.id);
    if (!o) return res.sendStatus(404);
    const from = o.status;
    if (!canTransition(from, req.body.status)) {
      await audit(req, "order_status", o.id, from, req.body.status, "rejected");
      return fail(res, 400, MSG.VAL014);
    }
    const updated = await Order.findOneAndUpdate(
      { _id: o._id, status: from },
      { $set: { status: req.body.status } },
      { new: true },
    );
    if (!updated) return fail(res, 409, MSG.VAL014);
    await audit(req, "order_status", o.id, from, updated.status);
    await notifyUser(
      o.user,
      "order_status",
      `${orderNo(o)} siparişinizin durumu: ${STATUS_TEXT[updated.status]}.`,
    );
    res.json(updated);
  });
  app.patch("/api/admin/users/:id", auth, roles("admin"), async (req, res) => {
    if (
      req.params.id === String(req.currentUser._id) ||
      !ROLES.includes(req.body.role)
    )
      return fail(res, 400, "Kendi rolünüzü değiştiremezsiniz veya rol geçersiz");
    if (!isId(req.params.id)) return res.sendStatus(404);
    const before = await User.findById(req.params.id);
    if (!before) return res.sendStatus(404);
    const u = await User.findByIdAndUpdate(
      req.params.id,
      { role: req.body.role },
      { new: true },
    );
    await audit(req, "role_update", u.id, { role: before.role }, { role: u.role });
    res.json(view(u));
  });

  /* ─── Parametrik ayarlar (FR-024, BR-017, BR-T01/T02) ─── */
  app.get("/api/admin/settings", auth, roles("admin"), async (req, res) =>
    res.json(await getSettings()),
  );
  app.put("/api/admin/settings", auth, roles("admin"), async (req, res) => {
    const { errors, values } = validateSettings(req.body || {});
    if (errors.length)
      return fail(res, 400, "Parametre değerlerini kontrol ediniz.", { fields: errors });
    const before = await getSettings();
    const $set = { updatedBy: req.currentUser._id };
    for (const [g, obj] of Object.entries(values))
      for (const [k, v] of Object.entries(obj)) $set[`${g}.${k}`] = v;
    await Setting.updateOne({ key: "global" }, { $set, $inc: { version: 1 } });
    const after = await getSettings();
    await audit(
      req,
      "settings_update",
      "settings",
      { version: before.version, commerce: before.commerce, analytics: before.analytics, preview: before.preview },
      { version: after.version, commerce: after.commerce, analytics: after.analytics, preview: after.preview },
    );
    res.json(after);
  });
  app.get("/api/admin/coupons", auth, roles("admin"), async (req, res) =>
    res.json(await Coupon.find().sort({ createdAt: -1 })),
  );
  app.post("/api/admin/coupons", auth, roles("admin"), async (req, res) => {
    const code = typeof req.body.code === "string" ? req.body.code.trim().toUpperCase() : "";
    const { type, value } = req.body;
    if (
      !/^[A-Z0-9_-]{3,20}$/.test(code) ||
      !["fixed", "percent"].includes(type) ||
      !Number.isFinite(value) ||
      value <= 0 ||
      (type === "percent" && value > 100) ||
      (await Coupon.exists({ code }))
    )
      return fail(res, 400, MSG.VAL013);
    const c = await Coupon.create({ code, type, value });
    await audit(req, "coupon_create", c.id, undefined, { code, type, value });
    res.json(c);
  });
  app.patch("/api/admin/coupons/:id", auth, roles("admin"), async (req, res) => {
    if (!isId(req.params.id) || typeof req.body.isActive !== "boolean")
      return fail(res, 400, MSG.VAL013);
    const c = await Coupon.findByIdAndUpdate(
      req.params.id,
      { isActive: req.body.isActive },
      { new: true },
    );
    if (!c) return res.sendStatus(404);
    await audit(req, "coupon_update", c.id, undefined, { isActive: c.isActive });
    res.json(c);
  });
  app.get("/api/admin/audit", auth, roles("admin"), async (req, res) => {
    const filter = {};
    if (typeof req.query.eventType === "string" && req.query.eventType)
      filter.eventType = req.query.eventType;
    res.json(await AuditLog.find(filter).sort({ occurredAt: -1 }).limit(200));
  });

  /* ─── Raporlar (FR-020/021/022/025, BR-013/014/016, VAL-011/012) ─── */
  const reportData = async (req) => {
    const s = await getSettings();
    const tz = s.analytics.reportTimezone;
    const { from, to } = req.query;
    if (!from || !to) return { error: MSG.VAL012 };
    const start = zonedDayStart(from, tz);
    const endDay = zonedDayStart(to, tz);
    if (!start || !endDay) return { error: MSG.VAL012 };
    if (start > endDay) return { error: MSG.VAL011 };
    const end = new Date(endDay.getTime() + 86400000);
    const windowMs = s.analytics.abandonmentHours * 3600000;
    const events = await Event.find({
      occurredAt: { $gte: start, $lt: new Date(end.getTime() + windowMs) },
    }).lean();
    const inRange = events.filter((e) => e.occurredAt < end);
    const sessionsWith = (type) =>
      new Set(inRange.filter((e) => e.eventType === type).map((e) => e.sessionId));
    // BR-013: checkout_start yapan tekil oturumun ilk başlatma anı + pencere içinde purchase var mı?
    const firstCheckout = new Map();
    for (const e of inRange)
      if (e.eventType === "checkout_start") {
        const t = firstCheckout.get(e.sessionId);
        if (!t || e.occurredAt < t) firstCheckout.set(e.sessionId, e.occurredAt);
      }
    let purchasedAfterCheckout = 0;
    for (const [sid, t] of firstCheckout)
      if (
        events.some(
          (e) =>
            e.eventType === "purchase" &&
            e.sessionId === sid &&
            e.occurredAt >= t &&
            e.occurredAt - t <= windowMs,
        )
      )
        purchasedAfterCheckout++;
    const viewSessions = sessionsWith("product_view");
    const purchaseSessions = sessionsWith("purchase");
    const cartSessions = sessionsWith("add_to_cart");
    const cartNoBuy = [...cartSessions].filter((sid) => !purchaseSessions.has(sid)).length;
    const pct = (num, den) => (den ? Math.round((num / den) * 10000) / 100 : null);
    // Satın alma KPI'ı: başarılı ödeme ile eşleşen siparişler (olay değil).
    const paidStatuses = ["paid", "demo_paid", "preparing", "shipped", "delivered"];
    const orders = await Order.find({
      status: { $in: paidStatuses },
      createdAt: { $gte: start, $lt: end },
    }).lean();
    const byProduct = new Map();
    const row = (id) => {
      const key = String(id);
      if (!byProduct.has(key))
        byProduct.set(key, { productId: key, views: 0, addToCart: 0, purchasedQty: 0, orders: 0 });
      return byProduct.get(key);
    };
    for (const e of inRange) {
      if (!e.productId) continue;
      if (e.eventType === "product_view") row(e.productId).views++;
      if (e.eventType === "add_to_cart") row(e.productId).addToCart++;
    }
    for (const o of orders)
      for (const i of o.items) {
        const r = row(i.id);
        r.purchasedQty += i.quantity;
        r.orders++;
      }
    const names = await Product.find({ _id: { $in: [...byProduct.keys()] } }).select("name").lean();
    const products = [...byProduct.values()]
      .map((r) => ({
        ...r,
        name: names.find((n) => String(n._id) === r.productId)?.name || "Silinmiş ürün",
      }))
      .sort((a, b) => b.views - a.views);
    return {
      range: { from, to, timezone: tz, abandonmentHours: s.analytics.abandonmentHours },
      lastUpdated: new Date(),
      kpis: {
        productViews: inRange.filter((e) => e.eventType === "product_view").length,
        addToCart: inRange.filter((e) => e.eventType === "add_to_cart").length,
        checkoutSessions: firstCheckout.size,
        purchases: orders.length,
        abandonmentRate: pct(firstCheckout.size - purchasedAfterCheckout, firstCheckout.size),
        cartAddNoPurchaseRate: pct(cartNoBuy, cartSessions.size),
        conversionRate: pct(
          [...purchaseSessions].filter((sid) => viewSessions.has(sid)).length,
          viewSessions.size,
        ),
      },
      labels: {
        productViews: "olay sayısı",
        addToCart: "olay sayısı",
        checkoutSessions: "tekil oturum",
        purchases: "başarılı ödemeli sipariş",
        abandonmentRate: "tekil oturum oranı (%)",
        cartAddNoPurchaseRate: "tekil oturum oranı (%)",
        conversionRate: "tekil oturum oranı (%)",
      },
      products,
    };
  };
  app.get("/api/reports/summary", auth, roles(...STAFF), async (req, res) => {
    const r = await reportData(req);
    if (r.error) return fail(res, 400, r.error);
    res.json(r);
  });
  app.get("/api/reports/summary.csv", auth, roles(...STAFF), async (req, res) => {
    const r = await reportData(req);
    if (r.error) return fail(res, 400, r.error);
    const esc = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // CSV formül enjeksiyonunu önle
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Dönem", `${r.range.from} – ${r.range.to} (${r.range.timezone})`],
      ["Ürün görüntüleme (olay)", r.kpis.productViews],
      ["Sepete ekleme (olay)", r.kpis.addToCart],
      ["Ödeme başlatan tekil oturum", r.kpis.checkoutSessions],
      ["Satın alma (başarılı sipariş)", r.kpis.purchases],
      ["Sepet terk oranı %", r.kpis.abandonmentRate ?? "Veri yok"],
      ["Sepete ekleyip almayan oturum %", r.kpis.cartAddNoPurchaseRate ?? "Veri yok"],
      ["Dönüşüm oranı % (oturum)", r.kpis.conversionRate ?? "Veri yok"],
      [],
      ["Ürün", "Görüntüleme", "Sepete ekleme", "Satılan adet", "Sipariş"],
      ...r.products.map((p) => [p.name, p.views, p.addToCart, p.purchasedQty, p.orders]),
    ];
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rapor-${r.range.from}-${r.range.to}.csv"`,
    });
    res.send("﻿" + lines.map((l) => l.map(esc).join(";")).join("\n"));
  });

  /* ─── Canlı ziyaretçi sayacı (SSE) ─── */
  const visitors = new Set();
  const broadcast = () => {
    const data = `data: ${JSON.stringify({ count: visitors.size })}\n\n`;
    for (const res of visitors) res.write(data);
  };
  app.get("/api/visitors/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ count: visitors.size + 1 })}\n\n`);
    visitors.add(res);
    broadcast();
    req.on("close", () => {
      visitors.delete(res);
      broadcast();
    });
  });
  app.get("/api/visitors/count", (req, res) =>
    res.json({ count: visitors.size }),
  );

  app.use((e, req, res, next) => {
    if (e.type === "entity.too.large") return fail(res, 413, MSG.VAL017);
    console.error(e.message);
    res
      .status(e.name === "CastError" ? 400 : 500)
      .json({ error: "İşlem tamamlanamadı. Bilgileri kontrol edin." });
  });
  return app;
}

/* ─── Şema geçişleri: eski veriyi SRS modeline taşır (idempotent) ─── */
const CATEGORY_MODELS = {
  "Oturma Grupları": "builtin:sofa",
  Sandalyeler: "builtin:chair",
  Masalar: "builtin:table",
  Şezlonglar: "builtin:lounger",
};
export async function migrate() {
  await getSettings();
  const s = await Setting.findOne({ key: "global" });
  if (!s.schemaVersion) {
    // Rol adları SRS 2.1'e göre: user→customer, admin→manager, superadmin→admin
    const users = User.collection;
    await users.updateMany({ role: "admin" }, { $set: { role: "manager" } });
    await users.updateMany({ role: "superadmin" }, { $set: { role: "admin" } });
    await users.updateMany({ role: "user" }, { $set: { role: "customer" } });
    await Setting.updateOne({ key: "global" }, { $set: { schemaVersion: 2 } });
  }
  const products = Product.collection;
  for (const name of await products.distinct("category"))
    if (name && !(await Category.exists({ name })))
      await Category.create({ name }).catch(() => {});
  for (const c of await Category.find())
    await products.updateMany(
      { category: c.name, categoryId: { $exists: false } },
      { $set: { categoryId: c._id } },
    );
  await products.updateMany({ status: { $exists: false } }, { $set: { status: "published" } });
  for (const [name, model] of Object.entries(CATEGORY_MODELS))
    await products.updateMany(
      { category: name, model3dUrl: { $exists: false } },
      { $set: { model3dUrl: model } },
    );
  await products.updateMany({ model3dUrl: { $exists: false } }, { $set: { model3dUrl: "builtin:chair" } });
}
export async function seed() {
  for (const name of Object.keys(CATEGORY_MODELS))
    if (!(await Category.exists({ name }))) await Category.create({ name }).catch(() => {});
  if (await Product.countDocuments()) return;
  const cat = async (name) => (await Category.findOne({ name }))._id;
  await Product.insertMany([
    {
      name: "Luna Bahçe Oturma Grubu",
      category: "Oturma Grupları",
      categoryId: await cat("Oturma Grupları"),
      price: 24990,
      stock: 12,
      image: "/images/product-sofa.png",
      description:
        "Doğal ahşabın sıcaklığı, yumuşak minderlerin konforuyla buluşuyor. 4 kişilik takım, açık havada uzun sohbetler için.",
      color: "#b79b77",
      model3dUrl: "builtin:sofa",
    },
    {
      name: "Terra Örgü Sandalye",
      category: "Sandalyeler",
      categoryId: await cat("Sandalyeler"),
      price: 3490,
      stock: 28,
      image: "/images/product-chair.png",
      description:
        "Hafif, dayanıklı ve zamansız. El örgüsü dokusuyla bahçenizin yeni favorisi.",
      color: "#ae8358",
      model3dUrl: "builtin:chair",
    },
    {
      name: "Olive Ahşap Bahçe Masası",
      category: "Masalar",
      categoryId: await cat("Masalar"),
      price: 8990,
      stock: 8,
      image: "/images/product-table.png",
      description:
        "Altı kişilik geniş yüzey ve masif ahşap tasarım. Güneşli kahvaltılara davet.",
      color: "#98734e",
      model3dUrl: "builtin:table",
    },
    {
      name: "Soleil Şezlong",
      category: "Şezlonglar",
      categoryId: await cat("Şezlonglar"),
      price: 6490,
      stock: 16,
      image: "/images/product-lounger.png",
      description:
        "Ayarlanabilir sırt desteği ve rahat minder. Kendinize ayırdığınız anlar için.",
      color: "#d0bc95",
      model3dUrl: "builtin:lounger",
    },
  ]);
}
