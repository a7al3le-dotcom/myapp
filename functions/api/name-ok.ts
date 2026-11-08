// /api/name-ok on Cloudflare Pages: the same rules as the isolated copy's app/api/name-ok/route.ts — a forbidden word (bmsgs) in a name,
// a guest name held by someone else (another device AND another IP) or a member's name, «تعدد النكات من نفس الجهاز» (maxIP). No sign-in needed.
import { clientIp, db, json, type Db, type Env } from "../_lib/fb";
import { joinParts, validParts } from "../../lib/shim/fp";

const FP_OK = /^[A-Za-z0-9 ._+|-]{1,200}$/;

async function guestNameFree(d: Db, name: string, ip: string, fp: string): Promise<boolean> {
  const profiles = ((await d.get("profiles")) ?? {}) as Record<string, { name?: string; topic?: string; registered?: boolean }>;
  const same = Object.entries(profiles).filter(([, p]) => (p?.name ?? p?.topic) === name);
  if (!same.length) return true;
  if (same.some(([, p]) => p?.registered === true)) return false;
  const site = ((await d.get("config/site")) ?? {}) as { stay?: unknown };
  const stay = Math.max(1, parseInt(String(site.stay)) || 1) * 60000, now = Date.now();
  for (const [uid] of same) {
    const pr = (await d.get(`presence/${encodeURIComponent(uid)}`)) as { online?: boolean; drop?: boolean; lastSeen?: number } | null;
    const listed = !!pr && (pr.online === true ? typeof pr.lastSeen !== "number" || now - pr.lastSeen < 180000 : pr.drop === true && typeof pr.lastSeen === "number" && now - pr.lastSeen < stay);
    if (!listed) continue;
    const c = (await d.get(`memberConn/${encodeURIComponent(uid)}`)) as { ip?: string; fp?: string } | null;
    if (!(!!fp && c?.fp === fp) && !(!!ip && c?.ip === ip)) return false;
  }
  return true;
}

async function deviceFull(d: Db, name: string, fp: string): Promise<boolean> {
  if (!fp) return false;
  const site = ((await d.get("config/site")) ?? {}) as { maxIP?: unknown };
  if (!(parseInt(String(site.maxIP ?? "")) > 0)) return false;
  const max = Math.max(2, parseInt(String(site.maxIP)) || 0);
  const [pres, conn, profiles] = (await Promise.all([d.get("presence"), d.get("memberConn"), d.get("profiles")])) as Record<string, Record<string, unknown>>[];
  const now = Date.now(); let n = 0;
  for (const [uid, p] of Object.entries(pres ?? {})) {
    if (p?.online !== true || (typeof p.lastSeen === "number" && now - p.lastSeen > 180000)) continue;
    if ((conn?.[uid] as { fp?: string } | undefined)?.fp !== fp) continue;
    const pr = profiles?.[uid] as { name?: string; topic?: string } | undefined; if ((pr?.name ?? pr?.topic) === name) continue;
    n++;
  }
  return n >= max;
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  let name = "", guest = false, fp = "";
  try {
    const b = (await request.json()) as { name?: unknown; guest?: unknown; parts?: unknown; fp?: unknown };
    name = typeof b?.name === "string" ? b.name.slice(0, 100) : ""; guest = b?.guest === true;
    fp = validParts(b?.parts) ? joinParts(b.parts) : typeof b?.fp === "string" && FP_OK.test(b.fp) ? b.fp : "";
  } catch { /* empty */ }
  if (!name) return json({ ok: true });
  const d = db(env);
  const list = ((await d.get("config/fltr")) ?? {}) as Record<string, { path?: string; v?: string }>;
  if (Object.values(list).some((w) => w?.path === "bmsgs" && typeof w.v === "string" && w.v !== "" && name.includes(w.v))) return json({ ok: false });
  if (guest && !(await guestNameFree(d, name, clientIp(request), fp))) return json({ ok: false });
  if (await deviceFull(d, name, fp)) return json({ ok: false, reason: "maxip" });
  return json({ ok: true });
};
