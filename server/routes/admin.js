// Yönetim paneli: ürün, kategori, sipariş durumu ve kullanıcı rolleri
import {
  User,
  Product,
  Category,
  Order,
  ROLES,
  PRODUCT_STATUSES,
} from "../db.js";
import { MSG, canTransition } from "../rules.js";
import {
  isId,
  STAFF,
  fail,
  audit,
  notifyUser,
  orderNo,
  auth,
  roles,
  userView,
} from "../helpers.js";

export default function registerAdminRoutes(app) {
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
      (p.color !== undefined &&
        p.color !== null &&
        !/^#[0-9a-fA-F]{6}$/.test(p.color)) ||
      (p.description !== undefined &&
        p.description !== null &&
        (typeof p.description !== "string" || p.description.length > 1000))
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
      name: {
        $regex: "^" + name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
        $options: "i",
      },
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    });
  app.post("/api/admin/products", auth, roles(...STAFF), async (req, res) => {
    const data = {
      status: "published",
      model3dUrl: "",
      ...pickProduct(req.body),
    };
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
    await audit(
      req,
      "product_create",
      p.id,
      undefined,
      pickProduct(p.toObject()),
    );
    res.json(p);
  });
  app.patch(
    "/api/admin/products/:id",
    auth,
    roles(...STAFF),
    async (req, res) => {
      if (!isId(req.params.id)) return res.sendStatus(404);
      const p = await Product.findById(req.params.id);
      if (!p) return res.sendStatus(404);
      const before = pickProduct(p.toObject());
      const data = { ...before, ...pickProduct(req.body) };
      const err = productError(data);
      if (err) return fail(res, 400, err);
      let c = null;
      if (
        req.body.categoryId !== undefined ||
        req.body.category !== undefined
      ) {
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
        return fail(
          res,
          409,
          "Stok bu sırada değişti; sayfayı yenileyip tekrar deneyin",
        );
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
    },
  );
  app.post("/api/admin/categories", auth, roles(...STAFF), async (req, res) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 40) return fail(res, 400, MSG.VAL013);
    if (await Category.exists({ name })) return fail(res, 400, MSG.VAL013);
    const c = await Category.create({ name });
    await audit(req, "category_create", c.id, undefined, { name });
    res.json(c);
  });
  app.patch(
    "/api/admin/categories/:id",
    auth,
    roles(...STAFF),
    async (req, res) => {
      if (!isId(req.params.id)) return res.sendStatus(404);
      const c = await Category.findById(req.params.id);
      if (!c) return res.sendStatus(404);
      const before = { name: c.name, isActive: c.isActive };
      if (req.body.name !== undefined) {
        const name =
          typeof req.body.name === "string" ? req.body.name.trim() : "";
        if (
          !name ||
          name.length > 40 ||
          (await Category.exists({ name, _id: { $ne: c._id } }))
        )
          return fail(res, 400, MSG.VAL013);
        c.name = name;
      }
      if (req.body.isActive !== undefined) {
        if (typeof req.body.isActive !== "boolean")
          return fail(res, 400, MSG.VAL013);
        c.isActive = req.body.isActive;
      }
      await c.save();
      await Product.updateMany(
        { categoryId: c._id },
        { $set: { category: c.name } },
      );
      await audit(req, "category_update", c.id, before, {
        name: c.name,
        isActive: c.isActive,
      });
      res.json(c);
    },
  );
  const STATUS_TEXT = {
    preparing: "Hazırlanıyor",
    shipped: "Kargolandı",
    delivered: "Teslim edildi",
  };
  app.patch(
    "/api/admin/orders/:id",
    auth,
    roles(...STAFF),
    async (req, res) => {
      if (!isId(req.params.id)) return res.sendStatus(404);
      const o = await Order.findById(req.params.id);
      if (!o) return res.sendStatus(404);
      const from = o.status;
      if (!canTransition(from, req.body.status)) {
        await audit(
          req,
          "order_status",
          o.id,
          from,
          req.body.status,
          "rejected",
        );
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
    },
  );
  app.patch("/api/admin/users/:id", auth, roles("admin"), async (req, res) => {
    if (
      req.params.id === String(req.currentUser._id) ||
      !ROLES.includes(req.body.role)
    )
      return fail(
        res,
        400,
        "Kendi rolünüzü değiştiremezsiniz veya rol geçersiz",
      );
    if (!isId(req.params.id)) return res.sendStatus(404);
    const before = await User.findById(req.params.id);
    if (!before) return res.sendStatus(404);
    const u = await User.findByIdAndUpdate(
      req.params.id,
      { role: req.body.role },
      { new: true },
    );
    await audit(
      req,
      "role_update",
      u.id,
      { role: before.role },
      { role: u.role },
    );
    res.json(userView(u));
  });
}
