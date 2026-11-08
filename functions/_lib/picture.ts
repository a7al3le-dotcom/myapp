// /uploads, /sico, /emo, /dro3 on Cloudflare Pages: a built-in file (public/) is served as it is; an uploaded picture (db-<id>.<ext>, kept as
// base64 in the database under images/<id>, readable without signing in) is read and sent with its own type — as lib/server/picture.ts does.
import type { Env } from "./fb";

export async function servePicture({ request, env, params }: { request: Request; env: Env; params: { name?: string | string[] } }) {
  const name = String(Array.isArray(params.name) ? params.name.join("/") : params.name ?? "");
  const m = /^db-([\w-]+)\.\w{2,4}$/.exec(name);
  if (!m) return env.ASSETS.fetch(request); // the built-in files
  const r = await fetch(`${env.FIREBASE_DB_URL}/images/${m[1]}.json`).catch(() => null);
  const v = r?.ok ? ((await r.json()) as { d?: string; ct?: string } | null) : null;
  if (!v?.d || !v.ct) return new Response("Not found", { status: 404 });
  const bin = Uint8Array.from(atob(v.d), (c) => c.charCodeAt(0));
  return new Response(bin, { headers: { "Content-Type": v.ct, "Cache-Control": "public, max-age=31536000, immutable" } });
}
