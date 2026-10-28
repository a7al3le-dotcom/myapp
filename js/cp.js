// لوحة التحكم (شكل العنود): تنفتح من الشات (window.opener) وتستخدم اتصاله وصلاحياته.
// القراءة من AL3.read/listen، وكل أمر يمر من AL3.perform (actions.js). الحفظ مباشر بدون إشعار.
import { initColors, getColor, setColor } from "./ui/colors.js";
const $ = window.jQuery;
const host = () => { try { return (window.opener && window.opener.AL3 && window.opener) || (window.parent !== window && window.parent.AL3 && window.parent) || null; } catch { return null; } };
const A = host()?.AL3 || null;
if (!A || !A.S.inChat) location.href = "./"; // مثل العنود: بدون نافذة الشات ترجع للصفحة الرئيسية
const S = A ? A.S : {};
const P = () => S.perms || {};

const fail = (e) => {
  console.error(e);
  const c = String((e && (e.code || e.message)) || "");
  window.alert(c === "blaze" ? "تغيير كلمة المرور يحتاج تفعيل Blaze" : /permission|PERMISSION/.test(c) ? "ليس لديك صلاحيه" : "فشل الحفظ");
};
const run = (type, payload) => A.perform(type, payload).catch(fail);

// ===== أدوات الجداول =====
function table(heads, widths) {
  const $t = $('<table class="tablesorter"><thead><tr></tr></thead><tbody></tbody></table>');
  // مثل العنود: رأس العمود بدون عرض ثابت، والخلايا لها حد أقصى بس (العمود يضيق حسب محتواه)
  heads.forEach((h) => $('<th class="border header"></th>').text(h).appendTo($t.find("tr")));
  $t.data("w", widths).data("h", heads).addClass("cptbl");
  // سطح المكتب: عرض الجدول = مجموع الأعمدة (CSS يقرأ --tw/--cw، والجوال يتجاهلها)
  $t.css("--tw", widths.reduce((a, b) => a + b, 0) + "px");
  $t.find("th").each((i, th) => th.style.setProperty("--cw", (widths[i] || 80) + "px"));
  return $t;
}
function row($t, cells) {
  const $r = $("<tr></tr>");
  const w = $t.data("w") || [], hd = $t.data("h") || [];
  cells.forEach((c, i) => $("<td></td>").attr("data-label", hd[i] || "").css("max-width", (w[i] || 80) + "px").append(c instanceof $ ? c : document.createTextNode(c ?? "")).appendTo($r));
  $t.find("tbody").append($r);
}
const stripe = ($t) => $t.find("tbody tr").each((i, tr) => $(tr).css("background-color", i % 2 ? "#fafaff" : "#fffafa"));
const pad = (n) => String(n).padStart(2, "0");
// مدة منذ: 00:04:31 (مثل العنود)
const el = (ts) => {
  if (!ts) return "--";
  const d = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  return `${pad(Math.floor(d / 3600))}:${pad(Math.floor(d / 60) % 60)}:${pad(d % 60)}`;
};
// الباقي على انتهاء الحظر المؤقت: 00:19:30
const hms3 = (ms) => { ms = Math.max(0, ms); const d = Math.floor(ms / 1000); return `${pad(Math.floor(d / 3600))}:${pad(Math.floor(d / 60) % 60)}:${pad(d % 60)}:${String(ms % 1000).padStart(3, "0")}`; };
const left = (ts) => hms3(ts - Date.now());
const ymd = (ts) => { if (!ts) return ""; const d = new Date(ts); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const num = (n) => Number(n || 0).toLocaleString("en-US");
const byTs = (o) => Object.entries(o || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.ts || 0) - (a.ts || 0));
const pad4 = (n) => String(n).padStart(4, "0");

// ===== قائمة منبثقة (أزرار تحت بعض) مثل العنود =====
function menu(btn, items) {
  $(".cpmenu").remove();
  const $m = $('<div class="border bg cpmenu"></div>');
  items.forEach((it) => {
    if (it === "-") return $m.append('<button class="btn btn-primary" disabled>-----</button>');
    $('<button class="btn btn-primary"></button>').text(it.t).on("click", (e) => { e.stopPropagation(); $m.remove(); it.f(); }).appendTo($m);
  });
  // ثابتة على الشاشة تحت الزر (اللوحة مصغّرة 95% مثل العنود، فالحساب من مكان الزر الظاهر)
  const b = btn.getBoundingClientRect();
  $("body").append($m);
  const w = $m.outerWidth();
  $m.css({ top: b.bottom, left: Math.max(0, Math.min(window.innerWidth - w, b.right - w)) });
  setTimeout(() => $(document).one("click", () => $m.remove()), 0);
  $("#cp").one("scroll", () => $m.remove());
  return $m;
}

// قائمة البحث/الحظر لبصمة جهاز (السجل والأعضاء)
function fpMenu(btn, fp, who) {
  const lv = (n) => (n ? " عميق " + n : "");
  const items = [];
  for (let n = 0; n <= 4; n++) items.push({ t: "بحث" + lv(n), f: () => { openTab("fps"); fps.search(A.fpShow(fp, n)); } });
  for (let n = 0; n <= 4; n++) items.push({ t: "حظر" + lv(n), f: () => run("ban_add", { v: A.fpShow(fp, n), u: who }) });
  items.push({ t: "سماح", f: () => run("ban_add", { v: fp, u: who, allow: true }) });
  menu(btn, items);
}

