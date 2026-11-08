// /api/member-admin on Cloudflare Pages: ⚙ «كلمه المرور» / «حذف العضويه» of «الأعضاء», as the isolated copy's app/api/member-admin/route.ts.
// The caller holds «إدارة العضويات» (edituser) with a valid rank (or is the site owner, config/bootstrap); the target is never the owner nor the
// caller, and is unranked or strictly lower. Auth changes go through Identity Toolkit with the service account (works on the free plan).
import { authAdmin, db, json, verifyIdToken, type Db, type Env } from "../_lib/fb";

const ID = /^[A-Za-z0-9_-]{6,64}$/;
type Pw = { name?: string; until?: number } | null;
async function rankOf(d: Db, uid: string) {
  const p = (await d.get(`powers/${encodeURIComponent(uid)}`)) as Pw;
  if (!p || !p.name || (typeof p.until === "number" && p.until < Date.now())) return { ok: true, rank: -1, flags: {} as Record<string, unknown> };
  const row = (await d.get(`powerTable/${encodeURIComponent(p.name)}`)) as Record<string, unknown> | null;
  if (!row || typeof row.rank !== "number") return { ok: false, rank: -1, flags: {} as Record<string, unknown> };
  return { ok: true, rank: row.rank, flags: row };
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const me = await verifyIdToken(env, request);
  if (!me) return json({ error: "bad token" }, 401);
  let body: { cmd?: unknown; id?: unknown; pwd?: unknown } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const cmd = body.cmd === "delu" ? "delu" : body.cmd === "pwd" ? "pwd" : "";
  const id = typeof body.id === "string" && ID.test(body.id) ? body.id : "";
  if (!cmd || !id) return json({ error: "bad request" }, 400);
  const d = db(env);
  const boot = String((await d.get("config/bootstrap")) ?? "");
  const mine = await rankOf(d, me), theirs = await rankOf(d, id);
  const flag = mine.flags.edituser === true || (typeof mine.flags.edituser === "number" && (mine.flags.edituser as number) > 0);
  if (!(id !== me && id !== boot && theirs.ok && (me === boot || (mine.ok && flag && mine.rank >= 0 && theirs.rank < mine.rank)))) return json({ ok: false, refused: true });
  const prof = (await d.get(`profiles/${encodeURIComponent(id)}`)) as { topic?: string; name?: string; registered?: boolean } | null;
  if (!prof?.registered) return json({ ok: false, refused: true });
  if (cmd === "pwd") {
    const pwd = typeof body.pwd === "string" ? body.pwd : "";
    if (!pwd || pwd.length > 100) return json({ ok: false, error: "bad" });
    const r = await authAdmin(env, "update", { localId: id, password: pwd + "~al3nood" }); // the login form's own padding (lib/shim/server.ts padPw)
    return json({ ok: r.ok });
  }
  const r = await authAdmin(env, "delete", { localId: id });
  if (!r.ok) return json({ ok: false });
  const name = String(prof.topic || prof.name || id);
  await d.put(`kicks/${encodeURIComponent(id)}`, { by: me, t: Date.now() });
  for (const p of ["profiles", "powers", "rep", "memberConn"]) await d.del(`${p}/${encodeURIComponent(id)}`);
  await d.post("actionLog", { type: "delu", u1: me, u2: id, d: name.slice(0, 120), created: Date.now() });
  return json({ ok: true });
};
