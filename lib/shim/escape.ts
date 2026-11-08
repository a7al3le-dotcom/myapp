// Output sanitising for the stand-in server.
//
// The original client puts the strings it receives into the page as markup. Anything a user can write (names, messages, status, wall text,
// alerts, room titles ...) therefore has to be neutralised on its way OUT of the shim. Doing it on the read side also covers data written
// straight into the database by a modified client.
//
// Rule of thumb: every string is HTML-escaped, unless its key is listed in `raw` (markup the shim builds itself) or it is validated by key:
// ids, pictures, colours, countries and links have a fixed shape and are checked instead of escaped (escaping would corrupt a URL).

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// For text the client may show either as plain text or as markup depending on where (room titles, descriptions): only the characters that can
// open a tag are replaced by look-alikes, so the result is safe in both places and reads almost as typed.
export const softEsc = (v: unknown): string => String(v ?? "").replace(/</g, "‹").replace(/>/g, "›");

const HEX = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
export const safeColor = (c: unknown, fallback = "#000000"): string => (typeof c === "string" && HEX.test(c) ? c : fallback);

// a picture or icon: our own files only (no scheme, no quotes, no spaces other than inside the known gift/emoji file names)
const PIC = /^(?:pic\.png|room\.png|(?:uploads|sico|dro3|emo|imgs|flags)\/[\w.\- ]{1,140})$/;
export const safePic = (p: unknown, fallback = ""): string => (typeof p === "string" && PIC.test(p) && !p.includes("..") ? p : fallback);

// a gift file name (used inside the shim's own <img> markup)
export const safeFile = (f: unknown): string => (typeof f === "string" && /^[\w.\- ]{1,140}$/.test(f) && !f.includes("..") ? f : "");
// a rank's icon file name in the power table (the page adds "sico/"); some owner files carry " (1)"
export const safeIco = (f: unknown): string => (typeof f === "string" && /^[\w.\- ()]{1,140}$/.test(f) && !f.includes("..") ? f : "");

// identifiers (user, room, message, wall post keys) end up inside inline handlers such as rjoin('<id>')
const ID = /^[\w-]{1,64}$/;
export const safeId = (i: unknown): string => (typeof i === "string" && ID.test(i) ? i : "");

// a link on the wall: http(s) or one of our uploads, no quotes/brackets/whitespace
const LINK = /^(?:https?:\/\/[^\s"'<>`\\]{1,280}|uploads\/[\w.\-]{1,120})$/i;
export const safeLink = (l: unknown): string => (typeof l === "string" && LINK.test(l) ? l : "");

const COUNTRY = /^(?:[a-zA-Z]{2}|--)$/;
export const safeCountry = (c: unknown): string => (typeof c === "string" && COUNTRY.test(c) ? c : "--");

const COLOR_KEYS = new Set(["ucol", "mcol", "bg", "c"]);
const ID_KEYS = new Set(["id", "lid", "uid", "bid", "mi", "roomid", "rid", "pm", "cpi"]);

export type SanitizeOptions = { raw?: readonly string[]; soft?: readonly string[] };

/** Deep copy of an outgoing payload with every string made safe. `raw`: keys whose value is markup built by the shim itself.
 *  `soft`: keys that only get the light treatment of softEsc(). */
export function sanitizeOut(value: unknown, opts: readonly string[] | SanitizeOptions = {}, key = ""): unknown {
  const o: SanitizeOptions = Array.isArray(opts) ? { raw: opts as readonly string[] } : (opts as SanitizeOptions);
  if (typeof value === "string") {
    if (o.raw?.includes(key)) return value;
    if (o.soft?.includes(key)) return softEsc(value);
    if (COLOR_KEYS.has(key)) return value === "" ? "" : safeColor(value);
    if (key === "pic") return safePic(value, "pic.png"); // a bad picture falls back to the default one
    // «ico»: a picture path, or a rank's bare icon file name from the power table (x3 adds "sico/" itself; e.g. "1748437312518 (1).gif")
    if (key === "ico") return safePic(value) || safeIco(value);
    if (key === "b") return safeFile(value); // a banner is stored as a bare file name
    if (ID_KEYS.has(key)) return safeId(value);
    if (key === "link") return safeLink(value);
    if (key === "co") return safeCountry(value);
    return esc(value);
  }
  if (Array.isArray(value)) return value.map((x) => sanitizeOut(x, o, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeOut(v, o, k);
    return out;
  }
  return value;
}
