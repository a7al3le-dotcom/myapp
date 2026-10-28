// المحادثات الخاصة: نوافذ cw + قائمة #chats + مؤشر الكتابة
import { r, now } from "../firebase.js";
import { S, on, emit } from "../state.js";
import { SITE } from "../config.js";
import {
  query, limitToLast, push, set, update, remove, onChildAdded, onChildChanged, onValue, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { renderMsg } from "./msg.js";
import { tpl, fillUser, fmt, toast, ago, statSrc } from "../util.js";
import { snap, touch } from "../session.js";
import { pickImage } from "./wall.js";
import { noteUser } from "./notify.js";
import { fixSize, closePanel } from "./panel.js";
import { prep, needLikes, waitBlock } from "./extras.js";

const $ = window.jQuery;
const wins = {};      // uid → { $w, unsubs }
const idx = {};       // uid → بيانات المحادثة من pmidx
const rows = {};      // uid → صف في #chats

export const cidOf = (a, b) => [a, b].sort().join("_");

function userOf(uid) { return S.users[uid] || (idx[uid] && idx[uid].u) || { topic: "؟" }; }

function unreadCount() {
  const n = Object.values(idx).filter((x) => x.un).length;
  // مثل العنود: الرقم + لون النص برتقالي (الخلفية ما تتغير)
  $("#pmb span").first().text(n ? String(n) : "");
  $("#pmb").css("color", n ? "orange" : "");
}

// ===== قائمة المحادثات =====
function drawRow(uid) {
  const x = idx[uid];
  if (!x) return;
  // مثل العنود: صف عضو كامل (uhtml) وآخر رسالة مكان الحالة + زر "حذف"
  if (!rows[uid]) {
    rows[uid] = $('<div style="width:99%;padding:2px;" class="cc noflow nosel hand break"></div>');
  }
  const $row = rows[uid].empty();
  const u = userOf(uid);
  const $h = tpl("uhtml").css("width", "100%");
  fillUser($h, u, { msg: false });
  $h.find(".ustat").attr("src", S.users[uid] ? statSrc(S.users[uid]) : "imgs/s3.png");
  $h.find(".u-msg").addClass("dots").html(fmt(x.last || ""));
  $h.find(".co").remove();
  $h.find(".uhash").text(S.users[uid] ? "#" + (S.users[uid].h || 0) : "");
  $h.on("click", () => { closePanel(); openPm(uid); });
  const $del = $('<div style="margin-top:-30px;margin-right:2px;" class="label border mini label-danger fr fa fa-times">حذف</div>');
  $del.on("click", (e) => { e.stopPropagation(); delChat(uid); });
  $row.append($h).append($del);
  $row.toggleClass("unread", !!x.un).attr("data-uid", uid);
  const $list = $("#chats");
  $list.append($row);
  $list.append($list.children().get().sort((a, b) => (idx[b.dataset.uid]?.ts || 0) - (idx[a.dataset.uid]?.ts || 0)));
}

// حذف المحادثة من قائمتي (الرسائل نفسها تبقى عند الطرف الثاني)
function delChat(uid) {
  remove(r(`pmidx/${S.uid}/${uid}`)).catch(() => {});
  rows[uid]?.remove(); delete rows[uid]; delete idx[uid];
  if (wins[uid]) { wins[uid].unsubs.forEach((f) => f()); wins[uid].$w.remove(); delete wins[uid]; }
  unreadCount();
}

// ===== النوافذ =====
function headFill(uid, $w) {
  const $h = tpl("uhead");
  fillUser($h, userOf(uid), { msg: false });
  $h.find(".ustat").attr("src", S.users[uid] ? statSrc(S.users[uid]) : "imgs/s3.png");
  $h.find(".u-pic").css({ width: "22px", height: "22px" });
  $w.find(".cwhead").empty().append($h);
}

function addMsg($w, m) {
  if (!m) return;
  const $d = $w.find(".d2");
  const $e = renderMsg(m, {});
  $d.append($e);
  $d.scrollTop($d[0].scrollHeight);
}

export function openPm(uid) {
  if (!uid) return; // يجوز تراسل نفسك مثل العنود
  if (S.ignored.has(uid)) return toast("لا يمكنك الدردشه مع شخص قمت بـ تجاهله\nيرجى إلغاء التجاهل");
  Object.values(wins).forEach((w) => w.$w.hide());
  if (wins[uid]) { wins[uid].$w.show(); markRead(uid); scrollEnd(uid); return; }
  const $w = tpl("cw");
  $w.attr("data-uid", uid).appendTo("body");
  const cid = cidOf(S.uid, uid), unsubs = [];
  wins[uid] = { $w, unsubs };
  headFill(uid, $w);
  // الضغط على أي مكان في البنر العلوي يفتح البروفايل (إلا زر التكبير والتصغير) مثل العنود
  $w.find(".head").addClass("hand").on("click", (e) => {
    if ($(e.target).closest(".cwexp, .phide").length) return;
    emit("profile", uid);
  });
  $w.find(".cwexp").on("click", function () {
    $w.css("bottom", $(this).hasClass("fa-expand") ? "114px" : "46%");
    $(this).toggleClass("fa-expand fa-compress");
    fixSize();
  });
  $w.find(".phide").on("click", () => $w.hide());
  const $t = $w.find("textarea");
  const doSend = (extra = {}) => sendPm(uid, $t, extra);
  $w.find(".sndpm").on("click", () => doSend());
  $t.on("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });
  $w.find(".sndfile").on("click", () => { if (!needLikes(SITE.fileslikes, "إرسال الصور يتطلب N إعجاب")) pickImage((img) => doSend({ img })); });
  // مؤشر الكتابة
  let lastTyping = 0;
  const myTyping = r(`typing/${cid}/${S.uid}`);
  $t.on("input", () => {
    if (Date.now() - lastTyping < 2000) return;
    lastTyping = Date.now();
    set(myTyping, serverTimestamp()).catch(() => {});
    onDisconnect(myTyping).remove().catch(() => {});
  });
  let typTimer = null;
  unsubs.push(onValue(r(`typing/${cid}/${uid}`), (s) => {
    const ts = s.val() || 0, fresh = now() - ts < 4000;
    $w.find(".typ").css("display", fresh ? "flex" : "none");
    clearTimeout(typTimer);
    if (fresh) typTimer = setTimeout(() => $w.find(".typ").hide(), 4000);
  }));
  const q = query(r("pm/" + cid), limitToLast(50));
  unsubs.push(onChildAdded(q, (s) => { addMsg($w, s.val()); if ($w.is(":visible")) markRead(uid); }));
  markRead(uid);
}

function scrollEnd(uid) { const d = wins[uid]?.$w.find(".d2")[0]; if (d) d.scrollTop = d.scrollHeight; }

function markRead(uid) {
  if (idx[uid] && idx[uid].un) update(r(`pmidx/${S.uid}/${uid}`), { un: false }).catch(() => {});
}

async function sendPm(uid, $t, extra) {
  const raw = $t.val().trim().slice(0, SITE.msgMax);
  if (!raw && !extra.img) return;
  const other = S.users[uid];
  if (!other) return toast("غير متصل");
  if (needLikes(SITE.pmLikes, "المحادثات الخاصه تتطلب منك الحصول على N إعجاب")) return;
  if (waitBlock("pm")) return;
  const { text, blocked } = prep(raw);
  // كلمة ممنوعه (الفلتر): الرساله تطلع عندك بس
  if (blocked || other.bot) {
    $t.val("");
    return addMsg(wins[uid].$w, { uid: S.uid, m: text, img: extra.img, ts: now(), u: snap() });
  }
  // معطّل الخاص (مثل العنود): الرسالة تطلع عندك بس وما توصله، ويطلع تنبيه باسمه.
  // صاحب صلاحية "فتح الخاص" (forcepm) يتجاوز هذا — المرحلة 2.
  if (other.busy && uid !== S.uid && !(S.perms && S.perms.forcepm)) {
    $t.val("");
    addMsg(wins[uid].$w, { uid: S.uid, m: text, img: extra.img, ts: now(), u: snap() });
    return noteUser(other, "هذا المستخدم لا يقبل المحادثات الخاصه");
  }
  $t.val("");
  const cid = cidOf(S.uid, uid);
  const last = text || "📷";
  try {
    const pk = push(r("pm/" + cid)).key;
    await update(r(), { [`pm/${cid}/${pk}`]: { uid: S.uid, m: text, ts: serverTimestamp(), u: snap(), ...extra }, [`lastmsg/${S.uid}`]: { ts: serverTimestamp() } });
    touch();
    await update(r(), {
      [`pmidx/${uid}/${S.uid}`]: { last, ts: serverTimestamp(), un: true, u: snap() },
      [`pmidx/${S.uid}/${uid}`]: { last, ts: serverTimestamp(), un: false, u: snapOf(other) }
    });
    set(r(`typing/${cid}/${S.uid}`), null).catch(() => {});
  } catch (e) { console.error(e); toast(e && e.code === "PERMISSION_DENIED" ? "أرسل ببطء" : "غير متصل"); $t.val(text); }
}

const snapOf = (u) => ({ topic: u.topic || "", pic: u.pic || "pic.png", ucol: u.ucol || "#000000", mcol: u.mcol || "#000000", bg: u.bg || "#ffffff", ico: u.ico || "" });

export function initPm() {
  on("profile-pm", openPm);
  on("enter", () => {
    const ref = r("pmidx/" + S.uid);
    const got = (s) => {
      const uid = s.key, x = s.val(), old = idx[uid];
      idx[uid] = x;
      if (x.un && wins[uid] && wins[uid].$w.is(":visible")) { markRead(uid); x.un = false; }
      drawRow(uid);
      unreadCount();
      if (x.un && (!old || old.ts !== x.ts)) emit("pmnew", uid);
    };
    onChildAdded(ref, got);
    onChildChanged(ref, got);
  });
  // لون الاتصال في رأس نافذة الخاص يتحدث مع الوقت
  on("stat", () => { for (const id in wins) headFill(id, wins[id].$w); });
  on("user", (uid) => {
    if (wins[uid]) headFill(uid, wins[uid].$w);
    if (rows[uid]) drawRow(uid);
  });
}
