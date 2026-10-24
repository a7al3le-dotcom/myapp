// المتواجدين: قائمة صفحة الدخول (#lonline) وقائمة الشات (#users)
import { r } from "../firebase.js";
import { S, on, emit } from "../state.js";
import { onChildAdded, onChildChanged, onChildRemoved, remove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { now } from "../firebase.js";
import { SITE } from "../config.js";
import { tpl, fillUser, tint, flagSrc, countryName, statSrc } from "../util.js";
import { icoOf, rankOf } from "../perms.js";

// المخفي (دخول مخفي) ما يطلع إلا لمن ترتيبه أعلى منه أو يساويه
export const hiddenFor = (uid, u) => !!(u && u.s && uid !== S.uid && (!S.inChat || rankOf(uid) > S.rank));

const $ = window.jQuery;
const elL = {}, elC = {};

const sortKey = (u) => (u.g ? "1" : "0") + String(u.topic || "").toLowerCase();

function insertSorted($list, $e, key) {
  $e.attr("data-k", key);
  let placed = false;
  $list.children(".uhtml").each(function () {
    if (this !== $e[0] && this.dataset.k > key) { $e.insertBefore(this); placed = true; return false; }
  });
  if (!placed) $list.append($e);
}

function draw($e, u, uid, login) {
  fillUser($e, { ...u, ico: icoOf(uid) || u.ico });
  $e.toggleClass("uhid", hiddenFor(uid, u));
  // الحالة الافتراضية مثل العنود
  if (!u.msg) $e.find(".u-msg").first().text(u.g ? "(غير مسجل)" : "(عضو جديد)");
  $e.css("background-color", tint(u.ucol));
  $e.find(".co").attr({ src: flagSrc(u.co), title: countryName(u.co) });
  $e.find(".uhash").text("#" + (u.h || 0));
  if (login) {
    $e.find(".ustat").remove();
    $e.find(".u-pic").css("width", "56px");
  } else {
    $e.find(".ustat").attr("src", statSrc(u));
    $e.find(".muted").toggle(S.ignored.has(uid));
  }
}

function place(uid) {
  const u = S.users[uid], $e = elC[uid];
  if (!u || !$e) return;
  const inroom = S.room && u.room === S.room;
  $e.toggleClass("inroom", !!inroom);
  insertSorted(inroom ? $("#uin") : $("#uout"), $e, sortKey(u));
}

function refreshHeader() {
  $(".ninr").toggle($("#uout").children(".uhtml:visible").length > 0 && $("#uin").children().length > 0);
}

function counts() {
  const n = Object.entries(S.users).filter(([uid, u]) => !hiddenFor(uid, u)).length;
  $("#s1").text(n);
  $("#busers").text(n);
  refreshHeader();
}

function upsert(uid, u) {
  S.users[uid] = u;
  if (!elL[uid]) { elL[uid] = tpl("uhtml").removeClass("hand"); }
  draw(elL[uid], u, uid, true);
  insertSorted($("#lonline"), elL[uid], sortKey(u));
  if (!elC[uid]) {
    elC[uid] = tpl("uhtml").attr("data-uid", uid);
    elC[uid].on("click", () => emit("profile", uid));
  }
  draw(elC[uid], u, uid, false);
  place(uid);
  applySearch(elC[uid]);
  counts();
}

function applySearch($e) {
  const q = String($("#usearch").val() || "").trim().toLowerCase();
  const uid = $e.attr("data-uid"), u = S.users[uid];
  $e.toggle(!hiddenFor(uid, u) && (!q || String(u?.topic || "").toLowerCase().includes(q)));
}

export const userEl = (uid) => elC[uid];

// أسماء وهمية (Bots): تنضاف وتنشال من القوائم بدون قاعدة البيانات
export function putUser(uid, u) {
  const old = S.users[uid];
  upsert(uid, u);
  emit("users");
  if (old) emit("user", uid, u, old);
}
export function dropUser(uid) {
  if (!S.users[uid]) return;
  delete S.users[uid];
  elL[uid]?.remove(); delete elL[uid];
  elC[uid]?.remove(); delete elC[uid];
  counts();
  emit("users");
  emit("user", uid, null);
}

// الأسماء المعلّقة القديمة تنشال (أي متصل يقدر يشيلها، والقواعد تتحقق إنها معلّقة وقديمة)
function pruneGhosts() {
  if (!S.inChat) return;
  const limit = now() - SITE.ghostMins * 60000;
  for (const [uid, u] of Object.entries(S.users)) {
    if (u.off && (u.offAt || 0) < limit) remove(r("online/" + uid)).catch(() => {});
  }
}

export function initUsers() {
  const ref = r("online");
  onChildAdded(ref, (s) => { upsert(s.key, s.val() || {}); emit("users"); });
  onChildChanged(ref, (s) => {
    const old = S.users[s.key];
    upsert(s.key, s.val() || {});
    emit("users");
    emit("user", s.key, s.val(), old);
  });
  onChildRemoved(ref, (s) => dropUser(s.key));
  $("#usearch").on("input", () => { Object.values(elC).forEach(applySearch); refreshHeader(); });
  on("room", () => { Object.keys(elC).forEach(place); refreshHeader(); });
  // تغيّرت المجموعات/الصلاحيات: نعيد رسم الأيقونات والمخفيين
  on("upow", () => { for (const uid in S.users) upsert(uid, S.users[uid]); emit("users"); });
  on("ignore", () => Object.keys(elC).forEach((uid) => elC[uid].find(".muted").toggle(S.ignored.has(uid))));
  // الأصفر يجي مع الوقت بدون أي كتابة، فنعيد حساب الألوان كل 30 ثانية
  setInterval(() => {
    for (const uid in elC) elC[uid].find(".ustat").attr("src", statSrc(S.users[uid]));
    emit("stat");
    pruneGhosts();
  }, 30000);
}
