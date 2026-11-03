// Sipariş oluşturma, ödeme doğrulama (iyzico / demo), iptal ve sipariş geçmişi
import express from "express";
import { Product, Cart, Order, Payment } from "../db.js";
import { MSG, priceSummary } from "../rules.js";
import {
  isId,
  STAFF,
  BUYERS,
  fail,
  getSettings,
  audit,
  notifyUser,
  notifyStaff,
  orderNo,
  trackEvent,
  auth,
  roles,
  loadCart,
  findCoupon,
  addressText,
} from "../helpers.js";

export default function registerOrdersRoutes(app, { iyzico, gateway, appUrl }) {
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
      if (
        !isId(i?.id) ||
        seen.has(i.id) ||
        !Number.isInteger(i.quantity) ||
        i.quantity < 1 ||
        i.quantity > 99
      )
        return fail(res, 400, MSG.VAL003);
      seen.add(i.id);
      const p = await Product.findById(i.id);
      // FR-017: yetersiz stokta ödeme başlatma engellenir.
      if (!p || p.status !== "published" || p.stock < 1)
        return fail(res, 409, MSG.VAL004, { productId: i.id });
      if (p.stock < i.quantity)
        return fail(res, 409, MSG.VAL003, { productId: i.id });
      lines.push({
        id: p.id,
        name: p.name,
        price: p.price,
        quantity: i.quantity,
      });
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
        await Payment.updateOne(
          { orderId: o._id },
          { $set: { status: "failed" } },
        );
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
        await Payment.updateOne(
          { orderId: o._id },
          { $set: { status: "failed" } },
        );
        await audit(
          req,
          "payment_verification",
          o.id,
          "pending",
          "failed",
          "failed",
        );
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
        await Product.updateOne(
          { _id: line.id },
          { $inc: { stock: line.quantity } },
        );
      const status =
        o.paymentMode === "iyzico" ? "stock_conflict" : "cancelled";
      await Order.updateOne({ _id: o._id }, { $set: { status } });
      await audit(
        req,
        "payment_verification",
        o.id,
        "pending",
        status,
        "stock_conflict",
      );
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
      await audit(
        req,
        "stock_change",
        line.id,
        { stock: p.stock + line.quantity },
        { stock: p.stock },
        "order:" + o.id,
      );
    await Cart.updateOne(
      { userId: o.user },
      {
        $pull: {
          items: { productId: { $in: claimed.items.map((i) => i.id) } },
        },
      },
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
    await notifyStaff(
      "order_created",
      `${orderNo(o)} numaralı yeni sipariş oluşturuldu.`,
    );
    const s = await getSettings();
    for (const [, p] of applied)
      if (p.stock <= s.commerce.lowStockThreshold)
        await notifyStaff(
          "low_stock",
          `${p.name} stok miktarı eşik altında (${p.stock}).`,
        );
    return { order: done };
  };
  app.post("/api/orders/:id/pay", auth, async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const o = await Order.findOne({
      _id: req.params.id,
      user: req.currentUser._id,
    });
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
    await notifyUser(
      o.user,
      "order_status",
      `${orderNo(o)} siparişinizin durumu: İptal edildi.`,
    );
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
}
