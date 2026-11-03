// Express uygulamasını kurar: oturum, güvenlik kontrolü ve tüm API rotaları.
// Her konu kendi dosyasındadır: server/routes/*.js
import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import Iyzipay from "iyzipay";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { MSG } from "./rules.js";
import { fail } from "./helpers.js";
import registerAuthRoutes from "./routes/auth.js";
import registerCatalogRoutes from "./routes/catalog.js";
import registerCartRoutes from "./routes/cart.js";
import registerAddressesRoutes from "./routes/addresses.js";
import registerOrdersRoutes from "./routes/orders.js";
import registerDesignsRoutes from "./routes/designs.js";
import registerNotificationsRoutes from "./routes/notifications.js";
import registerAdminRoutes from "./routes/admin.js";
import registerSettingsRoutes from "./routes/settings.js";
import registerReportsRoutes from "./routes/reports.js";
import registerVisitorsRoutes from "./routes/visitors.js";
export { migrate, seed } from "./seed.js";
export { getSettings } from "./helpers.js";

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

  // ─── API rotaları ───
  registerAuthRoutes(app);
  registerCatalogRoutes(app);
  registerCartRoutes(app);
  registerAddressesRoutes(app);
  registerOrdersRoutes(app, { iyzico, gateway, appUrl });
  registerDesignsRoutes(app);
  registerNotificationsRoutes(app);
  registerAdminRoutes(app);
  registerSettingsRoutes(app);
  registerReportsRoutes(app);
  registerVisitorsRoutes(app);

  app.use((e, req, res, next) => {
    if (e.type === "entity.too.large") return fail(res, 413, MSG.VAL017);
    console.error(e.message);
    res
      .status(e.name === "CastError" ? 400 : 500)
      .json({ error: "İşlem tamamlanamadı. Bilgileri kontrol edin." });
  });
  return app;
}
