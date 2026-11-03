// Katalog: kategoriler, ürünler, 3D önizleme ve ürün görüntüleme olayı
import { Product, Category } from "../db.js";
import { MSG } from "../rules.js";
import { isId, fail, getSettings, trackEvent } from "../helpers.js";

export default function registerCatalogRoutes(app) {
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
    if (
      eventId !== undefined &&
      (typeof eventId !== "string" || eventId.length > 64)
    )
      return fail(res, 400, "Geçersiz olay");
    if (!(await Product.exists({ _id: productId, status: { $ne: "draft" } })))
      return res.sendStatus(404);
    const recorded = await trackEvent(req, "product_view", {
      productId,
      eventId,
    });
    res.status(recorded ? 201 : 202).json({
      recorded,
      ...(recorded ? {} : { reason: MSG.VAL015 }),
    });
  });
}
