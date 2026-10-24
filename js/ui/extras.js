// المرحلة 3 داخل الشات: الفلتر، الإختصارات، رسائل الترحيب والتلقائيه، الإعلانات، غرفه الإنتظار،
// غرفة الدخول التلقائي، شروط الإعجابات، الهدايا والبنر في ملف العضو
import { r, now } from "../firebase.js";
import { S, on } from "../state.js";
import { SITE } from "../config.js";
import { get, query, orderByChild, startAt, onValue, onChildAdded, onChildRemoved, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { perform } from "../api/actions.js";
import { renderMsg, localMsg } from "./msg.js";
import { toast, tpl, setIco } from "../util.js";
import { banKeys } from "../session.js";
import { join, autoJoin } from "./rooms.js";
import { LISTS } from "../site.js";

const $ = window.jQuery;
let filters = [], shorts = [], cmsgs = [];
S.wroom = {};
S.entry = {};
S.waiting = false;

// المالك بس مستثنى من شروط الإعجابات وغرفه الإنتظار (طلب المالك: ولا أحد غيره)
export const exempt = () => !!S.owner;
// أصحاب المجموعات (لاعلانات السوابر بس)
const powered = () => !!(S.owner || S.rank > 0);
// يحتاج إعجابات أكثر؟ يطلع التنبيه ويرجّع true
export function needLikes(n, text) {
  n = +n || 0;
  if (!n || exempt() || (S.me?.likes || 0) >= n) return false;
  toast(text.replace("N", n));
  return true;
}

// ===== الإختصارات والفلتر =====
// الإختصار = كلمة كاملة في الرساله (مثل س1)، بحد SITE.maxshrt في الرساله الواحده
function shortcuts(text) {
  if (!shorts.length) return text;
  let n = 0;
  return text.split(/(\s+)/).map((w) => {
    if (n >= SITE.maxshrt) return w;
    const s = shorts.find((x) => x.k === w);
    if (!s) return w;
    n++;
    return s.v;
  }).join("");
}
// prep(text) → { text, blocked }: الممنوعه توقف الرساله (تطلع عند صاحبها بس) وتنسجل،
// المراقبه تمر وتنسجل، والمسموحه تستثني الكلمات اللي داخلها كلمة ممنوعه
export function prep(text) {
  text = shortcuts(String(text || ""));
  if (!filters.length) return { text, blocked: false };
  let t = text.toLowerCase();
  filters.filter((f) => f.t === "a").forEach((f) => { t = t.split(f.w).join(" "); });
  // كل الكلمات اللي في الرساله تنكتب في السجل (مثل العنود: "جو, جود, نور")
  const bad = filters.filter((f) => f.t === "b" && t.includes(f.w)).map((f) => f.w);
  const mon = filters.filter((f) => f.t === "m" && t.includes(f.w)).map((f) => f.w);
  const words = [...new Set([...bad, ...mon])].join(", ");
  if (bad.length) { perform("fltlog", { w: words, m: text, k: "b" }).catch(() => {}); return { text, blocked: true }; }
  if (mon.length) perform("fltlog", { w: words, m: text, k: "m" }).catch(() => {});
  return { text, blocked: false };
}
// الاسم فيه كلمة ممنوعه؟
// الاسم فيه كلمة ممنوعه؟ تنحفظ المحاولة في الفلتر (كل الكلمات) — log=false للفحص بس
export const badName = (name, log = true) => {
  let t = String(name || "").toLowerCase();
  filters.filter((f) => f.t === "a").forEach((f) => { t = t.split(f.w).join(" "); });
  const bad = filters.filter((f) => f.t === "b" && t.includes(f.w)).map((f) => f.w);
  if (bad.length && log) perform("fltlog", { w: [...new Set(bad)].join(", "), m: "الاسم: " + name, k: "b", u: name }).catch(() => {});
  return bad.length > 0;
};

// ===== رسائل الترحيب والتلقائيه + الإعلانات (تنعرض في الغرفة) =====
const atBottom = () => { const d = $("#d2")[0]; return d.scrollHeight - d.scrollTop - d.clientHeight < 80; };
function toRoom($e) {
  const stick = atBottom();
  $("#d2").append($e);
  if (stick) $("#d2")[0].scrollTop = $("#d2")[0].scrollHeight;
}
const sysMsg = (x) => localMsg(x.t || "╠ ترحيب ╣", x.m, "red", "prv1.png");
let welcomed = false, autoI = 0, lastAuto = 0;

// الإعلان مثل العنود: سطر pmsgc + علامة "إعلان" زرقاء (fa-bullhorn) + زر حذف لصاحبه أو "مسح الرسائل"
function showAnn(id, a, pp) {
  if (!a || !S.room || (a.by && S.ignored.has(a.by))) return;
  const $e = renderMsg({ t: "m", uid: a.by, m: a.m, ts: a.ts, u: a.u }, {
    cls: pp ? "ppmsgc" : "pmsgc",
    del: a.by === S.uid || !!S.perms.dmsg,
    onDel: () => perform("ann_del", { id, pp }).catch(() => toast("ليس لديك صلاحيه"))
  });
  $e.attr("data-ann", id);
  $e.find(".u-msg").first().append('<label style="margin-top:2px;color:blue" class="fl nosel fa fa-bullhorn">إعلان</label>');
  toRoom($e);
}
const SUPER_NOTE = "الرجاء عدم إرسال اعلانات مزعجة أو غير مرغوب فيها … وفي حال عدم احترام هذه القاعدة يتم إلغاء خاصية الإعلانات";
let noted = false;
// تنبيه للسوابر: يطلع مرة وحدة لصاحب صلاحية الإعلانات (مثل العنود)
function superNote() {
  if (noted || !S.inChat || !S.room || !((S.perms.publicmsg || 0) >= 1 || S.perms.ppmsg)) return;
  noted = true;
  toRoom(localMsg("╠ تنبيه للسوابر ╣", SUPER_NOTE, "red", "room.png"));
}

// ===== غرفه الإنتظار =====
let wkeys = null;
const ws = { listed: false, allowed: false, hit: [] };
async function checkList() {
  if (!wkeys) wkeys = await banKeys();
  const rows = await Promise.all(wkeys.map((k) => get(r("wlist/" + k)).then((s) => [k, s.val()]).catch(() => [k, null])));
  ws.allowed = rows.some(([, v]) => v && v.a);
  ws.hit = rows.filter(([, v]) => v && !v.a);
  ws.listed = ws.hit.length > 0;
}
const wLikes = () => +(S.wroom.likes || 0);
function calcWaiting() {
  const w = S.wroom || {};
  if (!w.active || exempt() || ws.allowed) return false;
  return ws.listed || (wLikes() > 0 && (S.me?.likes || 0) < wLikes());
}
// منع شي داخل غرفه الإنتظار: pm = الخاص، allowlikes = الايكات، nots = التنبيهات
export function waitBlock(what) {
  if (!S.waiting || !S.wroom[what]) return false;
  toast("غير مسموح في غرفه الانتظار");
  return true;
}
export function waitMsg() {
  return ws.listed || !wLikes() ? "لا يمكنك مغادره غرفه الانتظار" : `يجب الحصول على ${wLikes()} إعجاب لمغادره غرفه الانتظار`;
}
async function refreshWaiting(first) {
  if (!S.inChat || !S.me) return;
  await checkList().catch(() => {});
  const was = S.waiting;
  S.waiting = calcWaiting();
  // الحالات وآخر حاله في جدول غرفه الإنتظار (مثل الحظر)
  if (first && S.waiting) ws.hit.forEach(([k, v]) => update(r("wlist/" + k), { n: (v.n || 0) + 1, la: serverTimestamp() }).catch(() => {}));
  if (S.waiting && S.room && S.room !== "wait" && S.rooms.wait) join("wait", true);
  // طلع من الانتظار: نقل تلقائي للغرف العامه
  if (was && !S.waiting && S.room === "wait" && S.wroom.move) autoJoin();
}
// اكتملت الايكات: سماح تلقائي و/أو نقل تلقائي
async function onLikes() {
  if (!S.waiting || !S.wroom.active) return;
  if (!wLikes() || (S.me?.likes || 0) < wLikes()) return;
  if (S.wroom.autoAllow) await perform("wallow_self").catch(() => {});
  refreshWaiting(false);
}

// ===== ملف العضو: ارسل هديه + البنر =====
function picker(title, kind, folder, uid) {
  $("#gpick").closest(".bgg").remove();
  const $p = tpl("pop");
  $p.find(".title").text(" " + title);
  const $b = $p.find(".body").attr("id", "gpick").css({ padding: "4px", "background-color": "white" });
  $('<button class="btn btn-danger fa fa-times" style="margin:2px;"> إزالة</button>').on("click", () => {
    perform(kind, { uid, ico: "" }).catch(() => toast("ليس لديك صلاحيه"));
    $p.remove();
  }).appendTo($b);
  $b.append("<br>");
  LISTS[folder].forEach((n) => {
    const $i = $('<img class="hand border" style="max-height:32px;max-width:100px;margin:3px;padding:2px;" alt="">');
    setIco($i[0], n.startsWith("db:") ? n : folder + "/" + n);
    $i.on("click", () => {
      perform(kind, { uid, ico: n }).catch((e) => toast(e.msg || "ليس لديك صلاحيه"));
      $p.remove();
    }).appendTo($b);
  });
  $p.find(".pphide").on("click", () => $p.remove());
  $("#room").append($p);
}

export function initExtras() {
  // ===== الإعلانات =====
  const showPm = () => $("#pmsg").toggle(!!((S.perms.publicmsg || 0) >= 1 || S.perms.ppmsg));
  on("perms", showPm);
  // صلاحيات الحذف على body (الأزرار موجودة وتظهر/تختفي مباشرة)
  on("perms", () => { $("body").toggleClass("p-dmsg", !!S.perms.dmsg).toggleClass("p-delbc", !!S.perms.delbc); });
  on("enter", showPm);
  $("#pmsg").on("click", () => {
    const pp = !!S.perms.ppmsg, pub = (S.perms.publicmsg || 0) >= 1;
    $("#mnot textarea").val("");
    // مثل العنود: المربع يطلع دايماً، ومعطّل لغير صاحب "اعلانات السوابر"
    $("#mnot .ppmsg").prop("disabled", !pp).prop("checked", pp && !pub);
    $("#mnot").modal("show");
  });
  $("#mnot").on("shown.bs.modal", () => $("#mnot textarea").trigger("focus"));
  $("#mnot .rsave").on("click", async () => {
    const m = $("#mnot textarea").val().trim();
    if (!m) return;
    const { text, blocked } = prep(m);
    $("#mnot").modal("hide");
    if (blocked) return showAnn("local" + Date.now(), { m: text, by: S.uid, u: S.me, ts: Date.now() }, $("#mnot .ppmsg").prop("checked"));
    try { await perform("announce", { m: text, pp: $("#mnot .ppmsg").prop("checked") }); }
    catch (e) { toast(e.msg || (/permission|PERMISSION/.test(String(e?.code || e?.message)) ? "ليس لديك صلاحيه" : "فشل الحفظ")); }
  });

  // ===== ملف العضو: الهدايا والبنر =====
  $("#upro .ugift").on("click", function () { const uid = $("#upro").data("uid"); $("#upro").modal("hide"); picker("ارسل هديه", "gift", "dro3", uid); });
  $("#upro .ubnr").on("click", function () { const uid = $("#upro").data("uid"); $("#upro").modal("hide"); picker("البنر", "banner", "sico", uid); });

  // البيانات العامة (قبل وبعد الدخول) — الفلتر يتحمّل من صفحة الدخول
  onValue(r("filter"), (s) => { filters = Object.values(s.val() || {}).filter((x) => x && x.w).map((x) => ({ w: String(x.w).toLowerCase(), t: x.t })); }, () => {});
  onValue(r("entry"), (s) => { S.entry = s.val() || {}; }, () => {});
  onValue(r("wroom"), (s) => { S.wroom = s.val() || {}; refreshWaiting(false); }, () => {});
  // صار عنده مجموعة (أو انسحبت): نعيد حساب غرفه الإنتظار
  on("perms", () => { refreshWaiting(false); if (welcomed) superNote(); });

  on("enter", () => {
    onValue(r("shrt"), (s) => { shorts = Object.values(s.val() || {}).filter((x) => x && x.k); }, () => {});
    onValue(r("cmsgs"), (s) => { cmsgs = Object.entries(s.val() || {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, x]) => x); }, () => {});
    const t0 = now();
    onChildAdded(query(r("ann"), orderByChild("ts"), startAt(t0)), (s) => showAnn(s.key, s.val(), false), () => {});
    onChildRemoved(r("ann"), (s) => $(`#d2 [data-ann="${s.key}"]`).remove(), () => {});
    // اعلانات السوابر: لأصحاب المجموعات (حتى لو انعطى مجموعة بعد الدخول)
    let pannOn = false;
    const subPann = () => {
      if (pannOn || !powered()) return;
      pannOn = true;
      onChildAdded(query(r("pann"), orderByChild("ts"), startAt(now())), (s) => showAnn(s.key, s.val(), true), () => { pannOn = false; });
      onChildRemoved(r("pann"), (s) => $(`#d2 [data-ann="${s.key}"]`).remove(), () => {});
    };
    subPann();
    on("perms", subPann);
    onValue(r("ucount/" + S.uid), (s) => { S.me.likes = s.val() || 0; onLikes(); });
    // غرفه الإنتظار تتحسب قبل أول دخول غرفة
    S.waitCheck = refreshWaiting(true).catch(() => {});
  });

  // رسائل الترحيب: أول غرفة بعد الدخول
  on("room", (rid) => {
    if (!rid || welcomed) return;
    welcomed = true;
    lastAuto = Date.now();
    setTimeout(() => { cmsgs.filter((x) => x.k === "w").forEach((x) => toRoom(sysMsg(x))); superNote(); }, 400);
  });
  // الرسائل التلقائيه: وحدة كل SITE.msgstt دقيقة بالدور
  setInterval(() => {
    if (!S.inChat || !S.room) return;
    const auto = cmsgs.filter((x) => x.k === "a");
    if (!auto.length || Date.now() - lastAuto < (SITE.msgstt || 5) * 60000) return;
    lastAuto = Date.now();
    toRoom(sysMsg(auto[autoI++ % auto.length]));
  }, 15000);
}
