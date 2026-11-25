import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/* Woody Bambu temsili 3D modelleri (builtin:<chair|sofa|table|lounger>).
   Boğumlu bambu çubuklar, çıtalı oturma/masa yüzeyleri, yuvarlatılmış
   minderler ve zemine yumuşak temas gölgesi. Ölçüler eski kutu modellerle
   aynı tutuldu; kayıtlı yerleşimlerin konum/ölçek değerleri geçerli kalır.
   Dokular kodla (canvas) üretilir; dışarıdan dosya yüklenmez. */

const textures = {};
const canvasTexture = (key, w, h, paint, repeat) => {
  if (textures[key]) return textures[key];
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(...repeat);
  t.anisotropy = 4;
  return (textures[key] = t);
};
// Sabit tohumlu basit rastgele sayı: her açılışta aynı doku.
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/* Bambu kabuğu: çevre boyunca ince boyuna lifler (UV'de u yönü). */
const bambooTexture = () =>
  canvasTexture("bamboo", 128, 32, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const v = 200 + r() * 55;
      g.fillStyle = `rgb(${v},${v},${v * 0.97})`;
      g.fillRect(x, 0, 1, h);
    }
    // Işık alan taraf biraz daha parlak, gölgede kalan taraf koyu.
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "rgba(255,255,255,0.18)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.12)");
    grad.addColorStop(1, "rgba(255,255,255,0.18)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });

/* Çıta/ahşap: uzun eksen boyunca damar. */
const grainTexture = () =>
  canvasTexture(
    "grain",
    256,
    64,
    (g, w, h) => {
      const r = rng(13);
      g.fillStyle = "#e6e6e6";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const y = r() * h,
          v = 150 + r() * 90;
        g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
        g.lineWidth = 0.5 + r() * 1.5;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / 40 + i) * 1.5);
        g.stroke();
      }
    },
    [1, 1],
  );

/* Minder kumaşı: ince örgü. */
const weaveTexture = () =>
  canvasTexture(
    "weave",
    64,
    64,
    (g, w, h) => {
      const r = rng(29);
      g.fillStyle = "#f4f1ea";
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2)
        for (let x = 0; x < w; x += 2) {
          const v = 225 + r() * 30;
          g.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
          g.fillRect(x + ((y / 2) % 2), y, 1, 1);
        }
    },
    [6, 6],
  );

/* Zemin temas gölgesi: merkezde koyu, kenarlara doğru kaybolan elips. */
const shadowTexture = () =>
  canvasTexture("shadow", 128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.28)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });

export function buildBuiltin(type, color) {
  const group = new THREE.Group();
  const base = new THREE.Color(color || "#b79b77");
  const tone = (dl) => {
    const c = base.clone();
    c.offsetHSL(0, 0, dl);
    return c;
  };
  const caneMat = new THREE.MeshStandardMaterial({
    color: tone(0.04),
    map: bambooTexture(),
    roughness: 0.45,
    metalness: 0.02,
  });
  const nodeMat = new THREE.MeshStandardMaterial({ color: tone(-0.08), roughness: 0.5 });
  const slatMats = [-0.03, 0, 0.03].map(
    (dl) =>
      new THREE.MeshStandardMaterial({ color: tone(dl), map: grainTexture(), roughness: 0.6 }),
  );
  const fabric = new THREE.MeshStandardMaterial({
    color: "#e4dac8",
    map: weaveTexture(),
    roughness: 0.95,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: "#7d8461",
    map: weaveTexture(),
    roughness: 0.95,
  });

  const up = new THREE.Vector3(0, 1, 0);
  /* İki nokta arasında boğumlu bambu çubuğu. */
  const cane = (a, b, r = 0.045, nodes = true) => {
    const A = new THREE.Vector3(...a),
      B = new THREE.Vector3(...b),
      dir = B.clone().sub(A),
      len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14, 1), caneMat);
    stalk.position.copy(A).addScaledVector(dir, 0.5);
    stalk.quaternion.copy(q);
    group.add(stalk);
    if (!nodes) return;
    // Boğumlar ~35 cm aralıkla; uçlara değil, aralara.
    const count = Math.max(1, Math.round(len / 0.35) - 1);
    for (let i = 1; i <= count; i++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.16, r * 1.16, 0.022, 14), nodeMat);
      ring.position.copy(A).addScaledVector(dir, i / (count + 1));
      ring.quaternion.copy(q);
      group.add(ring);
    }
    // Uç kapakları: kesilmiş bambu görünümü.
    for (const p of [A, B]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.012, 14), nodeMat);
      cap.position.copy(p);
      cap.quaternion.copy(q);
      group.add(cap);
    }
  };
  let slatIndex = 0;
  const slat = (w, h, d, x, y, z, rotX = 0) => {
    const m = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.35),
      slatMats[slatIndex++ % slatMats.length],
    );
    m.position.set(x, y, z);
    m.rotation.x = rotX;
    group.add(m);
    return m;
  };
  const cushion = (w, h, d, x, y, z, rotX = 0, mat = fabric, round = 0.07) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 5, Math.min(round, h / 2 - 0.001)), mat);
    m.position.set(x, y, z);
    m.rotation.x = rotX;
    group.add(m);
    return m;
  };
  const shadow = (w, d, y) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.userData.shadow = true; // ölçü hesabına katılmaz (Studio)
    m.position.y = y;
    m.renderOrder = -1;
    group.add(m);
  };

  const floor = -0.85;
  if (type === "table") {
    const w = 2.7,
      d = 1.6,
      ix = w / 2 - 0.18,
      iz = d / 2 - 0.18;
    // Çıtalı tabla: uzun kenar boyunca aralıklı çıtalar.
    const n = 10,
      gap = 0.018,
      sw = (d - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) slat(w, 0.05, sw, 0, 0.0, -d / 2 + sw / 2 + i * (sw + gap));
    for (const x of [-ix, ix])
      for (const z of [-iz, iz]) cane([x, floor, z], [x, -0.03, z], 0.055);
    // Etek çubukları ve alt bağlantılar.
    for (const z of [-iz, iz]) cane([-ix, -0.09, z], [ix, -0.09, z], 0.04);
    for (const x of [-ix, ix]) cane([x, -0.09, -iz], [x, -0.09, iz], 0.04);
    for (const x of [-ix, ix]) cane([x, -0.6, -iz], [x, -0.6, iz], 0.035);
    cane([-ix, -0.6, 0], [ix, -0.6, 0], 0.035);
    shadow(w + 0.7, d + 0.7, floor - 0.005);
    return group;
  }

  if (type === "lounger") {
    const w = 1.2,
      d = 2.5,
      ix = w / 2 - 0.06,
      seatY = -0.38,
      hinge = -d / 2 + 0.85;
    const legZ = [-d / 2 + 0.12, d / 2 - 0.12];
    for (const x of [-ix, ix]) {
      for (const z of legZ) cane([x, floor, z], [x, seatY - 0.04, z], 0.05);
      cane([x, seatY - 0.06, -d / 2 + 0.05], [x, seatY - 0.06, d / 2 - 0.05], 0.045);
      cane([x, -0.7, legZ[0]], [x, -0.7, legZ[1]], 0.032);
    }
    for (const z of legZ) cane([-ix, seatY - 0.06, z], [ix, seatY - 0.06, z], 0.04);
    // Ayak tarafı çıtaları (yatay).
    const n = 11,
      len = d / 2 - hinge,
      sw = len / n - 0.015;
    for (let i = 0; i < n; i++) slat(w - 0.16, 0.035, sw, 0, seatY, hinge + sw / 2 + i * (len / n));
    // Sırt bölümü: 40° kalkık, kendi çıtaları ve destek çubuğu.
    const backLen = 0.95,
      a = (40 * Math.PI) / 180;
    const back = new THREE.Group();
    back.position.set(0, seatY, hinge);
    back.rotation.x = a;
    group.add(back);
    for (let i = 0; i < 8; i++) {
      const s = slat(w - 0.16, 0.035, backLen / 8 - 0.015, 0, 0, -(i + 0.5) * (backLen / 8));
      group.remove(s);
      back.add(s);
    }
    const topY = seatY + Math.sin(a) * backLen,
      topZ = hinge - Math.cos(a) * backLen;
    for (const x of [-ix + 0.02, ix - 0.02]) cane([x, seatY - 0.04, hinge], [x, topY, topZ], 0.035, false);
    cane([0, seatY - 0.06, hinge - 0.55], [0, seatY + Math.sin(a) * 0.5, hinge - Math.cos(a) * 0.5], 0.028, false);
    // Minderler: düz şilte + açılı sırt şiltesi + küçük baş yastığı.
    cushion(w - 0.2, 0.09, len - 0.04, 0, seatY + 0.07, hinge + len / 2, 0, fabric, 0.04);
    const pad = cushion(w - 0.2, 0.08, backLen - 0.06, 0, 0, 0, 0, fabric, 0.04);
    group.remove(pad);
    pad.position.set(0, 0.065, -backLen / 2);
    back.add(pad);
    const pillow = cushion(w - 0.5, 0.12, 0.3, 0, 0, 0, 0, accent, 0.05);
    group.remove(pillow);
    pillow.position.set(0, 0.16, -backLen + 0.22);
    back.add(pillow);
    shadow(w + 0.7, d + 0.6, floor - 0.005);
    return group;
  }

  // Sandalye ve kanepe: aynı iskelet, farklı genişlik ve minder sayısı.
  const sofa = type === "sofa",
    w = sofa ? 2.6 : 1.2,
    d = 1.15,
    ix = w / 2 - 0.07,
    fz = d / 2 - 0.07,
    bz = -d / 2 + 0.07,
    armY = 0.48,
    backTopY = 0.95,
    tilt = 0.14;
  // Ön ayaklar kolçağa kadar, arka ayaklar sırta doğru geriye eğik devam eder.
  for (const x of [-ix, ix]) {
    cane([x, floor, fz], [x, armY, fz], 0.05);
    cane([x, floor, bz], [x, 0.02, bz], 0.05);
    cane([x, 0.02, bz], [x, backTopY, bz - tilt], 0.05);
    // Kolçak: çubuk + üstte düz çıta.
    cane([x, armY, fz], [x, armY, bz - tilt * (armY / backTopY)], 0.04, false);
    slat(0.12, 0.035, d - 0.02, x, armY + 0.045, -0.04);
    cane([x, -0.6, fz], [x, -0.6, bz], 0.032);
    cane([x, -0.04, fz], [x, -0.04, bz], 0.042);
    for (const z of [fz - 0.33, fz - 0.66]) cane([x, -0.04, z], [x, armY - 0.02, z], 0.025, false);
  }
  for (const z of [fz, bz]) cane([-ix, -0.04, z], [ix, -0.04, z], 0.042);
  cane([-ix, -0.6, fz], [ix, -0.6, fz], 0.032);
  // Sırt çubukları (yatay), sırt eğimine uyumlu.
  for (const t of [0.4, 0.7, 1]) {
    const y = 0.02 + (backTopY - 0.02) * t,
      z = bz - tilt * t;
    cane([-ix, y, z], [ix, y, z], t === 1 ? 0.045 : 0.032, t === 1);
  }
  // Oturma çıtaları (minderin altında, yandan görünür).
  const n = 7;
  for (let i = 0; i < n; i++) slat(w - 0.2, 0.03, 0.1, 0, 0.01, bz + 0.08 + i * ((fz - bz - 0.16) / (n - 1)));
  // Minderler.
  const seats = sofa ? 3 : 1,
    inner = w - 0.24,
    cw = inner / seats - 0.02,
    backA = Math.atan2(tilt, backTopY);
  for (let i = 0; i < seats; i++) {
    const x = -inner / 2 + cw / 2 + i * (cw + 0.02);
    cushion(cw, 0.17, d - 0.26, x, 0.12, 0.07);
    cushion(cw, 0.5, 0.17, x, 0.5, bz + 0.055, -backA);
  }
  // Kanepede iki kırlent.
  if (sofa)
    for (const s of [-1, 1]) {
      const p = cushion(0.42, 0.42, 0.13, s * (inner / 2 - 0.3), 0.46, bz + 0.25, -0.35, accent, 0.06);
      p.rotation.z = s * 0.12;
    }
  shadow(w + 0.7, d + 0.8, floor - 0.005);
  return group;
}