// قائمة الترس (إدارة العضويات): الايكات، كلمه المرور، الصلاحيه، حذف العضويه
function userMenu(btn, uid, name) {
  menu(btn, [
    { t: "الايكات", f: () => { const v = window.prompt("اكتب الايكات الجديده"); if (v !== null && v.trim() !== "") run("setlikes", { uid, likes: v }).then(reloadUsers); } },
    { t: "كلمه المرور", f: () => { const v = window.prompt("كلمه المرور الجديدة"); if (v) run("setpass", { uid, pass: v }); } },
    { t: "الصلاحيه", f: () => powerMenu(btn, uid, "") },
    "-",
    { t: "حذف العضويه", f: () => { if (window.confirm(`حذف العضويه؟\n${name || ""}`)) run("deluser", { uid }).then(reloadUsers); } }
  ]);
}
function powerMenu(btn, uid, q) {
  const list = A.sortedPowers().filter((x) => !q || String(x.rank) === q || String(x.name || "").includes(q));
  menu(btn, [
    { t: "سحب الصلاحيه", f: () => run("setpower", { uid, pid: "" }).then(reloadUsers) },
    { t: "البحث", f: () => { const v = window.prompt("البحث"); if (v !== null) setTimeout(() => powerMenu(btn, uid, v.trim()), 0); } },
    ...list.map((x) => ({
      t: `[${pad4(x.rank)}] ${x.name}`,
      f: () => { const d = window.prompt("مده الإشتراك؟ 0 = دائم", "0"); if (d !== null) run("setpower", { uid, pid: x.id, days: parseInt(d, 10) || 0 }).then(reloadUsers); }
    }))
  ]);
}
const searchBtn = (fp, who) => $('<a class="btn btn-primary fa fa-search"></a>').on("click", function (e) { e.stopPropagation(); if (fp) fpMenu(this, fp, who); });
const gearBtn = (uid, name) => $('<a class="btn btn-danger fa fa-gear"></a>').on("click", function (e) { e.stopPropagation(); userMenu(this, uid, name); });

// ===== جداول بصفحات (السجل، الحالات، الأعضاء) =====
function paged(id, step, load, render, match) {
  const $p = $("#" + id);
  let i = 0, rows = [];
  async function show(reload) {
    if (reload) { try { rows = (await load()) || []; } catch (e) { rows = []; fail(e); } }
    const q = String($p.find(".tbar input").val() || "").trim();
    const list = q ? rows.filter((x) => match(x, q)) : rows;
    if (i >= list.length) i = Math.max(0, Math.floor((list.length - 1) / step) * step);
    $p.find(".tablesorter").remove();
    const $t = render(list.slice(i, i + step));
    stripe($t);
    $p.append($t);
    $p.find(".fa-arrow-left").text(String(Math.max(0, i))).prop("disabled", i <= 0);
    $p.find(".fa-arrow-right").text(String(i + step)).prop("disabled", i + step >= list.length);
  }
  $p.find(".tbar input").on("keydown", (e) => { if (e.key === "Enter") { i = 0; show(false); } });
  $p.find(".fa-arrow-left").on("click", () => { i = Math.max(0, i - step); show(false); });
  $p.find(".fa-arrow-right").on("click", () => { i += step; show(false); });
  return { show, search(q) { $p.find(".tbar input").val(q); i = 0; show(!rows.length); } };
}
// البحث: نص عادي، أو بصمة جهاز ("**=Win32|...") تطابق بالمستوى (البحث العميق)
function fpMatch(fp, q) {
  if (!String(q).includes("|")) return false;
  const { level, fp: f } = A.fpParse(q);
  const k = A.fpKey(f, level);
  return !!k && A.fpKey(fp, level) === k;
}
const textMatch = (q, ...v) => { q = q.toLowerCase(); return v.some((x) => String(x ?? "").toLowerCase().includes(q)); };

// السجل: كل دخول
const fps = paged("fps", 200, async () => byTs(await A.read("fps", 5000)),
  (list) => {
    const $t = table("الحاله,العضو,الزخرفه,الآي بي,الدوله,الجهاز,المصدر,الدعوه,الوقت,".split(","), [37, 54, 114, 114, 38, 184, 104, 41, 54, 25]);
    list.forEach((x) => row($t, [x.st, x.un, x.t, x.ip, String(x.co || "").toUpperCase(), x.fp, x.refr, x.r, el(x.ts), searchBtn(x.fp, x.t)]));
    return $t;
  },
  (x, q) => (q.includes("|") ? fpMatch(x.fp, q) : textMatch(q, x.st, x.un, x.t, x.ip, x.co, x.fp, x.refr)));

// الحالات
const acts = paged("actions", 200, async () => byTs(await A.read("acts", 5000)),
  (list) => {
    const $t = table(["الحاله", "العضو", "العضو الثاني", "الغرفه", "الاي بي", "الوقت"], [69, 124, 219, 124, 124, 73]);
    list.forEach((x) => row($t, [x.type, x.u1, x.u2, x.room, x.ip, el(x.ts)]));
    return $t;
  },
  (x, q) => textMatch(q, x.type, x.u1, x.u2, x.room, x.ip));

// الأعضاء
const activeSub = (x) => !!(x && S.powers[x.p] && (!x.until || x.until > Date.now()));
const powerName = (uid) => { const x = S.upow[uid]; return activeSub(x) ? S.powers[x.p].name : ""; };
let usersCache = null;
async function loadUsers() {
  const [users, prv, cnt] = await Promise.all([A.read("users"), A.read("uprv"), A.read("ucount")]);
  usersCache = { users: users || {}, prv: prv || {}, cnt: cnt || {} };
  return usersCache;
}
const logins = paged("logins", 100, async () => {
  const { users, prv, cnt } = await loadUsers();
  return Object.entries(users).map(([uid, u]) => {
    const p = prv[uid] || {};
    return { uid, name: u.name, topic: u.topic, ip: p.ip, fp: p.fp, power: powerName(uid), likes: cnt[uid] || 0, ls: S.users[uid] && !S.users[uid].off ? Date.now() : p.ls, reg: u.reg };
  }).sort((a, b) => (b.ls || 0) - (a.ls || 0));
}, (list) => {
  const $t = table(["العضو", "الزخرفه", "الآي بي", "الجهاز", "صلاحيات", "لايكات", "آخر تواجد", "التسجيل", ""], [66, 106, 114, 184, 54, 41, 67, 67, 74]);
  list.forEach((x) => {
    const $b = $('<div class="d-flex"></div>').append(searchBtn(x.fp, x.topic));
    if (P().edituser) $b.append(gearBtn(x.uid, x.name));
    row($t, [x.name, x.topic, x.ip, x.fp, x.power, num(x.likes), el(x.ls), ymd(x.reg), $b]);
  });
  return $t;
}, (x, q) => (q.includes("|") ? fpMatch(x.fp, q) : textMatch(q, x.name, x.topic, x.ip, x.fp)));
function reloadUsers() { if (loaded.logins) logins.show(true); if (loaded.subs) drawSubs(); }

