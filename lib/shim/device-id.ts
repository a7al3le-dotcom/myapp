// Part 7 of the device fingerprint: a random id created ONCE in this browser and reused by every visit and login afterwards.
// It is pure randomness (80 bits from crypto.getRandomValues), derived from nothing about the device or the member, so it reveals no personal data;
// it only lets the control panel see that two logins came from the same browser profile. Kept in localStorage, mirrored to a first-party cookie
// (some browsers clear one and not the other); when both are blocked it lives in memory for the page only (a new one next visit).
// It is sent to the server only with the login / guest / register request and read back only by control-panel holders (database rules).
// It is NOT an identity and NOT a credential: clearing site data, a private window or another browser gives a different id.
export const DID_KEY = "al3nood_did";
const OK = /^[0-9a-f]{20}$/;
export type Jar = { get(): string | null; set(v: string): void };
export type DeviceIdEnv = { local?: Jar; cookie?: Jar; rand?: (n: number) => Uint8Array };
let memory = "";
const safe = <T,>(f: () => T, d: T): T => { try { return f(); } catch { return d; } };
export function newDeviceId(rand: (n: number) => Uint8Array): string {
  return Array.from(rand(10), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function getDeviceId(env: DeviceIdEnv): { id: string; from: "local" | "cookie" | "new" | "memory" } {
  const l = safe(() => env.local?.get() ?? null, null), c = safe(() => env.cookie?.get() ?? null, null);
  if (l && OK.test(l)) { if (!(c && OK.test(c))) safe(() => env.cookie?.set(l), undefined); return { id: l, from: "local" }; }
  if (c && OK.test(c)) { safe(() => env.local?.set(c), undefined); return { id: c, from: "cookie" }; }
  if (memory) return { id: memory, from: "memory" };
  const id = newDeviceId(env.rand ?? ((n) => crypto.getRandomValues(new Uint8Array(n))));
  let stored = false;
  stored = safe(() => { env.local?.set(id); return env.local?.get() === id; }, false) || stored;
  stored = safe(() => { env.cookie?.set(id); return env.cookie?.get() === id; }, false) || stored;
  if (!stored) memory = id;
  return { id, from: stored ? "new" : "memory" };
}
// the real browser storages
export function browserEnv(): DeviceIdEnv {
  return {
    local: { get: () => localStorage.getItem(DID_KEY), set: (v) => localStorage.setItem(DID_KEY, v) },
    cookie: {
      get: () => new RegExp(`(?:^|; )${DID_KEY}=([0-9a-f]+)`).exec(document.cookie)?.[1] ?? null,
      set: (v) => { document.cookie = `${DID_KEY}=${v}; Max-Age=63072000; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; },
    },
  };
}
export const _resetMemoryForTests = () => { memory = ""; };
