// Cloudflare Pages Functions <-> Firebase (project in FIREBASE_PROJECT_ID), the free Spark plan: no Admin SDK, plain REST.
//  - who calls: the Firebase ID token in "Authorization: Bearer", verified HERE with Google's public keys (RS256, aud / iss / exp / sub).
//  - admin reads / writes: an OAuth access token made from the service-account key kept as the Cloudflare secret FIREBASE_SA (never in the code,
//    never sent to a browser). The database rules do not apply to it, exactly like the emulator's "Bearer owner" in the local copy.
//  - the visitor's IP: Cloudflare's own CF-Connecting-IP header (set by Cloudflare at the edge, a client cannot forge it).
export interface Env {
  FIREBASE_SA: string; // the service-account JSON (Firebase console > Project settings > Service accounts > Generate new private key)
  VIREBASE_SA?: string; // the same key, saved under this name by a typo when it was added (2026-11-06); either name works
  FIREBASE_PROJECT_ID: string; // e.g. mychat-2d881
  FIREBASE_DB_URL: string; // e.g. https://mychat-2d881-default-rtdb.firebaseio.com
  ASSETS: { fetch: (r: Request | string) => Promise<Response> };
}

export const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const clientIp = (req: Request) => req.headers.get("CF-Connecting-IP") ?? "";

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

// ---- service-account access token (cached per isolate until a minute before it expires) ----
let cached: { token: string; exp: number } | null = null;
async function accessToken(env: Env): Promise<string> {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const sa = JSON.parse(env.FIREBASE_SA || env.VIREBASE_SA || "{}") as { client_email: string; private_key: string };
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", unb64url(pem.replace(/\+/g, "-").replace(/\//g, "_")), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const scope = ["https://www.googleapis.com/auth/firebase.database", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/identitytoolkit"].join(" ");
  const head = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" })), claims = b64urlText(JSON.stringify({ iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${head}.${claims}.${sig}` });
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("no access token");
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

// ---- the Realtime Database with admin rights (REST) ----
export function db(env: Env) {
  const url = async (path: string, q = "") => `${env.FIREBASE_DB_URL}/${path}.json?access_token=${encodeURIComponent(await accessToken(env))}${q}`;
  const call = async (path: string, method: string, body?: unknown, q = "") => fetch(await url(path, q), { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }).catch(() => null);
  return {
    get: async (path: string, q = "") => { const r = await call(path, "GET", undefined, q); return r?.ok ? r.json() : null; },
    put: (path: string, v: unknown) => call(path, "PUT", v),
    patch: (path: string, v: unknown) => call(path, "PATCH", v),
    post: (path: string, v: unknown) => call(path, "POST", v),
    del: (path: string) => call(path, "DELETE"),
  };
}
export type Db = ReturnType<typeof db>;

// ---- Firebase Auth admin (Identity Toolkit REST: delete an account, set a password) ----
export async function authAdmin(env: Env, op: "delete" | "update", body: unknown) {
  return fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:${op}`, { method: "POST", headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

// ---- verify a Firebase ID token -> uid ("" when not valid) ----
let jwks: { keys: (JsonWebKey & { kid: string })[]; exp: number } | null = null;
export async function verifyIdToken(env: Env, req: Request): Promise<string> {
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1]; if (!token) return "";
  try {
    const [h, p, s] = token.split("."); if (!h || !p || !s) return "";
    const head = JSON.parse(new TextDecoder().decode(unb64url(h))) as { alg?: string; kid?: string };
    const c = JSON.parse(new TextDecoder().decode(unb64url(p))) as { aud?: string; iss?: string; exp?: number; iat?: number; sub?: string };
    const now = Math.floor(Date.now() / 1000);
    if (head.alg !== "RS256" || c.aud !== env.FIREBASE_PROJECT_ID || c.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}` || !c.sub || !c.exp || c.exp < now || (c.iat ?? 0) > now + 300) return "";
    if (!jwks || jwks.exp < Date.now()) { const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"); jwks = { ...(await r.json()) as { keys: (JsonWebKey & { kid: string })[] }, exp: Date.now() + 3600000 }; }
    const jwk = jwks.keys.find((k) => k.kid === head.kid); if (!jwk) return "";
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(s), new TextEncoder().encode(`${h}.${p}`));
    return ok ? c.sub : "";
  } catch { return ""; }
}
