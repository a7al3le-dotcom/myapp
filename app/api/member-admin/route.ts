// «السجل/الأعضاء» > ⚙ «كلمه المرور» (x3 cp_ledit -> cp pwd) and «حذف العضويه» (cp delu): what the original server does at once for a holder of
// «إدارة العضويات» (edituser, the flag that shows the ⚙ button, x3 L2898). Measured on the original 2026-11-06 (owner): the account is deleted at
// once and «الحالات» gets «حذف عضويه» (second member = the deleted name, «الاي بي» "<IP> |").
//
// ISOLATED COPY ONLY: works against the local Auth / Database emulators and refuses to run otherwise (501). The caller is identified by a
// Firebase ID token verified by the Auth emulator; the rank rules are the same as for every moderation act: the caller holds «edituser» with a
// valid unexpired rank (or is the site owner, config/bootstrap), the target is never the owner nor the caller, and is unranked or STRICTLY lower.
const EMU = process.env.NEXT_PUBLIC_USE_EMULATOR === "1" && (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").startsWith("demo-");
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
const AUTH = `http://127.0.0.1:${process.env.NEXT_PUBLIC_AUTH_EMU_PORT || "9699"}`;
const DB = `http://${process.env.DB_EMULATOR_HOST || "127.0.0.1:9600"}`;
const NS = `${PROJECT}-default-rtdb`;
const ID = /^[A-Za-z0-9_-]{6,64}$/;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const H = { Authorization: "Bearer owner" };
const get = (path: string) => fetch(`${DB}/${path}.json?ns=${NS}`, { headers: H, signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const del = (path: string) => fetch(`${DB}/${path}.json?ns=${NS}`, { method: "DELETE", headers: H, signal: AbortSignal.timeout(4000) }).catch(() => null);
const authApi = (op: string, body: unknown) => fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:${op}`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });

type Pw = { name?: string; level?: number; until?: number } | null;
async function rankOf(uid: string): Promise<{ ok: boolean; rank: number; flags: Record<string, unknown> }> {
  const p = (await get(`powers/${encodeURIComponent(uid)}`)) as Pw;
  if (!p || !p.name || (typeof p.until === "number" && p.until < Date.now())) return { ok: true, rank: -1, flags: {} };
  const row = (await get(`powerTable/${encodeURIComponent(p.name)}`)) as Record<string, unknown> | null;
  if (!row || typeof row.rank !== "number") return { ok: false, rank: -1, flags: {} };
  return { ok: true, rank: row.rank, flags: row };
}

export async function POST(req: Request) {
  if (!EMU) return json({ error: "emulator only" }, 501);
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return json({ error: "no token" }, 401);
  let me = "";
  try {
    const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo-api-key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(4000) });
    me = r.ok ? String((await r.json()).users?.[0]?.localId ?? "") : "";
  } catch { /* auth emulator unreachable */ }
  if (!me) return json({ error: "bad token" }, 401);
  let body: { cmd?: unknown; id?: unknown; pwd?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const cmd = body.cmd === "delu" ? "delu" : body.cmd === "pwd" ? "pwd" : "";
  const id = typeof body.id === "string" && ID.test(body.id) ? body.id : "";
  if (!cmd || !id) return json({ error: "bad request" }, 400);

  // permission: «إدارة العضويات» over a lower target (the owner may act on anybody but himself; nobody acts on the owner)
  const boot = String((await get("config/bootstrap")) ?? "");
  const mine = await rankOf(me), theirs = await rankOf(id);
  const flag = mine.flags.edituser === true || (typeof mine.flags.edituser === "number" && (mine.flags.edituser as number) > 0);
  const allowed = id !== me && id !== boot && theirs.ok && (me === boot || (mine.ok && flag && mine.rank >= 0 && theirs.rank < mine.rank));
  if (!allowed) return json({ ok: false, refused: true });

  const prof = (await get(`profiles/${encodeURIComponent(id)}`)) as { topic?: string; name?: string; registered?: boolean } | null;
  if (!prof?.registered) return json({ ok: false, refused: true }); // members only: the ⚙ menu is on «الأعضاء» rows (registered profiles)

  if (cmd === "pwd") {
    const pwd = typeof body.pwd === "string" ? body.pwd : "";
    if (!pwd || pwd.length > 100) return json({ ok: false, error: "bad" }); // x3 sends any non-empty text (prompt)
    // the same padding the login form uses (lib/shim/server.ts padPw), so the member signs in with exactly what was typed here
    const r = await authApi("update", { localId: id, password: pwd + "~al3nood" });
    return json({ ok: r.ok }); // the original panel shows no line in «الحالات» for a password change (none among 5914 rows)
  }

  // delu: the account, then its member data; the open page is closed (kick). The «الحالات» line keeps the name (the profile is gone).
  const r = await authApi("delete", { localId: id });
  if (!r.ok) return json({ ok: false });
  const name = String(prof.topic || prof.name || id);
  await fetch(`${DB}/kicks/${encodeURIComponent(id)}.json?ns=${NS}`, { method: "PUT", headers: H, body: JSON.stringify({ by: me, t: Date.now() }) }).catch(() => null);
  for (const p of ["profiles", "powers", "rep", "memberConn"]) await del(`${p}/${encodeURIComponent(id)}`);
  await fetch(`${DB}/actionLog.json?ns=${NS}`, { method: "POST", headers: H, body: JSON.stringify({ type: "delu", u1: me, u2: id, d: name.slice(0, 120), created: Date.now() }) }).catch(() => null);
  return json({ ok: true });
}
