// Device fingerprint for the control panel's «الجهاز» column: SEVEN separate, readable parts joined by "|" (the unified representation used for
// search and logs). Every value is read from the browser (see collectFp in fp-collect.ts); nothing is filled with a constant, a part the browser
// does not expose stays "-" (unavailable) and is never invented.
//
//   1 sys  operating system: name _ version _ platform          Android_13_Linux-armv81
//   2 cpu  cores _ memory(GB, browsers cap it at 8) _ arch+bits   c8_m8_arm64        (arch/bits only where userAgentData or the UA text give them)
//   3 scr  long side x short side _ pixel ratio _ colour depth _ touch points   869x412_d2.625_cd24_t5   (orientation does not matter)
//   4 reg  language _ time zone _ calendar _ numbering _ hour cycle   ar_Asia-Riyadh_gregory_arab_h12
//   5 gpu  WebGL unmasked vendor _ renderer                      Google-Inc.-Qualcomm_ANGLE-Adreno-640
//   6 drw  drawing: canvas-2D hash - 1x1-canvas hash - WebGL-parameters hash
//   7 id   random id created once and kept in the browser (device-id.ts); reused by every visit and login
//
// Window size, scroll position, mouse trace, timers and the page clock are NOT part of it, so resizing the window never creates a new
// fingerprint. A fingerprint is a hint for comparing devices, never an identity or a credential: two devices can share parts 1-6 and
// a browser can change them (update, zoom, privacy mode); part 7 disappears when the site data is cleared.
//
// HOW the ORIGINAL server turns navigator.n into its string ("Linux|107|1s.2hc…") is UNKNOWN; this is not that algorithm. What the original client
// COLLECTS (x3.js, read and decoded) is the source for the drawing/GPU values below: navigator.n.gg/gf (canvas MD5 hashes) and navigator.n.gn
// (unmasked WebGL renderer).
export const PART_NAMES = ["sys", "cpu", "scr", "reg", "gpu", "drw", "id"] as const;
export type PartName = (typeof PART_NAMES)[number];
export type Parts = Record<PartName, string>;

// What the browser exposes, as plain data (so the builder can be tested without a browser). Anything missing is undefined / "".
export type FpEnv = {
  userAgent?: string; platform?: string;
  uaPlatform?: string; uaPlatformVersion?: string; uaArchitecture?: string; uaBitness?: string; // navigator.userAgentData (Chromium)
  hardwareConcurrency?: number; deviceMemory?: number;
  screenWidth?: number; screenHeight?: number; colorDepth?: number; devicePixelRatio?: number; maxTouchPoints?: number;
  language?: string; timeZone?: string; calendar?: string; numberingSystem?: string; hourCycle?: string;
  gpuVendor?: string; gpuRenderer?: string;
  canvasHash?: string; blankCanvasHash?: string; webglParams?: string;
  deviceId?: string;
};

export const NA = "-";
// FNV-1a, 32 bit, over UTF-16 code units -> base 36 (short digest for the WebGL parameter list)
export function h36(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
// charset of a part value: letters, digits and . _ + -   (everything else becomes "-", runs collapse, length capped)
export function tok(v: unknown, max = 40): string {
  const s = String(v ?? "").trim().replace(/[^A-Za-z0-9._+]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, max);
  return s || NA;
}
const num = (v: unknown, digits = 3) => (typeof v === "number" && isFinite(v) && v > 0 ? String(Math.round(v * 10 ** digits) / 10 ** digits) : NA);

// operating system name + version, from the user-agent text (userAgentData's platform version when the UA text has none)
export function parseOs(ua: string, uaPlatform?: string, uaPlatformVersion?: string): { name: string; version: string } {
  const u = ua || "";
  let m: RegExpExecArray | null;
  if ((m = /Android[ /]([\d.]+)/.exec(u))) return { name: "Android", version: m[1] };
  if ((m = /(?:iPhone|iPad|iPod)[^)]*?OS ([\d_]+)/.exec(u))) return { name: "iOS", version: m[1].replace(/_/g, ".") };
  if ((m = /Windows NT ([\d.]+)/.exec(u))) return { name: "Windows", version: uaPlatformVersion || m[1] };
  if ((m = /Mac OS X ([\d_.]+)/.exec(u))) return { name: "macOS", version: m[1].replace(/_/g, ".") };
  if (/CrOS/.test(u)) return { name: "ChromeOS", version: uaPlatformVersion || "" };
  if (/Linux/.test(u)) return { name: "Linux", version: uaPlatformVersion || "" };
  return { name: uaPlatform || "", version: uaPlatformVersion || "" };
}
// architecture hint when userAgentData did not give one: only what the UA / platform text literally says
function archFromText(ua: string, platform: string): string {
  const t = `${ua} ${platform}`;
  if (/aarch64|arm64|armv8/i.test(t)) return "arm64";
  if (/\barm\b|armv7/i.test(t)) return "arm";
  if (/x86_64|x64|Win64|amd64/i.test(t)) return "x64";
  if (/i[3-6]86|x86\b/i.test(t)) return "x86";
  return "";
}

