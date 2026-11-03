import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { VAL, money } from "./util.js";

/* Temsili Three.js modeli (builtin:<tip>) */
function buildBuiltin(type, color) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: color || "#b79b77", roughness: 0.85 }),
    fabric = new THREE.MeshStandardMaterial({ color: "#eee6d9", roughness: 1 });
  const box = (w, h, d, x, y, z, mat = wood) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
  };
  const table = type === "table",
    sofa = type === "sofa",
    lounger = type === "lounger";
  const w = sofa ? 2.6 : table ? 2.7 : 1.2,
    d = lounger ? 2.5 : table ? 1.6 : 1.15;
  box(w, 0.15, d, 0, 0, 0);
  for (const x of [-w / 2 + 0.12, w / 2 - 0.12])
    for (const z of [-d / 2 + 0.12, d / 2 - 0.12]) box(0.12, 0.8, 0.12, x, -0.45, z);
  if (!table) {
    box(w - 0.12, 0.2, d - 0.12, 0, 0.16, 0, fabric);
    box(w, 0.85, 0.12, 0, 0.5, -d / 2);
    box(w - 0.15, 0.65, 0.17, 0, 0.5, -d / 2 + 0.1, fabric);
    for (const x of [-w / 2, w / 2]) box(0.12, 0.45, d, x, 0.3, 0);
    if (sofa)
      for (const x of [-0.82, 0, 0.82]) box(0.76, 0.15, 0.94, x, 0.29, 0.02, fabric);
  }
  return group;
}
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

