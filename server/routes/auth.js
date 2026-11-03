// Üyelik, giriş/çıkış, analitik izni ve herkese açık ayarlar
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { User } from "../db.js";
import { MSG } from "../rules.js";
import { fail, getSettings, auth, userView } from "../helpers.js";

export default function registerAuthRoutes(app) {
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
      return fail(
        res,
        429,
        "Çok fazla deneme. 10 dakika sonra tekrar deneyin.",
      );
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
    // Giriş/çıkışta oturum yenilenir; analitik izni korunur.
    const kept = {
      analyticsConsent: req.session.analyticsConsent,
      analyticsSid: req.session.analyticsSid,
    };
    await new Promise((resolve, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : resolve())),
    );
    Object.assign(req.session, kept);
    req.session.user = userView(u);
    res.json(userView(u));
  });
  app.get("/api/me", async (req, res) => {
    const u = req.session.user && (await User.findById(req.session.user.id));
    res.json(u ? userView(u) : null);
  });
  app.post("/api/logout", (req, res) => {
    // Giriş/çıkışta oturum yenilenir; analitik izni korunur.
    const kept = {
      analyticsConsent: req.session.analyticsConsent,
      analyticsSid: req.session.analyticsSid,
    };
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
}
