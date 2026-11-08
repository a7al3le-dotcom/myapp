// «فلتر» > the log under the word list: a message that contains WATCHED or FORBIDDEN words (config/fltr, wmsgs / bmsgs) is recorded
// here with the word, the message, the sender's name and the IP of this request. What the original does (al3nood.net, measured 2026-11-05):
// 11 logged messages were on screen unchanged in the public room and 2 on the wall; the log keeps the last 100; a watched word matches
// anywhere inside the text (55 of 62 entries were part of a longer word).
//
// ISOLATED COPY ONLY: works against the local emulators and refuses otherwise (501). The caller is identified by a Firebase ID token checked by
// the Auth emulator; the server re-checks that the word is really a watched word AND is inside the message, so a client cannot fill the log
// with arbitrary text. Clients cannot write fltrLog at all (database rules); holders of "filter" may read it and delete rows.
import { clientIp } from "@/lib/shim/client-ip";

const EMU = process.env.NEXT_PUBLIC_USE_EMULATOR === "1" && (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").startsWith("demo-");
const AUTH = `http://127.0.0.1:${process.env.NEXT_PUBLIC_AUTH_EMU_PORT || "9699"}`;
const DB = `http://${process.env.DB_EMULATOR_HOST || "127.0.0.1:9600"}`;
const NS = `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? ""}-default-rtdb`;
const KEEP = 100;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const H = { Authorization: "Bearer owner" };
const get = (path: string, q = "") => fetch(`${DB}/${path}.json?ns=${NS}${q}`, { headers: H, signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export async function POST(req: Request) {
  if (!EMU) return json({ error: "emulator only" }, 501);
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return json({ error: "no token" }, 401);
  let uid = "";
  try {
    const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo-api-key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(4000) });
    uid = r.ok ? String((await r.json()).users?.[0]?.localId ?? "") : "";
  } catch { /* auth emulator unreachable */ }
  if (!uid) return json({ error: "bad token" }, 401);
  let body: { v?: unknown; msg?: unknown } = {};
  try { body = await req.json(); } catch { return json({ error: "bad body" }, 400); }
  const v = typeof body.v === "string" ? body.v : "", msg = typeof body.msg === "string" ? body.msg.slice(0, 2000) : "";
  // v = every matched word, ", "-joined (the original log shows "قهوه, ش"): each one must be a watched/forbidden word that is in the message
  const words = v.split(", ");
  if (!v || words.some((w) => !w || !msg.includes(w))) return json({ error: "no match" }, 400);
  const list = ((await get("config/fltr")) ?? {}) as Record<string, { path?: string; v?: string }>;
  const known = new Set(Object.values(list).filter((w) => w?.path === "wmsgs" || w?.path === "bmsgs").map((w) => w.v));
  if (words.some((w) => !known.has(w))) return json({ error: "not in the list" }, 400);
  const topic = String((await get(`profiles/${encodeURIComponent(uid)}/topic`)) ?? "");
  const w = await fetch(`${DB}/fltrLog.json?ns=${NS}`, { method: "POST", headers: H, body: JSON.stringify({ v, msg, topic, uid, ip: clientIp(req.headers), t: Date.now() }), signal: AbortSignal.timeout(4000) }).catch(() => null);
  // keep the newest KEEP rows (push keys sort by time)
  const keys = Object.keys(((await get("fltrLog", "&shallow=true")) ?? {}) as Record<string, unknown>).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) await fetch(`${DB}/fltrLog/${k}.json?ns=${NS}`, { method: "DELETE", headers: H, signal: AbortSignal.timeout(4000) }).catch(() => null);
  return w?.ok ? json({ ok: true }) : json({ error: "not stored" }, 502);
}
