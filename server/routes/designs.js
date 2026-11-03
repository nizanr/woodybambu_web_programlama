// Kayıtlı 3D yerleşimler ve isteğe bağlı bahçe fotoğrafı
import express from "express";
import { Product, Design, DesignPhoto } from "../db.js";
import { MSG } from "../rules.js";
import { isId, BUYERS, fail, getSettings, auth, roles } from "../helpers.js";

export default function registerDesignsRoutes(app) {
  /* ─── Kayıtlı yerleşimler (FR-032, BR-022, VAL-020) ─── */
  const ownDesign = (req) =>
    isId(req.params.id)
      ? Design.findOne({ _id: req.params.id, user: req.currentUser._id })
      : null;
  app.get("/api/designs", auth, async (req, res) =>
    res.json(
      await Design.find({ user: req.currentUser._id }).sort({ createdAt: -1 }),
    ),
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
      buf
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
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
      if (
        !["image/jpeg", "image/png"].includes(declared) ||
        !type ||
        type !== declared
      )
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
    const photo = await DesignPhoto.findOne({
      _id: d.photoRef,
      user: req.currentUser._id,
    });
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
}
