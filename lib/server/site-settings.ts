// «إداره الموقع» text settings as the SERVER writes them into the page, like the original does when it serves its HTML:
// title / description / keywords (head + og), the site name / description / «الوصف الداخلي» hidden at the top of the login screen, the three
// colours, «كود head» and «السكربت» (run after x3.js). Isolated copy: read from the local emulator only; anything else gives {} (built-in page).
import { cacheLife } from "next/cache";
export { colourCss, hexColour } from "@/lib/shim/site-colors";

export type SiteText = { name?: string; title?: string; description?: string; keywords?: string; script?: string; customHead?: string; html?: string; bg?: string; background?: string; buttons?: string; favicon?: string; prv1?: string };

const EMU = process.env.NEXT_PUBLIC_USE_EMULATOR === "1" && (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").startsWith("demo-");
const DB = `http://${process.env.DB_EMULATOR_HOST || "127.0.0.1:9600"}`;
const NS = `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? ""}-default-rtdb`;
const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : undefined);

import { DOMAIN_COLOURS, DOMAIN_TEXT, domainKey, normDomain } from "@/lib/shim/domain";

/** the settings for the page asked from `host`: the main site's, with a listed domain's non-empty texts / colours on top («النطاقات») */
export async function getSiteText(host = ""): Promise<SiteText> {
  "use cache";
  cacheLife("seconds"); // a saved change reaches the next page load within seconds; open pages are updated live by the shim
  if (!EMU) return {};
  const get = (p: string) => fetch(`${DB}/${p}.json?ns=${NS}`, { headers: { Authorization: "Bearer owner" }, signal: AbortSignal.timeout(3000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const dom = normDomain(host);
  const [s, f, dm] = (await Promise.all([get("config/site"), get("config/files"), dom ? get(`config/domains/${domainKey(dom)}`) : Promise.resolve(null)])) as (Record<string, unknown> | null)[];
  const site: Record<string, unknown> = { ...(s ?? {}) }, files = f ?? {};
  if (dm) for (const k of [...DOMAIN_TEXT, ...DOMAIN_COLOURS]) if (typeof dm[k] === "string" && (dm[k] as string).trim() !== "") site[k] = dm[k];
  return {
    name: str(site.name), title: str(site.title), description: str(site.description), keywords: str(site.keywords),
    script: str(site.script), customHead: str(site.customHead), html: str(site.html),
    bg: str(site.bg), background: str(site.background), buttons: str(site.buttons),
    favicon: str(files.favicon), prv1: str(files.prv1),
  };
}

/** «كود head»: <meta> / <link> tags become real head tags on the server (search engines read them there); anything else is put in by the page */
export function headTags(html?: string): { metas: Record<string, string>[]; links: Record<string, string>[]; rest: string } {
  const metas: Record<string, string>[] = [], links: Record<string, string>[] = [];
  if (!html) return { metas, links, rest: "" };
  const rest = html.replace(/<(meta|link)\b([^>]*?)\/?>/gi, (_m, tag: string, attrs: string) => {
    const a: Record<string, string> = {};
    for (const m of attrs.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) a[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
    (tag.toLowerCase() === "meta" ? metas : links).push(a);
    return "";
  });
  return { metas, links, rest: rest.trim() };
}
