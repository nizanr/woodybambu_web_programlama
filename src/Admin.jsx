import React, { useEffect, useState } from "react";
import {
  money,
  ROLE_LABELS,
  STATUS_LABELS,
  NEXT_STATUS,
  MODEL_TYPES,
  istanbulDate,
} from "./util.js";

const STAFF_TABS = [
  ["products", "Ürünler"],
  ["categories", "Kategoriler"],
  ["orders", "Siparişler"],
  ["reports", "Raporlar"],
];
const ADMIN_TABS = [
  ["users", "Kullanıcılar"],
  ["settings", "Ayarlar"],
  ["audit", "Denetim kaydı"],
];
const PRODUCT_STATUS = {
  published: "Yayında",
  draft: "Taslak",
  inactive: "Pasif",
};
const isoDay = (offset = 0) =>
  new Date(Date.now() + offset * 86400000).toLocaleDateString("sv-SE", {
    timeZone: "Europe/Istanbul",
  });

export default function Admin({ user, api, notify, refresh }) {
  const [data, setData] = useState(null),
    [tab, setTab] = useState("products"),
    [editing, setEditing] = useState(null);
  const load = () =>
    api("/api/admin")
      .then(setData)
      .catch((e) => notify(e.message));
  useEffect(() => {
    load();
  }, []);
  if (!["manager", "admin"].includes(user?.role))
    return <main className="about">Yetkiniz yok.</main>;
  const isAdmin = user.role === "admin";
  const send = async (url, method, body, message = "Güncellendi") => {
    try {
      const r = await api(url, { method, body: JSON.stringify(body) });
      load();
      refresh();
      notify(message);
      return r;
    } catch (e) {
      notify(e.message);
    }
  };
  const tabs = isAdmin ? [...STAFF_TABS, ...ADMIN_TABS] : STAFF_TABS;
  return (
    <main className="admin">
      <span className="eyebrow">YÖNETİM PANELİ · {ROLE_LABELS[user.role]}</span>
      <h1>Her şey kontrolünde.</h1>
      <div className="tabs" role="tablist">
        {tabs.map(([t, label]) => (
          <button
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
            key={t}
            role="tab"
            aria-selected={tab === t}
          >
            {label}
          </button>
        ))}
      </div>
      {!data ? (
        <p>Yükleniyor…</p>
      ) : (
        <>
          <div className="stats">
            <div>
              <small>ÜRÜNLER</small>
              <h2>{data.products.length}</h2>
            </div>
            <div>
              <small>SİPARİŞLER</small>
              <h2>{data.orders.length}</h2>
            </div>
            <div>
              <small>DÜŞÜK STOK (≤3)</small>
              <h2>{data.products.filter((p) => p.stock <= 3).length}</h2>
            </div>
          </div>
          {tab === "products" && (
            <Products
              data={data}
              editing={editing}
              setEditing={setEditing}
              send={send}
            />
          )}
          {tab === "categories" && <Categories data={data} send={send} />}
          {tab === "orders" && <Orders data={data} send={send} />}
          {tab === "reports" && <Reports api={api} notify={notify} />}
          {tab === "users" && isAdmin && (
            <Users data={data} user={user} send={send} />
          )}
          {tab === "settings" && isAdmin && (
            <Settings api={api} notify={notify} refresh={refresh} />
          )}
          {tab === "audit" && isAdmin && <Audit api={api} notify={notify} />}
        </>
      )}
    </main>
  );
}

