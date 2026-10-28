// أدوات مشتركة: تنظيف النص، الإيموجي، الألوان، الوقت، القوالب
import { EMO } from "./data/emo.js";
import { COUNTRIES } from "./data/countries.js";
import { now } from "./firebase.js";
import { SITE } from "./config.js";
import { setPic, syncUrl } from "./api/images.js";

const $ = window.jQuery;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// نص الرسالة: تنظيف + تحويل ف5 إلى صورة إيموجي
export function fmt(text) {
  return esc(text).replace(/ف(\d{1,3})/g, (m, n) => {
    const f = EMO[parseInt(n, 10) - 1];
    if (!f) return m;
    // إبتسامه مرفوعة من إداره الموقع (db:) — تتحمّل مسبقاً
    const src = f.startsWith("db:") ? syncUrl(f) : "emo/" + f;
    return src ? `<img src="${esc(src)}" class="emoi" alt="">` : m;
  }).replace(/\n/g, "<br>");
}

// مفتاح الاسم (للتأكد من عدم التكرار) — بدون الرموز الممنوعة في Firebase
// (لازم يطابق نفس الحساب في database.rules.json: كل حرف ممنوع أو مسافة → _)
export const nameKey = (n) => String(n).trim().toLowerCase().replace(/[.#$\[\]\/ ]/g, "_");

// إيميل داخلي لكل اسم عضو (Firebase يحتاج إيميل)
export function nameEmail(n) {
  const bytes = new TextEncoder().encode(nameKey(n));
  let hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length > 56) {
    let h = 2166136261;
    for (const b of bytes) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
    hex = hex.slice(0, 44) + h.toString(16).padStart(8, "0");
  }
  return `u${hex}@al3.chat`;
}

// اسم صالح؟ (بدون أكواد HTML وبطول معقول)
export const validName = (n, max) => {
  n = String(n || "").trim();
  return n.length >= 1 && n.length <= max && !/[<>"'`\\\u0000-\u001f]/.test(n) && !/^ف\d/.test(n);
};

// خلفية خفيفة بلون الاسم (مثل العنود: كل قناة −30 بشفافية 0.024)
export function tint(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color || "");
  if (!m) return "";
  const v = parseInt(m[1], 16), rr = v >> 16, gg = (v >> 8) & 255, bb = v & 255;
  if (!rr && !gg && !bb) return "";
  return `rgba(${Math.max(rr - 30, 0)}, ${Math.max(gg - 30, 0)}, ${Math.max(bb - 30, 0)}, 0.024)`;
}

export const safeColor = (c, d = "#000000") => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : d);

// "منذ": 0د، 5د، 3س، 2ي
export function ago(ts) {
  const m = Math.max(0, Math.floor((now() - (ts || 0)) / 60000));
  if (m < 60) return m + "د";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "س";
  return Math.floor(h / 24) + "ي";
}
export function tickAgo() {
  document.querySelectorAll(".tago[data-ts]").forEach((e) => { e.textContent = ago(+e.dataset.ts); });
}

export const flagSrc = (co) => `flags/${/^[a-z]{2}$/.test(co || "") ? co : "--"}.png`;
export const countryName = (co) => COUNTRIES[co] || (/^[a-z]{2}$/.test(co || "") ? co.toUpperCase() : "");

// نسخة من قالب
export const tpl = (id) => $($("#" + id).html().trim());

// تعبئة بيانات عضو في عنصر (صورة، اسم، ألوان، أيقونة)
export function fillUser($e, u, opts = {}) {
  u = u || {};
  const $t = $e.find(".u-topic").first();
  $t.text(u.topic || "").css({ color: safeColor(u.ucol), "background-color": u.bg && u.bg !== "#ffffff" ? safeColor(u.bg, "") : "" });
  setIco($e.find(".u-ico")[0], u.ico);
  $e.find(".u-pic").each(function () { setPic(this, u.pic); });
  if (opts.msg !== false) $e.find(".u-msg").first().text(u.msg || "");
}

// أيقونة جنب الاسم: اسم ملف من sico، أو مسار (dro3/..)، أو صورة مرفوعة (db:..)
export function setIco(img, ico) {
  if (!img) return;
  if (ico && (String(ico).includes("://") || String(ico).startsWith("//"))) ico = ""; // لا روابط خارجية
  if (!ico) { img.removeAttribute("src"); img.style.display = "none"; return; }
  img.style.display = "";
  if (ico.startsWith("db:")) setPic(img, ico);
  else { img.dataset.pic = ""; img.src = ico.includes("/") ? ico : "sico/" + ico; }
}

