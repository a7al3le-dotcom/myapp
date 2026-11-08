// Bans of the control panel («الحظر» tab), as the ORIGINAL shows them (al3nood.net, measured 2026-11-05):
//   - a ban is a TEXT: a whole device string, a part of one (often with leading "*", e.g. "****1a.2b.3c"), an IP, or a country code;
//   - «سماح» (cmd "aban") adds the same kind of text as an ALLOW entry (column «ينتهي في» = «سماح», bans show «دائم»);
//   - «الحالات» = how many times the entry stopped/allowed a login, «آخر حاله» = time since the last one as hours:mm:ss:ms, or "--".
// «حظر عميق N» sends "N stars=<device>": it uses the measured deep-search rule (members-search.ts deepMatch: device parts 3..2+N).
// Other texts (a whole device, a piece of one, older "****1a.2b.3c" entries whose origin is not known) match when the device string CONTAINS
// them (after removing leading "*"), or they equal the IP or the country code (inferred). An allow entry that matches wins over any ban.
// Database keys cannot hold . # $ [ ] / so the text is stored in the record (key) under a short id path (banPath).

export type BanRec = { by?: string; t?: number; reason?: string; key?: string; allow?: boolean; hits?: number; last?: number };
export type Conn = { uid: string; ip: string; fp: string; co: string };

export const encodeBanKey = (text: string) => text.replace(/[%.#$[\]/]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
// the record's path: a short id made of the text (letters/digits only, so the list's ✕ button can carry it), "a" prefix for an allow entry
const fnv = (s: string, seed: number) => { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
export const banPath = (text: string, allow: boolean) => (allow ? "a" : "b") + fnv(text, 0x811c9dc5) + fnv(text, 0x9e3779b9);
export const decodeBanKey = (path: string) => path.replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** the text a record stands for: its key field, or (records written before keys existed) the decoded path */
export const banText = (path: string, r: BanRec) => (typeof r.key === "string" && r.key ? r.key : decodeBanKey(path));
const needle = (text: string) => text.replace(/^\*+=?/, "").trim().toLowerCase();

/** deep: the measured deep-search rule (members-search.ts deepMatch), passed in so this file stays free of imports */
export type Deep = { re: RegExp; match: (fp: string, text: string) => boolean };
export function recMatches(path: string, r: BanRec, c: Conn, deep: Deep): boolean {
  if (path === c.uid) return true; // ban made from the member's card
  const text = banText(path, r);
  if (deep.re.test(text.trim())) return deep.match(c.fp, text);
  const n = needle(text);
  if (!n) return false;
  return (!!c.fp && c.fp.toLowerCase().includes(n)) || (!!c.ip && c.ip.toLowerCase() === n) || (!!c.co && c.co.toLowerCase() === n);
}

/** which record decides this connection: an allow entry wins; otherwise the first matching ban; null = not banned */
export function decide(all: Record<string, BanRec>, c: Conn, deep: Deep): { path: string; allow: boolean } | null {
  const hits = Object.entries(all).filter(([p, r]) => r && typeof r === "object" && recMatches(p, r, c, deep));
  const allow = hits.find(([, r]) => r.allow === true);
  if (allow) return { path: allow[0], allow: true };
  const ban = hits.find(([, r]) => r.allow !== true);
  return ban ? { path: ban[0], allow: false } : null;
}

/** «آخر حاله»: elapsed time as hours:mm:ss:ms (hours are not wrapped at 24), "--" when it never happened */
export function lastCell(last: unknown, now: number): string {
  const t = Number(last);
  if (!t) return "--";
  const ms = Math.max(0, now - t), p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}:${p(ms % 1000, 3)}`;
}