// ===== الحظر =====
let bansData = {};
function drawBans() {
  const $p = $("#bans");
  $p.find(".tablesorter").remove();
  const $t = table(["العضو", "الحظر", "ينتهي في", "الحالات", "آخر حاله", ""], [40, 181, 53, 44, 88, 73]);
  byTs(bansData).forEach((x) => {
    const $b = $('<div class="d-flex"></div>')
      .append($('<a class="btn btn-danger fa fa-times"></a>').on("click", () => run("unban", { id: x.id })))
      .append($('<a class="btn btn-info fa fa-search"></a>').on("click", () => {
        openTab("fps");
        fps.search(/^f[0-4]$/.test(x.k) ? x.v : x.k === "c" ? x.v : x.v);
      }));
    row($t, [x.u, x.k === "c" ? String(x.v).toUpperCase() : x.v, x.a ? "سماح" : !x.until ? "دائم" : x.until > Date.now() ? left(x.until) : "منتهي", String(x.n || 0), x.la ? hms3(Date.now() - x.la) : "--", $b]);
  });
  stripe($t);
  $p.append($t);
}
function banInput(allow) {
  const v = $("#bans .banv").val().trim();
  if (!v) return;
  run("ban_add", { v, allow }).then(() => $("#bans .banv").val(""));
}
$("#bans .bandd").on("click", () => banInput(false));
$("#bans .unbandd").on("click", () => banInput(true));

// ===== الصلاحيات =====
let curPid = null;
function fillPlist() {
  const q = String($("#powers .psearch").val() || "").trim();
  const $s = $("#powers .plist").empty();
  const list = A.sortedPowers().filter((x) => !q || String(x.rank) === q || String(x.name || "").includes(q));
  if (!list.length || !curPid) $s.append('<option value=""></option>');
  list.forEach((x) => {
    const $o = $("<option></option>").attr("value", x.id).text(`[${pad4(x.rank)}] ${x.name}`);
    if (x.id === curPid) $o.attr("selected", "true");
    $s.append($o);
  });
}
// نفس نموذج العنود: label-primary ثم الحقل ثم <br> — الرقم عرضه 60، والاختيار "تفعيل" + مربع
function buildForm() {
  const $f = $("#powers .pform").empty();
  const $in = $('<div style="width:100%;height:100%;padding:5px;" class="break"></div>').appendTo($f);
  A.POWER_FIELDS.forEach(([k, label, t]) => {
    $in.append($('<label class="label label-primary"></label>').text(label));
    if (t === "n") $in.append($('<input type="number" style="width:60px;">').attr({ name: k, "data-k": k }));
    else if (t === "s") $in.append($('<input type="text">').attr({ name: k, "data-k": k }));
    else $in.append($("<label>تفعيل</label>").append($('<input type="checkbox">').attr({ name: k, "data-k": k })));
    $in.append("<br>");
  });
  $in.append('<button class="btn btn-primary fr fa fa-edit psave">حفظ</button>');
  const $g = $("#powers .sicobox").empty();
  A.SICO.forEach((n) => $('<img alt="">').attr({ src: "sico/" + n, "data-n": n }).on("click", function () {
    $f.find('[data-k="ico"]').val(n);
    $g.find("img").removeClass("unread border");
    $(this).addClass("unread border");
  }).appendTo($g));
}
function loadForm(pid) {
  curPid = pid || null;
  const p = (pid && S.powers[pid]) || {};
  const $f = $("#powers .pform");
  A.POWER_FIELDS.forEach(([k, , t]) => {
    const $i = $f.find(`[data-k="${k}"]`);
    if (t === "n") $i.val(p[k] ?? 0);
    else if (t === "s") $i.val(p[k] ?? "");
    else $i.prop("checked", p[k] === true);
  });
  $("#powers .sicobox img").removeClass("unread border").filter(`[data-n="${p.ico || ""}"]`).addClass("unread border");
}
$("#powers .psearch").on("input change", fillPlist);
$("#powers .plist").on("change", function () { loadForm(this.value); });
$("#powers").on("click", ".psave", async () => {
  const data = {};
  A.POWER_FIELDS.forEach(([k, , t]) => {
    const $i = $(`#powers .pform [data-k="${k}"]`);
    data[k] = t === "n" ? parseInt($i.val(), 10) || 0 : t === "s" ? String($i.val() || "").trim() : $i.prop("checked");
  });
  if (!data.name) return;
  // نفس الاسم = تعديل، اسم جديد = مجموعة جديدة. الحفظ مباشر بدون إشعار
  const same = Object.entries(S.powers).find(([, x]) => x.name === data.name);
  try { curPid = await A.perform("powers_save", { pid: same ? same[0] : null, data }); fillPlist(); } catch (e) { fail(e); }
});
$("#powers .pdel").on("click", async () => {
  const pid = $("#powers .plist").val();
  if (!pid) return;
  try { await A.perform("powers_del", { pid }); curPid = null; fillPlist(); loadForm(null); } catch (e) { fail(e); }
});

// ===== الإشتراكات =====
async function drawSubs() {
  const $p = $("#subs");
  let c = usersCache;
  try { c = await loadUsers(); } catch {}
  const users = c?.users || {}, prv = c?.prv || {};
  $p.find(".tablesorter").remove();
  const $t = table(["الإشتراك", "العضو", "الزخرفه", "المده", "المتبقي", "آخر تواجد", ""], [122, 70, 114, 33, 44, 57, 72]);
  Object.entries(S.upow || {}).map(([uid, x]) => ({ uid, ...x }))
    .sort((a, b) => (S.powers[b.p]?.rank || 0) - (S.powers[a.p]?.rank || 0))
    .forEach((x) => {
      const u = users[x.uid] || {}, on = S.users[x.uid], pw = S.powers[x.p];
      const days = x.until ? Math.max(1, Math.round((x.until - (x.ts || x.until)) / 864e5)) : 0;
      const left = x.until ? (x.until > Date.now() ? Math.ceil((x.until - Date.now()) / 864e5) : "منتهي") : "";
      const $b = $('<div class="c-flex"></div>')
        .append($('<a class="btn btn-primary fa fa-times"></a>').on("click", () => run("setpower", { uid: x.uid, pid: "" }).then(reloadUsers)));
      if (P().edituser) $b.append(gearBtn(x.uid, u.name));
      row($t, [pw ? `[${pad4(pw.rank)}] ${pw.name}` : "--", u.name || "", on?.topic || u.topic || x.t || "", days ? String(days) : "دائم", String(left), on && !on.off ? "00:00:00" : el(prv[x.uid]?.ls), $b]);
    });
  stripe($t);
  $p.append($t);
}

