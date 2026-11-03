// Raporlar: ürün etkileşimi, sepet terk oranı, dönüşüm ve CSV
import { Product, Order, Event } from "../db.js";
import { MSG, zonedDayStart } from "../rules.js";
import { STAFF, fail, getSettings, auth, roles } from "../helpers.js";

export default function registerReportsRoutes(app) {
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
      new Set(
        inRange.filter((e) => e.eventType === type).map((e) => e.sessionId),
      );
    // BR-013: checkout_start yapan tekil oturumun ilk başlatma anı + pencere içinde purchase var mı?
    const firstCheckout = new Map();
    for (const e of inRange)
      if (e.eventType === "checkout_start") {
        const t = firstCheckout.get(e.sessionId);
        if (!t || e.occurredAt < t)
          firstCheckout.set(e.sessionId, e.occurredAt);
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
    const cartNoBuy = [...cartSessions].filter(
      (sid) => !purchaseSessions.has(sid),
    ).length;
    const pct = (num, den) =>
      den ? Math.round((num / den) * 10000) / 100 : null;
    // Satın alma KPI'ı: başarılı ödeme ile eşleşen siparişler (olay değil).
    const paidStatuses = [
      "paid",
      "demo_paid",
      "preparing",
      "shipped",
      "delivered",
    ];
    const orders = await Order.find({
      status: { $in: paidStatuses },
      createdAt: { $gte: start, $lt: end },
    }).lean();
    const byProduct = new Map();
    const row = (id) => {
      const key = String(id);
      if (!byProduct.has(key))
        byProduct.set(key, {
          productId: key,
          views: 0,
          addToCart: 0,
          purchasedQty: 0,
          orders: 0,
        });
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
    const names = await Product.find({ _id: { $in: [...byProduct.keys()] } })
      .select("name")
      .lean();
    const products = [...byProduct.values()]
      .map((r) => ({
        ...r,
        name:
          names.find((n) => String(n._id) === r.productId)?.name ||
          "Silinmiş ürün",
      }))
      .sort((a, b) => b.views - a.views);
    return {
      range: {
        from,
        to,
        timezone: tz,
        abandonmentHours: s.analytics.abandonmentHours,
      },
      lastUpdated: new Date(),
      kpis: {
        productViews: inRange.filter((e) => e.eventType === "product_view")
          .length,
        addToCart: inRange.filter((e) => e.eventType === "add_to_cart").length,
        checkoutSessions: firstCheckout.size,
        purchases: orders.length,
        abandonmentRate: pct(
          firstCheckout.size - purchasedAfterCheckout,
          firstCheckout.size,
        ),
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
  app.get(
    "/api/reports/summary.csv",
    auth,
    roles(...STAFF),
    async (req, res) => {
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
        [
          "Sepete ekleyip almayan oturum %",
          r.kpis.cartAddNoPurchaseRate ?? "Veri yok",
        ],
        ["Dönüşüm oranı % (oturum)", r.kpis.conversionRate ?? "Veri yok"],
        [],
        ["Ürün", "Görüntüleme", "Sepete ekleme", "Satılan adet", "Sipariş"],
        ...r.products.map((p) => [
          p.name,
          p.views,
          p.addToCart,
          p.purchasedQty,
          p.orders,
        ]),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rapor-${r.range.from}-${r.range.to}.csv"`,
      });
      res.send("﻿" + lines.map((l) => l.map(esc).join(";")).join("\n"));
    },
  );
}
