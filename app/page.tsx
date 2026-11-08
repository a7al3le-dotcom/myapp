import { readFileSync } from "node:fs";
import { join } from "node:path";
import LegacyBoot from "@/components/LegacyBoot";
import type { Metadata } from "next";
import { DESC, KEYWORDS, TITLE } from "@/lib/shim/site-defaults";

import PhoneStage from "@/components/PhoneStage";

// The page body is the reference site's markup verbatim (inline handlers included). Its own client script drives it;
// our shim (lib/shim) stands in for the Socket.IO server and stores everything in Firebase.
const BODY = readFileSync(join(process.cwd(), "lib", "legacy-body.html"), "utf8");

const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// The top of the login screen, as the original server writes it from «إداره الموقع»: <div class="hid">name</div>, a visually hidden
// <h1>description</h1>, then <div class="hid">«الوصف الداخلي» (html)</div>. An empty setting keeps the reference page's own text.
function withSiteText(body: string, t: { name?: string; description?: string; html?: string }) {
  const at = body.indexOf('<div id="tlogins"'); if (at < 0) return body;
  let out = body;
  // the top bar: <img prv1><span class="flex-grow-1 dots"> name </span>
  // no default name (owner 2026-11-06): empty unless «اسم الموقع» is set
  { const sp = out.indexOf('<span class="flex-grow-1 dots">', at); if (sp >= 0) { const a = sp + '<span class="flex-grow-1 dots">'.length, e = out.indexOf("</span>", a); out = out.slice(0, a) + (t.name ? " " + text(t.name) + " " : "") + out.slice(e); } }
  let i = out.indexOf('<div class="hid">', at);
  const swap = (from: number, open: string, close: string, inner: string) => { const a = from + open.length, b = out.indexOf(close, a); if (b < 0) return from; out = out.slice(0, a) + inner + out.slice(b); return a + inner.length + close.length; };
  if (i < 0) return body;
  i = swap(i, '<div class="hid">', "</div>", t.name ? " " + text(t.name) + " " : "");
  const h = out.indexOf("<h1", i); if (h < 0) return out;
  const hOpen = out.slice(h, out.indexOf(">", h) + 1);
  i = t.description ? swap(h, hOpen, "</h1>", " " + text(t.description) + " ") : out.indexOf("</h1>", h) + 5;
  const d = out.indexOf('<div class="hid">', i);
  if (d >= 0 && t.html) {
    // the SEO block ends at the </div> that closes it (it may hold its own <div>s)
    let depth = 0, k = d;
    for (const m of out.slice(d).matchAll(/<div\b|<\/div>/g)) { depth += m[0] === "</div>" ? -1 : 1; if (depth === 0) { k = d + (m.index ?? 0); break; } }
    if (k > d) out = out.slice(0, d) + '<div class="hid">' + t.html + out.slice(k);
  }
  return out;
}

// Cloudflare Pages (static): the reference page's own head values; «إداره الموقع» / «النطاقات» are applied in the browser at once
// (LegacyBoot staticSite: «كود head» and «السكربت» before x3 runs them; the shim: title, description, colours, name, pictures).
export const metadata: Metadata = {
  title: TITLE, description: DESC, keywords: KEYWORDS,
  openGraph: { title: TITLE, description: DESC, images: ["/prv1.png"] },
  other: { google: "notranslate" },
  icons: { icon: "/favicon.ico" },
};

export default function Home() {
  return (
    <>
      <div id="stage"><div id="app" dangerouslySetInnerHTML={{ __html: withSiteText(BODY, {}) }} /></div>
      <PhoneStage />
      <LegacyBoot siteInline staticSite />
    </>
  );
}
