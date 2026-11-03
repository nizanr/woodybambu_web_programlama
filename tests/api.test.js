// API entegrasyon testleri. Test adlarındaki TC-xx kimlikleri SRS 6.
// bölümündeki fonksiyonel test senaryolarına karşılık gelir.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { createApp, seed, migrate } from "../server/app.js";
import {
  User,
  Product,
  Category,
  Order,
  Event,
  AuditLog,
  Payment,
  Setting,
  DesignPhoto,
} from "../server/db.js";
import {
  MSG,
  priceSummary,
  DEFAULT_SETTINGS,
  zonedDayStart,
} from "../server/rules.js";
import { testUri, stopMemory } from "./helpers/mongo.js";

let uri, app, user, other, manager, admin, guest, p, chairs, order;
const PASS = "TestPass123!";
const ADDRESS = "Test sokak 12, Kadıköy/İstanbul";
const login = (agent, email) =>
  agent.post("/api/auth/login").send({ email, password: PASS }).expect(200);
const checkout = (agent, extra = {}) =>
  agent
    .post("/api/orders")
    .send({ address: ADDRESS, acceptTerms: true, ...extra });
const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  uri = await testUri("bahceni_test");
  await mongoose.connect(uri);
  await seed();
  await migrate();
  await Product.deleteMany({});
  app = createApp(uri);
  [user, other, manager, admin, guest] = Array.from({ length: 5 }, () =>
    request.agent(app),
  );
  chairs = await Category.findOne({ name: "Sandalyeler" });
  p = await Product.create({
    name: "Test sandalye",
    category: chairs.name,
    categoryId: chairs._id,
    price: 120,
    stock: 10,
    image: "https://example.com/image.jpg",
    model3dUrl: "builtin:chair",
  });
  for (const [email, role, agent] of [
    ["manager@test.dev", "manager", manager],
    ["admin@test.dev", "admin", admin],
  ]) {
    await User.create({
      name: role,
      email,
      password: await bcrypt.hash(PASS, 4),
      role,
    });
    await login(agent, email);
  }
  // Varsayılan kargo/eşik testleri öngörülebilir kılmak için sabitlenir.
  await admin
    .put("/api/admin/settings")
    .send({ commerce: { shippingFee: 30, freeShipThreshold: 0 } })
    .expect(200);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await app.locals.sessionStore.close();
  await stopMemory();
});

/* ─── Üyelik ve oturum ─── */
test("VAL-001: invalid e-mail rejected with SRS message", async () => {
  const r = await user
    .post("/api/auth/register")
    .send({ name: "A", email: "not-mail", password: PASS })
    .expect(400);
  assert.equal(r.body.error, MSG.VAL001);
});
test("weak registration rejected", async () => {
  await user
    .post("/api/auth/register")
    .send({ name: "A", email: "u@test.dev", password: "123" })
    .expect(400);
});
test("registration ignores injected role and creates customer", async () => {
  const r = await user
    .post("/api/auth/register")
    .send({ name: "User", email: "u@test.dev", password: PASS, role: "admin" })
    .expect(200);
  assert.equal(r.body.role, "customer");
});
test("TC-03: duplicate e-mail rejected (VAL-002)", async () => {
  const r = await request(app)
    .post("/api/auth/register")
    .send({ name: "U", email: "U@test.dev", password: PASS })
    .expect(409);
  assert.equal(r.body.error, MSG.VAL002);
});
test("wrong password rejected", async () => {
  await request(app)
    .post("/api/auth/login")
    .send({ email: "u@test.dev", password: "wrongpassword" })
    .expect(401);
});
test("session identifies current user", async () => {
  const r = await user.get("/api/me").expect(200);
  assert.equal(r.body.email, "u@test.dev");
  await other
    .post("/api/auth/register")
    .send({ name: "Other", email: "other@test.dev", password: PASS })
    .expect(200);
});

