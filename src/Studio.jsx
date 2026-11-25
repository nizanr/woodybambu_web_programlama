import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { VAL, money } from "./util.js";
import { buildBuiltin } from "./models3d.js";
import { sizeOf } from "../server/balcony.js";

/* Harici GLB/GLTF modeli; boyutu sahneye sığacak şekilde normalize edilir. */
async function loadGltf(url, timeoutMs) {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await Promise.race([
    new GLTFLoader().loadAsync(url),
    new Promise((_, reject) => setTimeout(() => reject(Error("timeout")), timeoutMs)),
  ]);
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  const group = new THREE.Group();
  group.add(model);
  group.scale.setScalar(2.4 / Math.max(size.x, size.y, size.z, 0.001));
  return group;
}
const disposeTree = (obj) =>
  obj.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) m.dispose?.();
  });
/* Fotoğraf okunabilir mi? (VAL-017) */
const readable = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  });

/* Sahne ölçeği: 1 metre = UNIT birim. Her model gerçek enine göre
   ölçeklenir; böylece takımdaki ürünler birbirine göre doğru boyutta durur. */
const UNIT = 2;
// Fotoğraf yüklenmeden önce gösterilen boş bahçe arka planı.
const DEFAULT_BG = "/images/garden-empty.jpg";
const FLOOR = -0.85;
const rad = (d) => (d * Math.PI) / 180;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
let seq = 0;
const newKey = () => "p" + ++seq;

/* Modeli zemine oturtur, ortalar ve gerçek enine göre ölçekler. */
function normalize(model, product) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  model.traverse((o) => {
    if (o.isMesh && !o.userData.shadow) box.expandByObject(o);
  });
  const wrap = new THREE.Group();
  wrap.add(model);
  if (box.isEmpty()) return { obj: wrap, radius: 1 };
  const size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3());
  const real = sizeOf(product);
  const k = real ? ((real.w / 100) * UNIT) / Math.max(size.x, 0.001) : 1;
  wrap.scale.setScalar(k);
  wrap.position.set(-center.x * k, FLOOR - box.min.y * k, -center.z * k);
  const obj = new THREE.Group();
  obj.add(wrap);
  return { obj, radius: (Math.hypot(size.x, size.z) * k) / 2 };
}

