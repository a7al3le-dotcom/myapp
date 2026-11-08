// «فلتر» > forbidden words (config/fltr, path "bmsgs") also block a NAME: registering, entering as a guest or logging in with a name that contains
// one is refused (the owner checked this on al3nood.net, 2026-11-05). The check runs here, before any sign-in, because the word list is readable
// only by signed-in users. It answers yes / no only; the list itself is never sent.
//
// ISOLATED COPY ONLY: works against the local emulators and refuses otherwise (501).
const EMU = process.env.NEXT_PUBLIC_USE_EMULATOR === "1" && (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").startsWith("demo-");
const DB = `http://${process.env.DB_EMULATOR_HOST || "127.0.0.1:9600"}`;
const NS = `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? ""}-default-rtdb`;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

import { clientIp } from "@/lib/shim/client-ip";
import { joinParts, validParts } from "@/lib/shim/fp";
const FP_OK = /^[A-Za-z0-9 ._+|-]{1,200}$/;
const get = (path: string) => fetch(`${DB}/${path}.json?ns=${NS}`, { headers: { Authorization: "Bearer owner" }, signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// A GUEST name already in use (measured on al3nood.net 2026-11-06, guestname-device-orig.mjs / guestname-ip-orig.mjs / guestname-orig.mjs):
//  - by a registered member: refused (the owner, from the original);
//  - by a guest still listed (connected, or faded within «تثبيت النكات»): allowed when the SAME device OR the SAME IP (he takes the name back),
//    refused («يرجى إختيار أسم آخر») when both differ. The device and IP of the holder are the server's own record (memberConn), never sent out.
async function guestNameFree(name: string, ip: string, fp: string): Promise<boolean> {
  const profiles = ((await get("profiles")) ?? {}) as Record<string, { name?: string; topic?: string; registered?: boolean }>;
  const same = Object.entries(profiles).filter(([, p]) => (p?.name ?? p?.topic) === name);
  if (!same.length) return true;
  if (same.some(([, p]) => p?.registered === true)) return false;
  const site = ((await get("config/site")) ?? {}) as { stay?: unknown };
  const stay = Math.max(1, parseInt(String(site.stay)) || 1) * 60000, now = Date.now();
  for (const [uid] of same) {
    const pr = (await get(`presence/${encodeURIComponent(uid)}`)) as { online?: boolean; drop?: boolean; lastSeen?: number } | null;
    const listed = !!pr && (pr.online === true ? typeof pr.lastSeen !== "number" || now - pr.lastSeen < 180000 : pr.drop === true && typeof pr.lastSeen === "number" && now - pr.lastSeen < stay);
    if (!listed) continue;
    const c = (await get(`memberConn/${encodeURIComponent(uid)}`)) as { ip?: string; fp?: string } | null;
    const sameDevice = !!fp && c?.fp === fp, sameIp = !!ip && c?.ip === ip;
    if (!sameDevice && !sameIp) return false;
  }
  return true;
}

// «تعدد النكات من نفس الجهاز» (maxIP): the owner's improvement (2026-11-06; the original does not enforce it): a new login is refused when that
// many members/guests are already connected from the same DEVICE (memberConn fp). Taking back one's own name does not count.
async function deviceFull(name: string, fp: string): Promise<boolean> {
  if (!fp) return false;
  const site = ((await get("config/site")) ?? {}) as { maxIP?: unknown };
  const max = Math.max(2, parseInt(String(site.maxIP ?? "")) || 0); if (!(parseInt(String(site.maxIP ?? "")) > 0)) return false;
  const [pres, conn, profiles] = (await Promise.all([get("presence"), get("memberConn"), get("profiles")])) as Record<string, Record<string, unknown>>[];
  const now = Date.now();
  let n = 0;
  for (const [uid, p] of Object.entries(pres ?? {})) {
    if (p?.online !== true || (typeof p.lastSeen === "number" && now - p.lastSeen > 180000)) continue;
    if ((conn?.[uid] as { fp?: string } | undefined)?.fp !== fp) continue;
    const pr = profiles?.[uid] as { name?: string; topic?: string } | undefined; if ((pr?.name ?? pr?.topic) === name) continue;
    n++;
  }
  return n >= max;
}

export async function POST(req: Request) {
  if (!EMU) return json({ error: "emulator only" }, 501);
  let name = "", guest = false, fp = "";
  try {
    const b = await req.json(); name = typeof b?.name === "string" ? b.name.slice(0, 100) : ""; guest = b?.guest === true;
    fp = validParts(b?.parts) ? joinParts(b.parts) : typeof b?.fp === "string" && FP_OK.test(b.fp) ? b.fp : "";
  } catch { /* empty */ }
  if (!name) return json({ ok: true });
  const list = ((await get("config/fltr")) ?? {}) as Record<string, { path?: string; v?: string }>;
  const bad = Object.values(list).some((w) => w?.path === "bmsgs" && typeof w.v === "string" && w.v !== "" && name.includes(w.v));
  if (bad) return json({ ok: false });
  if (guest && !(await guestNameFree(name, clientIp(req.headers), fp))) return json({ ok: false });
  if (await deviceFull(name, fp)) return json({ ok: false, reason: "maxip" });
  return json({ ok: true });
}
