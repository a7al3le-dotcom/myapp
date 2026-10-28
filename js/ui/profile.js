// ملف العضو + أزرار الإدارة (تظهر حسب الصلاحية مثل العنود)
import { r } from "../firebase.js";
import { S, on, emit, setv } from "../state.js";
import { get, push, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { perform } from "../api/actions.js";
import { setPic } from "../api/images.js";
import { flagSrc, countryName, toast, safeColor, shortNum, tpl, setIco } from "../util.js";
import { prep, waitBlock, needLikes } from "./extras.js";
import { icoOf, rankOf, sortedPowers, above } from "../perms.js";
import { roomCount } from "./rooms.js";
import { SITE } from "../config.js";
import { snap, touch } from "../session.js";
import { openPm } from "./pm.js";
import { noteUser } from "./notify.js";

const $ = window.jQuery;
let cur = null;
const likeCache = {};

async function likesOf(uid) {
  try { return (await get(r("ucount/" + uid))).val() || 0; }
  catch { return 0; }
}

export async function openProfile(uid) {
  const u = S.users[uid];
  if (!u) return;
  // المخفي الأعلى مني ما ينفتح ملفه (مثل العنود)
  if (u.s && uid !== S.uid && rankOf(uid) > S.rank) return;
  cur = uid;
  const $m = $("#upro").data("uid", uid), self = uid === S.uid;
  // العنوان: صورة صغيرة + أيقونة الرتبة + الاسم (مثل العنود)
  const $t = $m.find(".modal-title").empty();
  const $tp = $('<img style="width:18px;height:18px;" alt="">').appendTo($t);
  setPic($tp[0], u.pic);
  const ico = icoOf(uid) || u.ico;
  if (ico) setIco($('<img class="fl u-ico" alt="">').appendTo($t)[0], ico);
  $t.append(document.createTextNode(u.topic || ""));
  $m.find(".pro .u-pic").each(function () { setPic(this, u.pic); });
  $m.find(".u-msg").first().text(u.msg || "").css("color", safeColor(u.mcol, "#333333"));
  // اسم الدولة ثم العلم 24×24 (مثل العنود)
  $m.find(".u-co").empty().text(countryName(u.co))
    .append($('<img style="width:24px;height:24px;border-radius:1px;margin-top:-3px;" class="fl" alt="">').attr("src", flagSrc(u.co)));
  const rm = u.room && S.rooms[u.room];
  const $room = $m.find(".u-room").empty();
  if (rm) {
    // زر الغرفة: صورة الغرفة + "الاسم ( العدد )"
    const $b = $('<div class="fl btn btn-primary dots roomh border" style="padding:0 5px;max-width:180px;"></div>');
    const $ri = $('<img style="max-width:24px;" alt="">').appendTo($b);
    setPic($ri[0], rm.pic || "room.png", "room.png");
    $b.append(document.createTextNode(rm.topic || ""));
    $b.on("click", () => { $m.modal("hide"); emit("rjoin", u.room); }).appendTo($room);
  }
  // ملفك الشخصي نفس أي شخص ثاني (تقدر تعجب بنفسك وترسل لنفسك) مثل العنود
  $m.find(".upm, .unot, .ulike").show();
  $m.find(".ureport").hide(); // العنود ما يعرض التبليغ هنا
  $m.find(".umute").toggle(!S.ignored.has(uid));
  $m.find(".uunmute").toggle(S.ignored.has(uid));
  // لون الضغط يختفي كل ما انفتح الملف من جديد
  $m.find(".ulike, .unot").css("background-color", "");
  $m.find(".ulike").text(likeCache[uid] != null ? shortNum(likeCache[uid]) : "");
  adminBox(uid, u);
  $m.modal("show");
  // الاسم الوهمي (Bots): الإعجابات = رصيده + اللي انضافت له
  const n = (await likesOf(uid)) + (u.bot ? +u.likes || 0 : 0);
  likeCache[uid] = n;
  if (cur === uid) { $m.find(".ulike").text(shortNum(n)); $m.find(".likebox .likec").val(n); }
}

// ===== أزرار الإدارة =====
const P = () => S.perms || {};
function adminBox(uid, u) {
  const $m = $("#upro"), p = P(), self = uid === S.uid;
  const rm = u.room && S.rooms[u.room];
  // طرد من الغرفه + ترقيه مراقب: صاحب الغرفة أو مراقبها أو "إدارة الغرف"
  const roomMod = !!p.roomowner || !!(rm && (rm.owner === S.uid || (rm.ops && rm.ops[S.uid])));
  $m.find(".urkick, .umod").toggle(roomMod);
  // البنر (bnr) والهدايا (upgrades) — على نفسي أو اللي ترتيبه أقل مني
  const canT = self || above(uid);
  $m.find(".ubnr").toggle(!!p.bnr && canT);
  $m.find(".ugift").toggle((p.upgrades || 0) >= 1 && canT);
  $m.find(".uml, .umm, .uma").hide(); // المايك — المرحلة 4
  $m.find(".uh").toggle(!!p.history);
  $m.find(".ukick, .udelpic").toggle((p.kick || 0) >= 1);
  $m.find(".uban").toggle(!!p.ban);
  $m.find(".uh, .uml, .umm, .uma, .umod, .ukick, .udelpic, .urkick, .uban").css("background-color", "");
  // الزخرفه: تغير النكات، أو تغير النك لنفسي
  const nick = !!p.unick || (!!p.mynick && self);
  $m.find(".nickbox").toggle(nick);
  if (nick) $m.find(".nickbox .u-topic").val(u.topic || "");
  $m.find(".likebox").toggle(!!p.setLikes);
  $m.find(".likebox .likec").val("");
  // المجموعه
  $m.find(".powerbox").toggle(!!p.setpower);
  if (p.setpower) { $("#upsearch").val(""); fillPowers(uid); $m.find(".userdays").val(0); }
  // الغرفه (نقل)
  $m.find(".roomzbox").toggle(!!p.rinvite);
  if (p.rinvite) fillRooms();
  // الاسم الوهمي ما عليه أوامر إدارة
  if (u.bot) $m.find(".ubnr, .ugift, .uh, .ukick, .udelpic, .uban, .urkick, .umod, .nickbox, .likebox, .powerbox, .roomzbox").hide();
}

function fillPowers(uid) {
  const q = String($("#upsearch").val() || "").trim();
  const curP = S.upow[uid]?.p || "";
  const $s = $("#upro .userpower").empty().append("<option></option>");
  sortedPowers().filter((x) => !q || String(x.rank) === q || String(x.name || "").includes(q)).forEach((x) => {
    const $o = $(x.rank > S.rank ? "<option disabled></option>" : "<option></option>").attr("value", x.id).text(`[${x.rank}] ${x.name}`);
    if (x.id === curP) $o.css("color", "blue").attr("selected", "true");
    $s.append($o);
  });
}

function fillRooms() {
  const $s = $("#upro .roomz").empty();
  $("#upro .roomzbox .rpwd").val("");
  Object.entries(S.rooms).map(([id, x]) => ({ id, topic: x.topic, n: roomCount(id) }))
    .sort((a, b) => b.n - a.n).forEach((x) => {
      const $o = $("<option></option>").attr("value", x.id).text(`[${String(x.n).padStart(2, "0")}]${x.topic || ""}`);
      if (x.id === S.room) $o.css("color", "blue").attr("selected", "true");
      $s.append($o);
    });
}

// تنفيذ أمر وتلوين الزر (مثل العنود) — close: يقفل الملف
async function run(btn, type, payload, close, noColor) {
  if (!noColor) $(btn).css("background-color", "indianred");
  if (close) $("#upro").modal("hide");
  try { return await perform(type, payload); }
  catch (e) { console.error(e); toast(e.msg || (/permission|PERMISSION/.test(String(e && (e.code || e.message))) ? "ليس لديك صلاحيه" : "فشل الحفظ")); }
}

// كشف النكات: جدول الدخول من نفس الجهاز — زر البحث في الصف يفلتر بنفس الآي بي (ضغطه ثانية = إلغاء)
function showHistory(rows) {
  $("#uh").closest(".bgg").remove();
  const $p = tpl("pop");
  $p.find(".title").html('<i class="fa fa-search"></i> كشف النكات');
  const $b = $p.find(".body").attr("id", "uh").css({ "background-color": "white" });
  const draw = (ip) => {
    $b.empty();
    if (ip) {
      $('<div class="uht-filter-badge"></div>')
        .append($("<span></span>").append('<i class="fa fa-filter"></i> تصفية حسب IP: ', $("<b></b>").text(ip)), '<span class="clear-filter" title="إلغاء التصفية"><i class="fa fa-times"></i> إلغاء</span>')
        .find(".clear-filter").on("click", () => draw("")).end()
        .appendTo($b);
    }
    const list = ip ? rows.filter((x) => x.ip === ip) : rows;
    if (!list.length) return $b.append('<div style="padding:15px;text-align:center;color:#888;">لا يوجد سجل لهذا العضو</div>');
    const $tb = $("<tbody></tbody>");
    list.forEach((x) => {
      const activeFilter = x.ip && x.ip === ip;
      $tb.append(
        $("<tr></tr>").append(
          $('<td style="width:34px;"></td>').append(
            $(`<button class="btn ${activeFilter ? 'btn-success' : 'btn-primary'} uht-search-btn fa fa-search" title="تصفية بهذا الآي بي"></button>`)
              .on("click", () => draw(x.ip === ip ? "" : x.ip))
          ),
          $('<td style="width:62px;white-space:nowrap;"></td>').text(x.ts ? new Date(x.ts).toLocaleTimeString("en-GB") : "--"),
          $('<td class="uht-ip" style="width:110px;"></td>').text(x.ip || "--"),
          $('<td class="dots" style="max-width:80px;"></td>').text(x.t || "--"),
          $('<td style="width:64px;font-weight:bold;"></td>').text(x.un || "***")
        ),
        $('<tr class="uht-fp"></tr>').append($('<td colspan="5"></td>').append(x.fp ? [$('<i class="fa fa-desktop" style="margin-left:4px;color:#999;"></i>'), $("<span></span>").text(x.fp)] : $('<span style="color:#aaa;">--</span>')))
      );
    });
    const $table = $('<table class="uht"></table>').append(
      '<thead><tr><th style="width:34px;">#</th><th style="width:62px;">الوقت</th><th style="width:110px;">IP</th><th style="max-width:80px;">الزخرفه</th><th style="width:64px;">العضو</th></tr></thead>',
      $tb
    );
    $('<div class="uht-wrap"></div>').append($table).appendTo($b);
  };
  draw("");
  $p.find(".pphide").on("click", () => $p.remove());
  $("#room").append($p);
}

function bindAdmin() {
  const $m = $("#upro");
  $m.find(".ukick").on("click", function () { run(this, "kick", { uid: cur }, true); });
  $m.find(".uban").on("click", function () { run(this, "ban", { uid: cur }, true); });
  $m.find(".udelpic").on("click", function () { run(this, "delpic", { uid: cur }); });
  $m.find(".urkick").on("click", function () { run(this, "roomkick", { uid: cur }, true); });
  $m.find(".umod").on("click", function () { run(this, "roomop", { uid: cur }); });
  $m.find(".uh").on("click", async function () {
    const names = await run(this, "history", { uid: cur }, true);
    if (names) showHistory(names);
  });
  $m.find(".u-nickc").on("click", function () {
    const topic = $m.find(".nickbox .u-topic").val().trim();
    if (topic) run(this, "setnick", { uid: cur, topic }, false, true);
  });
  $m.find(".ulikec").on("click", function () {
    run(this, "setlikes", { uid: cur, likes: parseInt($m.find(".likebox .likec").val(), 10) || 0 }, false, true);
  });
  $("#upsearch").on("change input", () => fillPowers(cur));
  $m.find(".upower").on("click", function () {
    run(this, "setpower", { uid: cur, pid: $m.find(".userpower").val() || "", days: parseInt($m.find(".userdays").val(), 10) || 0 }, false, true);
  });
  $m.find(".uroomz").on("click", function () {
    run(this, "move", { uid: cur, rid: $m.find(".roomz").val(), pass: $m.find(".roomzbox .rpwd").val() }, false, true);
  });
}

function saveIgnored() { setv("ign", JSON.stringify([...S.ignored])); }

export function initProfile() {
  try { JSON.parse(localStorage.getItem("al3_ign") || "[]").forEach((x) => S.ignored.add(x)); } catch {}
  on("profile", openProfile);
  const $m = $("#upro");
  bindAdmin();
  $m.find(".upm").on("click", () => { $m.modal("hide"); openPm(cur); });
  $m.find(".unot").on("click", () => {
    if (!S.users[cur]) return;
    $("#mmnot textarea").val("");
    $("#mmnot").data("to", cur).modal("show");
    $("#mmnot textarea").trigger("focus"); // صندوق الكتابة جاهز على طول (مثل العنود)
  });
  $m.find(".ulike").on("click", async function () {
    const uid = cur;
    $(this).css("background-color", "indianred"); // العنود يلوّن الزر فور الضغط
    try {
      if (waitBlock("allowlikes")) return;
    const ok = await perform("likeuser", { uid });
      if (ok) {
        push(r("notif/" + uid), { from: S.uid, k: "like", ts: serverTimestamp(), u: snap(), h: S.me.h || 0 }).catch(() => {});
        // العداد ما يتحدث وهو مفتوح (مثل العنود)، يتحدث لما ينفتح الملف من جديد
      }
    } catch (e) { toast(e.message === "rate" ? "يمكنك ارسال إعجاب مره واحده في الدقيقه" : "فشل الحفظ"); }
  });
  $m.find(".ureport").on("click", async () => {
    const why = window.prompt("سبب التبليغ؟");
    if (why === null) return;
    try { await perform("report", { uid: cur, why }); } catch { toast("فشل الحفظ"); }
  });
  $m.find(".umute").on("click", () => { S.ignored.add(cur); saveIgnored(); emit("ignore"); openProfile(cur); });
  $m.find(".uunmute").on("click", () => { S.ignored.delete(cur); saveIgnored(); emit("ignore"); openProfile(cur); });
  $("#mmnot").on("shown.bs.modal", () => $("#mmnot textarea").trigger("focus"));
  // إرسال تنبيه
  $("#mmnot .rsave").on("click", async () => {
    const to = $("#mmnot").data("to"), raw = $("#mmnot textarea").val().trim().slice(0, 300);
    if (!raw || !to) return;
    if (needLikes(SITE.alertLikes, "التنبيهات تتطلب منك الحصول على N إعجاب")) return $("#mmnot").modal("hide");
    if (waitBlock("nots")) return $("#mmnot").modal("hide");
    // معطّل التنبيهات: مثل الخاص — ما يوصل ويطلع تنبيه باسمه
    const tu = S.users[to];
    if (tu && tu.nn && to !== S.uid) { $("#mmnot").modal("hide"); return noteUser(tu, "هذا المستخدم لا يقبل التنبيهات"); }
    const { text: m, blocked } = prep(raw);
    if (blocked) { $("#mmnot").modal("hide"); if (cur === to) $("#upro .unot").css("background-color", "indianred"); return; }
    try {
      await push(r("notif/" + to), { from: S.uid, k: "alert", m, ts: serverTimestamp(), u: snap(), h: S.me.h || 0 });
      touch();
      $("#mmnot").modal("hide");
      if (cur === to) $("#upro .unot").css("background-color", "indianred");
    } catch { toast("غير متصل"); }
  });
  // كل الهيدرات تقفل النافذة
  $(document).on("click", ".modal .mclose", function () { $(this).closest(".modal").modal("hide"); });
}