export default function Studio({
  product: initial,
  initialPieces,
  products,
  user,
  api,
  notify,
  onClose,
  onAddToCart,
  pickedColors,
  onLoginRequest,
  settings,
}) {
  const host = useRef(),
    sceneRef = useRef(null),
    viewRef = useRef(null),
    ringRef = useRef(null),
    objects = useRef(new Map()),
    fileRef = useRef(null);
  const preview = settings?.preview || { maxPhotoMb: 8, loadTargetSec: 5, saveLayoutEnabled: true };
  const candidates = products.filter((p) => p.model3dUrl && p.isActive !== false);
  const productOf = (id) => products.find((p) => p._id === id);
  const optionsOf = (p) =>
    p?.colorOptions?.length ? p.colorOptions : p?.color ? [{ hex: p.color.toLowerCase(), name: p.color }] : [];
  const defaultColor = (p) => pickedColors?.[p._id] || optionsOf(p)[0]?.hex || "";
  const makePiece = (p, extra = {}) => ({
    key: newKey(),
    productId: p._id,
    color: defaultColor(p),
    x: 0,
    z: 0,
    rotation: 0,
    scale: 1,
    ...extra,
  });

  // Sahnedeki ürünler. Balkon önerisinden gelen takım plan konumlarıyla açılır.
  const [pieces, setPieces] = useState(() =>
    initialPieces?.length
      ? initialPieces.map((ip) =>
          makePiece(ip.product, {
            x: ((ip.xCm || 0) / 100) * UNIT,
            z: ((ip.zCm || 0) / 100) * UNIT,
            rotation: ip.rotation || 0,
          }),
        )
      : [makePiece(initial)],
  );
  // "all" → tüm sahne birlikte taşınır/ölçeklenir; aksi halde seçili ürün.
  const [active, setActive] = useState("all"),
    [group, setGroup] = useState(() => ({
      x: 0,
      y: 0,
      rotation: 0,
      scale: initialPieces?.length > 1 ? 0.8 : 1,
    })),
    [photo, setPhoto] = useState(null),
    [name, setName] = useState("Bahçem"),
    [saved, setSaved] = useState([]),
    [savePhoto, setSavePhoto] = useState(false),
    [status, setStatus] = useState("loading"),
    [loadMs, setLoadMs] = useState(null),
    [addId, setAddId] = useState(""),
    [busy, setBusy] = useState(false);
  const canSave = preview.saveLayoutEnabled && ["customer", "admin"].includes(user?.role);
  const canBuy = !user || ["customer", "admin"].includes(user.role);
  const multi = pieces.length > 1;
  // Seçim: "all", tek ürün anahtarı ya da "g:k1,k2" (aynı ürün/renk/boyut grubu).
  const liveKeys = (a) =>
    a.startsWith("g:") ? a.slice(2).split(",").filter((k) => pieces.some((p) => p.key === k)) : [];
  const target = !multi
    ? "all"
    : active.startsWith("g:")
      ? liveKeys(active).length > 1
        ? "g:" + liveKeys(active).join(",")
        : liveKeys(active)[0] || "all"
      : pieces.some((p) => p.key === active)
        ? active
        : "all";
  const selectedKeys = target === "all" ? [] : target.startsWith("g:") ? target.slice(2).split(",") : [target];
  const activePiece = pieces.find((p) => p.key === selectedKeys[0]);
  const state = useRef();
  state.current = { pieces, group, target };

  useEffect(() => {
    if (user)
      api("/api/designs")
        .then(setSaved)
        .catch(() => {});
  }, [user?.id]);

  /* Sahne bir kez kurulur; ürünler değişince yalnızca modeller değişir (FR-030). */
  useEffect(() => {
    const el = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: false });
    } catch {
      // NFR-12: 3D desteklenmeyen tarayıcıda bilgilendir; satın alma akışı etkilenmez.
      setStatus("nowebgl");
      return;
    }
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 3, 8);
    camera.lookAt(0, 0, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // Bambu ve kumaş tonlarının fotoğrafla daha doğal karışması için.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6d6957, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 5, 4);
    scene.add(light);
    const holder = new THREE.Group();
    scene.add(holder);
    // Seçili ürünlerin altındaki halkalar (en fazla 12 ürün).
    const ringGeo = new THREE.RingGeometry(0.92, 1, 64),
      ringMat = new THREE.MeshBasicMaterial({ color: 0xf2c46b, transparent: true, opacity: 0.9, depthWrite: false });
    ringRef.current = Array.from({ length: 12 }, () => {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      holder.add(ring);
      return ring;
    });
    let frame;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      renderer.render(scene, camera);
    };
    draw();
    const resize = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    sceneRef.current = holder;
    viewRef.current = { renderer, scene, camera };
    const objs = objects.current;
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
      objs.clear();
      sceneRef.current = null;
      viewRef.current = null;
    };
  }, []);

  /* Sahnedeki ürün listesi ile Three.js nesnelerini eşitler. */
  const sig = (pc) => pc.productId + "|" + pc.color;
  const sigs = pieces.map((pc) => pc.key + ":" + sig(pc)).join(",");
  useEffect(() => {
    const holder = sceneRef.current;
    if (!holder) return;
    const map = objects.current;
    const live = new Set(pieces.map((pc) => pc.key));
    for (const [k, o] of map)
      if (!live.has(k)) {
        holder.remove(o.obj);
        disposeTree(o.obj);
        map.delete(k);
      }
    const todo = pieces.filter((pc) => map.get(pc.key)?.sig !== sig(pc));
    if (!todo.length) {
      setStatus(map.size ? "ready" : "unavailable");
      return;
    }
    let cancelled = false;
    const started = performance.now();
    setStatus("loading");
    Promise.all(
      todo.map(async (pc) => {
        let info;
        try {
          // Ürün yayında ve 3D modeli tanımlı mı? (VAL-018)
          info = await api("/api/preview/" + pc.productId);
        } catch (e) {
          return { pc, error: e.message };
        }
        try {
          const model = info.model3dUrl.startsWith("builtin:")
            ? buildBuiltin(info.model3dUrl.slice(8), pc.color || info.color)
            : await loadGltf(info.model3dUrl, Math.max(preview.loadTargetSec, 1) * 2000);
          return { pc, ...normalize(model, productOf(pc.productId) || info) };
        } catch {
          return { pc, error: VAL.VAL018 };
        }
      }),
    ).then((results) => {
      const failed = [];
      for (const r of results) {
        if (r.error) {
          failed.push(r);
          continue;
        }
        if (cancelled) {
          disposeTree(r.obj);
          continue;
        }
        const old = map.get(r.pc.key);
        if (old) {
          holder.remove(old.obj);
          disposeTree(old.obj);
        }
        r.obj.userData.key = r.pc.key;
        holder.add(r.obj);
        map.set(r.pc.key, { obj: r.obj, sig: sig(r.pc), radius: r.radius });
      }
      if (cancelled) return;
      if (failed.length) {
        notify(failed[0].error || VAL.VAL018);
        const bad = new Set(failed.map((r) => r.pc.key));
        // Yüklenemeyen ürün sahneden çıkarılır; en az bir ürün kalır.
        setPieces((ps) => (ps.length > bad.size ? ps.filter((p) => !bad.has(p.key)) : ps));
      }
      setLoadMs(Math.round(performance.now() - started));
      setStatus(map.size ? "ready" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [sigs]);

  /* Konum/dönüş/ölçek her değişimde nesnelere uygulanır. */
  useEffect(() => {
    const holder = sceneRef.current;
    if (!holder) return;
    holder.scale.setScalar(group.scale);
    holder.rotation.y = rad(group.rotation) + 0.4;
    holder.position.set(group.x, group.y, 0);
    for (const pc of pieces) {
      const o = objects.current.get(pc.key)?.obj;
      if (!o) continue;
      o.position.set(pc.x, 0, pc.z);
      o.rotation.y = rad(pc.rotation);
      o.scale.setScalar(pc.scale);
    }
    (ringRef.current || []).forEach((ring, i) => {
      const pc = pieces.find((p) => p.key === selectedKeys[i]),
        sel = pc && objects.current.get(pc.key);
      ring.visible = Boolean(sel);
      if (sel) {
        ring.position.set(pc.x, FLOOR + 0.01, pc.z);
        ring.scale.setScalar(Math.max(sel.radius, 0.3) * pc.scale);
      }
    });
  });
  useEffect(
    () => () => {
      if (photo?.url) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  const usePhotoFile = async (file) => {
    if (!["image/jpeg", "image/png"].includes(file.type)) return notify(VAL.VAL016);
    if (file.size > preview.maxPhotoMb * 1024 * 1024) return notify(VAL.VAL017);
    const url = URL.createObjectURL(file);
    if (!(await readable(url))) {
      URL.revokeObjectURL(url);
      return notify(VAL.VAL017);
    }
    setPhoto({ url, file });
  };
  const upload = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) usePhotoFile(file);
  };

  /* Hedef: "all" (tüm sahne) ya da bir ürün anahtarı. */
  const valueOf = (key) => {
    const { pieces: ps, group: g } = state.current;
    const first = key.startsWith("g:") ? key.slice(2).split(",")[0] : key;
    return key === "all" ? g : ps.find((p) => p.key === first) || g;
  };
  const patch = (key, upd) => {
    if (key === "all") return setGroup((g) => ({ ...g, ...(typeof upd === "function" ? upd(g) : upd) }));
    const keys = key.startsWith("g:") ? key.slice(2).split(",") : [key];
    setPieces((ps) =>
      ps.map((p) => (keys.includes(p.key) ? { ...p, ...(typeof upd === "function" ? upd(p) : upd) } : p)),
    );
  };
  /* Ekrandaki kaydırmayı hedefe uygular: tüm sahne ekran düzleminde,
     tek ürün zeminde (sahnenin dönüşü ve ölçeği hesaba katılarak) taşınır. */
  const moveBy = (key, base, dx, dy) => {
    if (key === "all")
      return patch(key, {
        x: clamp(base.x + dx, -10, 10),
        y: clamp(base.y + dy, -10, 10),
      });
    const { group: g } = state.current;
    const th = rad(g.rotation) + 0.4;
    const wx = dx / g.scale,
      wz = (-dy * 2.5) / g.scale; // kamera eğimi: derinlik ekranda kısalır
    const mx = wx * Math.cos(th) - wz * Math.sin(th),
      mz = wx * Math.sin(th) + wz * Math.cos(th);
    // Grup: her parça aynı miktarda kayar (klavye ile adım adım).
    if (key.startsWith("g:"))
      return patch(key, (v) => ({ x: clamp(v.x + mx, -20, 20), z: clamp(v.z + mz, -20, 20) }));
    patch(key, { x: clamp(base.x + mx, -20, 20), z: clamp(base.z + mz, -20, 20) });
  };

  /* Dokunulan ürünü bulur (raycast). */
  const pick = (e) => {
    const view = viewRef.current,
      holder = sceneRef.current;
    if (!view || !holder || state.current.pieces.length < 2) return "all";
    const r = e.currentTarget.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, view.camera);
    const roots = [...objects.current.values()].map((o) => o.obj);
    const hit = ray.intersectObjects(roots, true).find((h) => !h.object.userData.shadow);
    let o = hit?.object;
    while (o && !o.userData.key) o = o.parent;
    return o?.userData.key || "all";
  };

  /* Fare ile sürükleme; dokunmatikte tek parmak sürükleme, iki parmak
     sıkıştırma (ölçek) ve çevirme (döndürme) — FR-029. */
  const pointers = useRef(new Map()),
    gesture = useRef(null);
  const snapshot = (key) => {
    const pts = [...pointers.current.values()];
    const k = key ?? gesture.current?.key ?? state.current.target;
    const v = valueOf(k);
    if (pts.length === 1) gesture.current = { kind: "drag", key: k, x: pts[0].x, y: pts[0].y, v: { ...v } };
    else if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = {
        kind: "pinch",
        key: k,
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        v: { ...v },
      };
    } else gesture.current = null;
  };
  const onPointerDown = (e) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    let key;
    if (pointers.current.size === 1) {
      key = pick(e);
      setActive(key);
    }
    snapshot(key);
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.kind === "drag" && pts.length === 1)
      moveBy(g.key, g.v, (pts[0].x - g.x) / 90, -(pts[0].y - g.y) / 90);
    if (g.kind === "pinch" && pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      patch(g.key, {
        scale: clamp(+(g.v.scale * (dist / (g.dist || 1))).toFixed(2), 0.2, 3),
        rotation: Math.round((((g.v.rotation + ((angle - g.angle) * 180) / Math.PI) % 360) + 360) % 360),
      });
    }
  };
  const onPointerEnd = (e) => {
    pointers.current.delete(e.pointerId);
    snapshot();
  };
  const onWheel = (e) =>
    patch(target, (v) => ({ scale: clamp(+(v.scale - e.deltaY * 0.001).toFixed(2), 0.2, 3) }));
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 0.5 : 0.1;
    const moves = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      moveBy(target, valueOf(target), moves[e.key][0], moves[e.key][1]);
      return;
    }
    // Sekme ile ürünler arasında geçiş; klavyeyle döndürme (Q/E), ölçek (+/−) — NFR-03.
    if (e.key.toLowerCase() === "t" && multi) {
      e.preventDefault();
      const order = ["all", ...rows.map(rowTarget)];
      setActive(order[(order.indexOf(target) + 1) % order.length]);
      return;
    }
    const turn = { q: -15, e: 15 }[e.key.toLowerCase()];
    if (turn) {
      e.preventDefault();
      patch(target, (v) => ({ rotation: (((v.rotation + turn) % 360) + 360) % 360 }));
      return;
    }
    const zoom = { "+": 0.1, "=": 0.1, "-": -0.1, _: -0.1 }[e.key];
    if (zoom) {
      e.preventDefault();
      patch(target, (v) => ({ scale: clamp(+(v.scale + zoom).toFixed(2), 0.2, 3) }));
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selectedKeys.length) {
      e.preventDefault();
      removeKeys(selectedKeys);
    }
  };

  /* Sahneye ürün ekleme / çıkarma / değiştirme. */
  const addPiece = (p) => {
    if (!p) return;
    if (pieces.length >= 12) return notify("Sahneye en fazla 12 ürün ekleyebilirsiniz.");
    const n = pieces.length;
    const pc = makePiece(p, { x: clamp(((n % 3) - 1) * 1.6, -20, 20), z: 0.8 + Math.floor(n / 3) * 0.8 });
    setPieces([...pieces, pc]);
    setActive(pc.key);
  };
  const removeKeys = (keys) => {
    const rest = pieces.filter((p) => !keys.includes(p.key));
    if (!rest.length) return;
    setPieces(rest);
    setActive("all");
  };
  const swapPiece = (key, p) => {
    if (!p) return;
    const keys = key === "all" ? [pieces[0].key] : key.startsWith("g:") ? key.slice(2).split(",") : [key];
    setPieces(pieces.map((x) => (keys.includes(x.key) ? { ...x, productId: p._id, color: defaultColor(p) } : x)));
  };
  /* Aynı ürün + renk + boyuttaki parçalar tek satırda "× adet" olarak gösterilir;
     rengi ya da boyutu değişen parça kendi satırına ayrılır. */
  const rows = [];
  for (const pc of pieces) {
    const gk = `${pc.productId}|${pc.color}|${pc.scale}`;
    let r = rows.find((x) => x.gk === gk);
    if (!r) rows.push((r = { gk, productId: pc.productId, color: pc.color, scale: pc.scale, keys: [] }));
    r.keys.push(pc.key);
  }
  const rowTarget = (r) => (r.keys.length > 1 ? "g:" + r.keys.join(",") : r.keys[0]);
  const addOne = (r) => {
    if (pieces.length >= 12) return notify("Sahneye en fazla 12 ürün ekleyebilirsiniz.");
    const last = pieces.find((p) => p.key === r.keys[r.keys.length - 1]);
    const real = sizeOf(productOf(last.productId));
    const step = ((real ? real.w : 60) / 100) * UNIT * last.scale + 0.15;
    const pc = { ...last, key: newKey(), x: clamp(last.x + step, -20, 20) };
    setPieces([...pieces, pc]);
    setActive("g:" + [...r.keys, pc.key].join(","));
  };

  /* Önizlemeyi PNG olarak indirme: fotoğraf + 3D model yalnızca tarayıcıda
     birleştirilir; sunucuya hiçbir şey gönderilmez (FR-033, BR-021). */
  const downloadImage = async () => {
    const view = viewRef.current,
      el = host.current;
    if (!view || !el || status !== "ready") return;
    const { width, height } = el.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const out = document.createElement("canvas");
    out.width = Math.round(width * ratio);
    out.height = Math.round(height * ratio);
    const ctx = out.getContext("2d");
    const bg = new Image();
    bg.src = photo?.url || DEFAULT_BG;
    try {
      await bg.decode();
      // CSS'teki background-size: cover ile aynı kırpma.
      const s = Math.max(out.width / bg.naturalWidth, out.height / bg.naturalHeight);
      const w = bg.naturalWidth * s,
        h = bg.naturalHeight * s;
      ctx.drawImage(bg, (out.width - w) / 2, (out.height - h) / 2, w, h);
    } catch {
      ctx.fillStyle = "#e9e5dc";
      ctx.fillRect(0, 0, out.width, out.height);
    }
    // Seçim halkası görüntüye girmesin; tampon kare sonunda temizlendiği için yeniden çiz.
    const rings = ringRef.current || [],
      was = rings.map((r) => r.visible);
    rings.forEach((r) => (r.visible = false));
    view.renderer.render(view.scene, view.camera);
    ctx.drawImage(view.renderer.domElement, 0, 0, out.width, out.height);
    rings.forEach((r, i) => (r.visible = was[i]));
    const link = document.createElement("a");
    link.download = `${(name.trim() || "bahcem").replace(/[^\p{L}\p{N}_-]+/gu, "-")}.png`;
    link.href = out.toDataURL("image/png");
    link.click();
  };

  const saveLayout = async () => {
    setBusy(true);
    try {
      const d = await api("/api/designs", {
        method: "POST",
        body: JSON.stringify({
          name,
          x: +group.x.toFixed(3),
          y: +group.y.toFixed(3),
          scale: group.scale,
          rotation: group.rotation,
          pieces: pieces.map((pc) => ({
            productId: pc.productId,
            x: +pc.x.toFixed(3),
            z: +pc.z.toFixed(3),
            scale: pc.scale,
            rotation: pc.rotation,
            ...(pc.color ? { color: pc.color } : {}),
          })),
        }),
      });
      let final = d;
      if (savePhoto && photo?.file) {
        const r = await fetch(`/api/designs/${d._id}/photo`, {
          method: "PUT",
          headers: { "Content-Type": photo.file.type },
          body: photo.file,
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) notify(body.error || VAL.VAL017);
        else final = body;
      }
      setSaved([final, ...saved]);
      notify(
        savePhoto && final.photoRef
          ? "Yerleşim ve fotoğraf hesabınıza kaydedildi."
          : "Yerleşim kaydedildi. Fotoğraf cihazınızda kalır.",
      );
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const openSaved = async (d) => {
    // Eski kayıtlar tek ürünlüdür (productId); yenileri parça listesi taşır.
    const list = d.pieces?.length
      ? d.pieces
      : [{ productId: d.productId, x: 0, z: 0, scale: 1, rotation: 0 }];
    const next = list
      .map((pc) => {
        const p = productOf(pc.productId);
        return p?.model3dUrl
          ? makePiece(p, {
              x: pc.x,
              z: pc.z,
              scale: pc.scale,
              rotation: pc.rotation,
              ...(pc.color ? { color: pc.color } : {}),
            })
          : null;
      })
      .filter(Boolean);
    if (!next.length) return notify(VAL.VAL018);
    if (next.length < list.length) notify("Kayıttaki bazı ürünler artık satışta değil.");
    setPieces(next);
    setActive("all");
    setGroup(
      d.pieces?.length
        ? { x: d.x, y: d.y, scale: d.scale, rotation: d.rotation }
        : { x: d.x, y: d.y, scale: d.scale, rotation: d.rotation },
    );
    setName(d.name);
    if (d.photoRef) {
      try {
        const r = await fetch(`/api/designs/${d._id}/photo`);
        if (!r.ok) throw Error();
        const blob = await r.blob();
        setPhoto({ url: URL.createObjectURL(blob), file: null });
      } catch {
        notify(VAL.VAL017);
      }
    }
  };
  const removeSaved = async (d) => {
    try {
      await api("/api/designs/" + d._id, { method: "DELETE" });
      setSaved(saved.filter((x) => x._id !== d._id));
    } catch (e) {
      notify(e.message);
    }
  };

  /* Sahnedekileri sepete ekleme: aynı ürün/renk tek satırda toplanır. */
  const lines = [];
  for (const pc of pieces) {
    const p = productOf(pc.productId);
    if (!p) continue;
    const l = lines.find((x) => x.product._id === p._id && x.color === pc.color);
    if (l) l.quantity++;
    else lines.push({ product: p, color: pc.color, quantity: 1 });
  }
  const total = lines.reduce((t, l) => t + l.product.price * l.quantity, 0);
  const needOf = (id) => lines.filter((l) => l.product._id === id).reduce((t, l) => t + l.quantity, 0);
  const shortage = lines.filter((l) => needOf(l.product._id) > l.product.stock);
  const buyAll = async () => {
    setBusy(true);
    let ok = 0;
    try {
      for (const l of lines) {
        if (await onAddToCart(l.product, { color: l.color, quantity: l.quantity, quiet: true })) ok += l.quantity;
        else break;
      }
    } finally {
      setBusy(false);
    }
    if (ok) notify(`${ok} ürün sepetinize eklendi`);
  };
  const colorName = (p, hex) => optionsOf(p).find((c) => c.hex === hex)?.name;
  const tv = activePiece || group;
  const targetLabel = activePiece
    ? (productOf(activePiece.productId)?.name || "Ürün") + (selectedKeys.length > 1 ? ` × ${selectedKeys.length}` : "")
    : multi
      ? "Tüm sahne"
      : "Ürün";
  const single = pieces.length === 1 ? productOf(pieces[0].productId) : null;

  return (
    <div className="overlay">
      <section
        className="studio modal"
        role="dialog"
        aria-modal="true"
        aria-label="3D tasarım stüdyosu"
      >
        <header>
          <div>
            <span className="eyebrow">BAHÇENİ TASARLA / 3D STÜDYO</span>
            <h2>Hayal et. Yerleştir. Yaşa.</h2>
          </div>
          <button onClick={onClose} className="icon" aria-label="Kapat">
            ×
          </button>
        </header>
        <div className="studio-body">
          <div
            className="scene"
            tabIndex={0}
            aria-label="Önizleme alanı. Ok tuşlarıyla seçili mobilyayı, T ile ürünler arasında geçiş yapabilirsiniz."
            style={{ backgroundImage: `url(${photo?.url || DEFAULT_BG})` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onWheel={onWheel}
            onKeyDown={onKeyDown}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) usePhotoFile(f);
            }}
          >
            <div ref={host} className="canvas-host" />
            {status === "loading" && <span className="scene-status">3D model yükleniyor…</span>}
            {status === "unavailable" && <span className="scene-status">{VAL.VAL018}</span>}
            {status === "nowebgl" && (
              <span className="scene-status">
                Tarayıcınız 3D görüntülemeyi desteklemiyor. Ürünü yine de sepete ekleyebilirsiniz.
              </span>
            )}
            <span className="scene-note">
              {multi
                ? "Ürüne dokunup sürükleyin · boş alana dokunup tüm sahneyi taşıyın · iki parmakla büyütün/döndürün · klavye: T ürün seç, oklar, Q/E, +/−, Sil"
                : "Sürükleyerek taşıyın · iki parmakla büyütün/döndürün · tekerlekle ölçekleyin · klavye: oklar, Q/E, +/−"}
            </span>
          </div>
          <aside>
            <div className="scene-pieces">
              <strong>Sahnedeki ürünler ({pieces.length})</strong>
              {multi && (
                <button
                  className={"piece-row all" + (target === "all" ? " on" : "")}
                  aria-pressed={target === "all"}
                  onClick={() => setActive("all")}
                >
                  Tüm sahne · birlikte taşı/ölçekle
                </button>
              )}
              {rows.map((r) => {
                const p = productOf(r.productId);
                const opts = optionsOf(p);
                const picked = r.keys.filter((k) => selectedKeys.includes(k)).length;
                return (
                  <div className={"piece-row" + (picked ? " on" : "")} key={r.gk}>
                    <button
                      className="piece-pick"
                      aria-pressed={picked > 0}
                      onClick={() => setActive(rowTarget(r))}
                    >
                      {p?.name || "Ürün"}
                      <small>
                        {[
                          colorName(p, r.color),
                          r.scale !== 1 && `${r.scale.toFixed(2)}× boyut`,
                          picked && picked < r.keys.length && `${picked}/${r.keys.length} seçili`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </button>
                    {opts.length > 1 && (
                      <span className="swatches" role="group" aria-label={(p?.name || "") + " renkleri"}>
                        {opts.map((c) => (
                          <button
                            type="button"
                            key={c.hex}
                            className={"swatch" + (c.hex === r.color ? " on" : "")}
                            style={{ background: c.hex }}
                            title={c.name}
                            aria-label={c.name}
                            aria-pressed={c.hex === r.color}
                            onClick={() =>
                              setPieces((ps) => ps.map((x) => (r.keys.includes(x.key) ? { ...x, color: c.hex } : x)))
                            }
                          />
                        ))}
                      </span>
                    )}
                    <span className="qty-step" role="group" aria-label={(p?.name || "Ürün") + " adedi"}>
                      <button
                        className="icon"
                        disabled={pieces.length < 2}
                        aria-label={(p?.name || "Ürün") + " bir adet azalt"}
                        onClick={() => removeKeys([r.keys[r.keys.length - 1]])}
                      >
                        −
                      </button>
                      <b>× {r.keys.length}</b>
                      <button
                        className="icon"
                        disabled={pieces.length >= 12}
                        aria-label={(p?.name || "Ürün") + " bir adet artır"}
                        onClick={() => addOne(r)}
                      >
                        +
                      </button>
                    </span>
                    {rows.length > 1 && (
                      <button
                        className="icon"
                        aria-label={(p?.name || "Ürün") + " sahneden çıkar"}
                        onClick={() => removeKeys(r.keys)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="piece-add">
                <select value={addId} onChange={(e) => setAddId(e.target.value)} aria-label="Sahneye eklenecek ürün">
                  <option value="">Ürün seç…</option>
                  {candidates.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name} · {money(p.price)}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary"
                  disabled={!addId || pieces.length >= 12}
                  onClick={() => {
                    addPiece(productOf(addId));
                    setAddId("");
                  }}
                >
                  + Sahneye ekle
                </button>
              </div>
            </div>
            <div className="studio-adjust">
              <strong className="target-label">Ayarlanan: {targetLabel}</strong>
              <label>
                Boyut · {tv.scale.toFixed(2)}×
                <input
                  type="range"
                  min=".2"
                  max="3"
                  step=".05"
                  value={tv.scale}
                  onChange={(e) => patch(target, { scale: +e.target.value })}
                />
              </label>
              <label>
                Döndürme · {tv.rotation}°
                <input
                  type="range"
                  min="0"
                  max="360"
                  value={tv.rotation}
                  onChange={(e) => {
                    // Gruptaki parçalar kendi yönlerini korur; hepsi aynı açı kadar döner.
                    const d = +e.target.value - tv.rotation;
                    patch(target, (v) => ({ rotation: (((v.rotation + d) % 360) + 360) % 360 }));
                  }}
                />
              </label>
              {(activePiece || !multi) && (
                <label>
                  {activePiece ? "Seçili ürünü değiştir" : "Ürünü değiştir"}
                  <select
                    value={(activePiece || pieces[0]).productId}
                    onChange={(e) => swapPiece(target, productOf(e.target.value))}
                  >
                    {candidates.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span className="adjust-links">
                <button
                  className="text-btn"
                  onClick={() =>
                    activePiece
                      ? patch(target, selectedKeys.length > 1 ? { scale: 1 } : { scale: 1, rotation: 0 })
                      : setGroup({ x: 0, y: 0, rotation: 0, scale: multi ? 0.8 : 1 })
                  }
                >
                  {activePiece ? "Seçileni sıfırla" : "Yerleşimi sıfırla"}
                </button>
                <button className="text-btn" disabled={status !== "ready"} onClick={downloadImage}>
                  Görüntüyü indir (PNG)
                </button>
              </span>
            </div>
            <label className="upload">
              ↥ {photo ? "Fotoğrafı değiştir" : "Bahçe fotoğrafı yükle"}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" onChange={upload} />
            </label>
            <small>JPEG veya PNG · en fazla {preview.maxPhotoMb} MB · fotoğrafı görüntünün üzerine de sürükleyebilirsiniz</small>
            {canSave && (
              <div className="save-row">
                <input
                  value={name}
                  maxLength="80"
                  aria-label="Tasarım adı"
                  placeholder="Tasarım adı"
                  onChange={(e) => setName(e.target.value)}
                />
                <button className="secondary" disabled={busy || !name.trim()} onClick={saveLayout}>
                  Yerleşimi kaydet
                </button>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={savePhoto}
                    disabled={!photo?.file}
                    onChange={(e) => setSavePhoto(e.target.checked)}
                  />
                  Bahçe fotoğrafını da hesabıma kaydet
                </label>
              </div>
            )}
            {!user && preview.saveLayoutEnabled && (
              <button className="secondary" onClick={onLoginRequest}>
                Yerleşimi kaydetmek için giriş yap
              </button>
            )}
            <p className="studio-price">
              {single ? (
                <>
                  <strong>{money(single.price)}</strong> ·{" "}
                  {single.stock > 0 ? `${single.stock} adet stokta` : "Stokta yok"}
                </>
              ) : (
                <>
                  <strong>{money(total)}</strong> · sahnedeki {pieces.length} ürünün toplamı
                </>
              )}
            </p>
            {shortage.length > 0 && !single && (
              <small className="warn">
                Stok yetersiz: {[...new Set(shortage.map((l) => l.product.name))].join(", ")}
              </small>
            )}
            {canBuy &&
              (single ? (
                <button
                  className="primary"
                  disabled={!single.stock || busy}
                  onClick={() => onAddToCart(single, { color: pieces[0].color })}
                >
                  {single.stock ? "Satın al · Sepete ekle" : VAL.VAL004}
                </button>
              ) : (
                <button className="primary" disabled={busy || shortage.length > 0} onClick={buyAll}>
                  Sahnedekileri sepete ekle · {money(total)}
                </button>
              ))}
            {saved.length > 0 && <strong>Kayıtlı yerleşimlerim</strong>}
            {saved.map((d) => (
              <div className="saved-row" key={d._id}>
                <button className="saved" onClick={() => openSaved(d)}>
                  {d.name} {d.photoRef ? "· 📷" : ""} ↗
                </button>
                <button
                  className="icon"
                  aria-label={d.name + " yerleşimini sil"}
                  onClick={() => removeSaved(d)}
                >
                  ×
                </button>
              </div>
            ))}
            {loadMs !== null && (
              <small className={loadMs > preview.loadTargetSec * 1000 ? "warn" : ""}>
                Model yükleme süresi: {(loadMs / 1000).toFixed(1)} sn (hedef ≤ {preview.loadTargetSec} sn)
              </small>
            )}
            <small>
              Gizlilik: bahçe fotoğrafı yalnızca önizleme için tarayıcınızda
              kullanılır; siz kaydetmeyi seçmedikçe sunucuya gönderilmez ve
              hiçbir zaman analitik olaylarına ya da loglara yazılmaz.
            </small>
            <p className="representative">
              Önizleme fotoğraf tabanlı ve temsilidir; yüzey, ölçü veya ışık
              algılamaz. Gerçek boyut ve perspektif birebir yansımayabilir.
              Önizleme fiyatı, stoğu ve siparişi etkilemez.
            </p>
          </aside>
        </div>
      </section>
    </div>
  );
}