// 1500 → 1.5K ، 10000000 → 10.0M (مثل عداد الإعجاب في العنود)
export function shortNum(n) {
  n = +n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

// لون الحالة مثل العنود:
// s4 أزرق = مخفي · s3 باهت = انقطع الاتصال (الاسم معلّق) · s2 أحمر = معطل الخاص · s1 أصفر = 5 دقائق بدون نشاط · s0 أخضر = نشط
export function statOf(u) {
  if (!u) return 0;
  if (u.off) return 3;
  if (u.s) return 4; // دخول مخفي: أزرق (s4) مثل العنود
  if (u.busy) return 2;
  if (now() - (u.la || u.ts || 0) >= SITE.idleMins * 60000) return 1;
  return 0;
}
export const statSrc = (u) => `imgs/s${statOf(u)}.png`;

// رقم قصير ثابت للجهاز (#66)
export function deviceHash() {
  let id;
  try { id = localStorage.getItem("al3_dev"); if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("al3_dev", id); } }
  catch { id = "x"; }
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 99) + 1;
}

// الدولة + بصمة الآي بي (الآي بي نفسه ما ينحفظ، بس بصمة منه).
// البصمة تخلي الزائر يرجع لاسمه المعلّق من نفس الآي بي بس.
// ملاحظة: على Spark الجهاز هو اللي يجيب الآي بي؛ عند Blaze السيرفر يتحقق منه.
let netCache = null;
async function sha(s) {
  // crypto.subtle ما يشتغل إلا على https أو localhost (مثلاً الجوال على http://192.168..)
  if (window.crypto && crypto.subtle) {
    try {
      const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return Array.from(new Uint8Array(b).slice(0, 12), (x) => x.toString(16).padStart(2, "0")).join("");
    } catch {}
  }
  // بديل بسيط عشان الدخول ما يتعطل
  let out = "";
  for (let k = 0; k < 3; k++) {
    let h = (2166136261 ^ k) >>> 0;
    for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}
// بصمة الآي بي (نفس اللي تنحفظ في online.ih) — تستخدمها لوحة التحكم للحظر بالآي بي
export const ipHash = (ip) => sha("al3:" + String(ip).trim());

// ===== بصمة الجهاز (رقم الجهاز في لوحة التحكم والحظر) =====
// أجزاء ثابتة للجهاز مفصولة بـ| مثل العنود:
// النظام | المعالج والذاكرة | الشاشة | المنطقة واللغة | كرت الشاشة | الرسم (canvas) | رقم محفوظ بالمتصفح
// مستويات الحظر/البحث: كل مستوى يطابق أجزاء أقل (أوسع)، والعرض "*" × المستوى + "=" قبل البصمة.
const b36 = (n) => Math.abs(Math.round(+n || 0)).toString(36);
function h32(s, seed = 0) {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
const hstr = (s) => h32(s).toString(36) + h32(s, 99).toString(36);
// المستوى 0 = نفس الجهاز بالضبط (النظام + الرقم المحفوظ) · 1 = مواصفات الجهاز (يبقى لو مسح المتصفح)
// 2 = بدون المنطقة واللغة (يبقى لو غيّر المنطقة/VPN) · 3 = النظام + كرت الشاشة + الرسم · 4 = النظام + كرت الشاشة (أوسع شي)
// الشاشة للعرض بس: مقاسها يتغير (شاشة ثانية، تكبير، أو المتصفح يرجّع 0) فما ندخلها في الحظر
export const FP_LEVELS = [[0, 6], [0, 1, 3, 4, 5], [0, 1, 4, 5], [0, 4, 5], [0, 4]];
// مفتاح المستوى من نص البصمة (نفس الحساب في كل مكان: الدخول، اللوحة، الحظر)
export function fpKey(fp, level = 0) {
  const s = String(fp || "").split("|");
  if (s.length < 7) return "";
  return "x" + hstr(FP_LEVELS[level].map((i) => s[i]).join("|"));
}
export const fpShow = (fp, level = 0) => (level ? "*".repeat(level) + "=" : "") + fp;
// "**=Win32|..." → { level: 2, fp: "Win32|..." }
export function fpParse(v) {
  const m = /^(\*{1,4})=(.+)$/.exec(String(v || "").trim());
  return m ? { level: m[1].length, fp: m[2] } : { level: 0, fp: String(v || "").trim() };
}
let fpCache = null;
export function deviceFp() {
  if (fpCache) return fpCache;
  const seg = [];
  seg.push(String(navigator.platform || "x").replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 12) || "x");
  seg.push(b36(navigator.hardwareConcurrency) + b36((navigator.deviceMemory || 0) * 10));
  // الشاشة: الأكبر ثم الأصغر (ما تتغير لما يتدوّر الجوال)
  const sw = screen.width || 0, sh = screen.height || 0;
  seg.push([Math.max(sw, sh), Math.min(sw, sh), screen.colorDepth, (window.devicePixelRatio || 1) * 100].map(b36).join("."));
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
  seg.push([new Date().getTimezoneOffset() + 720, h32(tz + (navigator.language || ""))].map(b36).join("."));
  let gpu = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    gpu = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) + String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR)) : "";
  } catch {}
  seg.push(b36(h32(gpu)) + "." + b36(gpu.length));
  let cv = "";
  try {
    const c = document.createElement("canvas"); c.width = 200; c.height = 40;
    const x = c.getContext("2d");
    x.textBaseline = "top"; x.font = "14px Arial"; x.fillStyle = "#f60"; x.fillRect(100, 1, 62, 20);
    x.fillStyle = "#069"; x.fillText("al3nood ✓ شات 😀", 2, 15);
    x.fillStyle = "rgba(102,204,0,0.7)"; x.fillText("al3nood ✓ شات 😀", 4, 17);
    cv = c.toDataURL();
  } catch {}
  seg.push(b36(h32(cv)) + "." + b36(h32(cv, 7)));
  let id;
  try { id = localStorage.getItem("al3_dev"); if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem("al3_dev", id); } }
  catch { id = "x" + Math.random().toString(36).slice(2, 10); }
  seg.push(id.replace(/[^a-z0-9]/gi, "").slice(0, 20) || "x");
  const fp = seg.join("|").slice(0, 190);
  fpCache = { fp, keys: FP_LEVELS.map((_, i) => fpKey(fp, i)) };
  return fpCache;
}
export function detectNet() {
  if (netCache) return netCache;
  netCache = (async () => {
    let ip = "", co = "";
    const get = async (u, ms = 5000) => {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
      try { return await (await fetch(u, { signal: c.signal })).json(); } finally { clearTimeout(t); }
    };
    // الدولة من أكثر من خدمة (لو وحدة محجوبة أو واقفة نجرب اللي بعدها)
    const okCo = () => /^[a-z]{2}$/.test(co);
    const tries = [
      async () => { const j = await get("https://api.country.is/", 4000); ip = ip || j.ip || ""; co = String(j.country || "").toLowerCase(); },
      async () => { const j = await get("https://get.geojs.io/v1/ip/country.json", 4000); ip = ip || j.ip || ""; co = String(j.country || "").toLowerCase(); },
      async () => { const j = await get("https://ipwho.is/?fields=ip,country_code", 4000); ip = ip || j.ip || ""; co = String(j.country_code || "").toLowerCase(); },
      async () => {
        const c = new AbortController(); const tm = setTimeout(() => c.abort(), 4000);
        try {
          const t = await (await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: c.signal })).text();
          ip = ip || (/^ip=(.+)$/m.exec(t) || [])[1] || ""; co = String((/^loc=(.+)$/m.exec(t) || [])[1] || "").toLowerCase();
        } finally { clearTimeout(tm); }
      }
    ];
    for (const f of tries) { if (okCo()) break; try { await f(); } catch {} }
    if (!ip) { try { ip = (await get("https://api.ipify.org?format=json")).ip || ""; } catch {} }
    if (!/^[a-z]{2}$/.test(co)) co = "--";
    return { co, ip, ih: ip ? await sha("al3:" + ip) : "" };
  })();
  netCache.catch(() => { netCache = null; });
  return netCache;
}
export async function detectCountry() { return (await detectNet()).co; }

// رسالة قصيرة تطلع وتختفي (بديل alert)
export function toast(text) {
  const $n = tpl("not");
  $n.find(".nottitle").text("تنبيه");
  $n.find(".notmsg").text(text).css("white-space", "pre-line"); // السطر الجديد في النص يطلع سطر جديد
  $n.on("click", () => $n.remove());
  $("body").append($n);
  setTimeout(() => $n.fadeOut(300, () => $n.remove()), 4000);
}
