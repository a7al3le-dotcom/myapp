// الحائط + التعليقات (#rpl) + مقاطع يوتيوب
import { r, now } from "../firebase.js";
import { S, on } from "../state.js";
import { SITE } from "../config.js";
import {
  query, limitToLast, limitToFirst, orderByKey, get, remove, push, onChildAdded, onChildChanged, onChildRemoved, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { perform } from "../api/actions.js";
import { upload } from "../api/images.js";
import { search as ytSearch, parseYt, thumb } from "../api/youtube.js";
import { renderMsg, setLikes } from "./msg.js";
import { toast, tint } from "../util.js";
import { snap, touch } from "../session.js";
import { panelTab } from "./panel.js";
import { prep, needLikes, exempt } from "./extras.js";

const $ = window.jQuery;
const msgs = {};
let lastWall = 0;
let unread = 0, started = false, since = Infinity;
let rplBid = null, rplUnsubs = [];

const canDel = (p) => !!(S.perms && S.perms[p]);
const repCount = (m) => (m && m.rep ? Object.keys(m.rep).length : 0);
// عدد التعليقات يطلع على زر التعليق (مثل العنود)
const setRepCount = ($e, m) => $e.find(".breply").first().text(repCount(m) ? String(repCount(m)) : "");

function badge() {
  $("#bwall").text(unread ? String(unread) : "");
  $('#d0 [data-target="#wall"]').css("color", unread ? "orange" : "");
}

function opts(bid, m) {
  return {
    id: bid,
    likes: true, // يظهر/يختفي مباشرة حسب إداره الموقع (site.js)
    reply: true,
    del: true, // صاحب الرسالة يحذفها، والباقي بصلاحية "حذف الحائط" (body.p-delbc) — يتحدث مباشرة
    cls: m.uid === S.uid ? "mine" : "",
    onLike: () => perform("likewall", { bid }).catch(() => {}),
    onReply: () => openReplies(bid),
    onDel: () => perform("delwall", { bid }).catch(() => toast("فشل الحفظ"))
  };
}

function add(bid, m) {
  msgs[bid] = m;
  if (!m || (m.uid && S.ignored.has(m.uid))) return;
  const $e = renderMsg(m, opts(bid, m));
  setRepCount($e, m);
  $e.css("background-color", tint(m.u && m.u.ucol));
  const $box = $("#d2bc");
  const scrolled = $box.scrollTop() > 40;
  $e.insertAfter("#bcmore"); // الأحدث فوق
  const $all = $box.children(".mm");
  if ($all.length > SITE.wallKeep) $all.slice(SITE.wallKeep).remove();
  if ((m.ts || 0) > since && m.uid !== S.uid) {
    if (panelTab() !== "wall") { unread++; badge(); }
    else if (scrolled) $("#bcmore").show();
  }
}

async function send(extra = {}) {
  const $t = $(".tboxbc"), raw = $t.val().trim().slice(0, SITE.msgMax);
  if (!raw && !extra.img && !extra.yt) return;
  if (needLikes(SITE.wall_likes, "الكتابه في الحائط تتطلب N إعجاب")) return;
  // المده بين رسائل الحائط
  const wait = (SITE.wall_minutes || 0) * 60000 - (Date.now() - lastWall);
  if (wait > 0 && !exempt()) return toast(`يمكنك الكتابه في الحائط بعد ${Math.ceil(wait / 60000)} دقيقه`);
  $t.val("");
  const { text, blocked } = prep(raw);
  // كلمة ممنوعه (الفلتر): الرساله تطلع عندك بس
  if (blocked) return $(renderMsg({ uid: S.uid, m: text, ts: now(), u: snap() }, {})).insertAfter("#bcmore");
  lastWall = Date.now();
  try {
    await push(r("wall"), { uid: S.uid, m: text, ts: serverTimestamp(), u: snap(), ...extra });
    touch();
    $("#d2bc").scrollTop(0);
    if (Math.random() < 0.1) prune();
  } catch (e) { console.error(e); toast("غير متصل"); $t.val(text); }
}

// رسائل الحائط الأقدم من أسبوع تنحذف (القواعد تسمح لأي أحد يحذف القديم)
async function prune() {
  try {
    const s = await get(query(r("wall"), orderByKey(), limitToFirst(10)));
    const limit = now() - 7 * 864e5;
    s.forEach((c) => { if ((c.val().ts || 0) < limit) remove(c.ref).catch(() => {}); });
  } catch {}
}

function pickImage(cb) {
  $("#filepick").off("change").val("").one("change", async function () {
    const f = this.files[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast("حجم الملف كبير. ");
    try { cb(await upload(f, "share")); }
    catch (e) { toast(e.message === "type" ? "نوع الملف غير مناسب: \n" + f.type : "فشل إرسال الصوره تأكد ان حجم الصوره مناسب"); }
  }).trigger("click");
}
export { pickImage };

// ===== التعليقات (تنحفظ داخل رسالة الحائط نفسها مثل العنود) =====
function closeReplies() { rplBid = null; }

function drawReplies() {
  const bid = rplBid, m = msgs[bid];
  if (!bid) return;
  if (!m) return $("#rpl").modal("hide");
  const $m = $("#rpl");
  $m.find(".rmsg").empty().append(renderMsg(m, {}));
  const $r = $m.find(".r");
  const atEnd = $r[0].scrollHeight - $r.scrollTop() - $r.innerHeight() < 40;
  $r.empty();
  Object.keys(m.rep || {}).sort().forEach((rid) => {
    const x = m.rep[rid];
    if (!x || S.ignored.has(x.uid)) return;
    const $e = renderMsg(x, {
      id: rid,
      likes: true,
      del: true,
      cls: x.uid === S.uid ? "mine" : "",
      onLike: () => perform("likerep", { bid, rid }).catch(() => {}),
      onDel: () => perform("delwallrep", { bid, rid }).catch(() => toast("فشل الحفظ"))
    });
    $e.css("background-color", tint(x.u && x.u.ucol));
    $r.append($e);
  });
  if (atEnd) $r.scrollTop($r[0].scrollHeight);
}

function openReplies(bid) {
  if (!msgs[bid]) return;
  rplBid = bid;
  $("#rpl .r").empty();
  drawReplies();
  $("#rpl").modal("show");
  setTimeout(() => { const r = $("#rpl .r")[0]; r.scrollTop = r.scrollHeight; }, 300);
}

async function sendReply() {
  const $t = $("#rpl textarea"), raw = $t.val().trim().slice(0, SITE.msgMax);
  if (!raw || !rplBid) return;
  $t.val("");
  const { text, blocked } = prep(raw);
  if (blocked) return $("#rpl .r").append(renderMsg({ uid: S.uid, m: text, ts: now(), u: snap() }, {}));
  try { await push(r(`wall/${rplBid}/rep`), { uid: S.uid, m: text, ts: serverTimestamp(), u: snap() }); touch(); }
  catch (e) { toast("غير متصل"); $t.val(text); }
}

// ===== يوتيوب: بحث (أو لصق رابط) ثم إرسال للحائط =====
const ytMsg = (t, c = "#888") => `<div style="padding:10px;color:${c};text-align:center;">${t}</div>`;
let ytTimer = null, ytSeq = 0;

function ytItem(v) {
  // نتيجة بستايل نوافذ العنود: صف أبيض بحد خفيف (مثل قوائم الشات)
  const $it = $(`<div class="d-flex uzr hand borderg" style="width:100%;gap:6px;background:#fafafa;border-bottom:1px solid lavender;padding:2px;align-items:center;">
      <img style="width:96px;height:54px;object-fit:cover;flex:0 0 auto;" class="borderg" alt="">
      <div style="flex:1;overflow:hidden;text-align:right;"><div class="ytt break" style="color:#333;max-height:42px;"></div><div class="ytc mini dots" style="color:#888;"></div></div>
    </div>`);
  $it.find("img").attr("src", thumb(v.id));
  $it.find(".ytt").text(v.title || "");
  $it.find(".ytc").text(v.ch || "");
  $it.on("click", () => ytPreview(v));
  return $it;
}

// معاينة المقطع قبل الإرسال: يشتغل داخل النافذة + زر إرسال للحائط + رجوع للنتائج
function ytPreview(v) {
  const $res = $("#ytResults");
  const $old = $res.children().detach();
  const $p = $(`<div style="width:100%;">
      <iframe width="100%" height="170" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen style="background:black;"></iframe>
      <div class="break ytt" style="color:#333;padding:2px;"></div>
      <div class="d-flex" style="gap:4px;">
        <button class="btn btn-primary fa fa-send flex-grow-1 ytsend"> ارسل الى الحائط</button>
        <button class="btn btn-danger fa fa-arrow-right ytback"> رجوع</button>
      </div>
    </div>`);
  $p.find("iframe").attr("src", `https://www.youtube.com/embed/${v.id}?autoplay=1`);
  $p.find(".ytt").text(v.title || "");
  $p.find(".ytsend").on("click", () => { $("#ytModal").modal("hide"); $res.empty(); send({ yt: v.id }); });
  $p.find(".ytback").on("click", () => { $p.remove(); $res.append($old); });
  $res.empty().append($p);
}

function ytRender() {
  const q = $("#ytSearchInput").val().trim();
  const $res = $("#ytResults");
  clearTimeout(ytTimer);
  if (!q) return $res.empty();
  const id = parseYt(q);
  if (id) return $res.empty().append(ytItem({ id, title: "ارسل المقطع الى الحائط", ch: "" }));
  ytTimer = setTimeout(async () => {
    const seq = ++ytSeq;
    $res.html(ytMsg("...جاري البحث"));
    try {
      const list = await ytSearch(q);
      if (seq !== ytSeq) return;
      $res.empty();
      if (!list.length) return $res.html(ytMsg("لا توجد نتائج"));
      list.forEach((v) => $res.append(ytItem(v)));
    } catch {
      if (seq === ytSeq) $res.html(ytMsg("فشل البحث في اليوتيوب", "indianred"));
    }
  }, 600);
}

export function initWall() {
  $(".sndbc").on("click", () => send());
  $(".tboxbc").on("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $(".sndfilebc").on("click", () => { if (!needLikes(SITE.fileslikes, "إرسال الصور تتطلب N إعجاب")) pickImage((img) => send({ img })); });
  $("#bcmore").on("click", function () { $("#d2bc").scrollTop(0); $(this).hide(); });
  $("#d2bc").on("scroll", function () { if (this.scrollTop < 20) $("#bcmore").hide(); });
  $("#ytSearchBtn").on("click", () => {
    if (needLikes(SITE.fileslikes, "إرسال الفيديو تتطلب N إعجاب")) return;
    $("#ytSearchInput").val(""); $("#ytResults").empty();
    // تنفتح فوق نافذة الحائط (اللوحة الجانبية) بدال وسط الشاشة
    const o = $("#dpnl")[0].getBoundingClientRect(), w = 310;
    const left = Math.max(0, Math.min(window.innerWidth - w, o.left + (o.width - w) / 2));
    $("#ytModal .modal-dialog").css({ position: "absolute", margin: 0, width: w, top: o.top + 32, left });
    $("#ytModal").modal("show");
    $("#ytSearchInput").trigger("focus"); // الكتابة على طول
  });
  $("#ytModal").on("shown.bs.modal", () => $("#ytSearchInput").trigger("focus"));
  $("#ytModal").on("hidden.bs.modal", () => $("#ytResults iframe").remove());
  $("#ytSearchInput").on("input", ytRender).on("keydown", (e) => { if (e.key === "Enter") ytRender(); });
  $("#rpl .sndrpl").on("click", sendReply);
  $("#rpl textarea").on("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } });
  $("#rpl").on("hidden.bs.modal", closeReplies);
  on("panel", (tab) => { if (tab === "wall") { unread = 0; badge(); } });
  on("enter", () => {
    if (started) return;
    started = true;
    since = now();
    const q = query(r("wall"), limitToLast(SITE.wallKeep));
    onChildAdded(q, (s) => add(s.key, s.val()));
    onChildChanged(q, (s) => {
      msgs[s.key] = s.val();
      const $e = $(`#d2bc > [data-id="${s.key}"]`);
      setLikes($e, s.val().likes);
      setRepCount($e, s.val());
      if (rplBid === s.key) drawReplies();
    });
    onChildRemoved(q, (s) => { delete msgs[s.key]; $(`#d2bc > [data-id="${s.key}"]`).remove(); if (rplBid === s.key) $("#rpl").modal("hide"); });
  });
  on("ignore", () => {
    $("#d2bc > .mm").remove();
    Object.keys(msgs).sort().forEach((k) => msgs[k] && add(k, msgs[k]));
  });
}
