/* Renk adlandırma: HEX kodunu en yakın Pantone TCX (Fashion, Home +
   Interiors) rengine eşler. Hem sunucu hem yönetim paneli kullanır.
   Eşleme CIELAB uzayında en küçük ΔE ile yapılır; sonuç temsilidir,
   ekran rengi fiziksel Pantone kartelasıyla birebir aynı olmayabilir. */
import { getNearestPantone } from "pantone-tcx";

const HEX = /^#[0-9a-f]{6}$/;
const cache = new Map();

/** "#b79b77" → { name: "Lark", code: "16-1324 TCX", hex: "#b89b72" } */
export function pantoneOf(hex) {
  const h = typeof hex === "string" ? hex.trim().toLowerCase() : "";
  if (!HEX.test(h)) return null;
  if (!cache.has(h)) {
    try {
      const p = getNearestPantone(h);
      cache.set(h, { name: p.name, code: p.tcx + " TCX", hex: p.hex.toLowerCase() });
    } catch {
      cache.set(h, null);
    }
  }
  return cache.get(h);
}

/** Tek bir renk seçeneğini tamamlar: ad boşsa Pantone adı, kod her zaman HEX'ten. */
export function withPantone(c) {
  const hex = String(c.hex).toLowerCase();
  const pt = pantoneOf(hex);
  const name = typeof c.name === "string" ? c.name.trim() : "";
  return { name: name || pt?.name || hex, hex, pantone: pt?.code || "" };
}

/** Müşteriye gösterilecek renk seçenekleri. Seçenek tanımlı değilse
    ürünün model rengi tek seçenek olarak (Pantone adıyla) kullanılır. */
export function colorOptions(p) {
  const list = p?.colors?.length ? p.colors : p?.color ? [{ hex: p.color }] : [];
  return list.filter((c) => c && typeof c.hex === "string").map(withPantone);
}
