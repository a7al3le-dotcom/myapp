"use client";
// Loads the reference site's own scripts, in its own order, then swaps Socket.IO for the Firebase-backed stand-in server.
import { useEffect } from "react";
import { FakeSocket, watchSiteFilesStandalone } from "@/lib/shim/server";
import { installUploadInterceptor } from "@/lib/shim/upload";
import { DOMAIN_TEXT, domainKey, normDomain } from "@/lib/shim/domain";

// static site (Cloudflare Pages): «إداره الموقع» + the page's own «النطاقات» entry, read before x3.js (both readable without signing in, like the
// original writes them into its HTML). Non-empty domain fields win, as on the server (lib/server/site-settings.ts getSiteText).
async function readSiteSettings(): Promise<{ script: string; customHead: string }> {
  const db = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL; if (!db) return { script: "", customHead: "" };
  const get = (p: string) => fetch(`${db}/${p}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const site = ((await get("config/site")) ?? {}) as Record<string, unknown>;
  const dom = normDomain(location.hostname); const d = dom ? (((await get(`config/domains/${encodeURIComponent(domainKey(dom))}`)) ?? {}) as Record<string, unknown>) : {};
  const pick = (k: (typeof DOMAIN_TEXT)[number]) => (typeof d[k] === "string" && d[k] ? String(d[k]) : typeof site[k] === "string" ? String(site[k]) : "");
  return { script: pick("script"), customHead: pick("customHead") };
}

function loadScript(src: string) {
  return new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = false;
    s.onload = () => res(); s.onerror = () => rej(new Error("failed to load " + src));
    document.body.appendChild(s);
  });
}

// put markup in the document and let any <script> in it run (scripts added through innerHTML do not run): «كود head» / «السكربت»
function runMarkup(html: string, where: HTMLElement) {
  const t = document.createElement("template"); t.innerHTML = html;
  for (const old of Array.from(t.content.querySelectorAll("script"))) {
    const s = document.createElement("script");
    for (const a of Array.from(old.attributes)) s.setAttribute(a.name, a.value);
    s.text = old.text; old.replaceWith(s);
  }
  where.appendChild(t.content);
}

// `siteInline`: the main page also runs the reference page's two inline scripts (public/js/site-inline-*.js) at the same points the original runs them.
// `siteScript` («إداره الموقع» > السكربت) takes the place of the second one when it is set — on the original that inline script IS this setting.
// `headRest`: what «كود head» holds besides meta / link tags (those are already in the head from the server).
export default function LegacyBoot({ siteInline = false, siteScript = "", headRest = "", staticSite = false }: { siteInline?: boolean; siteScript?: string; headRest?: string; staticSite?: boolean }) {
  useEffect(() => {
    (async () => {
      const w = window as unknown as Record<string, unknown>;
      if (w.__legacyBooted) return;
      w.__legacyBooted = true;
      // the page's second inline script is fetched NOW, in parallel: on the original it is inline in the page, so load() follows x3.js at once.
      // Fetching it only after x3.js left a gap on Cloudflare in which a typed guest name was wiped by load() (it refills #u1 from storage).
      const inline2 = siteInline ? fetch("/js/site-inline-2.js").then((r) => (r.ok ? r.text() : "")).catch(() => "") : Promise.resolve("");
      let script = siteScript, head = headRest;
      if (staticSite) { const t = await readSiteSettings(); script = t.script; head = t.customHead; } // the whole «كود head» (no server put its meta/link tags in)
      if (head) runMarkup(head, document.head);
      await loadScript("/js/b.js"); // jQuery + Bootstrap + Socket.IO client (unmodified)
      if (siteInline) await loadScript("/js/site-inline-1.js");
      w.io = () => new FakeSocket();
      installUploadInterceptor();
      await loadScript("/js/x3.js"); // the site's main client (unmodified)
      if (siteInline) {
        if (script) { const s = document.createElement("script"); s.text = script; document.body.appendChild(s); } // global scope, right after x3.js, like the original
        else { const t = await inline2; if (t) { const s = document.createElement("script"); s.text = t; document.body.appendChild(s); } else await loadScript("/js/site-inline-2.js"); }
      }
      if (typeof w.load === "function") (w.load as () => void)(); // what <body onload> does on the original
      if (!siteInline) watchSiteFilesStandalone(); // the control panel page: its tab icon and picture previews follow «الايقونات» live
    })().catch((e) => console.error(e));

  }, [siteInline, siteScript, headRest, staticSite]);
  return null;
}
