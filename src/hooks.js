// Sayfa animasyonları ve canlı ziyaretçi sayacı için React kancaları (hooks).
import { useEffect, useState } from "react";

/* ─── Scroll Reveal Hook ─── */
export function useScrollReveal() {
  useEffect(() => {
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) {
      document
        .querySelectorAll(".reveal, .reveal-left, .reveal-right")
        .forEach((el) => el.classList.add("visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    const targets = document.querySelectorAll(
      ".reveal, .reveal-left, .reveal-right",
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });
}

/* ─── Parallax Hook ─── */
export function useParallax() {
  useEffect(() => {
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) return;
    const hero = document.querySelector(".hero-image");
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
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  });
}

/* ─── Navbar Scroll Hook ─── */
export function useNavbarScroll() {
  useEffect(() => {
    const navbar = document.querySelector(".navbar");
    if (!navbar) return;
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          if (window.scrollY > 60) {
            navbar.classList.add("scrolled");
          } else {
            navbar.classList.remove("scrolled");
          }
          ticking = false;
        });
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  });
}

/* ─── Live Visitor Count Hook (SSE) ─── */
export function useVisitorCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let es;
    try {
      es = new EventSource("/api/visitors/stream");
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (Number.isInteger(data.count)) setCount(data.count);
        } catch {}
      };
      es.onerror = () => {
        es.close();
        // fallback: poll once
        fetch("/api/visitors/count")
          .then((r) => r.json())
          .then((d) => {
            if (Number.isInteger(d.count)) setCount(d.count);
          })
          .catch(() => {});
      };
    } catch {
      fetch("/api/visitors/count")
        .then((r) => r.json())
        .then((d) => {
          if (Number.isInteger(d.count)) setCount(d.count);
        })
        .catch(() => {});
    }
    return () => es?.close();
  }, []);
  return count;
}
