// رسائل الغرفة العامة
import { r, now } from "../firebase.js";
import { S, on, emit } from "../state.js";
import { SITE } from "../config.js";
import {
  query, limitToLast, limitToFirst, orderByKey, startAt, push, set, get, remove, onChildAdded, onChildChanged, onChildRemoved, off, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { perform } from "../api/actions.js";
import { renderMsg, setLikes, localMsg } from "./msg.js";
import { toast } from "../util.js";
import { snap, touch } from "../session.js";
import { roomCount } from "./rooms.js";
import { prep, needLikes } from "./extras.js";

const $ = window.jQuery;
let curQ = null, unsubs = [];

const atBottom = () => { const d = $("#d2")[0]; return d.scrollHeight - d.scrollTop - d.clientHeight < 80; };
const toBottom = () => { const d = $("#d2")[0]; d.scrollTop = d.scrollHeight; };

function add(rid, key, m) {
  if (!m) return;
  const own = m.uid === S.uid;
  const stick = atBottom() || own;
  const $e = renderMsg(m, {
    id: key,
    likes: m.t !== "j", // يظهر/يختفي مباشرة حسب "ﻻيكات العام" (site.js)
    reply: false,
    del: m.t !== "j", // يظهر لصاحب "مسح الرسائل" بس (body.p-dmsg) ويتحدث مباشرة
    onLike: () => perform("likemsg", { rid, mid: key }).catch(() => {}),
    onDel: () => perform("delmsg", { rid, mid: key }).catch(() => toast("فشل الحفظ"))
  });
  if (m.uid) $e.attr("data-uid", m.uid);
  if (m.uid && S.ignored.has(m.uid)) $e.hide();
  // بالترتيب حسب المفتاح (رسالتي المحلية ممكن توصل قبل الرسائل الأقدم)
  let $after = null;
  $("#d2 > .mm[data-id]").each(function () { if (this.dataset.id > key) { $after = $(this); return false; } });
  $after ? $e.insertBefore($after) : $("#d2").append($e);
  const $all = $("#d2 > .mm");
  if ($all.length > SITE.msgKeep) $all.slice(0, $all.length - SITE.msgKeep).remove();
  if (stick) toBottom();
}

function stop() {
  unsubs.forEach((u) => u());
  unsubs = [];
  curQ = null;
}

// العنود ما يعرض رسائل قديمة: تبدأ برسالة دخولك ثم الترحيب ثم الجديد
function start(rid) {
  stop();
  if (!rid) return;
  const ref = r("msgs/" + rid);
  const joinRef = push(ref); // المفتاح يتولد هنا، والاشتراك يبدأ منه
  curQ = query(ref, orderByKey(), startAt(joinRef.key));
  unsubs.push(onChildAdded(curQ, (s) => add(rid, s.key, s.val())));
  unsubs.push(onChildChanged(curQ, (s) => setLikes($(`#d2 > [data-id="${s.key}"]`), s.val().likes)));
  unsubs.push(onChildRemoved(curQ, (s) => $(`#d2 > [data-id="${s.key}"]`).remove()));
  // المخفي ما تطلع له رسالة دخول
  if (!S.me.s) set(joinRef, { t: "j", uid: S.uid, room: rid, rt: ((S.rooms[rid] && S.rooms[rid].topic) || "").slice(0, 40), ts: serverTimestamp(), u: snap() }).catch(() => {});
  const rm = S.rooms[rid];
  if (rm && rm.welcome) {
    const $w = localMsg("╠ ترحيب ╣", rm.welcome, "red", rm.pic);
    const $j = $(`#d2 > [data-id="${joinRef.key}"]`);
    $j.length ? $w.insertAfter($j) : $("#d2").append($w);
  }
}

// نحذف الرسائل الأقدم من يوم (القواعد تسمح لأي أحد يحذف القديم)
async function prune(rid) {
  try {
    const s = await get(query(r("msgs/" + rid), orderByKey(), limitToFirst(10)));
    const limit = now() - 864e5;
    s.forEach((c) => { if ((c.val().ts || 0) < limit) remove(c.ref).catch(() => {}); });
  } catch {}
}

async function send() {
  const $t = $("#tbox"), raw = $t.val().trim().slice(0, SITE.msgMax);
  if (!raw || !S.room) return;
  if (needLikes(SITE.roomMsgLikes, "الكتابه في العام تتطلب N إعجاب")) return;
  $t.val("");
  const { text, blocked } = prep(raw);
  // كلمة ممنوعه (الفلتر): الرساله تطلع عندك بس
  if (blocked) {
    $("#d2").append(renderMsg({ t: "m", uid: S.uid, m: text, ts: now(), u: snap() }, {}));
    return toBottom();
  }
  try {
    await push(r("msgs/" + S.room), { t: "m", uid: S.uid, m: text, ts: serverTimestamp(), u: snap() });
    touch();
    if (Math.random() < 0.1) prune(S.room);
  } catch (e) { console.error(e); toast("غير متصل"); $t.val(text); }
}

export function initChat() {
  $("#tsend").on("click", send);
  $("#tbox").on("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $("#tbox").on("click", () => setTimeout(toBottom, 600));
  on("room", (rid) => start(rid));
  // برا الغرفة: صندوق الكتابة فضي ومقفول (مثل العنود)
  on("room", (rid) => $("#tbox").toggleClass("noroom", !rid).prop("disabled", !rid));
  // التجاهل يخفي رسائل الشخص بدون ما نعيد تحميل الغرفة
  on("ignore", () => $("#d2 > .mm[data-uid]").each(function () { $(this).toggle(!S.ignored.has(this.dataset.uid)); }));
}