export function buildParts(e: FpEnv): Parts {
  const os = parseOs(e.userAgent ?? "", e.uaPlatform, e.uaPlatformVersion);
  const arch = (e.uaArchitecture || archFromText(e.userAgent ?? "", e.platform ?? "")).trim();
  const bits = (e.uaBitness ?? "").trim();
  const w = e.screenWidth ?? 0, h = e.screenHeight ?? 0;
  return {
    sys: [tok(os.name, 16), tok(os.version, 16), tok(e.platform, 24)].join("_"),
    cpu: [`c${num(e.hardwareConcurrency, 0)}`, `m${num(e.deviceMemory, 2)}`, tok((arch + bits).toLowerCase(), 12)].join("_"),
    scr: [w && h ? `${Math.max(w, h)}x${Math.min(w, h)}` : NA, `d${num(e.devicePixelRatio, 3)}`, `cd${num(e.colorDepth, 0)}`, `t${typeof e.maxTouchPoints === "number" ? e.maxTouchPoints : NA}`].join("_"),
    reg: [tok(e.language, 12), tok(e.timeZone, 32), tok(e.calendar, 12), tok(e.numberingSystem, 10), tok(e.hourCycle, 4)].join("_"),
    gpu: e.gpuVendor || e.gpuRenderer ? [tok(e.gpuVendor, 24), tok(e.gpuRenderer, 48)].join("_") : NA,
    drw: [tok(e.canvasHash, 12), tok(e.blankCanvasHash, 8), e.webglParams ? h36(e.webglParams) : NA].join("-"),
    id: /^[0-9a-f]{20,64}$/.test(e.deviceId ?? "") ? (e.deviceId as string) : NA,
  };
}
export const joinParts = (p: Parts) => PART_NAMES.map((k) => p[k]).join("|");
const PART_OK = /^[A-Za-z0-9._+-]{1,80}$/;
// a record sent by a client: valid only when it has exactly the seven parts, in the allowed charset (the server re-validates it)
export function validParts(v: unknown): v is Parts {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return PART_NAMES.every((k) => typeof o[k] === "string" && PART_OK.test(o[k] as string)) && Object.keys(o).length === PART_NAMES.length;
}

// «الجهاز» as the ORIGINAL control panel shows it (measured on al3nood.net 2026-11-05): "Platform|abc|ab.ab1.12.ab|1a.1a.1a.1a|1a.12.1a|1a.1a.1a|ab1ab1.12a"
// = navigator platform word, then short base-36 groups (3 / 2.3.2.2 / 2.2.2.2 / 2.2.2 / 2.2.2 / 6.3 characters), about 63 characters.
// How the original server derives its groups is unknown, so each group here is a digest of OUR matching part: same shape, same device -> same
// string, different device -> different string. The full readable parts stay stored (loginConn/memberConn .parts); only what is shown,
// searched and banned uses this short form. A string that is not a seven-part readable fingerprint (old rows, already short) is returned as is.
const dig = (s: string, n: number) => { let o = ""; for (let k = 0; o.length < n; k++) o += h36(s + "#" + k).padStart(7, "0"); return o.slice(0, n); };
const groups = (s: string, sizes: number[]) => { const d = dig(s, sizes.reduce((a, b) => a + b, 0)); let at = 0; return sizes.map((n) => { const g = d.slice(at, at + n); at += n; return g; }).join("."); };
export function compactFp(fp: unknown): string {
  const s = typeof fp === "string" ? fp : "";
  const p = s.split("|");
  if (p.length !== 7 || !p[0].includes("_")) return s;
  const plat = (p[0].split("_")[2] || p[0].split("_")[0] || "").split("-")[0].replace(/[^A-Za-z0-9]/g, "") || "x";
  return [plat, dig(p[1], 3), groups(p[2], [2, 3, 2, 2]), groups(p[3], [2, 2, 2, 2]), groups(p[4], [2, 2, 2]), groups(p[5], [2, 2, 2]), groups(p[6], [6, 3])].join("|");
}