// ===================== المرحلة 3 =====================
const xBtn = (f) => $('<a class="btn btn-danger fa fa-times xbtn"></a>').on("click", (e) => { e.stopPropagation(); f(); });
const live = {}; // اشتراكات تبويبات المرحلة 3 (مرة وحدة لكل تبويب)
const listen = (k, path, cb) => { if (!live[k]) live[k] = A.listen(path, cb); };
// اختيار صورة ورفعها (نفس بوابة الصور في الشات)
function pick(kind, cb) {
  $("#filepick").off("change").val("").one("change", async function () {
    const f = this.files[0];
    if (!f) return;
    try { cb(await A.upload(f, kind)); } catch (e) { fail(e); }
  }).trigger("click");
}
// عرض صورة (db: أو ملف)
const showPic = (img, v, fb) => { A.picUrl(v || fb).then((u) => { img.src = u; }); };

// ===== فلتر =====
const FT = { a: "مسموحه", b: "ممنوعه", m: "مراقبه" };
let fltData = {};
function drawFltr() {
  const $p = $("#fltr");
  $p.find(".tablesorter").remove();
  const $t = table(["التصنيف", "الكلمه", "حذف"], [61, 49, 36]);
  byTs(fltData).forEach((x) => row($t, [FT[x.t] || x.t, x.w, xBtn(() => run("filter_del", { id: x.id }))]));
  stripe($t);
  $p.append($t);
}
// سجل الكلمات: جدول مضغوط + بحث + الكل/ممنوعه/مراقبه + عداد المخالفات + أزرار سريعة (بحث/حظر/طرد)
let fltLog = {}, fltQ = "", fltK = "";
const cell = (t) => $('<span class="hand"></span>').text(t || "").on("click", () => { fltQ = t || ""; $("#fltr .fltq").val(fltQ); drawFltred(); });
function drawFltred(v) {
  if (v) fltLog = v;
  const $b = $("#fltred").empty();
  const all = byTs(fltLog);
  // العداد: كم مرة تكررت من نفس الشخص (الرقم أو الاسم)
  const cnt = {};
  all.forEach((x) => { const k = x.uid || x.u; cnt[k] = (cnt[k] || 0) + 1; });
  const q = fltQ.trim().toLowerCase();
  const list = all.filter((x) => (!fltK || x.k === fltK) && (!q || [x.w, x.m, x.u, x.ip].some((s) => String(s || "").toLowerCase().includes(q))))
    .sort((a, b) => (cnt[b.uid || b.u] - cnt[a.uid || a.u]) || ((b.ts || 0) - (a.ts || 0)));
  const $t = table(["", "العدد", "الكلمه", "الرساله", "العضو", "الآي بي", "التصنيف", "الوقت", ""], [30, 40, 120, 260, 100, 120, 60, 70, 90]);
  list.slice(0, 200).forEach((x) => {
    const $btn = $('<div class="d-flex"></div>').append(searchBtn(x.fp, x.u));
    // طرد سريع لو متصل الحين
    if (S.users[x.uid] && !S.users[x.uid].off) $('<a class="btn btn-danger fa fa-ban" title="طرد"></a>').on("click", () => { if (window.confirm("طرد " + (x.u || "") + "؟")) run("kick", { uid: x.uid }); }).appendTo($btn);
    row($t, [xBtn(() => run("fltlog_del", { id: x.id })), String(cnt[x.uid || x.u]), cell(x.w), x.m, cell(x.u), cell(x.ip), x.k === "m" ? "مراقبه" : "ممنوعه", el(x.ts), $btn]);
  });
  stripe($t);
  $b.append($t);
}
$("#fltr .fltq").on("input", function () { fltQ = this.value; drawFltred(); });
$("#fltr .fltt").on("click", function () { fltK = this.dataset.k; $("#fltr .fltt").removeClass("active").css("outline", ""); $(this).addClass("active").css("outline", "2px solid black"); drawFltred(); });

// ===== التفريغ والصيانه (المالك) =====
$("#sett .wipe").on("click", function () {
  if (!window.confirm("تأكيد: " + $(this).text() + "؟\nما يمكن استرجاعه")) return;
  run("wipe", { what: this.dataset.w });
});
$("#sett .cleanup").on("click", async () => {
  $("#sett .cleanres").text("...");
  try {
    const o = await A.perform("cleanup");
    $("#sett .cleanres").text(`أسماء معلّقة ${o.ghosts} · حظر منتهي ${o.bans} · اشتراكات منتهية ${o.subs} · رسائل غرف ${o.msgs} · حائط ${o.wall} · غرف فاضيه ${o.rooms} · صور قديمه ${o.pics || 0}`);
  } catch (e) { $("#sett .cleanres").text(""); fail(e); }
});
$("#fltr .stack").on("click", function () {
  const w = $("#fltr .fltrit").val().trim();
  if (!w) return;
  run("filter_add", { w, t: this.dataset.t }).then(() => $("#fltr .fltrit").val(""));
});

