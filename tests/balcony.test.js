// FR-034 / BR-025 — balkon önerisi saf fonksiyon testleri (veritabanı gerekmez).
import { test } from "node:test";
import assert from "node:assert/strict";
import { recommend, place, sizeOf, validBalcony, WALKWAY_CM } from "../server/balcony.js";

const P = [
  { _id: 1, name: "Kanepe", price: 24990, stock: 12, model3dUrl: "builtin:sofa" },
  { _id: 2, name: "Sandalye", price: 3490, stock: 28, model3dUrl: "builtin:chair" },
  { _id: 3, name: "Masa", price: 8990, stock: 8, model3dUrl: "builtin:table" },
  { _id: 4, name: "Şezlong", price: 6490, stock: 1, model3dUrl: "builtin:lounger" },
];

test("balcony size validation (VAL-021)", () => {
  assert.equal(validBalcony(300, 120), true);
  assert.equal(validBalcony(49, 120), false);
  assert.equal(validBalcony(300, 2001), false);
  assert.equal(validBalcony(300.5, 120), false);
  assert.equal(validBalcony(NaN, 120), false);
});

test("placement keeps a walkway and rotates when needed", () => {
  assert.equal(place(200, 85, 150, 120), null);
  const p = place(70, 195, 300, 120);
  assert.equal(p.rotated, true);
  assert.ok(p.w <= 300 && p.d <= 120);
  const q = place(58, 60, 100, 200);
  assert.ok(q.d + WALKWAY_CM <= 200 || q.w + WALKWAY_CM <= 100);
});

test("sizes fall back to the model type", () => {
  assert.deepEqual(sizeOf({ widthCm: 90, depthCm: 50 }), { w: 90, d: 50, h: null });
  assert.equal(sizeOf({ model3dUrl: "builtin:chair" }).w, 58);
  assert.equal(sizeOf({ model3dUrl: "", category: "Bilinmeyen" }), null);
});

test("small balcony gets only what fits; sets respect stock", () => {
  const small = recommend(P, 150, 100);
  assert.deepEqual(small.items.map((i) => i.product.name), ["Sandalye"]);
  assert.equal(small.sets.length, 0);
  const big = recommend(P, 600, 350);
  const titles = big.sets.map((s) => s.title);
  assert.ok(titles.includes("Masa ve 4 sandalye"));
  // Yalnızca 1 şezlong stokta: ikili şezlong takımı önerilmez.
  assert.ok(!titles.includes("İki şezlong yan yana"));
  const set = big.sets.find((s) => s.title === "Masa ve 4 sandalye");
  assert.equal(set.total, 8990 + 4 * 3490);
  for (const s of big.sets) assert.ok(s.fit.w <= 600 && s.fit.d <= 350);
});
