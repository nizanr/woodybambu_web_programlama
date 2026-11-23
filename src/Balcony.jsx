import React, { useState } from "react";
import { money } from "./util.js";

/* FR-034 — Balkon ölçüsüne göre mobilya önerisi.
   Kullanıcı balkonun enini ve derinliğini (cm) girer; sunucu yürüme payı
   bırakarak sığan ürünleri ve takımları döndürür (BR-025). Seçilen öneri
   kuşbakışı plan üzerinde gösterilir. */

const PRESETS = [
  { label: "Küçük balkon", w: 300, d: 120 },
  { label: "Orta balkon", w: 400, d: 180 },
  { label: "Geniş teras", w: 600, d: 350 },
];
const VAL021 = "Balkon eni ve derinliği 50–2000 cm arasında tam sayı olmalıdır.";
const valid = (v) => Number.isInteger(v) && v >= 50 && v <= 2000;
const cm = (v) => `${Math.round(v)} cm`;

function Plan({ balcony, option }) {
  const { width: W, depth: D } = balcony;
  const pad = Math.max(W, D) * 0.06;
  const fit = option?.fit;
  const font = Math.max(Math.min(W, D) * 0.09, 12);
  return (
    <svg
      className="balcony-plan"
      viewBox={`${-pad} ${-pad - font * 1.6} ${W + pad * 2} ${D + pad * 2 + font * 3.2}`}
      role="img"
      aria-label={
        option
          ? `Kuşbakışı plan: ${W}×${D} cm balkona ${option.title || option.product.name} yerleştirildi`
          : `Kuşbakışı plan: ${W}×${D} cm balkon`
      }
    >
      <defs>
        <pattern id="walk" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="16" stroke="#c9cdbf" strokeWidth="5" />
        </pattern>
      </defs>
      <text className="plan-edge" x={W / 2} y={-font * 0.6} fontSize={font} textAnchor="middle">
        Duvar / kapı tarafı
      </text>
      <rect x="0" y="0" width={W} height={D} className="plan-floor" />
      {fit &&
        (fit.walkway === "wall" ? (
          <rect x="0" y="0" width={W} height={fit.y} fill="url(#walk)" />
        ) : (
          <rect x="0" y="0" width={fit.x} height={D} fill="url(#walk)" />
        ))}
      {fit &&
        option.rects.map((r, i) => (
          <g key={i}>
            <rect
              x={fit.x + r.x}
              y={fit.y + r.y}
              width={r.w}
              height={r.d}
              rx={Math.min(r.w, r.d) * 0.08}
              className={"plan-piece kind-" + r.label}
            />
            <text
              x={fit.x + r.x + r.w / 2}
              y={fit.y + r.y + r.d / 2}
              fontSize={Math.min(font, Math.min(r.w, r.d) * 0.45)}
              textAnchor="middle"
              dominantBaseline="central"
              className="plan-label"
            >
              {r.label}
            </text>
          </g>
        ))}
      <rect x="0" y="0" width={W} height={D} className="plan-outline" />
      <text className="plan-edge" x={W / 2} y={D + font * 1.4} fontSize={font} textAnchor="middle">
        Korkuluk · {W} × {D} cm
      </text>
    </svg>
  );
}

