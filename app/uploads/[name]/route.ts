// Serves pictures that users uploaded (stored in the Realtime Database as base64) under the reference site's own URL scheme: /uploads/db-<id>.<ext>
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const m = /^db-([\w-]+)\.\w{2,4}$/.exec(name);
  const base = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!m || !base) return new Response("Not found", { status: 404 });
  const emu = process.env.DB_EMULATOR_HOST; // tests only: read from the local emulator instead of the cloud database
  // Isolation guard: in emulator mode never fall back to the cloud database.
  if (process.env.NEXT_PUBLIC_USE_EMULATOR === "1" && !emu) return new Response("Emulator mode without DB_EMULATOR_HOST", { status: 503 });
  const ns = new URL(base).hostname.split(".")[0];
  const r = await fetch(emu ? `http://${emu}/images/${m[1]}.json?ns=${ns}` : `${base}/images/${m[1]}.json`, { cache: "no-store" });
  if (!r.ok) return new Response("Not found", { status: 404 });
  const v = (await r.json()) as { d?: string; ct?: string } | null;
  if (!v?.d || !v.ct) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(v.d, "base64"), { headers: { "Content-Type": v.ct, "Cache-Control": "public, max-age=31536000, immutable" } });
}
