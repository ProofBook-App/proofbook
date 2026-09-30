import { useEffect } from "react";
import { useLocation } from "react-router";

// Marks [data-reveal] elements with data-in the first time they scroll into view.
// The transitions live in app.css and only apply once this has set data-motion on
// <html>, so if the script never runs, nothing stays hidden.
export function Reveal() {
  const { pathname } = useLocation();
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-in])")];
    if (!("IntersectionObserver" in window)) return;

    // Whatever is already on screen stays put, so turning motion on doesn't flash it.
    const fold = window.innerHeight;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.top < fold && r.bottom > 0) el.setAttribute("data-in", "");
    }
    document.documentElement.setAttribute("data-motion", "");

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    els.filter((el) => !el.hasAttribute("data-in")).forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);
  return null;
}
