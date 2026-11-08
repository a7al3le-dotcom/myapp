// Records where a member connected from: the IP of THIS request's connection (seen by the server, never sent by the browser) and the device
// fingerprint string the client built. Stored at memberConn/<uid> = { ip, fp, at } and read back only by control-panel holders (database rules).
//
// ISOLATED COPY ONLY: it works against the local emulators and refuses to run otherwise (501), so it can never touch a real project.
// The caller's identity comes from a Firebase ID token verified by the Auth emulator (the uid is never taken from the request body), and the
// write goes through the emulator's admin bypass, so the rules can keep memberConn closed to every client write.
//
// IP source: the first address of X-Forwarded-For / X-Real-IP, which the dev server (or a proxy in front of it) sets from the socket.
// That is only trustworthy when the server is the edge or sits behind a proxy you control; a client talking directly to a server that does not
// overwrite those headers could set them. Whether the original server reads the socket address or a proxy header is UNKNOWN.
import { clientIp } from "@/lib/shim/client-ip";
import { compactFp, joinParts, validParts } from "@/lib/shim/fp";
import { decide, type BanRec } from "@/lib/shim/bans";
import { DEEP, deepMatch } from "@/lib/shim/members-search";

const EMU = process.env.NEXT_PUBLIC_USE_EMULATOR === "1" && (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").startsWith("demo-");
const AUTH = `http://127.0.0.1:${process.env.NEXT_PUBLIC_AUTH_EMU_PORT || "9699"}`;
const DB = `http://${process.env.DB_EMULATOR_HOST || "127.0.0.1:9600"}`;
const NS = `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? ""}-default-rtdb`;

const LOG_KEY = /^[A-Za-z0-9_-]{10,30}$/;
const SRC_OK = /^[\p{L}\p{N} ._:/?&=%+@#,~*-]{1,100}$/u;
const FP_OK =/^[A-Za-z0-9 ._+|-]{1,200}$/;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

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
  let body: { fp?: unknown; parts?: unknown; log?: unknown; refr?: unknown; r?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body: only the ip is recorded */ }
  // seven validated parts -> the unified string is rebuilt HERE from them (a client cannot send a string that disagrees with its parts); otherwise a plain valid string is kept
  const parts = validParts(body.parts) ? body.parts : null;
  const fp = parts ? joinParts(parts) : typeof body.fp === "string" && FP_OK.test(body.fp) ? body.fp : "";
  const ip = clientIp(req.headers);
  // referrer / invite text the client sent with the login: plain printable text only (no markup, no control characters), capped; stored per login event only
  const plain = (v: unknown) => (typeof v === "string" && SRC_OK.test(v) ? v : "");
  const refr = plain(body.refr), inv = plain(body.r);
  const row: Record<string, unknown> = { ip, fp, ...(parts ? { parts } : {}), at: Date.now() };
  const put = (path: string, v: unknown) => fetch(`${DB}/${path}.json?ns=${NS}`, { method: "PUT", headers: { Authorization: "Bearer owner" }, body: JSON.stringify(v), signal: AbortSignal.timeout(4000) }).catch(() => null);
  const w = await put(`memberConn/${encodeURIComponent(uid)}`, row);
  // The same connection data for ONE login event (tab «السجل»): only for a loginLog row that exists and belongs to the verified uid, so a caller can never attach data to someone else's row.
  const log = typeof body.log === "string" && LOG_KEY.test(body.log) ? body.log : "";
  if (log) {
    const owner = await fetch(`${DB}/loginLog/${log}/uid.json?ns=${NS}`, { headers: { Authorization: "Bearer owner" }, signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (owner === uid) await put(`loginConn/${log}`, { uid, ip, fp, ...(parts ? { parts } : {}), ...(refr ? { refr } : {}), ...(inv ? { r: inv } : {}), at: row.at });
  }
  // «الحظر» (lib/shim/bans.ts): checked HERE, on the server, for every login: the device, IP, country or account against the ban / allow texts.
  // An allow entry wins. The deciding entry counts the event (الحالات / آخر حاله); a banned connection is logged as «محظور» and kicked out.
  const get = (path: string) => fetch(`${DB}/${path}.json?ns=${NS}`, { headers: { Authorization: "Bearer owner" }, signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const bans = ((await get("bans")) ?? {}) as Record<string, BanRec>;
  let banned = false;
  if (Object.keys(bans).length) {
    const co = String((await get(`profiles/${encodeURIComponent(uid)}/co`)) ?? "");
    const hit = decide(bans, { uid, ip, fp: compactFp(fp), co }, { re: DEEP, match: deepMatch });
    if (hit) {
      const rec = bans[hit.path];
      await fetch(`${DB}/bans/${encodeURIComponent(hit.path)}.json?ns=${NS}`, { method: "PATCH", headers: { Authorization: "Bearer owner" }, body: JSON.stringify({ hits: (Number(rec.hits) || 0) + 1, last: Date.now() }), signal: AbortSignal.timeout(4000) }).catch(() => null);
      if (!hit.allow) {
        banned = true;
        if (log) await fetch(`${DB}/loginLog/${log}.json?ns=${NS}`, { method: "PATCH", headers: { Authorization: "Bearer owner" }, body: JSON.stringify({ ban: true }), signal: AbortSignal.timeout(4000) }).catch(() => null);
        await put(`kicks/${encodeURIComponent(uid)}`, { by: uid, t: Date.now(), ban: true });
      }
    }
  }
  // «غرفه الانتظار»: when it is active, a connection matching the waiting-room list (device / part of one / IP / country; «سماح» entries win)
  // is marked waitRoom/<uid> = true (read by the member's own page, which keeps him in the waiting room); otherwise the mark is cleared
  if (!banned) {
    const owr = ((await get("config/wroomsOwr")) ?? {}) as { active?: boolean };
    const list = ((await get("config/wroomsList")) ?? {}) as Record<string, BanRec>;
    let wait = false;
    if (owr.active === true && Object.keys(list).length) {
      const co = String((await get(`profiles/${encodeURIComponent(uid)}/co`)) ?? "");
      const hit = decide(list, { uid, ip, fp: compactFp(fp), co }, { re: DEEP, match: deepMatch });
      if (hit) {
        await fetch(`${DB}/config/wroomsList/${encodeURIComponent(hit.path)}.json?ns=${NS}`, { method: "PATCH", headers: { Authorization: "Bearer owner" }, body: JSON.stringify({ hits: (Number(list[hit.path].hits) || 0) + 1, last: Date.now() }), signal: AbortSignal.timeout(4000) }).catch(() => null);
        wait = !hit.allow;
      }
    }
    await put(`waitRoom/${encodeURIComponent(uid)}`, wait ? true : null);
  }
  return w?.ok ? json({ ok: true, ...(banned ? { banned } : {}) }) : json({ error: "not stored" }, 502);
}
