// Site settings (config/site): the single description of what may be stored there.
// Used by the shim (shapeSite, on the way in and out) AND by firebase/build-rules.mjs (the database rules are generated from the same table),
// so the two can never disagree. Keep this file free of imports: Node loads it directly from the rules builder.
//
// Kinds: s = text up to `max` UTF-16 code units (the unit database rules count in), n = finite number 0..max, b = true/false,
// sn = short text (`max` units) or a number 0..nmax (the control panel's own form sends a few numeric settings as text).
export type SiteKind = { t: "s"; max: number } | { t: "n"; max: number } | { t: "b" } | { t: "sn"; max: number; nmax: number };

/** The one upper bound for every numeric setting; the rules and shapeSite both read it from here. */
export const SITE_NUMBER_MAX = 1_000_000;

const S = (max: number): SiteKind => ({ t: "s", max });
const N = (max = SITE_NUMBER_MAX): SiteKind => ({ t: "n", max });
const B: SiteKind = { t: "b" };
const SN = (max = 12, nmax = SITE_NUMBER_MAX): SiteKind => ({ t: "sn", max, nmax });

/** Fields the reference site injects into its pages (head markup, HTML, script). Applied like the original since 2026-11-06 (owner: «كل شيء
 *  كما في الأصل»): the server writes them into the page (lib/server/site-settings.ts, app/layout.tsx, app/page.tsx) and the script runs after
 *  x3.js (components/LegacyBoot.tsx). Whoever holds «إداره الموقع» (cpsite) can therefore run code on every visitor's page, as on the original. */
export const SITE_EXECUTABLE_KEYS = ["script", "html", "customHead"] as const;
export const EXECUTABLE_MAX = 20_000;

export const SITE_SCHEMA: Record<string, SiteKind> = {
  name: S(200), title: S(200), description: S(1000), keywords: S(1000),
  script: S(EXECUTABLE_MAX), html: S(EXECUTABLE_MAX), customHead: S(EXECUTABLE_MAX),
  bg: S(40), buttons: S(40), background: S(40),
  callsLike: SN(), maxIP: SN(), maxshrt: SN(),
  wall_likes: N(), wall_minutes: N(), msgst: N(), roomMsgLikes: N(), pmlikes: N(), notlikes: N(), fileslikes: N(), piclikes: N(), proflikes: N(),
  guestNameMax: N(), registerNameMax: N(), stay: N(),
  allowg: B, allowreg: B, bclikes: B, bcreply: B, calls: B, mlikes: B, mreply: B, rc: B, vpnBlock: B,
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const graphemes: Intl.Segmenter | undefined = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;

/** Cut `s` to at most `max` UTF-16 code units (the limit database rules enforce) WITHOUT splitting what the reader sees as one character:
 *  a surrogate pair (emoji), a flag, a family or skin-tone sequence, a letter with its combining marks. Whole characters are kept while they
 *  fit; the first one that does not fit ends the text. Shorter text is returned untouched. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  // only the head can matter (a character straddling the limit is dropped anyway); this keeps a 200 KB value cheap to process
  const head = s.slice(0, max + 64);
  let out = "";
  if (graphemes) {
    for (const { segment } of graphemes.segment(head)) {
      if (out.length + segment.length > max) break;
      out += segment;
    }
    return out;
  }
  for (const ch of head) { // fallback without Intl.Segmenter: whole code points at least (iterating a string never splits a surrogate pair)
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** One value, forced into its declared shape; `undefined` when it cannot be (the key is then dropped, never stored or shown).
 *  Text is kept EXACTLY as written (no escaping): the control panel fills its fields as plain values, so escaping would corrupt them. */
export function shapeValue(kind: SiteKind, v: unknown): string | number | boolean | undefined {
  switch (kind.t) {
    case "s": return typeof v === "string" ? clip(v, kind.max) : undefined;
    case "n": return typeof v === "number" && Number.isFinite(v) ? Math.min(kind.max, Math.max(0, v)) : undefined;
    case "b": return typeof v === "boolean" ? v : undefined;
    case "sn":
      if (typeof v === "string") return clip(v, kind.max);
      return typeof v === "number" && Number.isFinite(v) ? Math.min(kind.nmax, Math.max(0, v)) : undefined;
  }
}

/** Known keys only, each in its declared shape. Anything else (unknown keys, `domains`, nested objects, wrong types) is dropped.
 *  Idempotent: shapeSite(shapeSite(x)) equals shapeSite(x), so applying it on both receive and save never alters the text twice. */
export function shapeSite(input: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [k, kind] of Object.entries(SITE_SCHEMA)) {
    if (!has(input, k)) continue;
    const v = shapeValue(kind, (input as Record<string, unknown>)[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
