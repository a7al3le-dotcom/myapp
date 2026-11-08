"use client";
import { useEffect } from "react";

// Control panel on a narrow phone held upright. The original client sets <meta name="viewport"> to width=500 for /cp. A browser that honours it
// fits the 500px page into the screen by itself, but some (the Galaxy S9+ emulation, 320px wide) keep a scale that leaves the right-hand part
// of the page outside the visible area, so the last column (🔍 / ⚙) cannot be reached without panning. For a portrait screen narrower than the
// page, add the exact fitting initial-scale to that same meta. Landscape, tablets and desktop (>= 500px) are left exactly as the original
// (the token is removed again when the phone is turned), so the desktop layout and the original behaviour do not change.
const TOKEN = /,\s*initial-scale=[\d.]+/;
// «Bots» tab (built by x3.js itself): our two shortcut buttons «دخول للكل / خروج للكل» (owner 2026-11-06), put next to its «إضافه» button.
function botButtons() {
  const tab = document.getElementById("cp_bots"); if (!tab || tab.querySelector(".bots-all")) return;
  const add = Array.from(tab.querySelectorAll("button")).find((b) => (b.getAttribute("onclick") || "").includes("add:true")); if (!add) return;
  const mk = (txt: string, on: boolean, cls: string) => { const b = document.createElement("button"); b.className = `fa btn ${cls} bots-all`; b.style.cssText = "width:100px;margin-top:4px;"; b.textContent = txt; b.onclick = () => (window as unknown as { send: (c: string, d: unknown) => void }).send("cp", { cmd: "bot_all", online: on }); return b; };
  const br = () => document.createElement("br");
  add.after(br(), mk("دخول للكل", true, "btn-success fa-sign-in"), br(), mk("خروج للكل", false, "btn-warning fa-sign-out"));
}

export default function CpFit() {
  useEffect(() => {
    const botsObs = new MutationObserver(botButtons); botsObs.observe(document.body, { childList: true, subtree: true });
    const fit = () => {
      const m = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
      if (!m || !/width=500/.test(m.content)) return;
      const upright = matchMedia("(orientation: portrait)").matches && screen.width < 500;
      const want = upright ? `${m.content.replace(TOKEN, "")}, initial-scale=${(screen.width / 500).toFixed(3)}` : m.content.replace(TOKEN, "");
      if (m.content !== want) m.content = want;
    };
    // Pinned action column («الأعضاء» / «السجل»): the CSS in cp-mobile.css pins it on phones (<=600px). For every other width, tag a table that is
    // wider than its box with .cp-pin so the same scroller + pinned last column applies (narrow desktop window, tablet, a phone in desktop-site mode).
    // A table that fits is left exactly as the original draws it.
    const pin = () => {
      for (const id of ["logins", "fps"]) {
        const box = document.getElementById(id); const t = box?.querySelector<HTMLElement>("table.tablesorter"); if (!box || !t) continue;
        const pinned = t.classList.contains("cp-pin");
        const wide = pinned ? t.scrollWidth > t.clientWidth + 1 : box.scrollWidth > box.clientWidth + 1;
        if (wide !== pinned) t.classList.toggle("cp-pin", wide);
      }
    };
    fit(); pin();
    const mo = new MutationObserver(fit);
    mo.observe(document.head, { subtree: true, childList: true, attributes: true, attributeFilter: ["content"] });
    const mo2 = new MutationObserver(() => requestAnimationFrame(pin));
    for (const id of ["logins", "fps"]) { const e = document.getElementById(id); if (e) mo2.observe(e, { childList: true, subtree: true }); }
    const onSize = () => { fit(); pin(); };
    addEventListener("orientationchange", onSize); addEventListener("resize", onSize);
    return () => { botsObs.disconnect(); mo.disconnect(); mo2.disconnect(); removeEventListener("orientationchange", onSize); removeEventListener("resize", onSize); };
  }, []);
  return null;
}