/* ─── Katalog ─── */
test("TC-01: catalog filters published products by category and search", async () => {
  const tables = await Category.findOne({ name: "Masalar" });
  await Product.create([
    {
      name: "Yayında masa",
      category: tables.name,
      categoryId: tables._id,
      price: 500,
      stock: 2,
      image: "/images/product-table.png",
    },
    {
      name: "Taslak masa",
      category: tables.name,
      categoryId: tables._id,
      price: 500,
      stock: 2,
      image: "/images/product-table.png",
      status: "draft",
    },
    {
      name: "Pasif masa",
      category: tables.name,
      categoryId: tables._id,
      price: 500,
      stock: 2,
      image: "/images/product-table.png",
      status: "inactive",
    },
  ]);
  const r = await request(app)
    .get("/api/products?category=Masalar")
    .expect(200);
  assert.deepEqual(
    r.body.map((x) => x.name),
    ["Yayında masa"],
  );
  const s = await request(app).get("/api/products?q=sandal").expect(200);
  assert.deepEqual(
    s.body.map((x) => x.name),
    ["Test sandalye"],
  );
  const all = await request(app).get("/api/products").expect(200);
  assert.ok(all.body.every((x) => x.isActive));
});
test("TC-02: inactive product detail is visible but cannot be added to cart", async () => {
  const passive = await Product.findOne({ name: "Pasif masa" });
  const d = await request(app)
    .get("/api/products/" + passive.id)
    .expect(200);
  assert.equal(d.body.isActive, false);
  const draft = await Product.findOne({ name: "Taslak masa" });
  await request(app)
    .get("/api/products/" + draft.id)
    .expect(404);
  const r = await user
    .post("/api/cart/items")
    .send({ productId: passive.id })
    .expect(409);
  assert.equal(r.body.error, MSG.VAL004);
  const o = await user
    .post("/api/orders")
    .send({
      items: [{ id: passive.id, quantity: 1 }],
      address: ADDRESS,
      acceptTerms: true,
    })
    .expect(409);
  assert.equal(o.body.error, MSG.VAL004);
});

/* ─── Sepet ─── */
test("TC-04: add to cart validates stock on server", async () => {
  await user
    .post("/api/cart/items")
    .send({ productId: p.id, quantity: 2 })
    .expect(200);
  const r = await user.get("/api/cart").expect(200);
  assert.equal(r.body.items[0].quantity, 2);
  assert.equal(r.body.summary.subtotal, 240);
});
test("TC-05: quantity above stock rejected (VAL-003)", async () => {
  const r = await user
    .patch("/api/cart/items/" + p.id)
    .send({ quantity: 11 })
    .expect(400);
  assert.equal(r.body.error, MSG.VAL003);
  const o = await user
    .post("/api/orders")
    .send({
      items: [{ id: p.id, quantity: 11 }],
      address: ADDRESS,
      acceptTerms: true,
    })
    .expect(409);
  assert.equal(o.body.error, MSG.VAL003);
});
test("TC-06: BR-003 total = max(0, subtotal − discount) + shipping", () => {
  const s = priceSummary(
    [{ price: 120, quantity: 2 }],
    {
      ...DEFAULT_SETTINGS.commerce,
      shippingFee: 30,
      freeShipThreshold: 0,
      couponEnabled: true,
    },
    { code: "YIRMI", type: "fixed", value: 20, isActive: true },
  );
  assert.deepEqual(
    {
      subtotal: s.subtotal,
      discount: s.discount,
      shipping: s.shipping,
      total: s.total,
    },
    { subtotal: 240, discount: 20, shipping: 30, total: 250 },
  );
});
test("TC-06: coupon applied on server when enabled", async () => {
  await admin
    .put("/api/admin/settings")
    .send({ commerce: { couponEnabled: true } })
    .expect(200);
  await admin
    .post("/api/admin/coupons")
    .send({ code: "yirmi", type: "fixed", value: 20 })
    .expect(200);
  const r = await user.get("/api/cart?coupon=YIRMI").expect(200);
  assert.deepEqual(
    [
      r.body.summary.subtotal,
      r.body.summary.discount,
      r.body.summary.shipping,
      r.body.summary.total,
    ],
    [240, 20, 30, 250],
  );
  await admin
    .put("/api/admin/settings")
    .send({ commerce: { couponEnabled: false } })
    .expect(200);
});
test("TC-07: removing last line empties cart", async () => {
  const r = await other
    .post("/api/cart/items")
    .send({ productId: p.id })
    .expect(200);
  assert.equal(r.body.items.length, 1);
  const e = await other.delete("/api/cart/items/" + p.id).expect(200);
  assert.equal(e.body.items.length, 0);
  assert.equal(e.body.summary.total, 0);
});
test("manager cannot use cart or place orders (authorization matrix)", async () => {
  await manager.post("/api/cart/items").send({ productId: p.id }).expect(403);
  await checkout(manager).expect(403);
});

