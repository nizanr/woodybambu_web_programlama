/* FR-034 / BR-025 — balkon ölçüsüne göre mobilya önerisi.
   Saf fonksiyonlar: veritabanına dokunmaz, birim testleriyle denetlenir.
   Tüm ölçüler santimetre (cm). Balkon "en" (duvar boyunca) × "derinlik"
   (duvardan korkuluğa) olarak alınır. */

export const BALCONY_MIN_CM = 50;
export const BALCONY_MAX_CM = 2000;
// En az bir kenarda insanın rahat geçebileceği yürüme payı.
export const WALKWAY_CM = 60;

/* Ölçüsü girilmemiş ürünler için türe göre varsayılan ölçüler (en × derinlik × yükseklik). */
export const DEFAULT_SIZES = {
  chair: { w: 58, d: 60, h: 85 },
  sofa: { w: 200, d: 85, h: 80 },
  table: { w: 180, d: 90, h: 75 },
  lounger: { w: 70, d: 195, h: 85 },
};
const CATEGORY_KINDS = {
  "Oturma Grupları": "sofa",
  Sandalyeler: "chair",
  Masalar: "table",
  Şezlonglar: "lounger",
};

// Plan çiziminde parça harfleri: Masa, Sandalye, Kanepe, Şezlong.
const LABELS = { table: "M", chair: "S", sofa: "K", lounger: "Ş" };

export const kindOf = (p) => {
  const m = typeof p.model3dUrl === "string" && p.model3dUrl.match(/^builtin:(\w+)$/);
  if (m && DEFAULT_SIZES[m[1]]) return m[1];
  return CATEGORY_KINDS[p.category] || null;
};
export const sizeOf = (p) => {
  if (Number.isFinite(p.widthCm) && Number.isFinite(p.depthCm) && p.widthCm > 0 && p.depthCm > 0)
    return { w: p.widthCm, d: p.depthCm, h: Number.isFinite(p.heightCm) ? p.heightCm : null };
  const k = kindOf(p);
  return k ? { ...DEFAULT_SIZES[k] } : null;
};

export const validBalcony = (width, depth) =>
  [width, depth].every(
    (v) => Number.isInteger(v) && v >= BALCONY_MIN_CM && v <= BALCONY_MAX_CM,
  );

/* Ürün ölçüsü doğrulaması (yönetici formu): boş bırakılabilir, girilirse 10–1000 cm tam sayı. */
export const validProductSize = (v) =>
  v === undefined || v === null || (Number.isInteger(v) && v >= 10 && v <= 1000);

/* Bir kaplama alanını (fw × fd) balkona yerleştirir. Mobilya korkuluk tarafına
   dayanır; yürüme payı ya duvar tarafında (derinlikten) ya da yanda (enden)
   kalır. Gerekirse 90° döndürülür. Sığmazsa null. */
export function place(fw, fd, W, D, walkway = WALKWAY_CM) {
  const tries = [
    { w: fw, d: fd, rotated: false },
    { w: fd, d: fw, rotated: true },
  ];
  for (const t of tries) {
    if (t.w <= W && t.d + walkway <= D)
      return { ...t, x: (W - t.w) / 2, y: D - t.d, walkway: "wall" };
    if (t.w + walkway <= W && t.d <= D)
      return { ...t, x: W - t.w, y: D - t.d, walkway: "side" };
  }
  return null;
}

/* Parça dikdörtgenlerini döndürülmüş yerleşime çevirir (x↔y). */
const orient = (rects, rotated) =>
  rotated ? rects.map((r) => ({ ...r, x: r.y, y: r.x, w: r.d, d: r.w })) : rects;

const lean = (p) => ({
  _id: String(p._id),
  name: p.name,
  price: p.price,
  stock: p.stock,
  image: p.image,
  color: p.color,
  category: p.category,
  model3dUrl: p.model3dUrl,
  isActive: p.isActive !== false,
});

