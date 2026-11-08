// /api/fltr on Cloudflare Pages: the filter log row («فلتر» > سجل), as the isolated copy's app/api/fltr/route.ts; the newest 100 rows are kept.
import { clientIp, db, json, verifyIdToken, type Env } from "../_lib/fb";

const KEEP = 100;

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const uid = await verifyIdToken(env, request);
  if (!uid) return json({ error: "bad token" }, 401);
  let body: { v?: unknown; msg?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "bad body" }, 400); }
  const v = typeof body.v === "string" ? body.v : "", msg = typeof body.msg === "string" ? body.msg.slice(0, 2000) : "";
  const words = v.split(", ");
  if (!v || words.some((w) => !w || !msg.includes(w))) return json({ error: "no match" }, 400);
  const d = db(env);
  const list = ((await d.get("config/fltr")) ?? {}) as Record<string, { path?: string; v?: string }>;
  const known = new Set(Object.values(list).filter((w) => w?.path === "wmsgs" || w?.path === "bmsgs").map((w) => w.v));
  if (words.some((w) => !known.has(w))) return json({ error: "not in the list" }, 400);
  const topic = String((await d.get(`profiles/${encodeURIComponent(uid)}/topic`)) ?? "");
  const w = await d.post("fltrLog", { v, msg, topic, uid, ip: clientIp(request), t: Date.now() });
  const keys = Object.keys(((await d.get("fltrLog", "&shallow=true")) ?? {}) as Record<string, unknown>).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) await d.del(`fltrLog/${k}`);
  return w?.ok ? json({ ok: true }) : json({ error: "not stored" }, 502);
};