/* ─── Adresler ─── */
test("FR-008: addresses are owner-scoped", async () => {
  const a = await user
    .post("/api/addresses")
    .send({
      title: "Ev",
      fullName: "Test Kullanıcı",
      city: "İstanbul",
      district: "Kadıköy",
      line: "Moda cad. No: 12 D: 3",
    })
    .expect(200);
  await other
    .patch("/api/addresses/" + a.body._id)
    .send({ city: "Ankara" })
    .expect(404);
  await other.delete("/api/addresses/" + a.body._id).expect(404);
  assert.equal((await user.get("/api/addresses")).body.length, 1);
  const bad = await user
    .post("/api/addresses")
    .send({ fullName: "X" })
    .expect(400);
  assert.equal(bad.body.error, MSG.VAL005);
});

/* ─── Sipariş ve ödeme ─── */
test("VAL-005 / TC-21 (VAL-006): address and agreement required", async () => {
  const a = await user
    .post("/api/orders")
    .send({ acceptTerms: true })
    .expect(400);
  assert.equal(a.body.error, MSG.VAL005);
  const t = await user
    .post("/api/orders")
    .send({ address: ADDRESS })
    .expect(400);
  assert.equal(t.body.error, MSG.VAL006);
});
test("BR-002: server computes price from cart; client total ignored, stock untouched until payment", async () => {
  const r = await checkout(user, { total: 1 }).expect(200);
  order = r.body.order;
  assert.equal(order.subtotal, 240);
  assert.equal(order.shipping, 30);
  assert.equal(order.total, 270);
  assert.equal(order.status, "pending");
  assert.equal((await Product.findById(p.id)).stock, 10);
});
test("TC-08: other member cannot read or pay someone else's order", async () => {
  await other.get("/api/orders/" + order._id).expect(404);
  await other.post("/api/orders/" + order._id + "/pay").expect(404);
  assert.equal((await other.get("/api/orders")).body.length, 0);
  await user.get("/api/orders/" + order._id).expect(200);
});
test("pending order cannot ship (BR-009)", async () => {
  const r = await manager
    .patch("/api/admin/orders/" + order._id)
    .send({ status: "shipped" })
    .expect(400);
  assert.equal(r.body.error, MSG.VAL014);
});
test("TC-10: repeated payment confirmation creates one sale and one stock movement", async () => {
  const results = await Promise.all([
    user.post("/api/orders/" + order._id + "/pay"),
    user.post("/api/orders/" + order._id + "/pay"),
  ]);
  assert.ok(results.every((r) => [200].includes(r.status)));
  await user.post("/api/orders/" + order._id + "/pay").expect(200);
  assert.equal((await Order.findById(order._id)).status, "demo_paid");
  assert.equal((await Product.findById(p.id)).stock, 8);
  assert.equal(
    await Payment.countDocuments({ orderId: order._id, status: "success" }),
    1,
  );
  assert.equal((await user.get("/api/cart")).body.items.length, 0);
});
test("payment success produces member and staff notifications", async () => {
  const mine = await user.get("/api/notifications").expect(200);
  assert.ok(mine.body.some((n) => n.type === "payment_success"));
  const staff = await manager.get("/api/notifications").expect(200);
  assert.ok(staff.body.some((n) => n.type === "order_created"));
  assert.ok(!(await other.get("/api/notifications")).body.length);
});
test("TC-13: order status cannot skip steps (VAL-014)", async () => {
  const r = await manager
    .patch("/api/admin/orders/" + order._id)
    .send({ status: "delivered" })
    .expect(400);
  assert.equal(r.body.error, MSG.VAL014);
  for (const status of ["preparing", "shipped", "delivered"])
    await manager
      .patch("/api/admin/orders/" + order._id)
      .send({ status })
      .expect(200);
  await manager
    .patch("/api/admin/orders/" + order._id)
    .send({ status: "preparing" })
    .expect(400);
  const logs = await AuditLog.find({
    eventType: "order_status",
    targetId: order._id,
    result: "ok",
  });
  assert.equal(logs.length, 3);
  assert.ok(logs.every((l) => l.actorId && l.occurredAt));
});
test("paid order cannot be cancelled", async () => {
  await user.post("/api/orders/" + order._id + "/cancel").expect(409);
});
test("cancelled order cannot be marked paid", async () => {
  await user.post("/api/cart/items").send({ productId: p.id }).expect(200);
  const r = await checkout(user).expect(200);
  await user.post("/api/orders/" + r.body.order._id + "/cancel").expect(200);
  await user.post("/api/orders/" + r.body.order._id + "/cancel").expect(409);
  await user.post("/api/orders/" + r.body.order._id + "/pay").expect(409);
  assert.equal((await Product.findById(p.id)).stock, 8);
  await user.delete("/api/cart/items/" + p.id).expect(200);
});
test("TC-12: concurrent payments for the last unit sell at most once", async () => {
  const last = await Product.create({
    name: "Son ürün",
    category: chairs.name,
    categoryId: chairs._id,
    price: 100,
    stock: 1,
    image: "/images/product-chair.png",
  });
  const payload = {
    items: [{ id: last.id, quantity: 1 }],
    address: ADDRESS,
    acceptTerms: true,
  };
  const [a, b] = await Promise.all([
    user.post("/api/orders").send(payload).expect(200),
    other.post("/api/orders").send(payload).expect(200),
  ]);
  const paid = await Promise.all([
    user.post("/api/orders/" + a.body.order._id + "/pay"),
    other.post("/api/orders/" + b.body.order._id + "/pay"),
  ]);
  assert.deepEqual(paid.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await Product.findById(last.id)).stock, 0);
  // Stok bittikten sonra ödeme başlatma engellenir (FR-017).
  const blocked = await checkout(user, {
    items: [{ id: last.id, quantity: 1 }],
  }).expect(409);
  assert.equal(blocked.body.error, MSG.VAL004);
});
test("TC-09 / TC-11: iyzico result verified on server; failure and spoofed return never mark paid", async () => {
  process.env.APP_URL = "https://test.example";
  let result = {
    status: "success",
    paymentStatus: "FAILURE",
    paidPrice: "150",
  };
  const client = {
    checkoutForm: {
      initialize: (body, cb) =>
        cb(null, {
          status: "success",
          token: "tok-" + body.basketId,
          paymentPageUrl: "https://sandbox-api.iyzipay.com/test",
        }),
      retrieve: (body, cb) =>
        cb(null, { ...result, paymentId: "pay-" + body.conversationId }),
    },
  };
  const a = createApp(uri, { paymentClient: client });
  const agent = request.agent(a);
  try {
    await login(agent, "u@test.dev");
    const stock = (await Product.findById(p.id)).stock;
    const r = await agent
      .post("/api/orders")
      .send({
        items: [{ id: p.id, quantity: 1 }],
        address: ADDRESS,
        acceptTerms: true,
      })
      .expect(200);
    assert.equal(r.body.order.paymentMode, "iyzico");
    assert.equal(r.body.order.total, 150);
    assert.ok(r.body.url.startsWith("https://"));
    const failed = await agent
      .post("/api/orders/" + r.body.order._id + "/pay")
      .expect(409);
    assert.equal(failed.body.error, MSG.VAL007);
    // TC-09: dönüş adresi taklit edilir, sağlayıcı onayı yok.
    result = { status: "success", paymentStatus: "PENDING", paidPrice: "150" };
    await request(a)
      .post("/api/payment/callback")
      .type("form")
      .send({ token: "tok-" + r.body.order._id })
      .expect(302);
    assert.equal((await Order.findById(r.body.order._id)).status, "pending");
    assert.equal((await Product.findById(p.id)).stock, stock);
    result = { status: "success", paymentStatus: "SUCCESS", paidPrice: "1" };
    const mismatch = await agent
      .post("/api/orders/" + r.body.order._id + "/pay")
      .expect(409);
    assert.equal(mismatch.body.error, MSG.VAL008);
    result = { status: "success", paymentStatus: "SUCCESS", paidPrice: "150" };
    await request(a)
      .post("/api/payment/callback")
      .type("form")
      .send({ token: "tok-" + r.body.order._id })
      .expect(302);
    await request(a)
      .post("/api/payment/callback")
      .type("form")
      .send({ token: "tok-" + r.body.order._id })
      .expect(302);
    const paid = await agent
      .post("/api/orders/" + r.body.order._id + "/pay")
      .expect(200);
    assert.equal(paid.body.status, "paid");
    assert.equal((await Product.findById(p.id)).stock, stock - 1);
  } finally {
    await a.locals.sessionStore.close();
    delete process.env.APP_URL;
  }
});
test("FR-026: iyzico initialization failure leaves stock untouched", async () => {
  process.env.APP_URL = "https://test.example";
  const stock = (await Product.findById(p.id)).stock;
  const a = createApp(uri, {
    paymentClient: {
      checkoutForm: {
        initialize: (body, cb) =>
          cb(null, { status: "failure", errorMessage: "Sandbox unavailable" }),
      },
    },
  });
  try {
    const agent = request.agent(a);
    await login(agent, "u@test.dev");
    await agent
      .post("/api/orders")
      .send({
        items: [{ id: p.id, quantity: 1 }],
        address: ADDRESS,
        acceptTerms: true,
      })
      .expect(503);
    assert.equal((await Product.findById(p.id)).stock, stock);
  } finally {
    await a.locals.sessionStore.close();
    delete process.env.APP_URL;
  }
});