/* Takım şablonları: parçaların yerleşimi (cm, kaplama alanının sol üstüne göre). */
function setLayouts(byKind) {
  const out = [];
  const tuck = 15; // sandalye masa altına bu kadar girer
  for (const t of byKind.table || [])
    for (const c of byKind.chair || []) {
      const T = t.size,
        C = c.size;
      // 2 sandalye masanın kısa uçlarında: dar balkonlar için.
      out.push({
        title: "Masa ve 2 sandalye",
        parts: [
          { p: t, qty: 1 },
          { p: c, qty: 2 },
        ],
        w: T.w + 2 * (C.d - tuck),
        d: Math.max(T.d, C.w),
        rects: [
          { label: "S", x: 0, y: (Math.max(T.d, C.w) - C.w) / 2, w: C.d, d: C.w },
          { label: "M", x: C.d - tuck, y: (Math.max(T.d, C.w) - T.d) / 2, w: T.w, d: T.d },
          { label: "S", x: C.d - tuck + T.w - tuck, y: (Math.max(T.d, C.w) - C.w) / 2, w: C.d, d: C.w },
        ],
      });
      // 4 veya 6 sandalye: uzun kenarların iki yanında.
      for (const k of [4, 6]) {
        const per = k / 2,
          rowW = per * C.w + (per - 1) * 10;
        const w = Math.max(T.w, rowW),
          d = T.d + 2 * (C.d - tuck);
        const rects = [{ label: "M", x: (w - T.w) / 2, y: C.d - tuck, w: T.w, d: T.d }];
        for (let i = 0; i < per; i++) {
          const x = (w - rowW) / 2 + i * (C.w + 10);
          rects.push({ label: "S", x, y: 0, w: C.w, d: C.d });
          rects.push({ label: "S", x, y: d - C.d, w: C.w, d: C.d });
        }
        out.push({
          title: `Masa ve ${k} sandalye`,
          parts: [
            { p: t, qty: 1 },
            { p: c, qty: k },
          ],
          w,
          d,
          rects,
        });
      }
    }
  for (const s of byKind.sofa || [])
    for (const c of byKind.chair || []) {
      const S = s.size,
        C = c.size,
        d = Math.max(S.d, C.d);
      out.push({
        title: "Oturma köşesi: kanepe ve sandalye",
        parts: [
          { p: s, qty: 1 },
          { p: c, qty: 1 },
        ],
        w: S.w + 15 + C.w,
        d,
        rects: [
          { label: "K", x: 0, y: d - S.d, w: S.w, d: S.d },
          { label: "S", x: S.w + 15, y: d - C.d, w: C.w, d: C.d },
        ],
      });
    }
  for (const l of byKind.lounger || []) {
    const L = l.size;
    out.push({
      title: "İki şezlong yan yana",
      parts: [{ p: l, qty: 2 }],
      w: 2 * L.w + 30,
      d: L.d,
      rects: [
        { label: "Ş", x: 0, y: 0, w: L.w, d: L.d },
        { label: "Ş", x: L.w + 30, y: 0, w: L.w, d: L.d },
      ],
    });
  }
  return out;
}

/* products: yayında ve stokta olan ürünler (toJSON çıktısı). */
export function recommend(products, width, depth) {
  const area = width * depth;
  const available = products.filter((p) => p.isActive !== false && p.stock > 0);
  const usable = available
    .map((p) => ({ ...p, size: sizeOf(p), kind: kindOf(p) }))
    .filter((p) => p.size);
  const items = [];
  for (const p of usable) {
    const fit = place(p.size.w, p.size.d, width, depth);
    if (!fit) continue;
    items.push({
      product: lean(p),
      size: p.size,
      fit,
      rects: orient([{ label: LABELS[p.kind] || "?", x: 0, y: 0, w: p.size.w, d: p.size.d }], fit.rotated),
      usage: Math.round(((p.size.w * p.size.d) / area) * 100),
    });
  }
  const byKind = {};
  for (const p of usable) (byKind[p.kind] ||= []).push(p);
  const sets = [];
  for (const s of setLayouts(byKind)) {
    if (s.parts.some(({ p, qty }) => p.stock < qty)) continue;
    const fit = place(s.w, s.d, width, depth);
    if (!fit) continue;
    sets.push({
      title: s.title,
      items: s.parts.map(({ p, qty }) => ({ product: lean(p), qty })),
      total: Math.round(s.parts.reduce((t, { p, qty }) => t + p.price * qty, 0) * 100) / 100,
      fit,
      rects: orient(s.rects, fit.rotated),
      usage: Math.round(((s.w * s.d) / area) * 100),
    });
  }
  // Önce alanı en iyi değerlendiren (ama sığan) seçenekler.
  items.sort((a, b) => b.usage - a.usage);
  sets.sort((a, b) => b.usage - a.usage);
  return {
    balcony: { width, depth },
    walkwayCm: WALKWAY_CM,
    items,
    // Aynı türden takımın yalnızca alanı en iyi kullanan hâli gösterilir.
    sets: sets.filter((s, i) => sets.findIndex((x) => x.title === s.title) === i).slice(0, 6),
    unsized: available.length - usable.length,
  };
}