// ===== الغرف =====
function fillEntry() {
  const e = entryData || {};
  const $s = $("#entry_room_select").empty();
  Object.entries(S.rooms).sort(([, a], [, b]) => (a.no || 0) - (b.no || 0)).forEach(([id, x]) => {
    $("<option></option>").attr("value", id).text(x.topic || id).appendTo($s);
  });
  const fixed = e.mode === "fixed";
  $(fixed ? "#entry_mode_fixed" : "#entry_mode_auto").prop("checked", true);
  $s.prop("disabled", !fixed);
  if (fixed) $s.val(e.rid);
}
let entryData = {};
$("input[name=entry_room_mode]").on("change", () => $("#entry_room_select").prop("disabled", !$("#entry_mode_fixed").prop("checked")));
$("#entry_room_save_btn").on("click", () => {
  const fixed = $("#entry_mode_fixed").prop("checked");
  run("entry_save", fixed ? { mode: "fixed", rid: $("#entry_room_select").val() } : { mode: "auto" });
});
function drawRooms() {
  const $p = $("#cp_rooms");
  $p.find(".tablesorter").remove();
  const $t = table(["الغرفه", "صاحب الغرفه", "اعدادات"], [119, 74, 79]);
  const names = usersCache?.users || {};
  Object.entries(S.rooms).sort(([, a], [, b]) => (a.no || 0) - (b.no || 0)).forEach(([id, x]) => {
    const $c = $('<div class="d-flex"></div>');
    $('<a class="btn btn-info fa fa-gear"></a>').on("click", () => openMkr(id)).appendTo($c);
    const $i = $('<img style="width:40px;height:40px;object-fit:cover;" alt="">').appendTo($c);
    showPic($i[0], x.pic, "room.png");
    const own = x.owner ? (S.users[x.owner]?.topic || names[x.owner]?.topic || x.owner) : "";
    row($t, [`${x.topic || ""} (${A.roomCount(id)}/${x.max || 40})`, own, $c]);
  });
  stripe($t);
  $p.append($t);
}
// نافذة إداره الغرفه (نفس حقول الشات)
let mkrId = null, mkrPic = null;
function openMkr(id) {
  const rm = S.rooms[id];
  if (!rm) return;
  mkrId = id; mkrPic = rm.pic || "room.png";
  const $m = $("#mkr");
  $m.find(".rtopic").val(rm.topic || "");
  $m.find(".rabout").val(rm.about || "");
  $m.find(".rwelcome").val(rm.welcome || "");
  $m.find(".rpwd").val("").attr("placeholder", rm.hasPass ? "كلمه المرور (بدون تغيير)" : "كلمه المرور");
  $m.find(".rmax").val(rm.max || 40);
  $m.find(".rl").val(rm.rl || "");
  $m.find(".rvl").val(rm.rvl || "");
  $m.find(".rdel").prop("checked", !!rm.sticky);
  $m.find(".rv").prop("checked", !!rm.voice);
  setColor($m.find(".rcolor"), rm.color || "#000000");
  showPic($m.find(".rpic img")[0], mkrPic, "room.png");
  $m.find(".rdelete").toggle(id !== "main");
  $m.modal("show");
}
$("#mkr .rpic").on("click", () => pick("room", (v) => { mkrPic = v; showPic($("#mkr .rpic img")[0], v, "room.png"); }));
$("#mkr .rnopic").on("click", () => { mkrPic = "room.png"; showPic($("#mkr .rpic img")[0], "room.png"); });
$("#mkr .mclose").on("click", () => $("#mkr").modal("hide"));
$("#mkr .rsave").on("click", () => {
  const $m = $("#mkr");
  run("editroom", {
    rid: mkrId, topic: $m.find(".rtopic").val(), about: $m.find(".rabout").val(), welcome: $m.find(".rwelcome").val(),
    pass: $m.find(".rpwd").val(), max: $m.find(".rmax").val() || 40, rl: $m.find(".rl").val(), rvl: $m.find(".rvl").val(),
    sticky: $m.find(".rdel").prop("checked"), voice: $m.find(".rv").prop("checked"), color: getColor($m.find(".rcolor")), pic: mkrPic
  }).then(() => { $m.modal("hide"); setTimeout(drawRooms, 300); });
});
$("#mkr .rdelete").on("click", () => {
  if (!mkrId || !window.confirm("تأكيد حذف الغرفه؟")) return;
  run("delroom", { rid: mkrId }).then(() => { $("#mkr").modal("hide"); setTimeout(drawRooms, 300); });
});

// ===== الإختصارات =====
let shrtData = {};
function drawShrt() {
  const $p = $("#shrt");
  $p.find(".tablesorter").remove();
  const $t = table(["الإختصار", "الزخرفه", "حذف"], [53, 380, 36]);
  byTs(shrtData).forEach((x) => row($t, [x.k, x.v, xBtn(() => run("shrt_del", { id: x.id }))]));
  stripe($t);
  $p.append($t);
}
$("#shrt .shrtadd").on("click", () => {
  const k = $("#shrt .shrtname").val().trim(), v = $("#shrt .shrtvalue").val().trim();
  if (!k || !v) return;
  run("shrt_add", { k, v }).then(() => $("#shrt .shrtname, #shrt .shrtvalue").val(""));
});

// ===== الرسائل =====
let msgsData = {};
function drawMsgs() {
  const $p = $("#msgs");
  $p.find(".tablesorter").remove();
  const $t = table(["التصنيف", "العنوان", "الرساله", ""], [51, 96, 177, 36]);
  byTs(msgsData).forEach((x) => row($t, [x.k === "w" ? "ترحيب" : "تلقائيه", x.t || "", x.m, xBtn(() => run("cmsg_del", { id: x.id }))]));
  stripe($t);
  $p.append($t);
}
$("#msgs .stack").on("click", function () {
  const t = $("#msgs .msgt").val().trim(), m = $("#msgs .msgm").val().trim();
  if (!m) return;
  run("cmsg_add", { t, m, k: this.dataset.k }).then(() => $("#msgs .msgt, #msgs .msgm").val(""));
});