/* ─── Yönetim ─── */
test("TC-14: negative price/stock rejected (VAL-009)", async () => {
  const r = await manager
    .post("/api/admin/products")
    .send({
      name: "Bozuk",
      categoryId: chairs.id,
      price: -5,
      stock: -1,
      image: "/images/product-chair.png",
    })
    .expect(400);
  assert.equal(r.body.error, MSG.VAL009);
});
test("VAL-013: duplicate product or invalid 3D model reference rejected", async () => {
  await manager
    .post("/api/admin/products")
    .send({
      name: "test SANDALYE",
      categoryId: chairs.id,
      price: 5,
      stock: 1,
      image: "/images/product-chair.png",
    })
    .expect(400);
  await manager
    .post("/api/admin/products")
    .send({
      name: "Model",
      categoryId: chairs.id,
      price: 5,
      stock: 1,
      image: "/images/product-chair.png",
      model3dUrl: "javascript:alert(1)",
    })
    .expect(400);
  const ok = await manager
    .post("/api/admin/products")
    .send({
      name: "GLB sandalye",
      categoryId: chairs.id,
      price: 5,
      stock: 1,
      image: "/images/product-chair.png",
      model3dUrl: "https://cdn.example.com/chair.glb",
    })
    .expect(200);
  assert.equal(ok.body.category, "Sandalyeler");
});
test("FR-016: manager manages categories", async () => {
  const c = await manager
    .post("/api/admin/categories")
    .send({ name: "Saksılar" })
    .expect(200);
  await manager
    .post("/api/admin/categories")
    .send({ name: "Saksılar" })
    .expect(400);
  await manager
    .patch("/api/admin/categories/" + c.body._id)
    .send({ isActive: false })
    .expect(200);
  const list = await request(app).get("/api/categories").expect(200);
  assert.ok(!list.body.some((x) => x.name === "Saksılar"));
  await user.post("/api/admin/categories").send({ name: "X" }).expect(403);
});
test("TC-20: price change audited; old order keeps its price", async () => {
  await manager
    .patch("/api/admin/products/" + p.id)
    .send({ price: 150 })
    .expect(200);
  const r = await request(app)
    .get("/api/products/" + p.id)
    .expect(200);
  assert.equal(r.body.price, 150);
  assert.equal((await Order.findById(order._id)).items[0].price, 120);
  const log = await AuditLog.findOne({
    eventType: "stock_price_change",
    targetId: p.id,
  });
  assert.deepEqual([log.before.price, log.after.price], [120, 150]);
  await manager
    .patch("/api/admin/products/" + p.id)
    .send({ price: 120 })
    .expect(200);
});
test("TC-15: member cannot reach admin parameter API (VAL-010)", async () => {
  const r = await user.get("/api/admin/settings").expect(403);
  assert.equal(r.body.error, MSG.VAL010);
  await manager
    .put("/api/admin/settings")
    .send({ commerce: { pageSize: 4 } })
    .expect(403);
  await request(app).get("/api/admin").expect(401);
  await user.get("/api/admin").expect(403);
  assert.ok(await AuditLog.exists({ eventType: "unauthorized_access" }));
});
test("FR-018: only admin changes roles; own role locked", async () => {
  const u = await User.findOne({ email: "other@test.dev" });
  await manager
    .patch("/api/admin/users/" + u.id)
    .send({ role: "manager" })
    .expect(403);
  await admin
    .patch("/api/admin/users/" + u.id)
    .send({ role: "superadmin" })
    .expect(400);
  await admin
    .patch("/api/admin/users/" + u.id)
    .send({ role: "manager" })
    .expect(200);
  await admin
    .patch("/api/admin/users/" + u.id)
    .send({ role: "customer" })
    .expect(200);
  const s = await User.findOne({ email: "admin@test.dev" });
  await admin
    .patch("/api/admin/users/" + s.id)
    .send({ role: "customer" })
    .expect(400);
  assert.equal(await AuditLog.countDocuments({ eventType: "role_update" }), 2);
});
test("TC-22 / BR-T02: new shipping fee applies to new orders only, logged with before/after", async () => {
  const paidBefore = (await Order.findById(order._id)).total;
  await admin
    .put("/api/admin/settings")
    .send({ commerce: { shippingFee: 45.5 } })
    .expect(200);
  await user.post("/api/cart/items").send({ productId: p.id }).expect(200);
  const r = await user.get("/api/cart").expect(200);
  assert.equal(r.body.summary.shipping, 45.5);
  assert.equal(r.body.summary.total, 165.5);
  assert.equal((await Order.findById(order._id)).total, paidBefore);
  const log = await AuditLog.findOne({ eventType: "settings_update" }).sort({
    occurredAt: -1,
  });
  assert.equal(log.before.commerce.shippingFee, 30);
  assert.equal(log.after.commerce.shippingFee, 45.5);
  await user.delete("/api/cart/items/" + p.id).expect(200);
});
test("chk_inventory_gate cannot be disabled; invalid parameters rejected", async () => {
  const r = await admin
    .put("/api/admin/settings")
    .send({ commerce: { inventoryGate: false } })
    .expect(400);
  assert.deepEqual(r.body.fields, ["commerce.inventoryGate"]);
  await admin
    .put("/api/admin/settings")
    .send({ analytics: { reportTimezone: "Mars/Base" } })
    .expect(400);
});

