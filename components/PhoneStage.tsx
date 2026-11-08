"use client";
// Phone fit for the legacy page: under 600px wide (the same threshold the reference client uses for its mobile layout) the page is a 400px column
// scaled to the screen width; the stage's height is divided by the scale so the column reaches the bottom exactly. 600px and wider: untouched.
import { useEffect } from "react";

export default function PhoneStage() {
  useEffect(() => {
    const fit = () => {
      const html = document.documentElement, stage = document.getElementById("stage"), app = document.getElementById("app");
      if (!stage || !app) return;
      // The stage is only a fallback for places that do not honour <meta name="viewport" content="width=400"> (previews, iframes, desktop-mode browsers).
      // Where the page is already laid out 400px wide (real phones), nothing is wrapped or moved: the page, its colours and the browser bars stay exactly as in the original.
      const w0 = window.innerWidth;
      if (w0 >= 600 || Math.abs(w0 - 400) <= 2) { html.classList.remove("phone"); app.style.transform = ""; app.style.height = ""; return; }
      html.classList.add("phone");
      const w = stage.clientWidth, h = stage.clientHeight, s = w / 400;
      app.style.transform = "translateX(-50%) scale(" + s + ")"; app.style.height = h / s + "px";
    };
    const later = () => setTimeout(fit, 300);
    window.addEventListener("resize", fit); window.addEventListener("orientationchange", later);
    window.visualViewport?.addEventListener("resize", fit); fit();
    return () => { window.removeEventListener("resize", fit); window.removeEventListener("orientationchange", later); window.visualViewport?.removeEventListener("resize", fit); };
  }, []);
  return null;
}