export default function Balcony({ api, products, onPreview, onDetail, onPreviewSet, onAddSet }) {
  const [width, setWidth] = useState("");
  const [depth, setDepth] = useState("");
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const full = (lean) => products.find((p) => p._id === lean._id) || lean;
  const parts = (set) => set.items.map((i) => ({ product: full(i.product), qty: i.qty }));
  const run = async (w, d) => {
    if (!valid(w) || !valid(d)) return setError(VAL021);
    setError("");
    setBusy(true);
    try {
      const r = await api(`/api/recommend?width=${w}&depth=${d}`);
      setResult(r);
      setSelected(r.sets[0] || r.items[0] || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e) => {
    e.preventDefault();
    run(Number(width), Number(depth));
  };
  const preset = (p) => {
    setWidth(String(p.w));
    setDepth(String(p.d));
    run(p.w, p.d);
  };
  const options = result ? [...result.sets, ...result.items] : [];

  const Card = ({ o }) => {
    const isSet = !!o.items;
    const lead = full(isSet ? o.items[0].product : o.product);
    return (
      <li className={"balcony-option" + (o === selected ? " selected" : "")}>
        <button
          className="balcony-pick"
          aria-pressed={o === selected}
          onClick={() => setSelected(o)}
        >
          <strong>{isSet ? o.title : o.product.name}</strong>
          <span>
            {isSet
              ? o.items.map((i) => `${i.qty} × ${i.product.name}`).join(" · ")
              : `${cm(o.size.w)} × ${cm(o.size.d)}${o.size.h ? ` × ${cm(o.size.h)}` : ""}`}
          </span>
          <span className="balcony-meta">
            {money(isSet ? o.total : o.product.price)} · alanın %{o.usage}'i
            {o.fit.rotated ? " · yan çevrilmiş" : ""}
          </span>
        </button>
        <div className="balcony-actions">
          {isSet ? (
            <>
              {parts(o).every((i) => i.product.model3dUrl) && (
                <button className="text-btn" onClick={() => onPreviewSet(parts(o))}>
                  Takımı bahçende gör
                </button>
              )}
              <button className="text-btn" onClick={() => onAddSet(parts(o))}>
                Takımı sepete ekle
              </button>
            </>
          ) : (
            <>
              {lead.model3dUrl && (
                <button className="text-btn" onClick={() => onPreview(lead)}>
                  Bahçede Gör
                </button>
              )}
              <button className="text-btn" onClick={() => onDetail(lead)}>
                İncele
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="balcony" id="balcony" aria-labelledby="balcony-title">
      <div className="section-heading reveal">
        <div>
          <span className="eyebrow">BALKONUNA NE SIĞAR?</span>
          <h2 id="balcony-title">Ölçünü gir, sığanı görelim.</h2>
        </div>
        <p>
          Yürüme payı bırakarak sığan ürünleri ve takımları önerelim.
          <br />
          Ölçüler santimetre cinsindendir.
        </p>
      </div>
      <form className="balcony-form" onSubmit={submit} noValidate>
        <label>
          En (duvar boyunca)
          <span className="unit-input">
            <input
              inputMode="numeric"
              type="number"
              min="50"
              max="2000"
              step="1"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              placeholder="örn. 300"
              aria-describedby="balcony-error"
            />
            <span>cm</span>
          </span>
        </label>
        <label>
          Derinlik (duvardan korkuluğa)
          <span className="unit-input">
            <input
              inputMode="numeric"
              type="number"
              min="50"
              max="2000"
              step="1"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              placeholder="örn. 150"
              aria-describedby="balcony-error"
            />
            <span>cm</span>
          </span>
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Hesaplanıyor…" : "Önerileri göster"}
        </button>
        <div className="balcony-presets" aria-label="Hazır ölçüler">
          {PRESETS.map((p) => (
            <button type="button" key={p.label} onClick={() => preset(p)}>
              {p.label} · {p.w}×{p.d}
            </button>
          ))}
        </div>
        <p id="balcony-error" className="balcony-error" role="alert">
          {error}
        </p>
      </form>
      {result && (
        <div className="balcony-result">
          <Plan balcony={result.balcony} option={selected} />
          <div className="balcony-list">
            {!options.length ? (
              <p className="balcony-empty">
                Bu ölçüye {result.walkwayCm} cm yürüme payı bırakarak sığan bir ürünümüz yok.
                Daha küçük bir köşe için tek sandalyeyi ya da ölçüleri yeniden deneyin.
              </p>
            ) : (
              <>
                {result.sets.length > 0 && (
                  <>
                    <h3>Takım önerileri</h3>
                    <ul>
                      {result.sets.map((o) => (
                        <Card key={"s" + o.title} o={o} />
                      ))}
                    </ul>
                  </>
                )}
                {result.items.length > 0 && (
                  <>
                    <h3>Tek tek sığan ürünler</h3>
                    <ul>
                      {result.items.map((o) => (
                        <Card key={"i" + o.product._id} o={o} />
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
            <small>
              Planda M masa, S sandalye, K kanepe, Ş şezlong; taralı alan geçiş payıdır.
              <br />
              Öneriler yaklaşıktır: mobilya korkuluk tarafına yerleştirilir ve en az{" "}
              {result.walkwayCm} cm geçiş payı bırakılır. Kapı ve pencere açılımını ayrıca
              kontrol edin. Yalnızca stokta olan ürünler önerilir.
            </small>
          </div>
        </div>
      )}
    </section>
  );
}