/* ─── Analitik ve raporlar ─── */
test("VAL-015: events are not recorded without consent", async () => {
  const before = await Event.countDocuments();
  const r = await guest
    .post("/api/events")
    .send({ eventType: "product_view", productId: p.id })
    .expect(202);
  assert.equal(r.body.recorded, false);
  assert.equal(await Event.countDocuments(), before);
  await guest
    .post("/api/events")
    .send({ eventType: "purchase", productId: p.id })
    .expect(400);
});
test("TC-16: three consented product_view events are counted", async () => {
  await guest.post("/api/consent").send({ analytics: true }).expect(200);
  for (let i = 0; i < 3; i++)
    await guest
      .post("/api/events")
      .send({ eventType: "product_view", productId: p.id })
      .expect(201);
  // Aynı eventId tekrar işlenmez (NFR-10).
  await guest
    .post("/api/events")
    .send({ eventType: "product_view", productId: p.id, eventId: "dup-1" })
    .expect(201);
  await guest
    .post("/api/events")
    .send({ eventType: "product_view", productId: p.id, eventId: "dup-1" })
    .expect(202);
  const r = await manager
    .get(`/api/reports/summary?from=${today()}&to=${today()}`)
    .expect(200);
  const row = r.body.products.find((x) => x.productId === p.id);
  assert.equal(row.views, 4);
  assert.ok(r.body.lastUpdated);
  const ev = await Event.findOne({ eventType: "product_view" }).lean();
  for (const k of [
    "eventId",
    "eventType",
    "sessionId",
    "occurredAt",
    "consentState",
  ])
    assert.ok(ev[k], k);
});
test("TC-17: abandonment rate uses unique checkout sessions within 24h window", async () => {
  await Event.deleteMany({});
  const day = "2026-03-10";
  const base = zonedDayStart(day, "Europe/Istanbul").getTime() + 10 * 3600000;
  const docs = [];
  for (let i = 0; i < 10; i++) {
    docs.push({
      eventId: "c" + i,
      eventType: "checkout_start",
      sessionId: "s" + i,
      consentState: "granted",
      occurredAt: new Date(base + i * 60000),
    });
    if (i < 4)
      docs.push({
        eventId: "p" + i,
        eventType: "purchase",
        sessionId: "s" + i,
        consentState: "granted",
        occurredAt: new Date(base + i * 60000 + (i === 3 ? 23 : 1) * 3600000),
      });
  }
  // Pencere dışındaki satın alma sayılmaz.
  docs.push({
    eventId: "late",
    eventType: "purchase",
    sessionId: "s9",
    consentState: "granted",
    occurredAt: new Date(base + 30 * 3600000),
  });
  await Event.insertMany(docs);
  const r = await manager
    .get(`/api/reports/summary?from=${day}&to=${day}`)
    .expect(200);
  assert.equal(r.body.kpis.checkoutSessions, 10);
  assert.equal(r.body.kpis.abandonmentRate, 60);
  const empty = await manager
    .get("/api/reports/summary?from=2020-01-01&to=2020-01-01")
    .expect(200);
  assert.equal(empty.body.kpis.abandonmentRate, null); // arayüzde "Veri yok"
});
test("TC-18 / VAL-012: report date validation", async () => {
  const r = await manager
    .get("/api/reports/summary?from=2026-03-11&to=2026-03-10")
    .expect(400);
  assert.equal(r.body.error, MSG.VAL011);
  const e = await manager.get("/api/reports/summary").expect(400);
  assert.equal(e.body.error, MSG.VAL012);
});
test("TC-19: member cannot read business dashboard", async () => {
  await user
    .get(`/api/reports/summary?from=${today()}&to=${today()}`)
    .expect(403);
});
test("FR-025: CSV export contains aggregates only", async () => {
  const r = await manager
    .get("/api/reports/summary.csv?from=2026-03-10&to=2026-03-10")
    .expect(200);
  assert.match(r.headers["content-type"], /text\/csv/);
  assert.match(r.text, /Sepet terk oranı %;60/);
  assert.doesNotMatch(r.text, /@test\.dev|sessionId|s1;/);
});

