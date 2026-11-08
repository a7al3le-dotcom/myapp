// البوابة الوحيدة لرفع الصور وعرضها.
// الحين (Spark): الصورة تنضغط وتنحفظ في قاعدة البيانات تحت pics/{id} وترجع "db:{id}".
// عند Blaze: نغيّر upload() بس عشان ترفع لـStorage وترجع رابط https — وsetPic تعرضه كما هو.
import { r } from "../firebase.js";
import { push, set, get, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { S } from "../state.js";
import { SITE } from "../config.js";

const MAXLEN = 200000; // أقصى حجم للصورة المحفوظة (حرف)
// كل نوع: المقاس الأقصى + الحجم المستهدف (حرف base64 ≈ ×0.75 بايت) + أقل جودة مسموحة (الجودة أهم شي)
const PRESETS = {
  avatar: { w: 200, h: 200, crop: true, q: 0.9, minQ: 0.72, target: 26000 },
  room: { w: 120, h: 120, crop: true, q: 0.9, minQ: 0.72, target: 14000 },
  share: { w: 720, h: 720, crop: false, q: 0.88, minQ: 0.7, target: 90000 },
  banner: { w: 1000, h: 400, crop: false, q: 0.9, minQ: 0.72, target: 120000 },
  // أيقونات الموقع (السوابر، الهدايا، الإبتسامات، favicon): تنحفظ بنفس الملف لو صغير (عشان الحركة والشفافية)
  icon: { w: 128, h: 128, crop: false, q: 0.8, raw: true }
};
const readRaw = (file) => new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = no; fr.readAsDataURL(file); });

function readImage(file) {
  return new Promise((ok, no) => {
    if (!file || !/^image\//.test(file.type)) return no(new Error("type"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error("decode")); };
    img.src = url;
  });
}

// WebP (نفس الوضوح بحجم أقل) ولو الجهاز ما يدعمه نرجع لـJPEG.
// الجودة تنزل شوي شوي لين توصل الحجم المستهدف بدون ما تنزل تحت minQ،
// ولو للحين كبيرة نصغّر المقاس 15% (أوضح من الضغط القوي) ونعيد.
let webpOk = null;
function encode(c, q) {
  if (webpOk !== false) {
    const d = c.toDataURL("image/webp", q);
    webpOk = d.startsWith("data:image/webp");
    if (webpOk) return d;
  }
  return c.toDataURL("image/jpeg", q);
}
function draw(img, p, scale) {
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0, w, h;
  if (p.crop) {
    const s = Math.min(sw, sh);
    sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s;
    w = Math.round(Math.min(p.w, s) * scale); h = w;
  } else {
    const k = Math.min(1, p.w / sw, p.h / sh) * scale; // ما نكبّر الصورة الصغيرة
    w = Math.max(1, Math.round(sw * k)); h = Math.max(1, Math.round(sh * k));
  }
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  x.imageSmoothingQuality = "high";
  x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
  x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return c;
}
function compress(img, p) {
  const target = Math.min(p.target || MAXLEN, MAXLEN);
  let scale = 1, d = "";
  for (let round = 0; round < 6; round++) {
    const c = draw(img, p, scale);
    for (let q = p.q; q >= (p.minQ || 0.7) - 1e-9; q -= 0.04) {
      d = encode(c, q);
      if (d.length <= target) return d;
    }
    scale *= 0.85;
  }
  return d;
}

const cache = new Map();

// رفع صورة → يرجع مرجع نصي يُحفظ مع البيانات
export async function upload(file, kind = "share") {
  const img = await readImage(file);
  const p = PRESETS[kind] || PRESETS.share;
  let d = null;
  if (p.raw && /^image\/(png|gif|webp|jpeg|x-icon|vnd\.microsoft\.icon)$/.test(file.type) && file.size <= 140000) {
    d = await readRaw(file);
    if (!/^data:image\/(jpeg|png|gif|webp);base64,/.test(d)) d = null; // ico وغيره يتحول
  }
  if (!d) d = compress(img, p);
  if (d.length > MAXLEN) throw new Error("size");
  const ref = push(r("pics"));
  await set(ref, { uid: S.uid, d, ts: serverTimestamp() });
  set(r("picidx/" + ref.key), { k: kind, uid: S.uid, ts: serverTimestamp() }).catch(() => {});
  cache.set(ref.key, d);
  return "db:" + ref.key;
}

// يحوّل المرجع إلى رابط قابل للعرض
export async function url(v) {
  if (!v) v = "pic.png";
  // الصور الافتراضية للموقع ممكن تتغيّر من إداره الموقع (صوره العضو / صوره الغرف)
  if (v === "pic.png" && SITE.icons?.pic) v = SITE.icons.pic;
  if (v === "room.png" && SITE.icons?.room) v = SITE.icons.room;
  if (!v.startsWith("db:")) return /^(https:|data:image\/|[a-z0-9_\-\/]+\.(png|jpe?g|gif|webp)$)/i.test(v) ? v : "pic.png";
  const id = v.slice(3);
  if (!/^[\w-]+$/.test(id)) return "pic.png";
  if (cache.has(id)) return cache.get(id);
  const p = get(r("pics/" + id)).then((s) => (s.exists() && /^data:image\//.test(s.val().d) ? s.val().d : "pic.png")).catch(() => "pic.png");
  cache.set(id, p);
  const d = await p;
  cache.set(id, d);
  return d;
}

// الرابط لو جاهز بالذاكرة (للإبتسامات المرفوعة داخل نص الرسالة)
export function syncUrl(v) {
  if (!v || !v.startsWith("db:")) return v;
  const c = cache.get(v.slice(3));
  return typeof c === "string" ? c : null;
}

// يعرض الصورة في عنصر: <img> بالـsrc، وغيره بالخلفية
export function setPic(el, v, fallback = "pic.png") {
  if (!el) return;
  el.dataset.pic = v || "";
  url(v || fallback).then((u) => {
    if (el.dataset.pic !== (v || "")) return; // تغيّرت الصورة أثناء التحميل
    if (el.tagName === "IMG") el.src = u;
    else el.style.backgroundImage = `url("${u.replace(/"/g, "%22")}")`;
  });
}