function Products({ data, editing, setEditing, send }) {
  const modelValue = editing?.model3dUrl ?? "builtin:chair";
  const [modelKind, setModelKind] = useState(
    modelValue.startsWith("https://") ? "url" : modelValue,
  );
  useEffect(() => {
    const v = editing?.model3dUrl ?? "builtin:chair";
    setModelKind(v.startsWith("https://") ? "url" : v);
  }, [editing]);
  return (
    <>
      <h2>{editing ? "Ürünü düzenle" : "Yeni ürün ekle"}</h2>
      <form
        key={editing?._id || "new"}
        className="admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.target));
          f.price = +f.price;
          f.stock = +f.stock;
          f.model3dUrl = modelKind === "url" ? f.modelUrl.trim() : modelKind;
          delete f.modelUrl;
          const r = await send(
            "/api/admin/products" + (editing ? "/" + editing._id : ""),
            editing ? "PATCH" : "POST",
            f,
            "Ürün kaydedildi",
          );
          if (r) {
            setEditing(null);
            e.target.reset();
          }
        }}
      >
        <label>
          Ürün adı
          <input
            name="name"
            required
            maxLength="120"
            defaultValue={editing?.name}
          />
        </label>
        <label>
          Kategori
          <select name="categoryId" defaultValue={editing?.categoryId} required>
            {data.categories
              .filter((c) => c.isActive || c._id === editing?.categoryId)
              .map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Fiyat (TL)
          <input
            name="price"
            type="number"
            min="0.01"
            step="0.01"
            required
            defaultValue={editing?.price}
          />
        </label>
        <label>
          Stok
          <input
            name="stock"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={editing?.stock}
          />
        </label>
        <label>
          Yayın durumu
          <select name="status" defaultValue={editing?.status || "published"}>
            {Object.entries(PRODUCT_STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Görsel adresi (HTTPS veya /images/…)
          <input
            name="image"
            type="text"
            required
            defaultValue={editing?.image}
          />
        </label>
        <label>
          3D model
          <select
            value={modelKind}
            onChange={(e) => setModelKind(e.target.value)}
          >
            {Object.entries(MODEL_TYPES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
            <option value="url">Harici GLB/GLTF dosyası</option>
            <option value="">3D model yok (Bahçede Gör kapalı)</option>
          </select>
        </label>
        {modelKind === "url" && (
          <label>
            3D model HTTPS adresi (.glb / .gltf)
            <input
              name="modelUrl"
              type="url"
              required
              pattern="https://.+\.(glb|gltf)(\?.*)?"
              defaultValue={modelValue.startsWith("https://") ? modelValue : ""}
            />
          </label>
        )}
        <label>
          Model rengi
          <input
            name="color"
            type="color"
            defaultValue={editing?.color || "#b79b77"}
          />
        </label>
        <label>
          Açıklama
          <input
            name="description"
            maxLength="1000"
            defaultValue={editing?.description}
          />
        </label>
        <button className="primary">Kaydet</button>
        {editing && (
          <button type="button" onClick={() => setEditing(null)}>
            Vazgeç
          </button>
        )}
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Ürün</th>
              <th>Kategori</th>
              <th>Fiyat</th>
              <th>Stok</th>
              <th>Durum</th>
              <th>3D</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p._id}>
                <td>{p.name}</td>
                <td>{p.category}</td>
                <td>{money(p.price)}</td>
                <td className={p.stock <= 3 ? "warn" : ""}>{p.stock}</td>
                <td>{PRODUCT_STATUS[p.status]}</td>
                <td>{p.model3dUrl ? "✓" : "—"}</td>
                <td>
                  <button onClick={() => setEditing(p)}>Düzenle</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Categories({ data, send }) {
  return (
    <>
      <h2>Kategoriler</h2>
      <form
        className="admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = new FormData(e.target).get("name");
          if (
            await send(
              "/api/admin/categories",
              "POST",
              { name },
              "Kategori eklendi",
            )
          )
            e.target.reset();
        }}
      >
        <label>
          Yeni kategori adı
          <input name="name" required maxLength="40" />
        </label>
        <button className="primary">Ekle</button>
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Kategori</th>
              <th>Ürün</th>
              <th>Durum</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {data.categories.map((c) => (
              <tr key={c._id}>
                <td>{c.name}</td>
                <td>
                  {data.products.filter((p) => p.categoryId === c._id).length}
                </td>
                <td>{c.isActive ? "Aktif" : "Pasif"}</td>
                <td>
                  <button
                    onClick={() =>
                      send("/api/admin/categories/" + c._id, "PATCH", {
                        isActive: !c.isActive,
                      })
                    }
                  >
                    {c.isActive ? "Pasif yap" : "Aktif yap"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Orders({ data, send }) {
  if (!data.orders.length) return <p>Henüz sipariş yok.</p>;
  return data.orders.map((o) => (
    <div className="order" key={o._id}>
      <div>
        <strong>
          #{o._id.slice(-8).toUpperCase()} · {money(o.total)}
        </strong>
        <span className="badge">{STATUS_LABELS[o.status] || o.status}</span>
      </div>
      <p>{o.items.map((i) => i.name + " × " + i.quantity).join(", ")}</p>
      <p>{o.address}</p>
      <small>
        {istanbulDate(o.createdAt)} ·{" "}
        {o.paymentMode === "iyzico" ? "iyzico" : "Demo ödeme"}
      </small>
      {NEXT_STATUS[o.status] && (
        <button
          className="secondary"
          onClick={() =>
            send("/api/admin/orders/" + o._id, "PATCH", {
              status: NEXT_STATUS[o.status],
            })
          }
        >
          Durumu “{STATUS_LABELS[NEXT_STATUS[o.status]]}” yap
        </button>
      )}
    </div>
  ));
}

function Reports({ api, notify }) {
  const [range, setRange] = useState({ from: isoDay(-29), to: isoDay() }),
    [report, setReport] = useState(null),
    [error, setError] = useState("");
  const query = `from=${range.from}&to=${range.to}`;
  const run = async () => {
    setError("");
    try {
      setReport(await api("/api/reports/summary?" + query));
    } catch (e) {
      setReport(null);
      setError(e.message);
    }
  };
  useEffect(() => {
    run();
  }, []);
  const pct = (v) => (v === null || v === undefined ? "Veri yok" : "%" + v);
  return (
    <>
      <h2>Ürün etkileşim raporu</h2>
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <label>
          Başlangıç
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
          />
        </label>
        <label>
          Bitiş
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
          />
        </label>
        <button className="primary">Raporu getir</button>
        <a
          className="secondary button-link"
          href={"/api/reports/summary.csv?" + query}
          onClick={(e) => {
            if (!range.from || !range.to || range.from > range.to) {
              e.preventDefault();
              notify(
                !range.from || !range.to
                  ? "Rapor için tarih aralığı seçiniz."
                  : "Başlangıç tarihi bitiş tarihinden sonra olamaz.",
              );
            }
          }}
        >
          CSV dışa aktar
        </a>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <p className="muted">
            Dönem: {report.range.from} – {report.range.to} (
            {report.range.timezone}) · Son güncelleme:{" "}
            {istanbulDate(report.lastUpdated)} · Rapor geçmiş olayları gösterir,
            anlık kesin sonuç garantisi vermez.
          </p>
          <div className="stats kpis">
            <div>
              <small>ÜRÜN GÖRÜNTÜLEME · olay</small>
              <h2>{report.kpis.productViews}</h2>
            </div>
            <div>
              <small>SEPETE EKLEME · olay</small>
              <h2>{report.kpis.addToCart}</h2>
            </div>
            <div>
              <small>ÖDEME BAŞLATAN · tekil oturum</small>
              <h2>{report.kpis.checkoutSessions}</h2>
            </div>
            <div>
              <small>SATIN ALMA · başarılı sipariş</small>
              <h2>{report.kpis.purchases}</h2>
            </div>
            <div>
              <small>
                SEPET TERK ({report.range.abandonmentHours} sa) · oturum
              </small>
              <h2>{pct(report.kpis.abandonmentRate)}</h2>
            </div>
            <div>
              <small>SEPETE EKLEYİP ALMAYAN · oturum</small>
              <h2>{pct(report.kpis.cartAddNoPurchaseRate)}</h2>
            </div>
            <div>
              <small>DÖNÜŞÜM · oturum</small>
              <h2>{pct(report.kpis.conversionRate)}</h2>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ürün (en çok ilgi görene göre)</th>
                  <th>Görüntüleme</th>
                  <th>Sepete ekleme</th>
                  <th>Satılan adet</th>
                  <th>Sipariş</th>
                </tr>
              </thead>
              <tbody>
                {report.products.map((p) => (
                  <tr key={p.productId}>
                    <td>{p.name}</td>
                    <td>{p.views}</td>
                    <td>{p.addToCart}</td>
                    <td>{p.purchasedQty}</td>
                    <td>{p.orders}</td>
                  </tr>
                ))}
                {!report.products.length && (
                  <tr>
                    <td colSpan="5">Seçili dönemde veri yok.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Users({ data, user, send }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Ad</th>
            <th>E-posta</th>
            <th>Rol</th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((u) => (
            <tr key={u._id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                {u._id !== user.id ? (
                  <select
                    value={u.role}
                    aria-label={u.name + " rolü"}
                    onChange={(e) =>
                      send("/api/admin/users/" + u._id, "PATCH", {
                        role: e.target.value,
                      })
                    }
                  >
                    {Object.entries(ROLE_LABELS).map(([r, l]) => (
                      <option key={r} value={r}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : (
                  ROLE_LABELS[u.role]
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FIELDS = [
  [
    "commerce",
    "shippingFee",
    "num_shipping_fee — Kargo bedeli (TL)",
    "number",
    0.01,
  ],
  [
    "commerce",
    "freeShipThreshold",
    "num_free_ship_threshold — Ücretsiz kargo alt limiti (0 = kapalı)",
    "number",
    0.01,
  ],
  [
    "commerce",
    "couponEnabled",
    "chk_coupon_enabled — İndirim kodu alanı",
    "checkbox",
  ],
  ["commerce", "pageSize", "num_page_size — Katalog sayfa boyutu", "number", 1],
  [
    "commerce",
    "inventoryGate",
    "chk_inventory_gate — Stok kontrolü (kapatılamaz)",
    "checkbox",
  ],
  ["commerce", "lowStockThreshold", "Kritik stok bildirim eşiği", "number", 1],
  [
    "analytics",
    "abandonmentHours",
    "num_abandonment_hours — Sepet terk penceresi (saat)",
    "number",
    1,
  ],
  [
    "analytics",
    "eventRetentionDays",
    "num_event_retention_days — Ham olay saklama (gün)",
    "number",
    1,
  ],
  [
    "analytics",
    "optionalAnalytics",
    "chk_optional_analytics — İsteğe bağlı analitik",
    "checkbox",
  ],
  [
    "analytics",
    "reportTimezone",
    "cmb_report_timezone — Rapor saat dilimi",
    "select",
  ],
  ["preview", "enabled", "chk_preview_enabled — “Bahçede Gör”", "checkbox"],
  [
    "preview",
    "maxPhotoMb",
    "num_max_photo_mb — Fotoğraf üst boyutu (MB)",
    "number",
    1,
  ],
  [
    "preview",
    "loadTargetSec",
    "num_preview_load_sec — Yükleme hedefi (sn)",
    "number",
    1,
  ],
  [
    "preview",
    "saveLayoutEnabled",
    "chk_save_layout_enabled — Yerleşimi kaydetme",
    "checkbox",
  ],
];
function Settings({ api, notify, refresh }) {
  const [s, setS] = useState(null),
    [coupons, setCoupons] = useState([]);
  const load = () =>
    Promise.all([api("/api/admin/settings"), api("/api/admin/coupons")])
      .then(([a, b]) => {
        setS(a);
        setCoupons(b);
      })
      .catch((e) => notify(e.message));
  useEffect(() => {
    load();
  }, []);
  if (!s) return <p>Yükleniyor…</p>;
  return (
    <>
      <h2>Parametrik ayarlar</h2>
      <p className="muted">
        Sürüm {s.version} · Değişiklikler yalnızca yeni işlemlere uygulanır;
        ödenmiş siparişler değişmez. Her değişiklik önce/sonra değerleriyle
        denetim kaydına yazılır.
      </p>
      <form
        className="admin-form settings-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = { commerce: {}, analytics: {}, preview: {} };
          const form = e.target;
          for (const [g, k, , type] of FIELDS) {
            const el = form.elements[`${g}.${k}`];
            body[g][k] =
              type === "checkbox"
                ? el.checked
                : type === "number"
                  ? Number(el.value)
                  : el.value;
          }
          try {
            setS(
              await api("/api/admin/settings", {
                method: "PUT",
                body: JSON.stringify(body),
              }),
            );
            refresh();
            notify("Ayarlar kaydedildi");
          } catch (err) {
            notify(err.message);
          }
        }}
      >
        {["commerce", "analytics", "preview"].map((g) => (
          <fieldset key={g}>
            <legend>
              {
                {
                  commerce: "Ürün ve sipariş (param_commerce)",
                  analytics: "Analitik (param_analytics)",
                  preview: "3D önizleme (param_preview)",
                }[g]
              }
            </legend>
            {FIELDS.filter((f) => f[0] === g).map(
              ([, k, label, type, step]) => (
                <label key={k} className={type === "checkbox" ? "check" : ""}>
                  {type === "checkbox" && (
                    <input
                      type="checkbox"
                      name={`${g}.${k}`}
                      defaultChecked={s[g][k]}
                      disabled={k === "inventoryGate"}
                    />
                  )}
                  {label}
                  {type === "number" && (
                    <input
                      type="number"
                      name={`${g}.${k}`}
                      min="0"
                      step={step}
                      defaultValue={s[g][k]}
                      required
                    />
                  )}
                  {type === "select" && (
                    <select name={`${g}.${k}`} defaultValue={s[g][k]}>
                      <option value="Europe/Istanbul">Europe/Istanbul</option>
                      <option value="UTC">UTC</option>
                    </select>
                  )}
                </label>
              ),
            )}
          </fieldset>
        ))}
        <button className="primary">Ayarları kaydet</button>
      </form>
      <h2>İndirim kodları</h2>
      <form
        className="admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.target));
          try {
            await api("/api/admin/coupons", {
              method: "POST",
              body: JSON.stringify({ ...f, value: Number(f.value) }),
            });
            e.target.reset();
            load();
            notify("İndirim kodu eklendi");
          } catch (err) {
            notify(err.message);
          }
        }}
      >
        <label>
          Kod
          <input name="code" required pattern="[A-Za-z0-9_\-]{3,20}" />
        </label>
        <label>
          Tür
          <select name="type">
            <option value="fixed">Sabit tutar (TL)</option>
            <option value="percent">Yüzde (%)</option>
          </select>
        </label>
        <label>
          Değer
          <input name="value" type="number" min="0.01" step="0.01" required />
        </label>
        <button className="primary">Kod ekle</button>
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Kod</th>
              <th>İndirim</th>
              <th>Durum</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c._id}>
                <td>{c.code}</td>
                <td>{c.type === "percent" ? "%" + c.value : money(c.value)}</td>
                <td>{c.isActive ? "Aktif" : "Pasif"}</td>
                <td>
                  <button
                    onClick={async () => {
                      try {
                        await api("/api/admin/coupons/" + c._id, {
                          method: "PATCH",
                          body: JSON.stringify({ isActive: !c.isActive }),
                        });
                        load();
                      } catch (err) {
                        notify(err.message);
                      }
                    }}
                  >
                    {c.isActive ? "Pasif yap" : "Aktif yap"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Audit({ api, notify }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api("/api/admin/audit")
      .then(setRows)
      .catch((e) => notify(e.message));
  }, []);
  if (!rows) return <p>Yükleniyor…</p>;
  const show = (v) =>
    v === undefined || v === null
      ? "—"
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  return (
    <div className="table-scroll">
      <table className="audit">
        <thead>
          <tr>
            <th>Zaman</th>
            <th>Rol</th>
            <th>Olay</th>
            <th>Hedef</th>
            <th>Önce</th>
            <th>Sonra</th>
            <th>Sonuç</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id}>
              <td>{istanbulDate(r.occurredAt)}</td>
              <td>{ROLE_LABELS[r.role] || r.role}</td>
              <td>{r.eventType}</td>
              <td>{r.targetId}</td>
              <td>
                <code>{show(r.before)}</code>
              </td>
              <td>
                <code>{show(r.after)}</code>
              </td>
              <td>{r.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