/* ─── 3D önizleme ve yerleşim ─── */
test("TC-31: visitors can preview; saving a placement requires an account (VAL-019)", async () => {
  const pub = await request(app)
    .get("/api/preview/" + p.id)
    .expect(200);
  assert.equal(pub.body.model3dUrl, "builtin:chair");
  const r = await request(app)
    .post("/api/designs")
    .send({
      name: "Misafir",
      productId: p.id,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    })
    .expect(401);
  assert.equal(r.body.error, MSG.VAL019);
  await request(app)
    .post("/api/cart/items")
    .send({ productId: p.id })
    .expect(401);
  const ok = await user.get("/api/preview/" + p.id).expect(200);
  assert.equal(ok.body.model3dUrl, "builtin:chair");
});
test("TC-26: product without 3D model has no preview (VAL-018)", async () => {
  const noModel = await Product.findOne({ name: "Yayında masa" });
  const r = await user.get("/api/preview/" + noModel.id).expect(404);
  assert.equal(r.body.error, MSG.VAL018);
  await admin
    .put("/api/admin/settings")
    .send({ preview: { enabled: false } })
    .expect(200);
  await user.get("/api/preview/" + p.id).expect(404);
  await admin
    .put("/api/admin/settings")
    .send({ preview: { enabled: true } })
    .expect(200);
});
test("TC-27: add to cart from preview follows same stock rules", async () => {
  const empty = await Product.findOne({ name: "Son ürün" });
  const r = await user
    .post("/api/cart/items")
    .send({ productId: empty.id })
    .expect(409);
  assert.equal(r.body.error, MSG.VAL004);
});
let design;
test("TC-28: saved placement visible only to owner (VAL-020)", async () => {
  const d = await user
    .post("/api/designs")
    .send({
      name: "Bahçem",
      productId: p.id,
      x: 0,
      y: 1,
      scale: 1,
      rotation: 90,
    })
    .expect(200);
  design = d.body;
  assert.equal((await user.get("/api/designs")).body.length, 1);
  assert.equal((await other.get("/api/designs")).body.length, 0);
  await other.get("/api/designs/" + design._id).expect(404);
  await other.delete("/api/designs/" + design._id).expect(404);
  await user.get("/api/designs/" + design._id).expect(200);
});
test("invalid placement transform rejected", async () => {
  await user
    .post("/api/designs")
    .send({ name: "Bad", productId: p.id, x: 0, y: 0, scale: 20, rotation: 0 })
    .expect(400);
  await user
    .post("/api/designs")
    .send({ name: "Bad", productId: p.id, x: 999, y: 0, scale: 1, rotation: 0 })
    .expect(400);
});
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
test("TC-23 / TC-24: garden photo stored only on request; type and size checked on server", async () => {
  const pdf = await user
    .put(`/api/designs/${design._id}/photo`)
    .set("Content-Type", "application/pdf")
    .send(Buffer.from("%PDF-1.4"))
    .expect(415);
  assert.equal(pdf.body.error, MSG.VAL016);
  // Uzantısı/MIME'ı PNG gösterilen ama içeriği PNG olmayan dosya.
  await user
    .put(`/api/designs/${design._id}/photo`)
    .set("Content-Type", "image/png")
    .send(Buffer.from("<script>alert(1)</script>"))
    .expect(415);
  await admin
    .put("/api/admin/settings")
    .send({ preview: { maxPhotoMb: 1 } })
    .expect(200);
  const big = await user
    .put(`/api/designs/${design._id}/photo`)
    .set("Content-Type", "image/png")
    .send(Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))
    .expect(413);
  assert.equal(big.body.error, MSG.VAL017);
  await admin
    .put("/api/admin/settings")
    .send({ preview: { maxPhotoMb: 8 } })
    .expect(200);
  await user
    .put(`/api/designs/${design._id}/photo`)
    .set("Content-Type", "image/png")
    .send(PNG)
    .expect(200);
  const got = await user.get(`/api/designs/${design._id}/photo`).expect(200);
  assert.equal(got.headers["content-type"], "image/png");
  assert.equal(got.headers["x-content-type-options"], "nosniff");
  await other.get(`/api/designs/${design._id}/photo`).expect(404);
});
test("TC-30: garden photo never reaches events or audit logs", async () => {
  const marker = PNG.toString("base64").slice(0, 16);
  const events = JSON.stringify(await Event.find().lean());
  const logs = JSON.stringify(await AuditLog.find().lean());
  for (const text of [events, logs]) {
    assert.doesNotMatch(text, /photoRef|image\/png|image\/jpeg/);
    assert.ok(!text.includes(marker));
  }
  await user.delete("/api/designs/" + design._id).expect(200);
  assert.equal(await DesignPhoto.countDocuments({ designId: design._id }), 0);
});
test("saving placement can be switched off by parameter", async () => {
  await admin
    .put("/api/admin/settings")
    .send({ preview: { saveLayoutEnabled: false } })
    .expect(200);
  await user
    .post("/api/designs")
    .send({
      name: "Kapalı",
      productId: p.id,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    })
    .expect(403);
  await admin
    .put("/api/admin/settings")
    .send({ preview: { saveLayoutEnabled: true } })
    .expect(200);
});