// ===== غرفه الإنتظار =====
const WR = ["active", "move", "pm", "allowlikes", "nots", "autoAllow"];
function fillWroom(w) {
  w = w || {};
  WR.forEach((k) => $("#owr_" + k).prop("checked", !!w[k]));
  $("#owr_likes").val(w.likes || 0);
}
$("#owr_save").on("click", () => {
  const data = { likes: parseInt($("#owr_likes").val(), 10) || 0 };
  WR.forEach((k) => { data[k] = $("#owr_" + k).prop("checked"); });
  run("wroom_save", { data });
});
let wlistData = {};
function drawWlist() {
  const $p = $("#wrooms");
  $p.find(".tablesorter").remove();
  const $t = table(["العضو", "الحظر", "المده", "الحالات", "آخر حاله", ""], [40, 38, 33, 44, 151, 73]);
  byTs(wlistData).forEach((x) => {
    const $b = $('<div class="d-flex"></div>')
      .append(xBtn(() => run("wlist_del", { id: x.id })))
      .append($('<a class="btn btn-info fa fa-search"></a>').on("click", () => { openTab("fps"); fps.search(x.v); }));
    const la = x.la ? new Date(x.la) : null;
    row($t, [x.u, x.k === "c" ? String(x.v).toUpperCase() : x.v, x.a ? "سماح" : "انتظار", String(x.n || 0),
      la ? `${ymd(x.la)} ${pad(la.getHours())}:${pad(la.getMinutes())}` : "--", $b]);
  });
  stripe($t);
  $p.append($t);
}
function wInput(allow) {
  const v = $("#wrooms .wroomit").val().trim();
  if (!v) return;
  run("wlist_add", { v, allow }).then(() => $("#wrooms .wroomit").val(""));
}
$("#wrooms .wadd").on("click", () => wInput(false));
$("#wrooms .wallow").on("click", () => wInput(true));

