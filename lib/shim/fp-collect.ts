// Reads the real values from the browser and builds the seven fingerprint parts (fp.ts). Browser only.
// Sources: navigator (platform, userAgent, hardwareConcurrency, deviceMemory, maxTouchPoints, language, userAgentData high-entropy hints where the browser
// gives them), screen (size, colour depth) and devicePixelRatio, Intl.DateTimeFormat().resolvedOptions() (time zone, calendar, numbering, hour cycle),
// WebGL (unmasked vendor / renderer, a list of numeric limits), canvas (the drawing the original client uses, or the value the original client already computed
// in navigator.n: gg = canvas-2D MD5, gf = 1x1 canvas MD5, gn = unmasked renderer) and the stored random id (device-id.ts).
import { buildParts, joinParts, type FpEnv, type Parts } from "./fp";
import { browserEnv, getDeviceId } from "./device-id";
import { sha256Hex } from "./sha256";

type N = Record<string, unknown> | null | undefined;
type UAData = { platform?: string; getHighEntropyValues?: (h: string[]) => Promise<Record<string, string>> };

function webgl(): { vendor: string; renderer: string; params: string } {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return { vendor: "", renderer: "", params: "" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? "") : "";
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "") : "";
    const keys = ["MAX_TEXTURE_SIZE", "MAX_VIEWPORT_DIMS", "MAX_VERTEX_ATTRIBS", "MAX_VERTEX_UNIFORM_VECTORS", "MAX_VARYING_VECTORS", "MAX_FRAGMENT_UNIFORM_VECTORS", "MAX_RENDERBUFFER_SIZE", "MAX_COMBINED_TEXTURE_IMAGE_UNITS", "ALIASED_LINE_WIDTH_RANGE", "ALIASED_POINT_SIZE_RANGE"] as const;
    const params = keys.map((k) => { const v = gl.getParameter(gl[k]); return `${k}=${v && typeof v === "object" ? Array.from(v as ArrayLike<number>).join(",") : String(v)}`; }).join(";")
      + `;SL=${String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION))};EXT=${(gl.getSupportedExtensions() ?? []).length}`;
    return { vendor, renderer, params };
  } catch { return { vendor: "", renderer: "", params: "" }; }
}
// same drawing as the original client's gg (so the value is comparable), hashed with SHA-256 when navigator.n has no gg yet
function canvasHash(): { main: string; blank: string } {
  try {
    const c = document.createElement("canvas"); c.width = 100; c.height = 16;
    const x = c.getContext("2d"); if (!x) return { main: "", blank: "" };
    const t = "thisTهلا😀️🐺️😍️";
    x.textBaseline = "alphabetic"; x.font = "14px 'Arial'"; x.fillStyle = "#f60"; x.fillRect(40, 1, 40, 18); x.fillStyle = "#069"; x.fillText(t, 2, 15); x.fillStyle = "rgba(102, 204, 0, 0.7)"; x.fillText(t, 4, 17);
    const b = document.createElement("canvas"); b.width = 1; b.height = 1; b.getContext("2d");
    return { main: sha256Hex(c.toDataURL()).slice(0, 12), blank: sha256Hex(b.toDataURL()).slice(0, 8) };
  } catch { return { main: "", blank: "" }; }
}
const hex = (v: unknown) => (typeof v === "string" && /^[0-9a-f]{8,}$/i.test(v) ? v.toLowerCase() : "");

export async function collectFp(n?: N): Promise<{ parts: Parts; fp: string }> {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: UAData };
  const ua = nav.userAgentData;
  let high: Record<string, string> = {};
  try { if (ua?.getHighEntropyValues) high = await Promise.race([ua.getHighEntropyValues(["architecture", "bitness", "platformVersion"]), new Promise<Record<string, string>>((r) => setTimeout(() => r({}), 400))]); } catch { /* not available */ }
  let intl: Intl.ResolvedDateTimeFormatOptions | null = null;
  try { intl = new Intl.DateTimeFormat().resolvedOptions(); } catch { /* not available */ }
  const gl = webgl();
  const cv = hex(n?.gg) && hex(n?.gf) ? { main: hex(n?.gg), blank: hex(n?.gf) } : canvasHash();
  const env: FpEnv = {
    userAgent: nav.userAgent, platform: nav.platform,
    uaPlatform: ua?.platform, uaPlatformVersion: high.platformVersion, uaArchitecture: high.architecture, uaBitness: high.bitness,
    hardwareConcurrency: nav.hardwareConcurrency, deviceMemory: nav.deviceMemory,
    screenWidth: screen.width, screenHeight: screen.height, colorDepth: screen.colorDepth, devicePixelRatio: window.devicePixelRatio, maxTouchPoints: nav.maxTouchPoints,
    language: nav.language, timeZone: intl?.timeZone, calendar: intl?.calendar, numberingSystem: intl?.numberingSystem, hourCycle: intl?.hourCycle,
    gpuVendor: gl.vendor, gpuRenderer: gl.renderer || (typeof n?.gn === "string" && n.gn !== "x" ? n.gn : ""),
    canvasHash: cv.main, blankCanvasHash: cv.blank, webglParams: gl.params,
    deviceId: getDeviceId(browserEnv()).id,
  };
  const parts = buildParts(env);
  return { parts, fp: joinParts(parts) };
}