/* ─── Güvenlik ve altyapı ─── */
test("cross-origin mutation rejected", async () => {
  await user
    .post("/api/orders")
    .set("Origin", "https://evil.example")
    .send({})
    .expect(403);
});
test("logout invalidates session", async () => {
  await user.post("/api/logout").expect(200);
  await user.get("/api/orders").expect(401);
  await login(user, "u@test.dev");
});
test("migration maps legacy roles once and links categories", async () => {
  await Setting.updateOne({ key: "global" }, { $unset: { schemaVersion: 1 } });
  await User.collection.insertMany([
    { name: "L1", email: "legacy-user@test.dev", role: "user" },
    { name: "L2", email: "legacy-admin@test.dev", role: "admin" },
    { name: "L3", email: "legacy-super@test.dev", role: "superadmin" },
  ]);
  await User.collection.updateOne(
    { email: "admin@test.dev" },
    { $set: { role: "superadmin" } },
  );
  await User.collection.updateOne(
    { email: "manager@test.dev" },
    { $set: { role: "admin" } },
  );
  await Product.collection.insertOne({
    name: "Eski ürün",
    category: "Şezlonglar",
    price: 1,
    stock: 1,
    image: "/images/product-lounger.png",
  });
  await migrate();
  await migrate();
  const role = async (email) => (await User.findOne({ email })).role;
  assert.equal(await role("legacy-user@test.dev"), "customer");
  assert.equal(await role("legacy-admin@test.dev"), "manager");
  assert.equal(await role("legacy-super@test.dev"), "admin");
  assert.equal(await role("admin@test.dev"), "admin");
  const old = await Product.findOne({ name: "Eski ürün" });
  assert.equal(old.status, "published");
  assert.equal(old.model3dUrl, "builtin:lounger");
  assert.ok(old.categoryId);
});
test("database health endpoint reports readiness", async () => {
  const r = await request(app).get("/api/health").expect(200);
  assert.equal(r.body.ok, true);
});
test("production requires strong session secret", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };
  try {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "short";
    assert.throws(() => createApp(uri), /32 characters/);
  } finally {
    for (const [name, value] of Object.entries(previous))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});
test("production behind HTTPS proxy accepts Render origin and sets secure cookie", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    SESSION_SECRET: process.env.SESSION_SECRET,
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
  };
  let a;
  try {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a".repeat(64);
    process.env.RENDER_EXTERNAL_URL = "https://test.onrender.com";
    a = createApp(uri);
    const r = await request(a)
      .post("/api/auth/login")
      .set("X-Forwarded-Proto", "https")
      .set("Origin", "https://test.onrender.com")
      .send({ email: "u@test.dev", password: PASS })
      .expect(200);
    assert.match(r.headers["set-cookie"][0], /; Secure/);
    assert.match(r.headers["set-cookie"][0], /; HttpOnly/);
    await request(a)
      .post("/api/auth/login")
      .set("X-Forwarded-Proto", "https")
      .set("Origin", "https://evil.example")
      .send({ email: "u@test.dev", password: PASS })
      .expect(403);
  } finally {
    await a?.locals.sessionStore.close();
    for (const [name, value] of Object.entries(previous))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});
