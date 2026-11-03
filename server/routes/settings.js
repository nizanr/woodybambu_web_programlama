// Admin ayarları, indirim kodları ve denetim kaydı
import { Setting, Coupon, AuditLog } from "../db.js";
import { MSG, validateSettings } from "../rules.js";
import { isId, fail, getSettings, audit, auth, roles } from "../helpers.js";

export default function registerSettingsRoutes(app) {
  /* ─── Parametrik ayarlar (FR-024, BR-017, BR-T01/T02) ─── */
  app.get("/api/admin/settings", auth, roles("admin"), async (req, res) =>
    res.json(await getSettings()),
  );
  app.put("/api/admin/settings", auth, roles("admin"), async (req, res) => {
    const { errors, values } = validateSettings(req.body || {});
    if (errors.length)
      return fail(res, 400, "Parametre değerlerini kontrol ediniz.", {
        fields: errors,
      });
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
      {
        version: before.version,
        commerce: before.commerce,
        analytics: before.analytics,
        preview: before.preview,
      },
      {
        version: after.version,
        commerce: after.commerce,
        analytics: after.analytics,
        preview: after.preview,
      },
    );
    res.json(after);
  });
  app.get("/api/admin/coupons", auth, roles("admin"), async (req, res) =>
    res.json(await Coupon.find().sort({ createdAt: -1 })),
  );
  app.post("/api/admin/coupons", auth, roles("admin"), async (req, res) => {
    const code =
      typeof req.body.code === "string"
        ? req.body.code.trim().toUpperCase()
        : "";
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
  app.patch(
    "/api/admin/coupons/:id",
    auth,
    roles("admin"),
    async (req, res) => {
      if (!isId(req.params.id) || typeof req.body.isActive !== "boolean")
        return fail(res, 400, MSG.VAL013);
      const c = await Coupon.findByIdAndUpdate(
        req.params.id,
        { isActive: req.body.isActive },
        { new: true },
      );
      if (!c) return res.sendStatus(404);
      await audit(req, "coupon_update", c.id, undefined, {
        isActive: c.isActive,
      });
      res.json(c);
    },
  );
  app.get("/api/admin/audit", auth, roles("admin"), async (req, res) => {
    const filter = {};
    if (typeof req.query.eventType === "string" && req.query.eventType)
      filter.eventType = req.query.eventType;
    res.json(await AuditLog.find(filter).sort({ occurredAt: -1 }).limit(200));
  });
}
