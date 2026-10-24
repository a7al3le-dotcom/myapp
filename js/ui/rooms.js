// الغرف: القائمة + إنشاء/تعديل/حذف + الدخول بكلمة مرور
import { r } from "../firebase.js";
import { S, on, emit } from "../state.js";
import { SITE } from "../config.js";
import { get, set, onChildAdded, onChildChanged, onChildRemoved } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { perform } from "../api/actions.js";
import { upload, setPic } from "../api/images.js";
import { tpl, toast, safeColor } from "../util.js";
import { getColor, setColor } from "./colors.js";
import { openPanel, closePanel, panelTab } from "./panel.js";
import { waitMsg } from "./extras.js";
import { hiddenFor } from "./users.js";
import { snap } from "../session.js";
import { renderMsg } from "./msg.js";
import { push, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
// رسالة في الغرفة القديمة: l = غادر الغرفه · v = أنتقل ألى (to)
function roomEvent(rid, t, to) {
  if (!rid || S.me?.s || !S.rooms[rid]) return Promise.resolve();
  const d = { t, uid: S.uid, room: rid, ts: serverTimestamp(), u: snap() };
  if (to) { d.to = to; d.rt = String(S.rooms[to]?.topic || "").slice(0, 40); }
  return push(r("msgs/" + rid), d).catch(() => {});
}

const $ = window.jQuery;
const els = {};
let editing = null, newPic = null;
let pending; // الغرفة اللي أنا قاعد أدخلها/أطلع منها بنفسي الحين (undefined = ما فيه)

// المخفي ما ينحسب في عدد الغرفة عند اللي ترتيبه أقل منه (عشان ما ينكشف)
export const roomCount = (rid) => Object.entries(S.users).filter(([uid, u]) => u.room === rid && !hiddenFor(uid, u)).length;

function draw(rid) {
  const rm = S.rooms[rid], $e = els[rid];
  if (!rm || !$e) return;
  setPic($e.find(".u-pic")[0], rm.pic || "room.png", "room.png");
  const $t = $e.find(".u-topic").text(rm.topic || "").css("color", safeColor(rm.color));
  if (rm.hasPass) $t.prepend('<img src="imgs/lock.png" style="margin-right:2px;" alt="">');
  $e.find(".u-msg").text(rm.about || "");
  const n = roomCount(rid);
  $e.find(".uc").text(`${n}/${rm.max || 40}`);
  $e.attr("data-v", n);
  // الغرفة اللي أنا فيها: خط أزرق يمين ويسار (مثل العنود: class bord)
  $e.toggleClass("bord", rid === S.room);
}

function sortList() {
  const $l = $("#rlist");
  const items = $l.children().get().sort((a, b) => (+b.dataset.v - +a.dataset.v) || String(a.dataset.n).localeCompare(String(b.dataset.n)));
  $l.append(items);
}

function upsert(rid, rm) {
  S.rooms[rid] = rm;
  if (!els[rid]) {
    els[rid] = tpl("rhtml").attr("data-rid", rid);
    els[rid].on("click", () => join(rid));
    $("#rlist").append(els[rid]);
  }
  els[rid].attr("data-n", rm.topic || "");
  draw(rid);
  sortList();
}

export async function join(rid, force) {
  const rm = S.rooms[rid];
  if (!rm) return;
  if (S.room === rid && !force) return panelTab() === "rooms" && closePanel();
  // المحبوس في غرفه الانتظار ما يطلع منها
  if (S.waiting && rid !== "wait") return toast(waitMsg());
  if (rm.owner !== S.uid && roomCount(rid) >= (rm.max || 40)) return toast("الغرفه ممتلئه");
  if (rm.rl && (S.me.likes || 0) < rm.rl && !S.owner) return toast(`دخول الغرفه يتطلب ${rm.rl} إعجاب`);
  let pass = null;
  if (rm.hasPass && rm.owner !== S.uid && !S.perms.rjoin && !S.perms.roomowner) {
    pass = window.prompt("كلمه المرور؟");
    if (pass === null) return;
  }
  pending = rid; // تغيير غرفتي من عندي (مو نقل من الإدارة)
  if (S.room && S.room !== rid) await roomEvent(S.room, "v", rid);
  try {
    await perform("rjoin", { rid, pass });
  } catch (e) {
    pending = undefined;
    return toast(rm.hasPass && pass !== null ? "كلمه المرور غير صحيحه" : "غير متصل");
  }
  pending = undefined;
  const old = S.room;
  S.room = rid;
  S.me.room = rid;
  if (panelTab() === "rooms") closePanel(); // الاختيار من قائمة الغرف يقفلها

  emit("room", rid, old);
  maybeCleanup(old);
}

// الغرف العامة التلقائية: main2, main3 ... (الغرفه العامه ( 2 ) ...)
export const isAutoRoom = (rid) => /^main[0-9]+$/.test(rid || "");
const activeCount = (rid) => Object.values(S.users).filter((u) => u.room === rid && !u.off).length;

// الغرفة غير المثبتة تنحذف لما يطلع منها صاحبها وهي فاضية،
// والغرفة العامة التلقائية تنقفل أول ما يصير عددها 0 (أي أحد يقدر يقفلها)
function maybeCleanup(rid) {
  const rm = rid && S.rooms[rid];
  if (!rm || rm.sticky || rid === SITE.defaultRoom) return;
  if (isAutoRoom(rid) ? activeCount(rid) === 0 : (rm.owner === S.uid && roomCount(rid) === 0)) {
    perform("delroom", { rid }).catch(() => {});
  }
}

// غرفة الدخول التلقائي (مثل العنود): أول غرفة عامة فيها مكان، ولو كلها ممتلئة تنفتح غرفة جديدة
export async function autoJoin() {
  if (S.waitCheck) await S.waitCheck;
  if (S.waiting && S.rooms.wait) return join("wait", true);
  // كل دخول جديد يبدأ من الغرفة العامة (طلب المالك) — نفس الغرفة بس في إعادة الاتصال
  // غرفة الدخول التلقائي من لوحة التحكم (الغرف): غرفة محددة لو فيها مكان
  const fx = S.entry && S.entry.mode === "fixed" && S.rooms[S.entry.rid];
  const kicked = (id) => S.rkick && S.rkick.rid === id && Date.now() - S.rkick.at < 300000;
  if (fx && !kicked(S.entry.rid) && roomCount(S.entry.rid) < (fx.max || 40)) return join(S.entry.rid, true);
  const mainMax = (S.rooms[SITE.defaultRoom] && S.rooms[SITE.defaultRoom].max) || 40;
  for (let n = 1; n < 50; n++) {
    const rid = n === 1 ? SITE.defaultRoom : "main" + n;
    const rm = S.rooms[rid];
    if (!rm) {
      try { await perform("mkauto", { n, max: mainMax }); } catch {}
      for (let i = 0; i < 25 && !S.rooms[rid]; i++) await new Promise((ok) => setTimeout(ok, 200));
      if (S.rooms[rid]) return join(rid, true);
      return join(SITE.defaultRoom, true);
    }
    // الغرفة اللي انطردت منها (5 دقائق) نتخطاها
    if (S.rkick && S.rkick.rid === rid && Date.now() - S.rkick.at < 300000) continue;
    if (roomCount(rid) < (rm.max || 40)) return join(rid, true);
  }
}

export async function leaveRoom() {
  const old = S.room;
  if (!old) return; // مثل العنود: برا الغرفة الزر ما يسوي شي
  if (S.waiting) return toast(waitMsg());
  await roomEvent(old, "l");
  pending = null;
  await perform("rjoin", { rid: null }).catch(() => {});
  pending = undefined;
  S.room = null; S.me.room = null;
  emit("room", null, old);
  maybeCleanup(old);
}

// ===== نافذة إنشاء / تعديل =====
function openMkr(rid) {
  editing = rid || null;
  newPic = null;
  const rm = rid ? S.rooms[rid] : {};
  const $m = $("#mkr");
  $m.find(".modal-title").text(rid ? "إداره الغرفه" : "إنشاء غرفه جديدة");
  $m.find(".rtopic").val(rm.topic || "");
  $m.find(".rabout").val(rm.about || "");
  $m.find(".rwelcome").val(rm.welcome || "");
  $m.find(".rpwd").val("").attr("placeholder", rm.hasPass ? "كلمه المرور (بدون تغيير)" : "كلمه المرور");
  $m.find(".rmax").val(rid ? rm.max : "");
  $m.find(".rl").val(rid ? rm.rl || "" : "");
  $m.find(".rvl").val(rid ? rm.rvl || "" : "");
  $m.find(".rdel").prop("checked", !!rm.sticky);
  $m.find(".rv").prop("checked", !!rm.voice);
  setColor($m.find(".rcolor"), safeColor(rm.color));
  setPic($m.find(".rpic img")[0], rm.pic || "room.png", "room.png");
  newPic = rm.pic || "room.png";
  $m.find(".rmake").toggle(!rid);
  $m.find(".rsave, .rdelete").toggle(!!rid);
  $m.find(".rdelete").toggle(!!rid && rid !== SITE.defaultRoom);
  $m.modal("show");
}

function formData() {
  const $m = $("#mkr");
  return {
    topic: $m.find(".rtopic").val(), about: $m.find(".rabout").val(), welcome: $m.find(".rwelcome").val(),
    pass: $m.find(".rpwd").val(), max: $m.find(".rmax").val() || 40, rl: $m.find(".rl").val(), rvl: $m.find(".rvl").val(),
    sticky: $m.find(".rdel").prop("checked"), voice: $m.find(".rv").prop("checked"),
    color: getColor($m.find(".rcolor")), pic: newPic || "room.png"
  };
}

// تثبيت الغرفه: بحد "أقصى حد للغرف الثابته" (rooms) — إدارة الغرف بدون حد
function stickyOk(d, rid) {
  // العدد اليومي يتحسب في actions.js (quota)
  if (!d.sticky || S.owner || (rid && S.rooms[rid]?.sticky) || S.perms.roomowner || S.perms.cprooms || (S.perms.rooms || 0) >= 1) return true;
  toast("ليس لديك صلاحيه");
  return false;
}
// صاحب الغرفة أو صاحب صلاحية "إدارة الغرف"
export const canEditRoom = (rid) => !!(rid && S.rooms[rid] && (S.rooms[rid].owner === S.uid || S.perms.roomowner));
export const openRoomEdit = () => { if (canEditRoom(S.room)) openMkr(S.room); };

export function initRooms() {
  const ref = r("rooms");
  onChildAdded(ref, (s) => { upsert(s.key, s.val()); emit("rooms"); });
  onChildChanged(ref, (s) => { upsert(s.key, s.val()); emit("rooms"); });
  onChildRemoved(ref, (s) => {
    delete S.rooms[s.key];
    els[s.key]?.remove(); delete els[s.key];
    sortList();
    emit("rooms");
    if (S.room === s.key) { S.room = null; S.me.room = null; emit("room", null, s.key); join(SITE.defaultRoom); }
  });
  on("users", () => { Object.keys(els).forEach(draw); sortList(); });
  on("room", () => Object.keys(els).forEach(draw));
  // عنوان اللوحة مع عدد الغرف (مثل العنود: "غرف الدردشه: 27")
  const head = () => { if (panelTab() === "rooms") $("#dpnl .pnhead").text(`غرف الدردشه: ${Object.keys(S.rooms).length}`); };
  on("panel", head);
  on("rooms", head);
  // غرفتي تغيّرت من الإدارة: نقل لغرفة ثانية أو طرد من الغرفة
  on("user", (uid, val) => {
    if (uid !== S.uid || !val || !S.inChat) return;
    const rid = val.room || null;
    if (rid === S.room || rid === pending) return;
    const old = S.room;
    S.room = rid; S.me.room = rid;
    emit("room", rid, old);
    if (!rid) {
      toast("تم طردك من الغرفة");
      // مثل العنود: سطر الطرد يطلع عند المطرود نفسه بعد
      $("#d2").append(renderMsg({ t: "k", uid: S.uid, m: "( تم طرد هذا المستخدم من الغرفة )", ts: Date.now(), u: snap() }, {}));
      S.rkick = { rid: old, at: Date.now() };
      autoJoin();
    }
  });
  // كل دقيقة: أي غرفة عامة تلقائية فاضية تنقفل
  setInterval(() => { if (S.inChat) Object.keys(S.rooms).filter(isAutoRoom).forEach(maybeCleanup); }, 60000);

  // زر "غرفه جديدة" يطلع لصاحب صلاحية "انشاء الغرف" بس
  const showMk = () => $("#mkroom").toggle(!!(S.perms && S.perms.createroom));
  showMk();
  on("enter", showMk);
  on("perms", showMk);
  $("#mkroom").on("click", () => {
    if (!(S.perms && S.perms.createroom)) return; // إنشاء الغرف لأصحاب الصلاحية بس (المرحلة 2)
    openMkr(null);
  });
  const $m = $("#mkr");
  $m.find(".rpic").on("click", () => {
    $("#filepick").off("change").val("").one("change", async function () {
      const f = this.files[0];
      if (!f) return;
      try { newPic = await upload(f, "room"); setPic($m.find(".rpic img")[0], newPic); }
      catch (e) { toast(e.message === "type" ? "نوع الملف غير مناسب: \n" + f.type : "فشل إرسال الصوره تأكد ان حجم الصوره مناسب"); }
    }).trigger("click");
  });
  $m.find(".rnopic").on("click", () => { newPic = "room.png"; $m.find(".rpic img").attr("src", "room.png"); });
  $m.find(".rmake").on("click", async () => {
    const d = formData();
    if (!d.topic.trim()) return toast("يرجى إختيار أسم آخر");
    if (!stickyOk(d, null)) return;
    try {
      const rid = await perform("mkroom", d);
      $m.modal("hide");
      // ننتظر وصول الغرفة ثم ندخلها
      const wait = (n) => (S.rooms[rid] ? join(rid) : n > 0 && setTimeout(() => wait(n - 1), 200));
      wait(25);
    } catch (e) { console.error(e); toast(e.msg || "فشل الحفظ"); }
  });
  $m.find(".rsave").on("click", async () => {
    if (!stickyOk(formData(), editing)) return;
    try { await perform("editroom", { rid: editing, ...formData() }); $m.modal("hide"); } // الحفظ مباشر بدون إشعار
    catch (e) { console.error(e); toast(e.msg || "فشل الحفظ"); }
  });
  $m.find(".rdelete").on("click", async () => {
    if (!editing || !window.confirm("تأكيد حذف الغرفه؟")) return;
    try { await perform("delroom", { rid: editing }); $m.modal("hide"); }
    catch (e) { toast("فشل الحفظ"); }
  });
}

// الغرفة الأساسية تنخلق مرة وحدة لو القاعدة فاضية
export async function ensureMainRoom() {
  const s = await get(r("rooms/" + SITE.defaultRoom));
  if (s.exists()) return;
  await set(r("rooms/" + SITE.defaultRoom), {
    topic: "الغرفه العامه ( 1 )", about: "غرفه عامه ..",
    welcome: "يا مرحبا باللي طلته علينا مثل ضي القمر ، سيل المطر ، فوح الزهر .. اهلا بك مليون ، .. نتمنى لك قضاء وقت ممتع معنا",
    pic: "room.png", max: 40, rl: 0, rvl: 0,
    sticky: true, voice: false, color: "#000000", hasPass: false, owner: "", ts: Date.now(), no: 1
  }).catch(() => {});
}
