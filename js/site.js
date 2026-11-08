// إعدادات الموقع من لوحة التحكم (إداره الموقع + النطاقات + الأيقونات) فوق القيم الافتراضية في config.js
// al3/site · al3/sitecode (للمالك) · al3/domains/{نطاق} · al3/domcode/{نطاق} · al3/assets/{sico|dro3|emo}
import { r } from "./firebase.js";
import { emit } from "./state.js";
import { SITE } from "./config.js";
import { get, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { url, setPic } from "./api/images.js";
import { SICO } from "./data/sico.js";
import { DRO3 } from "./data/dro3.js";
import { EMO } from "./data/emo.js";

const $ = window.jQuery;
const DEF = JSON.parse(JSON.stringify(SITE));
const BUILTIN = { sico: SICO.slice(), dro3: DRO3.slice(), emo: EMO.slice() };
export const LISTS = { sico: SICO, dro3: DRO3, emo: EMO };
// مفتاح النطاق الحالي (www.al3nood.net → al3nood_net)
export const hostKey = () => String(location.hostname || "").toLowerCase().replace(/^www\./, "").replace(/[.#$\[\]\/ ]/g, "_");
// مفتاح ملف مدمج (الاسم بدون النقطة) للحذف والترتيب
export const assetKey = (name) => String(name).replace(/[.#$\[\]\/]/g, "_").slice(0, 80);

let raw = { site: {}, dom: null, code: null, dcode: null, assets: {} };

// القائمة النهائية: المدمج (غير المحذوف) + المرفوع، مرتبة بـ o
export function mergeList(kind, recs = raw.assets[kind] || {}) {
  const map = new Map();
  BUILTIN[kind].forEach((n, i) => map.set(assetKey(n), { k: assetKey(n), src: n, o: i + 1, builtin: true }));
  let extra = 1e4;
  for (const [k, v] of Object.entries(recs)) {
    if (!v) continue;
    const cur = map.get(k) || { k, src: v.src, o: extra++, builtin: false };
    if (v.del) { map.delete(k); continue; }
    if (v.src) cur.src = v.src;
    if (typeof v.o === "number") cur.o = v.o;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => a.o - b.o);
}

function applyLists() {
  for (const kind of ["sico", "dro3", "emo"]) {
    const l = mergeList(kind).map((x) => x.src);
    LISTS[kind].length = 0;
    LISTS[kind].push(...l);
    // الصور المرفوعة تتحمّل مسبقاً (الإيموجي يحتاجها جاهزة وقت كتابة الرسالة)
    l.filter((x) => x.startsWith("db:")).forEach((x) => url(x));
  }
}

function meta(name, content) {
  let $m = $(`meta[name="${name}"]`);
  if (!$m.length) $m = $(`<meta name="${name}">`).appendTo("head");
  $m.attr("content", content || "");
}

function apply() {
  const s = raw.site || {}, d = raw.dom || {};
  // القيم الافتراضية ← إداره الموقع ← النطاق (الاسم والعناوين والألوان والبنر)
  Object.assign(SITE, JSON.parse(JSON.stringify(DEF)), s);
  SITE.icons = { ...(s.icons || {}) };
  for (const k of ["name", "title", "description", "keywords", "sbg", "sbackground", "sbuttons"]) if (d[k]) SITE[k] = d[k];
  SITE.bnr = !!d.bnr; SITE.bimg = d.bimg || "";
  SITE.nameMax = SITE.guestNameMax;
  if (!SITE.rc) SITE.ghostMins = 0; // بدون إستعاده الاتصال: الاسم يطلع أول ما ينقطع
  document.title = SITE.title || SITE.name;
  meta("description", SITE.description);
  meta("keywords", SITE.keywords);
  $(".sitename").text(SITE.name);
  $("#u1").attr("maxlength", SITE.guestNameMax);
  $("#u3, #u2").attr("maxlength", SITE.registerNameMax);
  let $st = $("#sitecss");
  if (!$st.length) $st = $('<style id="sitecss"></style>').appendTo("head");
  $st.text(`.bg:not(body){background-color:${SITE.sbg}!important;}
.label-primary,.btn-primary,.bg-primary,.label-primary:hover,.btn-primary:hover,.btn-primary:focus{background-color:${SITE.sbuttons}!important;background-image:none;}
.d2,#rooms,#users{background-color:${SITE.sbackground}!important;}
${SITE.mlikes ? "" : "#d2 .blike{display:none!important;}"}
${SITE.bclikes ? "" : "#d2bc .blike,#rpl .blike{display:none!important;}"}
${SITE.bcreply ? "" : "#d2bc .breply{display:none!important;}"}`);
  // الأيقونات: favicon و prv1 (الشعار)
  if (SITE.icons.favicon) url(SITE.icons.favicon).then((u) => $('link[rel="icon"]').attr("href", u));
  else $('link[rel="icon"]').attr("href", "favicon.ico");
  $("img.sprv1").each(function () { setPic(this, SITE.icons.prv1 || "prv1.png", "prv1.png"); });
  // بنر صفحة الدخول
  const $b = $("#bnr").empty();
  if (SITE.bnr && SITE.bimg) {
    const $i = $('<img alt="" style="width:100%;max-height:150px;object-fit:cover;border-radius:4px;">').appendTo($b);
    setPic($i[0], SITE.bimg);
  }
  applyLists();
  emit("site");
}

// السكربت + كود head + الوصف الداخلي (مرة وحدة وقت فتح الصفحة، مثل العنود)
let codeRan = false;
function runCode() {
  if (codeRan) return;
  codeRan = true;
  const c = raw.dcode || raw.code || {};
  try {
    if (c.head) {
      const t = document.createElement("template");
      t.innerHTML = c.head;
      [...t.content.childNodes].forEach((n) => {
        if (n.nodeName === "SCRIPT") { const s = document.createElement("script"); [...n.attributes].forEach((a) => s.setAttribute(a.name, a.value)); s.text = n.textContent; document.head.appendChild(s); }
        else document.head.appendChild(n);
      });
    }
    if (c.html) $('<div id="seohtml" style="display:none;"></div>').html(c.html).appendTo("body");
    if (c.scr) { const s = document.createElement("script"); s.text = c.scr; document.body.appendChild(s); }
  } catch (e) { console.error("site code", e); }
}

const val = (p) => get(r(p)).then((s) => s.val()).catch(() => null);
// تحميل أولي (بحد أقصى 4 ثواني عشان الصفحة ما تعلق) ثم متابعة التغييرات
const isLocal = () => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
let domK = "";
export async function loadSite() {
  const k = hostKey();
  domK = k || "_";
  // تجربة محلية (localhost أو عنوان الكمبيوتر على الواي فاي): نستخدم أول نطاق محفوظ عشان يبان البنر والاسم
  if (isLocal()) { const all = await val("domains"); const first = all && Object.keys(all)[0]; if (first && !all[k]) domK = first; }
  const all = Promise.all([val("site"), val("sitecode"), val("domains/" + domK), val("domcode/" + domK), val("assets")]);
  const got = await Promise.race([all, new Promise((ok) => setTimeout(() => ok(null), 4000))]);
  if (got) raw = { site: got[0] || {}, code: got[1], dom: got[2], dcode: got[3], assets: got[4] || {} };
  apply();
  // السكربت يشتغل بعد ما تجهز الصفحة
  setTimeout(runCode, 0);
  onValue(r("site"), (s) => { raw.site = s.val() || {}; apply(); }, () => {});
  onValue(r("domains/" + domK), (s) => { raw.dom = s.val(); apply(); }, () => {});
  onValue(r("assets"), (s) => { raw.assets = s.val() || {}; apply(); }, () => {});
}