// ===== إداره الموقع =====
const hex = (v) => String(v || "").replace(/^#/, "").toUpperCase();
function colorIn($i, v) {
  v = hex(v);
  $i.val(v);
  if (/^[0-9A-F]{6}$/.test(v)) {
    const n = parseInt(v, 16), lum = ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
    $i.css({ "background-color": "#" + v, color: lum > 140 ? "black" : "white" });
  }
}
$(document).on("input", "input.color", function () { colorIn($(this), this.value); });
async function fillSett() {
  const [s, code] = await Promise.all([A.read("site"), A.read("sitecode")]);
  const v = { ...A.SITE, ...(s || {}) };
  for (const k of ["name", "title", "description", "keywords"]) $("#sett_" + k).val(v[k] || "");
  $("#sett .color").each(function () { colorIn($(this), v[this.dataset.k]); });
  $("#sett [data-n]").each(function () { $(this).val(v[this.dataset.n] ?? 0); });
  $("#sett [data-b]").each(function () { $(this).prop("checked", !!v[this.dataset.b]); });
  $("#sett_scr").val(code?.scr || ""); $("#sett_customHead").val(code?.head || ""); $("#sett_html").val(code?.html || "");
  $(".ownonly").prop("disabled", !S.owner);
}
$("#sett .settsave").on("click", async () => {
  const data = {};
  for (const k of ["name", "title", "description", "keywords"]) data[k] = $("#sett_" + k).val();
  $("#sett .color").each(function () { data[this.dataset.k] = "#" + hex(this.value); });
  $("#sett [data-n]").each(function () { data[this.dataset.n] = parseInt(this.value, 10) || 0; });
  $("#sett [data-b]").each(function () { data[this.dataset.b] = this.checked; });
  try {
    await A.perform("site_save", { data });
    if (S.owner) await A.perform("sitecode_save", { scr: $("#sett_scr").val(), head: $("#sett_customHead").val(), html: $("#sett_html").val() });
    applyBtnColor();
  } catch (e) { fail(e); }
});
// الأيقونات: الضغط على الصورة يرفع بديل
function drawSiteIcons() {
  const ic = A.SITE.icons || {};
  $("#sett .p-site img").each(function () {
    const w = this.dataset.w, def = w === "favicon" ? "favicon.ico" : w + ".png";
    if (ic[w]) showPic(this, ic[w]); else this.src = def;
  });
}
$("#sett .p-site img").on("click", function () {
  const w = this.dataset.w;
  pick("icon", (src) => run("site_icon", { which: w, src }).then(() => setTimeout(drawSiteIcons, 300)));
});
// ايقونات السوابر / الهدايا / الإبتسامات
const FOLDER = { sico: "sico/", dro3: "dro3/", emo: "emo/" };
function drawAssets(kind, recs) {
  const $b = $(`#sett .p-${kind}`).empty();
  A.mergeList(kind, recs || {}).forEach((x, i) => {
    const $d = $('<div style="display:inline-block;padding:2px;margin:2px;margin-top:2px;" class="border"></div>').attr("data-k", x.k).attr("data-src", x.src);
    if (kind === "emo") $('<input style="width:48px;" type="number">').val(i + 1).appendTo($d);
    const $i = $('<img alt="">').css(kind === "emo" ? { "max-width": "24px", "max-height": "24px" } : { "max-width": "220px", "max-height": "32px" }).appendTo($d);
    if (x.src.startsWith("db:")) showPic($i[0], x.src); else $i.attr("src", FOLDER[kind] + x.src);
    // حذف: المرفوع ينشال، والمدمج يتخفى
    xBtn(() => run("asset_set", { kind, k: x.k, val: x.builtin ? { src: x.src, del: true } : null })).css({ "margin-left": "4px", padding: "4px" }).text(".").appendTo($d);
    $b.append($d);
  });
}
let assetsData = {};
$("#sett .aadd").on("click", function () {
  const kind = this.dataset.kind;
  pick("icon", (src) => run("asset_set", { kind, k: "u" + Date.now().toString(36), val: { src, o: 10000 + Date.now() % 90000 } }));
});
// ترتيب الإبتسامات: الرقم = الترتيب (ف1 = الأول)
$("#sett .emo_order").on("click", () => {
  const list = $("#sett .p-emo > div").get().map((d) => ({ k: d.dataset.k, src: d.dataset.src, o: parseInt($(d).find("input").val(), 10) || 0 }));
  run("assets_order", { kind: "emo", list });
});

// ===== النطاقات =====
let domData = {}, curDom = null, domBimg = "";
function fillDomList() {
  const q = $("#domain_search").val().trim().toLowerCase();
  const $s = $("#domain_list").empty();
  $('<option value="">+ نطاق جديد</option>').appendTo($s);
  Object.entries(domData).filter(([, d]) => !q || String(d.domain).includes(q)).forEach(([k, d]) => $("<option></option>").attr("value", k).text(d.domain).appendTo($s));
  $s.val(curDom && domData[curDom] ? curDom : "");
}
async function loadDom(k) {
  curDom = k && domData[k] ? k : null;
  const d = (curDom && domData[curDom]) || {};
  const code = curDom ? (await A.read("domcode/" + curDom)) || {} : {};
  $("#domain").val(d.domain || "");
  for (const f of ["name", "title", "description", "keywords"]) $("#domain_" + f).val(d[f] || "");
  $("#domain_scr").val(code.scr || ""); $("#domain_customHead").val(code.head || ""); $("#sett_htmld").val(code.html || "");
  $("#domains .color").each(function () { colorIn($(this), d[this.dataset.k] || A.SITE[this.dataset.k]); });
  $("#bannerEnabled").prop("checked", !!d.bnr);
  domBimg = d.bimg || "";
  drawBanner();
  // فعال = النطاق محفوظ (والأخضر لو هو نفس النطاق المفتوح الحين)
  $("#domain_status").text(curDom ? (curDom === A.hostKey() ? "فعال" : "محفوظ") : "").css("color", curDom === A.hostKey() ? "green" : "grey");
  $(".ownonly").prop("disabled", !S.owner);
}
function drawBanner() {
  const $p = $("#banner_preview").empty();
  if (!domBimg) return $p.append('<span class="banner_empty" style="color:#888;">لا يوجد بنر</span>');
  const $i = $('<img alt="" style="max-width:100%;max-height:150px;border-radius:4px;">').appendTo($p);
  showPic($i[0], domBimg);
}
$("#domain_search").on("input", fillDomList);
$("#domain_list").on("change", function () { loadDom(this.value); });
$("#banner_arrow").on("click", function () { const open = $("#banner_section").toggle().is(":visible"); $(this).text(open ? "▼" : "◀"); });
$("#banner_section .bup").on("click", () => pick("banner", (v) => { domBimg = v; drawBanner(); }));
$("#banner_section .bdel").on("click", () => { domBimg = ""; drawBanner(); });
$("#domain_save_btn").on("click", async () => {
  // النطاق فاضي = نطاق الصفحة الحالية
  if (!$("#domain").val().trim()) $("#domain").val(location.hostname.replace(/^www\./, ""));
  const data = { domain: $("#domain").val().trim(), bnr: $("#bannerEnabled").prop("checked"), bimg: domBimg };
  if (!A.domKey(data.domain)) return;
  for (const f of ["name", "title", "description", "keywords"]) data[f] = $("#domain_" + f).val();
  $("#domains .color").each(function () { data[this.dataset.k] = "#" + hex(this.value); });
  const code = { scr: $("#domain_scr").val(), head: $("#domain_customHead").val(), html: $("#sett_htmld").val() };
  try { curDom = await A.perform("domain_save", { data, code }); fillDomList(); loadDom(curDom); } catch (e) { fail(e); }
});
$("#domain_delete_btn").on("click", () => {
  if (!curDom || !window.confirm("حذف النطاق؟\n" + (domData[curDom]?.domain || ""))) return;
  run("domain_del", { k: curDom }).then(() => { curDom = null; loadDom(null); });
});

// ===== Bots =====
let botsData = {}, botCfg = {};
const BOTMAX = 500;
function fillBotCfg() {
  for (const k of ["minStay", "maxStay", "minLeave", "maxLeave"]) $(".bots_" + k).val(botCfg[k] || 0);
  $(".bots_active").val(botCfg.active ? "true" : "false");
}
function drawBots() {
  const $p = $("#cp_bots");
  $p.find(".tablesorter").remove();
  const ids = Object.keys(botsData);
  const onl = ids.filter((id) => S.users["bot_" + id]).length;
  $(".botsb").text(`${BOTMAX}/${ids.length}`);
  $(".botso").text(`${onl}/${ids.length}`);
  const $t = table(["الصوره", "تثبيت الغرفه", "إعجاب", "الوصف", "الزخرفه", "الدوله", "الحاله"], [60, 140, 90, 160, 120, 50, 60]);
  byTs(botsData).forEach((b) => {
    const $c = $('<div class="c-flex"></div>');
    const $i = $('<img style="width:52px;height:46px;object-fit:cover;" alt="">').appendTo($c);
    showPic($i[0], b.pic, "pic.png");
    $('<a class="btn btn-primary fa fa-gear"></a>').on("click", () => botForm(b.id)).appendTo($c);
    const on = S.users["bot_" + b.id];
    row($t, [$c, b.room ? S.rooms[b.room]?.topic || "" : "", num(b.likes), b.msg || "", b.topic, b.co || "", on ? "متصل" : "فاضي"]);
  });
  stripe($t);
  $p.append($t);
}
$("#cp_bots .botsave").on("click", () => {
  const data = { active: $(".bots_active").val() === "true" };
  for (const k of ["minStay", "maxStay", "minLeave", "maxLeave"]) data[k] = parseInt($(".bots_" + k).val(), 10) || 0;
  run("botcfg_save", { data });
});
$("#cp_bots .botadd").on("click", () => {
  if (Object.keys(botsData).length >= BOTMAX) return;
  const topic = window.prompt("الزخرفه");
  if (topic && topic.trim()) run("bot_save", { data: { topic: topic.trim(), co: "sa", likes: 0 } });
});
// تعديل الاسم الوهمي: الزخرفه، الوصف، الدوله، الغرفه، الإعجابات، الألوان، الصوره
function botForm(id) {
  const b = botsData[id];
  if (!b) return;
  $("#botbox").remove();
  let pic = b.pic || "pic.png";
  const $f = $('<div id="botbox" class="border corner"></div>');
  const fld = (label, $in) => $f.append($('<label class="label label-primary"></label>').text(label)).append("<br>").append($in).append("<br>");
  const $topic = $('<input maxlength="40">').val(b.topic || ""); fld("الزخرفه", $topic);
  const $msg = $('<input maxlength="150">').val(b.msg || ""); fld("الوصف", $msg);
  const $co = $("<select></select>");
  Object.entries(A.COUNTRIES).forEach(([c, n]) => $("<option></option>").attr("value", c).text(n).appendTo($co));
  $co.val(b.co || "sa"); fld("الدوله", $co);
  const $rm = $('<select><option value="">تلقائي</option></select>');
  Object.entries(S.rooms).forEach(([rid, x]) => $("<option></option>").attr("value", rid).text(x.topic || rid).appendTo($rm));
  $rm.val(b.room || ""); fld("تثبيت الغرفه", $rm);
  const $lk = $('<input type="number" min="0">').val(b.likes || 0); fld("إعجاب", $lk);
  const $uc = $('<div class="cpick border btn" style="width:64px;height:22px;background-image:none;"></div>'); setColor($uc, b.ucol || "#000000"); fld("لون الإسم", $uc);
  const $mc = $('<div class="cpick border btn" style="width:64px;height:22px;background-image:none;"></div>'); setColor($mc, b.mcol || "#000000"); fld("لون الخط", $mc);
  const $img = $('<img class="border hand" style="width:52px;height:46px;object-fit:cover;" alt="">');
  showPic($img[0], pic, "pic.png");
  $img.on("click", () => pick("avatar", (v) => { pic = v; showPic($img[0], v); }));
  fld("الصوره", $img);
  $('<button class="btn btn-danger fa fa-save" style="margin:2px;"> حفظ</button>').on("click", () => {
    run("bot_save", { id, data: { topic: $topic.val(), msg: $msg.val(), co: $co.val(), room: $rm.val(), likes: $lk.val(), ucol: getColor($uc), mcol: getColor($mc), bg: b.bg, ico: b.ico, pic } })
      .then(() => $f.remove());
  }).appendTo($f);
  $('<button class="btn btn-default fa fa-times" style="margin:2px;"> حذف</button>').on("click", () => {
    if (window.confirm("حذف الاسم الوهمي؟\n" + (b.topic || ""))) run("bot_del", { id }).then(() => $f.remove());
  }).appendTo($f);
  $('<button class="btn btn-primary" style="margin:2px;">إغلاق</button>').on("click", () => $f.remove()).appendTo($f);
  $("body").append($f);
}

// لون أزرار اللوحة = لون الأزرار في إداره الموقع
function applyBtnColor() { document.documentElement.style.setProperty("--sbtn", A.SITE.sbuttons || "#8C5D73"); }

// ===== التبويبات =====
const TABS = {
  fps: () => P().cp, actions: () => P().cp, logins: () => P().cp, bans: () => P().cp || P().ban, powers: () => P().editpower,
  fltr: () => P().filter, cp_rooms: () => P().cprooms, shrt: () => P().cpshrt, subs: () => P().cpsubs || P().setpower,
  msgs: () => P().cpmsgs, wrooms: () => P().cpwrooms, sett: () => P().cpsite, domains: () => P().cpdomains,
  cp_bots: () => S.owner // الأسماء الوهمية للمالك بس
};
const loaded = {};
function openTab(id) {
  try { history.replaceState(null, "", "#" + id); } catch {}
  $("#cpnav li").removeClass("active");
  $(`#cpnav li[data-tab="${id}"]`).addClass("active");
  $("#cpc > .cpane").removeClass("active");
  $("#" + id).addClass("active");
  if (loaded[id]) return;
  loaded[id] = true;
  load(id);
}
function load(id) {
  if (id === "fps") fps.show(true);
  if (id === "actions") acts.show(true);
  if (id === "logins") logins.show(true);
  if (id === "bans" && !loaded._bans) { loaded._bans = true; A.listen("bans", (v) => { bansData = v || {}; drawBans(); }); }
  if (id === "powers") { if (!$("#powers .psave").length) buildForm(); fillPlist(); loadForm(curPid); }
  if (id === "subs") drawSubs();
  if (id === "fltr") { listen("fltr", "filter", (v) => { fltData = v || {}; drawFltr(); }); listen("fltlog", "fltlog", (v) => drawFltred(v || {})); }
  if (id === "cp_rooms") { listen("entry", "entry", (v) => { entryData = v || {}; fillEntry(); }); fillEntry(); loadUsers().catch(() => {}).finally(drawRooms); }
  if (id === "shrt") listen("shrt", "shrt", (v) => { shrtData = v || {}; drawShrt(); });
  if (id === "msgs") listen("msgs", "cmsgs", (v) => { msgsData = v || {}; drawMsgs(); });
  if (id === "wrooms") { listen("wroom", "wroom", fillWroom); listen("wlist", "wlist", (v) => { wlistData = v || {}; drawWlist(); }); }
  if (id === "sett") { $("#sett .ownbox").toggle(!!S.owner); fillSett(); drawSiteIcons(); listen("assets", "assets", (v) => { assetsData = v || {}; ["sico", "dro3", "emo"].forEach((k) => drawAssets(k, assetsData[k])); }); }
  if (id === "domains") listen("domains", "domains", (v) => { domData = v || {}; fillDomList(); loadDom(curDom); });
  if (id === "cp_bots") { listen("botcfg", "botcfg", (v) => { botCfg = v || {}; fillBotCfg(); }); listen("bots", "bots", (v) => { botsData = v || {}; drawBots(); }); }
}
function applyPerms() {
  let first = null;
  $("#cpnav li").each(function () {
    const id = this.dataset.tab, ok = !!TABS[id]();
    $(this).toggle(ok);
    if (ok && !first) first = id;
  });
  if (!first) { location.href = "./"; return; }
  // بعد تحديث الصفحة: نفس التبويب اللي كان مفتوح (لو عنده صلاحيته)
  const h = location.hash.slice(1);
  if (!$("#cpnav li.active:visible").length) openTab(h && TABS[h] && TABS[h]() ? h : first);
}
if (A) {
  initColors();
  applyBtnColor();
  $("#cpnav a").on("click", function (e) { e.preventDefault(); openTab($(this).parent().data("tab")); });
  // زر التحديث الأخضر: يعيد تحميل التبويب المفتوح
  $("#cprefresh").on("click", () => { const id = $("#cpnav li.active").data("tab"); if (id) load(id); });
  applyPerms();
  A.listen("powers", () => setTimeout(() => { if (loaded.powers) fillPlist(); if (loaded.subs) drawSubs(); applyPerms(); }, 50));
  A.listen("upow", () => setTimeout(() => { if (loaded.subs) drawSubs(); applyPerms(); }, 50));
  // الشات انقفل؟ اللوحة ترجع للرئيسية
  setInterval(() => { if (!host() || !A.S.inChat) location.href = "./"; }, 3000);
}
