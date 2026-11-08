// الجلسة: تسجيل التواجد، الدخول للشات، الخروج، الطرد
import { r, db, auth, now } from "./firebase.js";
import { S, emit, on, setv } from "./state.js";
import { ref, get, set, push, remove, update, onValue, onChildAdded, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { deviceHash, deviceFp, detectNet, nameKey, toast } from "./util.js";
import { SITE } from "./config.js";
import { loadPerms } from "./perms.js";

const $ = window.jQuery;

// نسخة مختصرة من بياناتي تنحفظ مع كل رسالة
export const snap = (u = S.me) => ({
  topic: u.topic, pic: u.pic || "pic.png", ucol: u.ucol || "#000000",
  mcol: u.mcol || "#000000", bg: u.bg || "#ffffff", ico: u.ico || ""
});

let presenceBound = false;

async function writePresence() {
  const me = r("online/" + S.uid);
  // la = آخر نشاط (كتابة/إعجاب) — إعادة الاتصال ما ترجّع اللون أخضر
  const d = { ts: serverTimestamp(), la: S.lastLa || serverTimestamp() };
  for (const k of ["topic", "msg", "pic", "ucol", "mcol", "bg", "co", "g", "h", "busy", "room", "ih", "fp", "f1", "f2", "f3", "f4", "fd", "s", "sid", "nn"]) if (S.me[k]) d[k] = S.me[k];
  if (S.me.busy === false) d.busy = false;
  await set(me, d);
  // لو انقطع الاتصال: الاسم يبقى معلّق بلون باهت (مثل العنود) بدل ما ينحذف
  // (ينسجّل بعد الكتابة عشان القواعد تشوف السجل كامل)
  if (SITE.ghostMins > 0) await onDisconnect(me).update({ off: true, offAt: serverTimestamp() });
  else await onDisconnect(me).remove();
  lastTouch = Date.now();
}

// أي فعل (رسالة، إعجاب، تنبيه، حذف...) يرجّع اللون أخضر — لمس الشاشة ما يغيّر شي
let lastTouch = 0;
// تغيّرت إعدادات الموقع وأنا داخل: نحدّث تصرّف انقطاع النت (معلّق باهت أو يطلع على طول)
on("site", () => {
  if (!S.inChat || !S.uid) return;
  const me = r("online/" + S.uid);
  (SITE.ghostMins > 0 ? onDisconnect(me).update({ off: true, offAt: serverTimestamp() }) : onDisconnect(me).remove()).catch(() => {});
});

export function touch() {
  if (!S.inChat) return;
  if (Date.now() - lastTouch < 30000) return; // مرة كل 30 ثانية تكفي
  lastTouch = Date.now();
  S.lastLa = now() - 2000; // بوقت السيرفر (القواعد ترفض وقت بالمستقبل)
  update(r("online/" + S.uid), { la: serverTimestamp() }).catch(() => {});
}

function bindPresence() {
  if (presenceBound) return;
  presenceBound = true;
  // لو انقطع الاتصال ورجع، نرجّع التواجد (لأن onDisconnect حذفه)
  let down = false;
  let $rc = null, offT = null;
  onValue(ref(db, ".info/connected"), (s) => {
    if (!s.val()) {
      down = true;
      if (!S.inChat || kicked) return;
      // إستعاده الاتصال (إداره الموقع): مفعّل = تنبيه "يتم إعادة الاتصال" ويرجع لنفس مكانه، مقفول = يرجع لصفحة الدخول
      if (!SITE.rc) { offT = setTimeout(() => { if (down && S.inChat) logout(); }, 3000); return; }
      // مثل العنود: الشاشة تغمق + شريط برتقالي "يتم إعاده الاتصال .." وزر [x] أحمر
      if (!$rc) {
        $rc = $(`<div class="rcbox" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:99998;">
          <div class="rcbar label-warning d-flex corner" style="position:absolute;top:96px;left:25%;width:220px;height:36px;padding:0;align-items:center;">
            <span class="rct flex-grow-1" style="padding:0 8px;color:black;text-align:left;">يتم إعاده الاتصال ..</span>
            <span class="btn btn-danger hand" style="padding:4px 6px;margin:2px;border:0;">[ x ]</span>
          </div></div>`);
        // [x] مثل العنود: يطلعك لصفحة الدخول بدون إعادة الاتصال
        $rc.find(".btn-danger").on("click", () => { $rc.remove(); $rc = null; logout(); });
        $("body").append($rc);
      }
      return;
    }
    clearTimeout(offT);
    // رجع الاتصال: الشريط يصير أخضر "متصل .." ثم يختفي
    if ($rc) {
      const $o = $rc; $rc = null;
      $o.find(".rcbar").removeClass("label-warning").addClass("label-success");
      $o.find(".rct").text("متصل ..");
      setTimeout(() => $o.remove(), 1500);
    }
    if (down && S.inChat && !kicked) writePresence().catch(console.error);
    down = false;
  });
}

// مفاتيح الحظر اللي تخص جهازي: بصمة الجهاز بمستوياتها الخمسة + الآي بي + الدولة
export async function banKeys() {
  const { co, ih } = await detectNet();
  const keys = deviceFp().keys.map((k, i) => `f${i}_${k}`);
  if (ih) keys.push("i_" + ih);
  keys.push("c_" + co);
  return keys;
}
// محظور؟ "سماح" (استثناء) يغلب الحظر. كل محاولة دخول محظورة تنحسب في "الحالات".
// القواعد تمنع التواجد كمان.
export async function isBanned() {
  const keys = await banKeys();
  const rows = await Promise.all(keys.map((k) => get(r("bans/" + k)).then((s) => [k, s.val()]).catch(() => [k, null])));
  if (rows.some(([, v]) => v && v.a)) return false;
  // الحظر المؤقت المنتهي ينشال ولا يمنع
  rows.filter(([, v]) => v && v.until && v.until <= Date.now()).forEach(([k]) => remove(r("bans/" + k)).catch(() => {}));
  const hit = rows.filter(([, v]) => v && !v.a && !(v.until && v.until <= Date.now()));
  hit.forEach(([k, v]) => update(r("bans/" + k), { n: (v.n || 0) + 1, la: serverTimestamp() }).catch(() => {}));
  if (!hit.length) return false;
  // دائم لو فيه حظر بدون مدة، وإلا مؤقت (نرجّع أطول مدة باقية)
  if (hit.some(([, v]) => !v.until)) return { perm: true };
  return { until: Math.max(...hit.map(([, v]) => v.until)) };
}

// ===== الطرد والباند =====
let kicked = false;
// نفس نصوص العنود حرفياً (الطرد بالهاء والحظر بالتاء)
const KMSG = { kick: "تم طردك من الدردشه", ban: "تم حظرك من الدردشة" };
function onKick(k) {
  try { sessionStorage.removeItem("al3_in"); } catch {}
  if (kicked || !S.inChat) return;
  kicked = true;
  toast(KMSG[k] || KMSG.kick); // صندوق "تنبيه" داخل الشات
  setTimeout(logout, 3000);    // بعدها يرجع لصفحة الدخول
}
function watchKicks() {
  onChildAdded(r("kicks/" + S.uid), (s) => {
    const k = s.val() || {};
    remove(s.ref).catch(() => {});
    if (k.k === "kick" || k.k === "ban") onKick(k.k);
  });
  // انشال اسمي وأنا متصل؟ لو مو طرد نرجّعه
  on("user", (uid, val) => {
    if (uid !== S.uid || !S.inChat) return;
    // نفس العضوية دخلت من مكان ثاني: هذا يطلع (بدون ما يلمس تواجد الجديد)
    if (val && val.sid && S.me.sid && val.sid !== S.me.sid) return dupOut();
    if (val) {
      // الإدارة غيّرت زخرفتي أو حذفت صورتي: نحدّث نسختي المحلية
      if (val.topic && val.topic !== S.me.topic) { S.me.topic = val.topic; logNick(val.topic); emit("me"); }
      if (val.pic && val.pic !== S.me.pic) { S.me.pic = val.pic; emit("me"); }
      return;
    }
    setTimeout(() => { if (S.inChat && !kicked) writePresence().catch(() => {}); }, 2000);
  });
}

// سجل الدخول + بيانات اللوحة + كشف النكات
function logEnter(ip) {
  push(r("fps"), {
    uid: S.uid, st: S.member ? "عضو" : "زائر", un: S.member ? String(S.name || "").slice(0, 60) : "",
    t: S.me.topic, ip: ip || "", co: S.me.co, fp: S.dev, refr: String(document.referrer || "").slice(0, 200), ts: serverTimestamp()
  }).catch(() => {});
  // بيانات خاصة للوحة التحكم (الآي بي والجهاز) — لكل متصل
  set(r("uprv/" + S.uid), { ip: ip || "", fp: S.dev, co: S.me.co, ls: serverTimestamp() }).catch(() => {});
  onDisconnect(r("uprv/" + S.uid + "/ls")).set(serverTimestamp()).catch(() => {});
  logNick(S.me.topic);
}
export function logNick(topic) {
  if (!S.me?.fp || !topic) return;
  set(r(`hist/${S.me.fp}/${nameKey(topic).slice(0, 100)}`), { t: String(topic).slice(0, 40), ts: serverTimestamp() }).catch(() => {});
}

// الدخول للشات بعد نجاح تسجيل الدخول
export async function enter(profile, isMember) {
  S.uid = auth.currentUser.uid;
  S.member = !!isMember;
  S.name = profile.name || "";
  const { co, ih, ip } = await detectNet();
  const wantStealth = isMember && ($("#stealth").prop("checked") || profile._stealth);
  S.me = {
    topic: profile.topic,
    msg: profile.msg || "",
    pic: profile.pic || "pic.png",
    ucol: profile.ucol || "#000000",
    mcol: profile.mcol || "#000000",
    bg: profile.bg || "#ffffff",
    co, ih, g: !isMember, h: deviceHash(),
    busy: false, room: null
  };
  const dev = deviceFp();
  S.dev = dev.fp;
  S.me.fp = dev.keys[0];
  S.me.fd = dev.fp;
  [1, 2, 3, 4].forEach((i) => { S.me["f" + i] = dev.keys[i]; });
  await loadPerms(); // قبل التواجد: الأيقونة والدخول المخفي
  // تعدد النكات من نفس الجهاز (إداره الموقع) — المالك وأصحاب المجموعات مستثنين
  if (!S.owner && !S.rank) {
    const same = Object.entries(S.users).filter(([uid, u]) => uid !== S.uid && !u.bot && !u.off && u.fp && u.fp === S.me.fp).length;
    if (same >= (SITE.maxIP || 5)) {
      try { await signOut(auth); } catch {}
      throw new Error("maxip");
    }
  }
  // المحظور ما يدخل (المالك مستثنى مثل القواعد)
  const ban = S.owner ? false : await isBanned();
  if (ban) {
    try { await signOut(auth); } catch {}
    const e = new Error("banned");
    e.ban = ban;
    throw e;
  }
  if (wantStealth && S.perms.stealth) S.me.s = true;
  await remove(r("kicks/" + S.uid)).catch(() => {});
  S.me.nn = !!S.nonot;
  S.me.sid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  // كان معلّق (حدّث الصفحة أو انقطع): نكتب "غادر الدردشه" في غرفته القديمة قبل الدخول
  const prev = S.users[S.uid] || profile._ghost;
  if (prev && prev.room && !S.me.s) {
    await push(r("msgs/" + prev.room), { t: "x", uid: S.uid, room: prev.room, ts: serverTimestamp(), u: snap(prev.topic ? { ...S.me, topic: prev.topic } : S.me) }).catch(() => {});
  }
  await writePresence();
  S.inChat = true;
  try { sessionStorage.setItem("al3_in", JSON.stringify({ uid: S.uid, m: S.member ? 1 : 0, t: S.me.topic, msg: S.me.msg, s: S.me.s ? 1 : 0 })); } catch {}
  on("room", (rid) => { try { sessionStorage.setItem("al3_room", rid || ""); } catch {} });
  // مثل العنود: داخل الشات التحديث بالغلط ما يمشي (F5 / Ctrl+R) والمتصفح يسأل قبل مغادرة الصفحة
  window.onbeforeunload = (e) => { if (S.inChat) { e.preventDefault(); e.returnValue = ""; return ""; } };
  $(document).on("keydown.norefresh", (e) => {
    if (S.inChat && (e.key === "F5" || ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R" || e.key === "ر")))) e.preventDefault();
  });
  bindPresence();
  watchKicks();
  logEnter(ip);
  $(".dad").remove(); // العنود يشيل صفحة الدخول كاملة بعد الدخول
  $("#room").css("display", "flex");
  emit("enter");
}

// تحديث بياناتي (التواجد + الملف لو عضو)
export async function saveMe(fields) {
  Object.assign(S.me, fields);
  const upd = {};
  for (const k in fields) upd[`online/${S.uid}/${k}`] = fields[k];
  if (S.member) for (const k of ["topic", "msg", "pic", "ucol", "mcol", "bg"]) if (k in fields) upd[`users/${S.uid}/${k}`] = fields[k];
  await update(r(), upd);
  if ("topic" in fields) logNick(fields.topic);
}

let dupDone = false;
async function dupOut() {
  if (dupDone) return;
  dupDone = kicked = true;
  try { await onDisconnect(r("online/" + S.uid)).cancel(); } catch {}
  try { sessionStorage.removeItem("al3_in"); } catch {}
  S.inChat = false;
  // يفصل على طول بدون تنبيه (طلب المالك)
  try { await signOut(auth); } catch {}
  location.reload();
}

export async function logout() {
  try { sessionStorage.removeItem("al3_in"); sessionStorage.removeItem("al3_room"); } catch {}
  if (S.room && !S.me?.s) { try { await push(r("msgs/" + S.room), { t: "x", uid: S.uid, room: S.room, ts: serverTimestamp(), u: snap() }); } catch {} }
  S.inChat = false;
  try { await onDisconnect(r("online/" + S.uid)).cancel(); } catch {}
  try { await set(r("online/" + S.uid), null); } catch {}
  try { await set(r("uprv/" + S.uid + "/ls"), serverTimestamp()); } catch {}
  try { await signOut(auth); } catch {}
  location.reload();
}
