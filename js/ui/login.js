// صفحة الدخول: زوار / أعضاء / تسجيل + حالة الاتصال + قائمة المتواجدين
import { r, db, auth } from "../firebase.js";
import { S, getv, setv } from "../state.js";
import { SITE } from "../config.js";
import { ref, get, set, remove, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { nameKey, nameEmail, validName, detectNet, toast } from "../util.js";
import { enter } from "../session.js";
import { badName } from "./extras.js";
// اسم فيه كلمة ممنوعه: نسجّل المحاولة (يحتاج دخول مجهول عشان القواعد) ونرفض
async function blockedName(name) {
  if (!badName(name, false)) return false;
  try { if (!auth.currentUser) await signInAnonymously(auth); } catch {}
  badName(name, true);
  return true;
}

const $ = window.jQuery;
let busy = false, connected = false, ever = false;

function stat(text, cls) {
  $("#loginstat").text(text).removeClass("label-success label-danger label-warning label-info").addClass(cls);
}

// الاسم مستخدم؟ الاسم المعلّق (باهت) لزائر يرجع لصاحبه بس إذا نفس الآي بي، وينشال قبل الدخول.
// من آي بي ثاني: الاسم محجوز لين تخلص مدته ("يرجى إختيار أسم آخر").
let myIh = "";
const myGhosts = (name) => Object.entries(S.users).filter(([, u]) => u.off && u.g && myIh && u.ih === myIh && nameKey(u.topic) === nameKey(name)).map(([uid]) => uid);
const nameTakenOnline = (name) => {
  const k = nameKey(name), mine = myGhosts(name);
  return Object.entries(S.users).some(([uid, u]) => uid !== auth.currentUser?.uid && !mine.includes(uid) && nameKey(u.topic) === k);
};
const clearMyGhosts = (name) => Promise.all(myGhosts(name).map((uid) => remove(r("online/" + uid)).catch(() => {})));

// Firebase يرفض كلمة المرور الأقصر من 6 أحرف، والعنود يقبلها (مثل 1234)،
// فنضيف لها لاحقة ثابتة قبل الإرسال. نفس الكلمة تعطي نفس النتيجة دايماً.
const authPass = (p) => p + "@al3nood";

// الأخطاء تطلع داخل #loginstat نفسه مثل العنود (برتقالي = warning، أحمر = danger)
const warn = (t) => stat(t, "label-warning");
const danger = (t) => stat(t, "label-danger");

async function loginGuest() {
  const name = $("#u1").val().trim();
  if (!SITE.allowg) return danger("دخول الزوار مغلق");
  if (!validName(name, SITE.guestNameMax) || (await blockedName(name))) return warn("يرجى إختيار أسم آخر");
  myIh = (await detectNet()).ih;
  if ((await get(r("names/" + nameKey(name)))).exists()) return danger("هذا الإسم مسجل من قبل");
  if (nameTakenOnline(name)) return warn("يرجى إختيار أسم آخر");
  if (auth.currentUser && !auth.currentUser.isAnonymous) await signOut(auth);
  if (!auth.currentUser) await signInAnonymously(auth);
  const ghost = Object.values(S.users).find((u) => u.off && u.g && myIh && u.ih === myIh && nameKey(u.topic) === nameKey(name));
  await clearMyGhosts(name);
  setv("isl", "no");
  setv("u1", name);
  await enter({ topic: name, msg: "(غير مسجل)", _ghost: ghost }, false);
}

async function loginMember() {
  const name = $("#u2").val().trim(), pass = $("#pass1").val();
  if (!name || !pass) return warn("يرجى إختيار أسم آخر");
  const owner = await get(r("names/" + nameKey(name)));
  if (!owner.exists()) return warn("هذا الإسم غير مسجل !");
  // دايماً نتحقق من كلمة المرور (حتى لو فيه جلسة محفوظة من قبل)
  if (auth.currentUser) await signOut(auth);
  try { await signInWithEmailAndPassword(auth, nameEmail(name), authPass(pass)); }
  catch (e) {
    if (e.code === "auth/network-request-failed") throw e;
    return danger("كلمه المرور غير صحيحه");
  }
  setv("isl", "yes");
  setv("u2", name);
  setv("p1", pass); // العنود يحفظ كلمة المرور عشان الرجوع أسهل (طلب صاحب الموقع)
  const p = (await get(r("users/" + auth.currentUser.uid))).val() || { topic: name };
  await enter(p, true);
}

async function register() {
  const name = $("#u3").val().trim(), pass = $("#pass2").val();
  if (!SITE.allowreg) return danger("تسجيل العضويات مغلق");
  if (!validName(name, SITE.registerNameMax) || (await blockedName(name))) return warn("يرجى إختيار أسم آخر");
  if (!pass) return danger("كلمه المرور غير صحيحه");
  const key = nameKey(name);
  if ((await get(r("names/" + key))).exists() || nameTakenOnline(name)) return danger("هذا الإسم مسجل من قبل");
  if (auth.currentUser) await signOut(auth);
  try { await createUserWithEmailAndPassword(auth, nameEmail(name), authPass(pass)); }
  catch (e) {
    if (e.code === "auth/email-already-in-use") return danger("هذا الإسم مسجل من قبل");
    if (e.code === "auth/weak-password") return danger("كلمه المرور غير مناسبه");
    throw e;
  }
  const uid = auth.currentUser.uid;
  try {
    await set(r("names/" + key), uid); // القواعد ترفض لو انحجز الاسم في نفس اللحظة
  } catch {
    try { await deleteUser(auth.currentUser); } catch {}
    return danger("هذا الإسم مسجل من قبل");
  }
  const profile = { name, topic: name, msg: "(عضو جديد)", pic: "pic.png", ucol: "#000000", mcol: "#000000", bg: "#ffffff", reg: serverTimestamp() };
  await set(r("users/" + uid), profile);
  setv("isl", "yes");
  setv("u2", name);
  setv("p1", pass);
  await enter(profile, true);
}

async function doLogin(kind) {
  if (busy || S.inChat) return;
  if (!connected) return danger("غير متصل");
  busy = true;
  try {
    if (kind === 1) await loginGuest();
    else if (kind === 2) await loginMember();
    else await register();
  } catch (e) {
    // تنبيه للمحظور عند محاولة الدخول: الدائم (المشفّر) له نص، والمؤقت يبيّن المتبقي
    if (e && e.message === "maxip") return danger("تم تجاوز عدد الأسماء المسموح من نفس الجهاز");
    if (e && e.message === "banned") {
      const b = e.ban || {};
      if (b.perm) return toast("تم حظرك من الدردشة نهائياً");
      const mins = Math.max(1, Math.ceil(((b.until || 0) - Date.now()) / 60000));
      return toast(`تم حظرك من الدردشة
المتبقي: ${mins} دقيقة`);
    }
    console.error(e);
    // غير متصل مثل العنود؛ وأخطاء إعداد Firebase تطلع بسببها الواضح عشان تنصلح
    const c = String((e && (e.code || e.message)) || "");
    if (/operation-not-allowed/.test(c)) danger("طريقة الدخول غير مفعلة في Firebase");
    else if (/permission|PERMISSION/.test(c)) danger("قواعد قاعدة البيانات غير مضبوطة");
    else danger("غير متصل");
  } finally {
    busy = false;
  }
}

// يفتح آخر تبويب دخول استخدمه (زوار / أعضاء) مع الاسم، مثل العنود
function showTab(n) {
  const $a = $(`#tlogins .nav-tabs li:nth-child(${n}) a`);
  $("#tlogins .nav-tabs li").removeClass("active");
  $a.parent().addClass("active");
  $("#tlogins .tab-content > .tab-pane").removeClass("active in");
  $($a.attr("href")).addClass("active in");
}

// تحديث الصفحة بالغلط: نرجع للشات بنفس الاسم بدون صفحة الدخول (مثل العنود)
async function resume() {
  let f = null;
  try { f = JSON.parse(sessionStorage.getItem("al3_in") || "null"); } catch {}
  if (!f) return;
  try {
    await auth.authStateReady();
    if (!auth.currentUser || auth.currentUser.uid !== f.uid) throw new Error("nosess");
    for (let i = 0; i < 50 && !connected; i++) await new Promise((ok) => setTimeout(ok, 100));
    busy = true;
    stat("يتم الاتصال ..", "label-warning");
    if (f.m) {
      const p = (await get(r("users/" + f.uid))).val();
      if (!p) throw new Error("nouser");
      await enter({ ...p, _stealth: !!f.s }, true);
    } else {
      await enter({ topic: f.t, msg: f.msg || "(غير مسجل)" }, false);
    }
  } catch (e) {
    try { sessionStorage.removeItem("al3_in"); } catch {}
    if (e && e.message === "banned") toast("تم حظرك من الدردشة");
    else if (e && e.message !== "nosess") console.error(e);
    stat(connected ? "متصل" : "غير متصل", connected ? "label-success" : "label-danger");
  } finally { busy = false; }
}

export function initLogin() {
  // الاسم والعنوان وطول الأسماء تنضبط من site.js (إداره الموقع)
  $("#u1").attr("maxlength", SITE.guestNameMax);
  $("#u3").attr("maxlength", SITE.registerNameMax);
  $("#u1").val(getv("u1", ""));
  $("#u2").val(getv("u2", ""));
  $("#pass1").val(getv("p1", ""));
  showTab(getv("isl") === "yes" ? 2 : 1);
  // الروابط تنحط بعد #loginstat بنفس ترتيب القائمة
  let $after = $("#loginstat");
  SITE.loginLinks.forEach((l) => {
    const $d = $('<div class="fr borderg minix" style="padding:2px;background-color:white!important;font-size:10px;margin-top:0;"> <a></a></div>');
    $d.find("a").attr({ href: l.url, title: l.title }).text(l.title);
    $d.insertAfter($after);
    $after = $d;
  });
  $("[data-login]").on("click", function () { doLogin(+$(this).data("login")); });
  $("#u1").on("keydown", (e) => { if (e.key === "Enter") doLogin(1); });
  $("#pass1").on("keydown", (e) => { if (e.key === "Enter") doLogin(2); });
  $("#pass2").on("keydown", (e) => { if (e.key === "Enter") doLogin(3); });
  $("#tlogins .fa-refresh").on("click", (e) => { e.preventDefault(); location.reload(); });
  $("#stealthbtn").on("click", function () { $(this).toggleClass("label-info"); $("#stealth").prop("checked", $(this).hasClass("label-info")); });
  // تبويبات الدخول بدون الاعتماد على bootstrap tab
  $("#tlogins .nav-tabs a").on("click", function (e) {
    e.preventDefault();
    showTab($(this).parent().index() + 1);
  });
  onValue(ref(db, ".info/connected"), (s) => {
    connected = !!s.val();
    if (connected) ever = true;
    if (busy || S.inChat) return;
    if (!ever) stat("يتم الاتصال ..", "label-warning");
    else stat(connected ? "متصل" : "غير متصل", connected ? "label-success" : "label-danger");
    // مثل العنود: لو انقطع الاتصال وأنت في صفحة الدخول، الصفحة تتحدث بعد 3 ثواني
    if (ever && !connected) setTimeout(() => { if (!connected && !S.inChat && !busy) location.reload(); }, 3000);
  });
}
