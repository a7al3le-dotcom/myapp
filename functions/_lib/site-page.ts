// The site's texts and colours written into a page's HTML at the edge, like the original's server does, so nothing shows empty or in the
// built-in colours first. Values: «إداره الموقع» (config/site), then this host's «النطاقات» entry (non-empty fields win, as Server.effectiveSite).
// Both are readable without signing in. The page script later updates the same elements live.
import { colourCss } from "../../lib/shim/site-colors";
import { DOMAIN_TEXT, domainKey, normDomain } from "../../lib/shim/domain";

export type Site = Record<string, string>;
type El = { append(s: string, o: { html: boolean }): void; setInnerContent(s: string, o?: { html: boolean }): void; setAttribute(n: string, v: string): void };
type Rw = { on(sel: string, h: { element(e: El): void }): Rw; transform(r: Response): Response };
declare const HTMLRewriter: { new (): Rw };

export async function readSite(dbUrl: string, host: string): Promise<Site> {
  // a few seconds of edge cache: a busy page does not read the database on every load; a change shows on newly opened pages within ~10 s
  const get = (p: string) => fetch(`${dbUrl}/${p}.json`, { cf: { cacheTtl: 10, cacheEverything: true } } as RequestInit).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const dom = normDomain(host);
  const [s, d] = await Promise.all([get("config/site"), dom ? get(`config/domains/${encodeURIComponent(domainKey(dom))}`) : Promise.resolve(null)]);
  const site = (s ?? {}) as Record<string, unknown>, dd = (d ?? {}) as Record<string, unknown>;
  const o: Site = {};
  for (const k of [...DOMAIN_TEXT, "bg", "background", "buttons"]) {
    const v = typeof dd[k] === "string" && (dd[k] as string).trim() !== "" ? dd[k] : site[k];
    if (typeof v === "string" && v.trim() !== "") o[k] = v;
  }
  return o;
}

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const text = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** head: <style id="site-colors"> (colourCss lets only hex colours through), <title>, description / keywords / og metas when missing */
export function rewriteHead(rw: Rw, s: Site, title: string, metas: boolean): Rw {
  const css = colourCss({ bg: s.bg, background: s.background, buttons: s.buttons });
  let hasKeywords = false;
  if (metas) rw = rw.on("meta[name='keywords']", { element(e) { hasKeywords = true; e.setAttribute("content", s.keywords ?? ""); } });
  return rw.on("head", { element(e) {
    if (css) e.append(`<style id="site-colors">${css}</style>`, { html: true });
    if (title) e.append(`<title>${text(title)}</title>`, { html: true });
    if (metas && s.description) e.append(`<meta name="description" content="${attr(s.description)}"><meta property="og:description" content="${attr(s.description)}">`, { html: true });
    if (metas && title) e.append(`<meta property="og:title" content="${attr(title)}">`, { html: true });
    if (metas && !hasKeywords && s.keywords) e.append(`<meta name="keywords" content="${attr(s.keywords)}">`, { html: true });
  } });
}

export async function sitePage(request: Request, env: { FIREBASE_DB_URL?: string }, res: Response, kind: "main" | "cp"): Promise<Response> {
  const dbUrl = (env.FIREBASE_DB_URL || "").replace(/\/+$/, "");
  if (!dbUrl || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const s = await readSite(dbUrl, new URL(request.url).hostname);
  if (kind === "cp") return rewriteHead(new HTMLRewriter(), s, s.name || s.title || "", false).transform(res);
  // the chat page: the same places the shim's applySiteText fills (top bar name, the hidden name, the hidden h1 description)
  let rw = rewriteHead(new HTMLRewriter(), s, s.title || "", true);
  const name = s.name ? " " + s.name + " " : "";
  if (name) rw = rw.on("#tlogins a.label.bg > span.flex-grow-1", { element(e) { e.setInnerContent(name); } });
  let firstHid = true;
  if (name) rw = rw.on("#tlogins > .hid", { element(e) { if (firstHid) { firstHid = false; e.setInnerContent(name); } } });
  if (s.description) rw = rw.on("#tlogins > h1", { element(e) { e.setInnerContent(" " + s.description + " "); } });
  return rw.transform(res);
}