export default function Studio({
  product: initial,
  products,
  user,
  api,
  notify,
  onClose,
  onAddToCart,
  settings,
}) {
  const host = useRef(),
    sceneRef = useRef(null),
    modelRef = useRef(null),
    fileRef = useRef(null);
  const preview = settings?.preview || { maxPhotoMb: 8, loadTargetSec: 5, saveLayoutEnabled: true };
  const candidates = products.filter((p) => p.model3dUrl && p.isActive !== false);
  const [product, setProduct] = useState(initial),
    [photo, setPhoto] = useState(null),
    [scale, setScale] = useState(1),
    [rotation, setRotation] = useState(0),
    [name, setName] = useState("Bahçem"),
    [position, setPosition] = useState({ x: 0, y: 0 }),
    [saved, setSaved] = useState([]),
    [savePhoto, setSavePhoto] = useState(false),
    [status, setStatus] = useState("loading"),
    [loadMs, setLoadMs] = useState(null),
    [busy, setBusy] = useState(false);
  const canSave = preview.saveLayoutEnabled && ["customer", "admin"].includes(user?.role);
  const canBuy = ["customer", "admin"].includes(user?.role);

  useEffect(() => {
    api("/api/designs")
      .then(setSaved)
      .catch(() => {});
  }, []);

  /* Sahne bir kez kurulur; ürün değişince yalnızca model değişir (FR-030). */
  useEffect(() => {
    const el = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
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
    el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6d6957, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 5, 4);
    scene.add(light);
    const holder = new THREE.Group();
    scene.add(holder);
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
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const started = performance.now();
    setStatus((s) => (s === "nowebgl" ? s : "loading"));
    (async () => {
      let info;
      try {
        // Erişim sunucuda da doğrulanır (BR-024): oturumsuz istek 401 döner.
        info = await api("/api/preview/" + product._id);
      } catch (e) {
        if (!cancelled) {
          setStatus("unavailable");
          notify(e.message);
        }
        return;
      }
      const holder = sceneRef.current;
      if (!holder) return;
      let model;
      try {
        model = info.model3dUrl.startsWith("builtin:")
          ? buildBuiltin(info.model3dUrl.slice(8), info.color)
          : await loadGltf(info.model3dUrl, Math.max(preview.loadTargetSec, 1) * 2000);
      } catch {
        if (!cancelled) {
          setStatus("unavailable");
          notify(VAL.VAL018);
        }
        return;
      }
      if (cancelled) return disposeTree(model);
      if (modelRef.current) {
        holder.remove(modelRef.current);
        disposeTree(modelRef.current);
      }
      holder.add(model);
      modelRef.current = model;
      setLoadMs(Math.round(performance.now() - started));
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [product._id]);

  useEffect(() => {
    const g = sceneRef.current;
    if (g) {
      g.scale.setScalar(scale);
      g.rotation.y = (rotation * Math.PI) / 180 + 0.4;
      g.position.set(position.x, position.y, 0);
    }
  }, [scale, rotation, position, status]);
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

  /* Fare ile sürükleme; dokunmatikte tek parmak sürükleme, iki parmak
     sıkıştırma (ölçek) ve çevirme (döndürme) — FR-029. */
  const pointers = useRef(new Map()),
    gesture = useRef(null);
  const snapshot = () => {
    const pts = [...pointers.current.values()];
    if (pts.length === 1)
      gesture.current = { kind: "drag", x: pts[0].x, y: pts[0].y, p: position };
    else if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = {
        kind: "pinch",
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        scale,
        rotation,
      };
    } else gesture.current = null;
  };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const onPointerDown = (e) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    snapshot();
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.kind === "drag" && pts.length === 1)
      setPosition({
        x: clamp(g.p.x + (pts[0].x - g.x) / 90, -10, 10),
        y: clamp(g.p.y - (pts[0].y - g.y) / 90, -10, 10),
      });
    if (g.kind === "pinch" && pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      setScale(clamp(+(g.scale * (dist / (g.dist || 1))).toFixed(2), 0.2, 3));
      setRotation(Math.round((((g.rotation + ((angle - g.angle) * 180) / Math.PI) % 360) + 360) % 360));
    }
  };
  const onPointerEnd = (e) => {
    pointers.current.delete(e.pointerId);
    snapshot();
  };
  const onWheel = (e) => setScale((s) => clamp(+(s - e.deltaY * 0.001).toFixed(2), 0.2, 3));
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
      setPosition((p) => ({
        x: clamp(p.x + moves[e.key][0], -10, 10),
        y: clamp(p.y + moves[e.key][1], -10, 10),
      }));
    }
  };

  const saveLayout = async () => {
    setBusy(true);
    try {
      const d = await api("/api/designs", {
        method: "POST",
        body: JSON.stringify({
          name,
          productId: product._id,
          x: +position.x.toFixed(3),
          y: +position.y.toFixed(3),
          scale,
          rotation,
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
    const p = products.find((x) => x._id === d.productId);
    if (!p) return notify(VAL.VAL018);
    setProduct(p);
    setPosition({ x: d.x, y: d.y });
    setScale(d.scale);
    setRotation(d.rotation);
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
            aria-label="Önizleme alanı. Ok tuşlarıyla mobilyayı taşıyabilirsiniz."
            style={{ backgroundImage: `url(${photo?.url || "/images/garden-hero.png"})` }}
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
              Sürükleyerek taşıyın · iki parmakla büyütün/döndürün · tekerlekle ölçekleyin
            </span>
          </div>
          <aside>
            <label>
              Ürün
              <select
                value={product._id}
                onChange={(e) => setProduct(candidates.find((p) => p._id === e.target.value))}
              >
                {candidates.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="studio-price">
              <strong>{money(product.price)}</strong> ·{" "}
              {product.stock > 0 ? `${product.stock} adet stokta` : "Stokta yok"}
            </p>
            <p className="representative">
              Önizleme fotoğraf tabanlı ve temsilidir; yüzey, ölçü veya ışık
              algılamaz. Gerçek boyut ve perspektif birebir yansımayabilir.
              Önizleme fiyatı, stoğu ve siparişi etkilemez.
            </p>
            <label className="upload">
              ↥ {photo ? "Fotoğrafı değiştir" : "Bahçe fotoğrafı yükle"}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={upload}
              />
            </label>
            <small>JPEG veya PNG · en fazla {preview.maxPhotoMb} MB</small>
            <label>
              Boyut · {scale.toFixed(2)}×
              <input
                type="range"
                min=".2"
                max="3"
                step=".05"
                value={scale}
                onChange={(e) => setScale(+e.target.value)}
              />
            </label>
            <label>
              Döndürme · {rotation}°
              <input
                type="range"
                min="0"
                max="360"
                value={rotation}
                onChange={(e) => setRotation(+e.target.value)}
              />
            </label>
            <button
              className="text-btn"
              onClick={() => {
                setScale(1);
                setRotation(0);
                setPosition({ x: 0, y: 0 });
              }}
            >
              Yerleşimi sıfırla
            </button>
            {canBuy && (
              <button
                className="primary"
                disabled={!product.stock}
                onClick={() => onAddToCart(product)}
              >
                {product.stock ? "Satın al · Sepete ekle" : VAL.VAL004}
              </button>
            )}
            {canSave && (
              <>
                <label>
                  Tasarım adı
                  <input value={name} maxLength="80" onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={savePhoto}
                    disabled={!photo?.file}
                    onChange={(e) => setSavePhoto(e.target.checked)}
                  />
                  Bahçe fotoğrafını da hesabıma kaydet
                </label>
                <button className="secondary" disabled={busy || !name.trim()} onClick={saveLayout}>
                  Yerleşimimi kaydet
                </button>
              </>
            )}
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
          </aside>
        </div>
      </section>
    </div>
  );
}
