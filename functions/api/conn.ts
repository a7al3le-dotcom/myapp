// /api/conn on Cloudflare Pages: the same as the isolated copy's app/api/conn/route.ts (where a member connected from, the bans checked on the
// server for every login, the waiting room). Identity: the verified Firebase ID token. IP: CF-Connecting-IP. Writes: admin REST (functions/_lib/fb.ts).
import { clientIp, db, json, verifyIdToken, type Env } from "../_lib/fb";
import { compactFp, joinParts, validParts } from "../../lib/shim/fp";
import { decide, type BanRec } from "../../lib/shim/bans";
import { DEEP, deepMatch } from "../../lib/shim/members-search";

const LOG_KEY = /^[A-Za-z0-9_-]{10,30}$/;
const SRC_OK = /^[\p{L}\p{N} ._:/?&=%+@#,~*-]{1,100}$/u;
const FP_OK = /^[A-Za-z0-9 ._+|-]{1,200}$/;

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const uid = await verifyIdToken(env, request);
  if (!uid) return json({ error: "bad token" }, 401);
  let body: { fp?: unknown; parts?: unknown; log?: unknown; refr?: unknown; r?: unknown } = {};
  try { body = await request.json(); } catch { /* empty body: only the ip is recorded */ }
  const parts = validParts(body.parts) ? body.parts : null;
  const fp = parts ? joinParts(parts) : typeof body.fp === "string" && FP_OK.test(body.fp) ? body.fp : "";
  const ip = clientIp(request);
  const plain = (v: unknown) => (typeof v === "string" && SRC_OK.test(v) ? v : "");
  const refr = plain(body.refr), inv = plain(body.r);
  const d = db(env);
  const row: Record<string, unknown> = { ip, fp, ...(parts ? { parts } : {}), at: Date.now() };
  const w = await d.put(`memberConn/${encodeURIComponent(uid)}`, row);
  const log = typeof body.log === "string" && LOG_KEY.test(body.log) ? body.log : "";
  if (log && (await d.get(`loginLog/${log}/uid`)) === uid) await d.put(`loginConn/${log}`, { uid, ip, fp, ...(parts ? { parts } : {}), ...(refr ? { refr } : {}), ...(inv ? { r: inv } : {}), at: row.at });
  // «الحظر»: device / IP / country / account against the ban and allow texts; an allow entry wins; the deciding entry is counted
  const bans = ((await d.get("bans")) ?? {}) as Record<string, BanRec>;
  let banned = false;
  if (Object.keys(bans).length) {
    const co = String((await d.get(`profiles/${encodeURIComponent(uid)}/co`)) ?? "");
    const hit = decide(bans, { uid, ip, fp: compactFp(fp), co }, { re: DEEP, match: deepMatch });
    if (hit) {
      await d.patch(`bans/${encodeURIComponent(hit.path)}`, { hits: (Number(bans[hit.path].hits) || 0) + 1, last: Date.now() });
      if (!hit.allow) {
        banned = true;
        if (log) await d.patch(`loginLog/${log}`, { ban: true });
        await d.put(`kicks/${encodeURIComponent(uid)}`, { by: uid, t: Date.now(), ban: true });
      }
    }
  }
  // «غرفه الانتظار»
  if (!banned) {
    const owr = ((await d.get("config/wroomsOwr")) ?? {}) as { active?: boolean };
    const list = ((await d.get("config/wroomsList")) ?? {}) as Record<string, BanRec>;
    let wait = false;
    if (owr.active === true && Object.keys(list).length) {
      const co = String((await d.get(`profiles/${encodeURIComponent(uid)}/co`)) ?? "");
      const hit = decide(list, { uid, ip, fp: compactFp(fp), co }, { re: DEEP, match: deepMatch });
      if (hit) { await d.patch(`config/wroomsList/${encodeURIComponent(hit.path)}`, { hits: (Number(list[hit.path].hits) || 0) + 1, last: Date.now() }); wait = !hit.allow; }
    }
    await d.put(`waitRoom/${encodeURIComponent(uid)}`, wait ? true : null);
  }
  return w?.ok ? json({ ok: true, ...(banned ? { banned } : {}) }) : json({ error: "not stored" }, 502);
};
