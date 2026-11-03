// Sepet: ürün ekleme, adet değiştirme, çıkarma
import { Product } from "../db.js";
import { MSG } from "../rules.js";
import {
  isId,
  BUYERS,
  fail,
  trackEvent,
  auth,
  roles,
  loadCart,
  cartView,
  checkLine,
} from "../helpers.js";

export default function registerCartRoutes(app) {
  app.get("/api/cart", auth, roles(...BUYERS), async (req, res) =>
    res.json(
      await cartView(await loadCart(req.currentUser._id), req.query.coupon),
    ),
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
}
