import React, { useEffect, useState, useRef, useCallback, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  money,
  ROLE_LABELS,
  STATUS_LABELS,
  VAL,
  istanbulDate,
} from "./util.js";
const Studio = lazy(() => import("./Studio"));
const Admin = lazy(() => import("./Admin"));
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./style.css";

/* ─── Scroll Reveal Hook ─── */
function useScrollReveal() {
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => el.classList.add('visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    const targets = document.querySelectorAll('.reveal, .reveal-left, .reveal-right');
    targets.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  });
}

/* ─── Parallax Hook ─── */
function useParallax() {
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;
    const hero = document.querySelector('.hero-image');
    if (!hero) return;
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          hero.style.transform = `scale(1.03) translateY(${scrollY * 0.25}px)`;
          ticking = false;
        });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });
}

/* ─── Navbar Scroll Hook ─── */
function useNavbarScroll() {
  useEffect(() => {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          if (window.scrollY > 60) {
            navbar.classList.add('scrolled');
          } else {
            navbar.classList.remove('scrolled');
          }
          ticking = false;
        });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });
}

/* ─── Live Visitor Count Hook (SSE) ─── */
function useVisitorCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let es;
    try {
      es = new EventSource('/api/visitors/stream');
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (Number.isInteger(data.count)) setCount(data.count);
        } catch {}
      };
      es.onerror = () => {
        es.close();
        // fallback: poll once
        fetch('/api/visitors/count').then(r => r.json()).then(d => {
          if (Number.isInteger(d.count)) setCount(d.count);
        }).catch(() => {});
      };
    } catch {
      fetch('/api/visitors/count').then(r => r.json()).then(d => {
        if (Number.isInteger(d.count)) setCount(d.count);
      }).catch(() => {});
    }
    return () => es?.close();
  }, []);
  return count;
}

