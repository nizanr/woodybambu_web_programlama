// Üyenin kayıtlı teslimat adresleri
import { MSG } from "../rules.js";
import { fail, auth, cleanAddress } from "../helpers.js";

export default function registerAddressesRoutes(app) {
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
}
