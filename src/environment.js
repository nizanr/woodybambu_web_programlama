/* Varsayılan 3D ortam: bahçeye açılan boş bir ahşap veranda.
   Kullanıcı kendi fotoğrafını yüklemediğinde gösterilir; mobilyalarla aynı
   kamera ve zemin düzleminde olduğu için ürünler havada durmaz. Tamamen
   kodla üretilir (harici görsel/lisans gerekmez). */
import * as THREE from "three";

const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function canvasTex(w, h, paint, repeat = [1, 1]) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}

/* Gökyüzü: üstte mavi, ufka doğru açılan ton, ince bulut lekeleri. */
const skyTexture = () =>
  canvasTex(16, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#7fb3dc");
    grad.addColorStop(0.55, "#bcd8ea");
    grad.addColorStop(0.8, "#e6eef0");
    grad.addColorStop(1, "#eef1ea");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });

/* Çim: yeşil tonlarında ince gürültü ve biçme izi şeritleri. */
const grassTexture = () =>
  canvasTex(
    256,
    256,
    (g, w, h) => {
      const r = rng(11);
      g.fillStyle = "#6f9a45";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) {
        const v = r();
        g.fillStyle = v > 0.5 ? `rgba(140,178,84,${0.25 + r() * 0.3})` : `rgba(70,104,40,${0.2 + r() * 0.3})`;
        g.fillRect(r() * w, r() * h, 1 + r() * 2, 2 + r() * 4);
      }
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(0, 0, w / 2, h);
    },
    [18, 18],
  );

/* Deck tahtaları: her tahta hafif farklı ton, aralarında koyu derz. */
const deckTexture = () =>
  canvasTex(
    512,
    512,
    (g, w, h) => {
      const r = rng(5),
        n = 8,
        bh = h / n;
      for (let i = 0; i < n; i++) {
        const base = 150 + r() * 30;
        g.fillStyle = `rgb(${base + 20},${base - 18},${base - 60})`;
        g.fillRect(0, i * bh, w, bh);
        for (let k = 0; k < 40; k++) {
          const y = i * bh + r() * bh;
          g.strokeStyle = `rgba(90,58,30,${0.08 + r() * 0.12})`;
          g.beginPath();
          g.moveTo(0, y);
          g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 6, w * 0.7, y + (r() - 0.5) * 6, w, y);
          g.stroke();
        }
        // Tahta başları (uç uca eklenen yerler).
        const cut = r() * w;
        g.fillStyle = "rgba(60,38,20,0.55)";
        g.fillRect(cut, i * bh, 2, bh);
        g.fillStyle = "rgba(55,35,18,0.85)";
        g.fillRect(0, i * bh + bh - 3, w, 3);
      }
    },
    [1, 4],
  );

/* Çit: koyu yeşil yapraklı doku. */
const hedgeTexture = () =>
  canvasTex(
    256,
    128,
    (g, w, h) => {
      const r = rng(23);
      g.fillStyle = "#3c5a2c";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const v = 50 + r() * 60;
        g.fillStyle = `rgba(${v * 0.7},${v + 30},${v * 0.45},${0.35 + r() * 0.4})`;
        g.beginPath();
        g.arc(r() * w, r() * h, 1 + r() * 2.2, 0, Math.PI * 2);
        g.fill();
      }
    },
    [10, 1],
  );

export function buildEnvironment() {
  const env = new THREE.Group();
  const sky = skyTexture();
  const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, ...o });

  // Çim zemin (deck'in hemen altında).
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat({ map: grassTexture() }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.14;
  env.add(grass);

  // Ahşap veranda: 10 m × 7 birim; tahtalar sağa-sola uzanır.
  const deckW = 10,
    deckD = 7;
  const deckTex = deckTexture();
  deckTex.repeat.set(deckW / 5, deckD / 1.6);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.14, deckD), [
    mat({ color: 0x7a5636 }),
    mat({ color: 0x7a5636 }),
    mat({ map: deckTex, roughness: 0.8 }),
    mat({ color: 0x6b4a2e }),
    mat({ color: 0x6b4a2e }),
    mat({ color: 0x6b4a2e }),
  ]);
  deck.position.set(0, -0.07, -0.6);
  env.add(deck);
  // Veranda ile çim arasında basamak.
  const step = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.07, 0.5), mat({ color: 0x8a6440 }));
  step.position.set(0, -0.105, deckD / 2 - 0.6 + 0.25);
  env.add(step);

  // Arkada çit ve önünde çalılar.
  const hedge = new THREE.Mesh(new THREE.BoxGeometry(90, 2.2, 1.4), mat({ map: hedgeTexture() }));
  hedge.position.set(0, 0.96, -24);
  env.add(hedge);
  const r = rng(41);
  const greens = [0x4f7a35, 0x5f8c3f, 0x3f6a2f, 0x6d9a48];
  const flowers = [0xc77fb8, 0xe9e2f0, 0x8f7ad1, 0xf0b44c];
  for (let i = 0; i < 34; i++) {
    const x = -26 + i * 1.6 + (r() - 0.5) * 0.6,
      s = 0.55 + r() * 0.5;
    const bush = new THREE.Mesh(
      new THREE.IcosahedronGeometry(s, 2),
      mat({ color: greens[i % greens.length] }),
    );
    bush.scale.y = 0.75;
    bush.position.set(x, -0.14 + s * 0.6, -22.8 + (r() - 0.5) * 0.5);
    env.add(bush);
    if (r() > 0.45) {
      const fl = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, 0.7, 6),
        mat({ color: flowers[Math.floor(r() * flowers.length)] }),
      );
      fl.position.set(x + (r() - 0.5) * 0.4, -0.14 + s + 0.25, -22.4);
      env.add(fl);
    }
  }

  // Çitin ardında ağaç tepeleri.
  for (let i = 0; i < 11; i++) {
    const x = -34 + i * 7 + (r() - 0.5) * 3,
      s = 2.6 + r() * 1.8;
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(s, 2),
      mat({ color: [0x456b34, 0x557d3d, 0x3d5f2e][i % 3] }),
    );
    crown.position.set(x, 1.4 + s * 0.7, -31 - r() * 5);
    env.add(crown);
  }

  return {
    group: env,
    background: sky,
    fog: new THREE.Fog(0xe3ece9, 22, 60),
    /** Zemini mobilyaların tabanına hizalar (sahne ölçeği/konumu değişince). */
    setFloor(y) {
      env.position.y = y;
    },
  };
}