function App() {
  const [products, setProducts] = useState([]),
    [user, setUser] = useState(null),
    [page, setPage] = useState("home"),
    [category, setCategory] = useState("Tümü"),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("featured"),
    [modal, setModal] = useState(null),
    [selected, setSelected] = useState(null),
    [toast, setToast] = useState(""),
    [toastHiding, setToastHiding] = useState(false),
    [orders, setOrders] = useState([]),
    [payment, setPayment] = useState(null),
    [busy, setBusy] = useState(false),
    [loadError, setLoadError] = useState(""),
    [pageKey, setPageKey] = useState(0);
  const visitorCount = useVisitorCount();
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    const focusTimer = setTimeout(
      () => document.querySelector(".modal button, .modal input")?.focus(),
      150,
    );
    const keydown = (e) => {
      if (e.key === "Escape") {
        setModal(null);
        return;
      }
      if (e.key !== "Tab") return;
      const controls = [
        ...document.querySelectorAll(
          ".modal button:not(:disabled), .modal input, .modal select, .modal textarea, .modal a[href]",
        ),
      ].filter((el) => el.getClientRects().length);
      if (!controls.length) return;
      const first = controls[0],
        last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [modal]);
  const [cart, setCart] = useState({ items: [], summary: null }),
    [settings, setSettings] = useState(null),
    [categories, setCategories] = useState([]),
    [consent, setConsent] = useState(undefined),
    [addresses, setAddresses] = useState([]),
    [addressChoice, setAddressChoice] = useState("new"),
    [notifications, setNotifications] = useState([]),
    [coupon, setCoupon] = useState(""),
    [visible, setVisible] = useState(8),
    [afterLogin, setAfterLogin] = useState(null);
  const notify = (s) => { setToastHiding(false); setToast(s); };
  const isBuyer = ["customer", "admin"].includes(user?.role);
  const previewOn = settings?.preview.enabled !== false;
  const refreshProducts = () =>
    api("/api/products").then(setProducts).catch(() => {});
  const loadCart = async (code = coupon) => {
    if (!isBuyer) return setCart({ items: [], summary: null });
    try {
      setCart(await api("/api/cart" + (code ? "?coupon=" + encodeURIComponent(code) : "")));
    } catch {}
  };
  const loadAddresses = () =>
    api("/api/addresses")
      .then((list) => {
        setAddresses(list);
        setAddressChoice(list[0]?._id || "new");
      })
      .catch(() => {});
  const loadNotifications = () =>
    api("/api/notifications").then(setNotifications).catch(() => {});
  useEffect(() => {
    if (!user) {
      setCart({ items: [], summary: null });
      setAddresses([]);
      setNotifications([]);
      return;
    }
    loadCart();
    loadAddresses();
    loadNotifications();
  }, [user?.id]);
  useEffect(() => {
    setVisible(settings?.commerce.pageSize || 8);
  }, [category, search, settings]);
  const saveConsent = async (value) => {
    try {
      const r = await api("/api/consent", {
        method: "POST",
        body: JSON.stringify({ analytics: value }),
      });
      setConsent(r.analytics);
    } catch (e) {
      notify(e.message);
    }
  };
  const trackView = (p) => {
    if (consent !== true || !settings?.analytics.optionalAnalytics) return;
    api("/api/events", {
      method: "POST",
      body: JSON.stringify({
        eventType: "product_view",
        productId: p._id,
        ...(globalThis.crypto?.randomUUID ? { eventId: crypto.randomUUID() } : {}),
      }),
    }).catch(() => {});
  };
  const openDetail = (p) => {
    setModal("detail");
    setSelected(p);
    trackView(p);
  };
  /* FR-027 / VAL-019: 3D önizleme yalnızca oturum açmış kullanıcıya açılır. */
  const openStudio = (p) => {
    const target =
      p?.model3dUrl && p.isActive !== false
        ? p
        : products.find((x) => x.model3dUrl && x.isActive !== false);
    if (!previewOn || !target) return notify(VAL.VAL018);
    setSelected(target);
    if (!user) {
      notify(VAL.VAL019);
      setAfterLogin("studio");
      setModal("login");
      return;
    }
    setModal("studio");
  };
  const add = async (p) => {
    if (!user) {
      notify("Sepete eklemek için giriş yapın veya üye olun.");
      setModal("login");
      return;
    }
    if (!isBuyer) return notify("Yönetici hesabıyla sipariş verilemez.");
    try {
      setCart(
        await api("/api/cart/items", {
          method: "POST",
          body: JSON.stringify({ productId: p._id }),
        }),
      );
      notify("Ürün sepetinize eklendi");
    } catch (e) {
      notify(e.message);
      refreshProducts();
    }
  };
  const setQuantity = async (line, quantity) => {
    if (quantity < 1) return removeLine(line);
    try {
      await api("/api/cart/items/" + line.productId, {
        method: "PATCH",
        body: JSON.stringify({ quantity }),
      });
      await loadCart();
    } catch (e) {
      notify(e.message);
    }
  };
  const removeLine = async (line) => {
    try {
      await api("/api/cart/items/" + line.productId, { method: "DELETE" });
      await loadCart();
    } catch (e) {
      notify(e.message);
    }
  };
  const count = cart.items.reduce((s, i) => s + i.quantity, 0);
  useEffect(() => {
    Promise.all([
      api("/api/products"),
      api("/api/me"),
      api("/api/payment-config"),
      api("/api/settings/public"),
      api("/api/categories"),
      api("/api/consent"),
    ])
      .then(([p, u, c, s, cats, cons]) => {
        setProducts(p);
        setUser(u);
        setPayment(c);
        setSettings(s);
        setCategories(cats);
        setConsent(cons.analytics);
      })
      .catch((e) => setLoadError(e.message));
    const id = new URLSearchParams(location.search).get("payment");
    if (id)
      api("/api/orders/" + id + "/pay", { method: "POST" })
        .then(() => {
          notify("Ödeme doğrulandı. Siparişlerinizden takip edebilirsiniz.");
          api("/api/cart").then(setCart).catch(() => {});
          refreshProducts();
          history.replaceState({}, "", "/");
        })
        .catch((e) => notify(e.message));
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => {
        setToastHiding(true);
        setTimeout(() => { setToast(""); setToastHiding(false); }, 350);
      }, 4650);
      return () => clearTimeout(t);
    }
  }, [toast]);
  /* Animation hooks */
  useScrollReveal();
  useParallax();
  useNavbarScroll();
  const openOrders = async () => {
    try {
      setOrders(await api("/api/orders"));
      setModal("orders");
    } catch (e) {
      notify(e.message);
      setModal("login");
    }
  };
  let shown = products.filter(
    (p) =>
      (category === "Tümü" || category === p.category) &&
      p.name.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr")),
  );
  if (sort === "low") shown.sort((a, b) => a.price - b.price);
  if (sort === "high") shown.sort((a, b) => b.price - a.price);
  const collection = () => {
    setPage("home");
    setPageKey(k => k + 1);
    setTimeout(
      () =>
        document
          .getElementById("collection")
          ?.scrollIntoView({ behavior: "smooth" }),
      30,
    );
  };
  return (
    <>
      <div className="announcement">
        Doğanın içinde, evinizin konforunda.{" "}
        <span>
          {settings?.commerce.freeShipThreshold > 0
            ? `${money(settings.commerce.freeShipThreshold)} üzeri ücretsiz teslimat ↗`
            : "Güvenli ödeme · Kolay teslimat ↗"}
        </span>
      </div>
      <header className="navbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("home");
            window.scrollTo(0, 0);
          }}
        >
          <span className="brand-symbol">✳</span>
          <span>
            bahçeni<span className="brand-bottom">tasarla.</span>
          </span>
        </a>
        <nav>
          <button
            className={page === "home" ? "active" : ""}
            onClick={collection}
          >
            Koleksiyon
          </button>
          <button
            onClick={() => {
              openStudio(products[0]);
            }}
          >
            Bahçeni Tasarla <span className="tiny-tag">3D</span>
          </button>
          <button
            onClick={() => {
              setPage("about");
              window.scrollTo(0, 0);
            }}
          >
            Hikâyemiz
          </button>
        </nav>
        <div className="nav-actions">
          <button
            className="icon search-icon"
            aria-label="Ürün ara"
            onClick={() => {
              collection();
              setTimeout(() => document.getElementById("search")?.focus(), 100);
            }}
          >
            ⌕
          </button>
          <button
            className="account"
            onClick={() => setModal(user ? "account" : "login")}
          >
            ♙ <span>{user ? user.name.split(" ")[0] : "Hesabım"}</span>
          </button>
          <button className="cart-btn" onClick={() => setModal("cart")}>
            Sepet <span>{count}</span>
          </button>
        </div>
      </header>
      {loadError && (
        <div className="error-banner">
          {loadError}{" "}
          <button onClick={() => location.reload()}>Tekrar dene</button>
        </div>
      )}
      {page === "admin" ? (
        <Suspense fallback={<main className="admin">Yükleniyor…</main>}>
          <Admin
            user={user}
            api={api}
            notify={notify}
            refresh={() => {
              refreshProducts();
              api("/api/settings/public").then(setSettings).catch(() => {});
              api("/api/categories").then(setCategories).catch(() => {});
            }}
          />
        </Suspense>
      ) : page === "about" ? (
        <main className="about page-transition" key={"about-" + pageKey}>
          <span className="eyebrow reveal">HİKÂYEMİZ</span>
          <h1 className="reveal">
            Bir bahçeden
            <br />
            çok daha fazlası.
          </h1>
          <p className="reveal">
            Bahçeni Tasarla, Nisa Nur Çakır ve Zeynep Ulusoy'un bahçe mobilyası
            alışverişini bir tasarım deneyimine dönüştüren web programlama
            projesidir.
          </p>
          <p className="reveal">
            Mobilyayı satın almadan önce kendi alanınızda deneyin. Bahçe
            fotoğrafınızı yükleyin, 3D modeli yerleştirin ve sizin için doğru
            düzeni bulun.
          </p>
          <button
            className="primary reveal"
            onClick={() => {
              openStudio(products[0]);
            }}
          >
            Tasarım stüdyosunu keşfet ↗
          </button>
        </main>
      ) : (
        <main className="page-transition" key={"home-" + pageKey}>
          <section className="hero">
            <div className="hero-image" />
            <div className="hero-shade" />
            <div className="hero-content">
              <span className="eyebrow light">AÇIK HAVADA YAŞAM SANATI</span>
              <h1>
                Biraz doğa.
                <br />
                Biraz huzur.
                <br />
                <em>Tam senlik bir bahçe.</em>
              </h1>
              <p>
                Yaşam alanını dışarı taşı. Zamansız tasarımları keşfet,
                <br className="desktop" /> satın almadan önce kendi bahçende
                gör.
              </p>
              <div className="hero-buttons">
                <button className="cream-btn" onClick={collection}>
                  Koleksiyonu keşfet <span>↗</span>
                </button>
                <button
                  className="glass-btn"
                  onClick={() => {
                    openStudio(products[0]);
                  }}
                >
                  ◈ Bahçemde dene
                </button>
              </div>
              <div className="hero-bottom">
                <span>DOĞADAN İLHAM ALAN TASARIMLAR</span>
                <span>
                  01 <i /> 04
                </span>
              </div>
            </div>
            <div className="hero-label">
              <span>YENİ KOLEKSİYON</span>
              <strong>Dışarıda hayat var.</strong>
            </div>
            {visitorCount > 0 && (
              <div className="hero-visitor">
                <div className="visitor-counter">
                  <span className="pulse-dot" />
                  <span className="count">{visitorCount}</span>
                  <span>kişi şu an geziyor</span>
                </div>
              </div>
            )}
          </section>
          <section className="benefits">
            <div className="reveal">
              <span>♧</span>
              <p>
                Doğaya yakın tasarım
                <small>Doğal dokular, zamansız çizgiler</small>
              </p>
            </div>
            <div className="reveal">
              <span>◈</span>
              <p>
                Önce bahçende gör<small>Fotoğrafın üzerinde 3D deneyim</small>
              </p>
            </div>
            <div className="reveal">
              <span>♙</span>
              <p>
                Senin için burada
                <small>Kolay alışveriş, şeffaf sipariş takibi</small>
              </p>
            </div>
            <div className="reveal">
              <span>↗</span>
              <p>
                Kapına kadar<small>₺15.000 üzeri ücretsiz teslimat</small>
              </p>
            </div>
          </section>
          <section className="collection" id="collection">
            <div className="section-heading reveal">
              <div>
                <span className="eyebrow">BAHÇENİN YENİ FAVORİLERİ</span>
                <h2>Dışarıda güzel bir hayat.</h2>
              </div>
              <p>
                Küçük bir balkon ya da kocaman bir bahçe.
                <br />
                Her alan için, sana ait bir köşe.
              </p>
            </div>
            <div className="filters">
              <div className="tabs">
                {["Tümü", ...categories.map((c) => c.name)].map((c) => (
                  <button
                    key={c}
                    className={c === category ? "selected" : ""}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="filter-controls">
                <input
                  id="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Ürün ara…"
                  aria-label="Ürün ara"
                />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  aria-label="Sıralama"
                >
                  <option value="featured">Önerilen sıralama</option>
                  <option value="low">Fiyat: düşükten yükseğe</option>
                  <option value="high">Fiyat: yüksekten düşüğe</option>
                </select>
              </div>
            </div>
            <div className="product-grid reveal-stagger">
              {shown.slice(0, visible).map((p, i) => (
                <article className="product reveal" key={p._id}>
                  <div className="product-image">
                    <button
                      className="image-open"
                      onClick={() => {
                        openDetail(p);
                      }}
                      aria-label={p.name + " detayları"}
                    >
                      <img src={p.image} alt={p.name} loading="lazy" />
                    </button>
                    <span className="product-tag">
                      {i === 0 ? "ÇOK SEVİLEN" : "DOĞAL DOKULAR"}
                    </span>
                    <button
                      className="quick-add"
                      onClick={() => add(p)}
                      aria-label={p.name + " sepete ekle"}
                      disabled={!p.stock}
                    >
                      +
                    </button>
                    {previewOn && p.model3dUrl && (
                      <button className="try-btn" onClick={() => openStudio(p)}>
                        ◈ Bahçede Gör
                      </button>
                    )}
                  </div>
                  <div className="product-meta">
                    <small>{p.category.toLocaleUpperCase("tr")}</small>
                    <span className={"stock-label" + (p.stock ? "" : " out")}>
                      {!p.stock ? "Tükendi" : p.stock <= 3 ? `Son ${p.stock} ürün` : "Stokta"}
                    </span>
                    <h3>
                      <button
                        onClick={() => {
                          openDetail(p);
                        }}
                      >
                        {p.name}
                      </button>
                    </h3>
                    <div className="price-row">
                      <span>{money(p.price)}</span>
                      <span className="swatches">
                        <i style={{ background: p.color }} />
                        <i style={{ background: "#455147" }} />
                        <i style={{ background: "#dfd5c5" }} />
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {!shown.length && (
              <p className="empty">Aramanıza uygun ürün bulunamadı.</p>
            )}
            {shown.length > visible && (
              <button
                className="secondary load-more"
                onClick={() => setVisible((v) => v + (settings?.commerce.pageSize || 8))}
              >
                Daha fazla ürün göster ({shown.length - visible})
              </button>
            )}
          </section>
          <section className="design-promo">
            <div className="promo-photo reveal-left">
              <span className="floating-pill">
                ◈ SENİN ALANIN, SENİN TASARIMIN
              </span>
            </div>
            <div className="promo-copy reveal-right">
              <span className="eyebrow">HAYAL ETMEKLE KALMA</span>
              <h2>
                Bahçende nasıl
                <br />
                duracağını <em>gör.</em>
              </h2>
              <p>
                Bir fotoğraf yükle, favori mobilyanı yerleştir.
                <br />
                Döndür, boyutlandır, hayalindeki köşeyi oluştur.
              </p>
              <button
                className="primary"
                onClick={() => {
                  openStudio(products[0]);
                }}
              >
                Bahçemi tasarlamaya başla ↗
              </button>
              <small>
                Ücretsiz · İndirme gerektirmez · Fotoğrafın sende kalır
              </small>
            </div>
          </section>
        </main>
      )}
      <footer>
        <div className="footer-top">
          <div>
            <a className="brand">
              <span className="brand-symbol">✳</span>
              <span>
                bahçeni<span className="brand-bottom">tasarla.</span>
              </span>
            </a>
            <p>Güzel anlar, açık havada başlar.</p>
          </div>
          <div>
            <strong>Keşfet</strong>
            <button onClick={collection}>Koleksiyon</button>
            <button
              onClick={() => {
                openStudio(products[0]);
              }}
            >
              3D tasarım stüdyosu
            </button>
          </div>
          <div>
            <strong>Hesabın</strong>
            <button onClick={() => setModal(user ? "account" : "login")}>
              Giriş / Üyelik
            </button>
            <button onClick={openOrders}>Siparişlerim</button>
          </div>
          <div>
            <strong>Birlikte tasarlayalım.</strong>
            <p>Bahçen için yeni bir başlangıç.</p>
            <button onClick={() => setPage("about")}>
              Hikâyemizi keşfet ↗
            </button>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Bahçeni Tasarla</span>
          <span>Web Programlama Projesi · Nisa Nur Çakır & Zeynep Ulusoy</span>
        </div>
      </footer>
      {settings?.analytics.optionalAnalytics && consent === null && (
        <div className="consent" role="region" aria-label="Analitik izni">
          <p>
            Ürünleri nasıl incelediğinizi anonim olarak ölçmek için izninizi
            istiyoruz. Ödeme, sepet ve sipariş kayıtları bu tercihten bağımsız
            tutulur; bahçe fotoğrafınız hiçbir zaman ölçüme alınmaz.
          </p>
          <div>
            <button className="primary" onClick={() => saveConsent(true)}>
              İzin ver
            </button>
            <button className="secondary" onClick={() => saveConsent(false)}>
              Reddet
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className={"toast" + (toastHiding ? " hiding" : "")} role="status">
          {toast}
          <button onClick={() => { setToastHiding(true); setTimeout(() => { setToast(""); setToastHiding(false); }, 350); }} aria-label="Bildirimi kapat">
            ×
          </button>
        </div>
      )}
      {modal === "studio" && selected && user && (
        <Suspense
          fallback={<div className="toast">3D stüdyo hazırlanıyor…</div>}
        >
          <Studio
            product={selected}
            products={products}
            user={user}
            api={api}
            notify={notify}
            settings={settings}
            onAddToCart={add}
            onClose={() => setModal(null)}
          />
        </Suspense>
      )}
      {modal && modal !== "studio" && (
        <div className="overlay" onClick={() => setModal(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Hesap ve alışveriş penceresi"
            className={"modal " + (modal === "cart" ? "cart-modal" : "")}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon"
              onClick={() => setModal(null)}
              aria-label="Kapat"
            >
              ×
            </button>
            {["login", "register"].includes(modal) && (
              <>
                <span className="eyebrow">BAHÇENE HOŞ GELDİN</span>
                <h2>
                  {modal === "login"
                    ? "Yeniden merhaba."
                    : "Yeni bir başlangıç."}
                </h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      const u = await api("/api/auth/" + modal, {
                        method: "POST",
                        body: JSON.stringify(
                          Object.fromEntries(new FormData(e.target)),
                        ),
                      });
                      setUser(u);
                      setModal(afterLogin);
                      setAfterLogin(null);
                      notify("Hoş geldin, " + u.name);
                    } catch (e) {
                      notify(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {modal === "register" && (
                    <label>
                      Ad soyad
                      <input
                        name="name"
                        required
                        maxLength="80"
                        autoComplete="name"
                      />
                    </label>
                  )}
                  <label>
                    E-posta
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                    />
                  </label>
                  <label>
                    Şifre
                    <input
                      name="password"
                      type="password"
                      required
                      minLength="8"
                      maxLength="128"
                      autoComplete={
                        modal === "login" ? "current-password" : "new-password"
                      }
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    {busy
                      ? "Lütfen bekleyin…"
                      : modal === "login"
                        ? "Giriş yap"
                        : "Hesap oluştur"}
                  </button>
                </form>
                <button
                  className="text-btn"
                  onClick={() =>
                    setModal(modal === "login" ? "register" : "login")
                  }
                >
                  {modal === "login"
                    ? "Hesabın yok mu? Üye ol"
                    : "Hesabın var mı? Giriş yap"}
                </button>
              </>
            )}
            {modal === "account" && user && (
              <>
                <h2>Merhaba, {user.name}</h2>
                <p>{user.email}</p>
                <span className="badge">{ROLE_LABELS[user.role] || user.role}</span>
                <div className="account-actions">
                  <button className="primary" onClick={openOrders}>
                    Siparişlerim
                  </button>
                  {["manager", "admin"].includes(user.role) && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setModal(null);
                        setPage("admin");
                      }}
                    >
                      Yönetim paneli
                    </button>
                  )}
                </div>
                <h3>Bildirimler</h3>
                {!notifications.length ? (
                  <p className="muted">Yeni bildiriminiz yok.</p>
                ) : (
                  <ul className="notifications">
                    {notifications.slice(0, 8).map((n) => (
                      <li key={n._id} className={n.read ? "" : "unread"}>
                        <span>{n.message}</span>
                        <small>{istanbulDate(n.createdAt)}</small>
                        {!n.read && (
                          <button
                            className="text-btn"
                            onClick={async () => {
                              await api("/api/notifications/" + n._id + "/read", { method: "POST" }).catch(() => {});
                              loadNotifications();
                            }}
                          >
                            Okundu
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <h3>Adreslerim</h3>
                {addresses.map((a) => (
                  <div className="address-row" key={a._id}>
                    <div>
                      <strong>{a.title}</strong>
                      <p>
                        {a.fullName}, {a.line}, {a.district}/{a.city}
                      </p>
                    </div>
                    <button
                      className="text-btn"
                      onClick={async () => {
                        try {
                          await api("/api/addresses/" + a._id, { method: "DELETE" });
                          loadAddresses();
                        } catch (e) {
                          notify(e.message);
                        }
                      }}
                    >
                      Sil
                    </button>
                  </div>
                ))}
                <details className="address-form">
                  <summary>+ Yeni adres ekle</summary>
                  <AddressForm
                    onSave={async (body) => {
                      await api("/api/addresses", { method: "POST", body: JSON.stringify(body) });
                      loadAddresses();
                      notify("Adres kaydedildi");
                    }}
                    notify={notify}
                  />
                </details>
                {settings?.analytics.optionalAnalytics && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={consent === true}
                      onChange={(e) => saveConsent(e.target.checked)}
                    />
                    Ürün deneyimini iyileştirmek için anonim davranış ölçümüne izin veriyorum
                  </label>
                )}
                <button
                  className="text-btn"
                  onClick={async () => {
                    await api("/api/logout", { method: "POST" });
                    setUser(null);
                    setModal(null);
                    setPage("home");
                  }}
                >
                  Çıkış yap
                </button>
              </>
            )}
            {modal === "detail" && selected && (
              <>
                <img
                  className="detail-image"
                  src={selected.image}
                  alt={selected.name}
                />
                <span className="eyebrow">{selected.category}</span>
                <h2>{selected.name}</h2>
                <p>{selected.description}</p>
                <h3>{money(selected.price)}</h3>
                <p>
                  {selected.isActive === false
                    ? VAL.VAL004
                    : selected.stock > 0
                      ? `${selected.stock} adet stokta`
                      : "Tükendi"}
                  {previewOn && selected.model3dUrl && " · Temsili 3D model ile önizleme"}
                </p>
                <button
                  className="primary"
                  onClick={() => add(selected)}
                  disabled={!selected.stock || selected.isActive === false}
                >
                  Sepete ekle
                </button>
                {previewOn && selected.model3dUrl && selected.isActive !== false && (
                  <button
                    className="secondary"
                    onClick={() => openStudio(selected)}
                  >
                    ◈ Bahçede Gör
                  </button>
                )}
              </>
            )}
            {modal === "cart" && (
              <>
                <span className="eyebrow">SANA AİT BİR KÖŞE</span>
                <h2>
                  Sepetin <small>({count})</small>
                </h2>
                {!user ? (
                  <>
                    <p className="empty">Sepet oluşturmak için giriş yapın veya üye olun.</p>
                    <button className="primary" onClick={() => setModal("login")}>
                      Giriş yap
                    </button>
                  </>
                ) : !cart.items.length ? (
                  <>
                    <p className="empty">
                      Sepetin henüz boş. Bahçen için güzel bir şey seç.
                    </p>
                    <button className="primary" disabled>
                      Ödemeye geç
                    </button>
                  </>
                ) : (
                  <>
                    {cart.items.map((i) => (
                      <div className="cart-item" key={i.productId}>
                        <img src={i.image} alt="" />
                        <div>
                          <strong>{i.name}</strong>
                          <p>
                            {money(i.price)}
                            {!i.isActive && <em className="warn"> · {VAL.VAL004}</em>}
                          </p>
                          <div className="quantity">
                            <button
                              aria-label="Adedi azalt"
                              onClick={() => setQuantity(i, i.quantity - 1)}
                            >
                              −
                            </button>
                            <span>{i.quantity}</span>
                            <button
                              aria-label="Adedi artır"
                              disabled={i.quantity >= i.stock}
                              onClick={() => setQuantity(i, i.quantity + 1)}
                            >
                              +
                            </button>
                            <button onClick={() => removeLine(i)}>Kaldır</button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {settings?.commerce.couponEnabled && (
                      <form
                        className="coupon"
                        onSubmit={(e) => {
                          e.preventDefault();
                          loadCart(coupon);
                        }}
                      >
                        <label>
                          İndirim kodu
                          <input
                            value={coupon}
                            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                            maxLength="20"
                          />
                        </label>
                        <button className="secondary">Uygula</button>
                        {coupon && cart.summary?.couponValid === false && (
                          <small className="warn">İndirim kodu geçersiz</small>
                        )}
                      </form>
                    )}
                    <dl className="summary">
                      <dt>Ara toplam</dt>
                      <dd>{money(cart.summary?.subtotal)}</dd>
                      {cart.summary?.discount > 0 && (
                        <>
                          <dt>İndirim ({cart.summary.couponCode})</dt>
                          <dd>−{money(cart.summary.discount)}</dd>
                        </>
                      )}
                      <dt>Kargo</dt>
                      <dd>{cart.summary?.shipping ? money(cart.summary.shipping) : "Ücretsiz"}</dd>
                      <dt className="total">Genel toplam</dt>
                      <dd className="total">{money(cart.summary?.total)}</dd>
                    </dl>
                    <p className="muted">
                      Tutar sunucuda hesaplanır; ödeme öncesinde stok ve fiyat yeniden doğrulanır.
                    </p>
                    <div className="payment-note">
                      {payment?.label || "Ödeme bilgisi yükleniyor…"}
                      {payment?.provider === "iyzico" &&
                        " · Sandbox test bilgileri kullanılır. Gerçek kart veya kimlik bilgisi girmeyin."}
                    </div>
                    {!["customer", "admin"].includes(user.role) ? (
                      <p className="warn">Yönetici hesabıyla sipariş verilemez.</p>
                    ) : (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const f = new FormData(e.target);
                          const addressId = f.get("addressId");
                          setBusy(true);
                          try {
                            const r = await api("/api/orders", {
                              method: "POST",
                              body: JSON.stringify({
                                ...(addressId && addressId !== "new"
                                  ? { addressId }
                                  : { address: f.get("address") }),
                                acceptTerms: f.get("ch_distance_sales") === "on",
                                couponCode: cart.summary?.couponCode,
                              }),
                            });
                            if (r.url) {
                              location.href = r.url;
                              return;
                            }
                            await api("/api/orders/" + r.order._id + "/pay", {
                              method: "POST",
                            });
                            setCoupon("");
                            await loadCart("");
                            refreshProducts();
                            notify(
                              "Demo sipariş oluşturuldu. Gerçek ödeme alınmadı.",
                            );
                            await openOrders();
                          } catch (e) {
                            notify(e.message);
                            loadCart();
                            refreshProducts();
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <label>
                          Teslimat adresi
                          <select
                            name="addressId"
                            value={addressChoice}
                            onChange={(e) => setAddressChoice(e.target.value)}
                          >
                            {addresses.map((a) => (
                              <option key={a._id} value={a._id}>
                                {a.title} — {a.line}, {a.district}/{a.city}
                              </option>
                            ))}
                            <option value="new">Yeni adres yaz</option>
                          </select>
                        </label>
                        {addressChoice === "new" && (
                          <label>
                            Adres
                            <textarea
                              name="address"
                              minLength="10"
                              maxLength="500"
                              placeholder="Ad soyad, il, ilçe, mahalle, sokak ve kapı numarası"
                            />
                          </label>
                        )}
                        <label className="check">
                          <input type="checkbox" name="ch_distance_sales" />
                          Ön bilgilendirme formunu ve mesafeli satış sözleşmesini okudum, onaylıyorum.
                        </label>
                        <button className="primary" disabled={busy || !cart.items.length}>
                          {busy
                            ? "İşleniyor…"
                            : payment?.provider === "iyzico"
                              ? "Güvenli ödemeye geç ↗"
                              : "Demo ödemeyi tamamla"}
                        </button>
                      </form>
                    )}
                  </>
                )}
              </>
            )}
            {modal === "orders" && (
              <>
                <h2>Siparişlerim</h2>
                {!orders.length ? (
                  <p>Henüz siparişin yok.</p>
                ) : (
                  orders.map((o) => (
                    <div className="order" key={o._id}>
                      <div>
                        <strong>#{o._id.slice(-8).toUpperCase()}</strong>
                        <span className="badge">{STATUS_LABELS[o.status] || o.status}</span>
                      </div>
                      <p>
                        {o.items
                          .map((i) => `${i.name} × ${i.quantity}`)
                          .join(", ")}
                      </p>
                      <p className="muted">
                        Ara toplam {money(o.subtotal ?? o.total)}
                        {o.discount > 0 && ` · İndirim −${money(o.discount)}`}
                        {` · Kargo ${o.shipping ? money(o.shipping) : "ücretsiz"}`}
                      </p>
                      <strong>{money(o.total)}</strong>
                      <small>{istanbulDate(o.createdAt)}</small>
                      {o.status === "pending" && o.paymentMode === "demo" && (
                        <button
                          onClick={async () => {
                            try {
                              await api("/api/orders/" + o._id + "/cancel", {
                                method: "POST",
                              });
                              await openOrders();
                              notify("Sipariş iptal edildi");
                            } catch (e) {
                              notify(e.message);
                            }
                          }}
                        >
                          Siparişi iptal et
                        </button>
                      )}
                      {o.status === "pending" && (
                        <button
                          className="secondary"
                          onClick={async () => {
                            try {
                              await api("/api/orders/" + o._id + "/pay", {
                                method: "POST",
                              });
                              await openOrders();
                              refreshProducts();
                              notify("Ödeme doğrulandı");
                            } catch (e) {
                              notify(e.message);
                            }
                          }}
                        >
                          Ödeme durumunu doğrula
                        </button>
                      )}
                    </div>
                  ))
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
function AddressForm({ onSave, notify }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="admin-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(Object.fromEntries(new FormData(e.target)));
          e.target.reset();
        } catch (err) {
          notify(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Adres başlığı
        <input name="title" maxLength="40" placeholder="Ev, iş…" />
      </label>
      <label>
        Ad soyad
        <input name="fullName" required maxLength="80" autoComplete="name" />
      </label>
      <label>
        İl
        <input name="city" required maxLength="40" autoComplete="address-level1" />
      </label>
      <label>
        İlçe
        <input name="district" required maxLength="40" autoComplete="address-level2" />
      </label>
      <label>
        Açık adres
        <textarea name="line" required minLength="10" maxLength="300" autoComplete="street-address" />
      </label>
      <button className="primary" disabled={busy}>Adresi kaydet</button>
    </form>
  );
}
createRoot(document.getElementById("root")).render(<App />);
