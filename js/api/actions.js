// البوابة الوحيدة لكل أمر حساس.
// BACKEND = "rules": الكتابة مباشرة في القاعدة، وقواعد database.rules.json تحمي.
// BACKEND = "functions" (عند Blaze): كل أمر يروح لـCloud Function وحدة اسمها "action" بنفس الاسم والبيانات،
// وبعدها نقفل الكتابة المباشرة في القواعد. ولا ملف واجهة يتغيّر.
import { r, app, now, auth } from "../firebase.js";
import { S } from "../state.js";
import { touch } from "../session.js";
import { detectNet, ipHash, fpKey, fpParse, fpShow, nameKey } from "../util.js";
import { SITE } from "../config.js";
import { update, set, remove, push, get, increment, serverTimestamp, query, orderByChild, equalTo, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export const BACKEND = "rules";

const lastLike = {};
const clean = (s, max) => String(s ?? "").trim().slice(0, max);
const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const okColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "#000000");
const okId = (id) => typeof id === "string" && /^[\w-]{1,40}$/.test(id);

function roomData(p) {
  return {
    topic: clean(p.topic, 40),
    about: clean(p.about, 200),
    welcome: clean(p.welcome, 300),
    pic: clean(p.pic || "room.png", 60),
    max: int(p.max, 2, 40, 40),
    rl: int(p.rl, 0, 1e6, 0),
    rvl: int(p.rvl, 0, 1e6, 0),
    sticky: !!p.sticky,
    voice: !!p.voice,
    color: okColor(p.color),
    hasPass: !!clean(p.pass, 30)
  };
}

const local = {
  // حذف رسالتي من الغرفة
  async delmsg({ rid, mid }) {
    if (!okId(rid) || !okId(mid)) throw new Error("bad");
    const m = (await get(r(`msgs/${rid}/${mid}`))).val();
    if (!m) return;
    // حذف رسالة شخص ثاني (مسح الرسائل) ينكتب في الحالات
    const upd = { [`msgs/${rid}/${mid}`]: null };
    if (m.uid !== S.uid) Object.assign(upd, await act("مسح", { topic: m.u?.topic, uid: m.uid }, S.rooms[rid]?.topic));
    await update(r(), upd);
  },
  // حذف رسالتي من الحائط (مع ردودها)
  async delwall({ bid }) {
    if (!okId(bid)) throw new Error("bad");
    const m = (await get(r(`wall/${bid}`))).val();
    if (!m) return;
    const upd = { [`wall/${bid}`]: null }; // التعليقات داخلها تنحذف معها
    if (m.uid !== S.uid) Object.assign(upd, await act("حذف الحائط", { topic: m.u?.topic, uid: m.uid }, ""));
    await update(r(), upd);
  },
  // حذف تعليقي على الحائط
  async delwallrep({ bid, rid }) {
    if (!okId(bid) || !okId(rid)) throw new Error("bad");
    await remove(r(`wall/${bid}/rep/${rid}`));
  },
  // إعجاب رسالة غرفة / حائط / رد
  async likemsg({ rid, mid }) {
    if (!okId(rid) || !okId(mid)) throw new Error("bad");
    await set(r(`msgs/${rid}/${mid}/likes/${S.uid}`), true);
  },
  async likerep({ bid, rid }) {
    if (!okId(bid) || !okId(rid)) throw new Error("bad");
    await set(r(`wall/${bid}/rep/${rid}/likes/${S.uid}`), true);
  },
  async likewall({ bid }) {
    if (!okId(bid)) throw new Error("bad");
    await set(r(`wall/${bid}/likes/${S.uid}`), true);
  },
  // إعجاب بعضو (مثل العنود: يتكرر ويتحسب كل مرة، بحد مرة وحدة في الدقيقة، ويجوز لنفسك)
  async likeuser({ uid }) {
    if (!okId(uid)) throw new Error("bad");
    // الحد مرة بالدقيقة لنفس البروفايل (تقدر تعجب بأشخاص مختلفين ورا بعض)
    if (now() - (lastLike[uid] || 0) < 60000) throw new Error("rate");
    lastLike[uid] = now();
    // العدد يزيد مرة وحدة كل 24 ساعة لنفس الشخص — الضغطات الثانية توصل كإعجاب بس ما تنحسب
    const last = (await get(r(`ulast/${S.uid}/${uid}`)).catch(() => null))?.val() || 0;
    if (now() - last >= 864e5) {
      try { await update(r(), { [`ucount/${uid}`]: increment(1), [`ulast/${S.uid}/${uid}`]: serverTimestamp() }); } catch {}
    }
    return true;
  },
  // إنشاء غرفة
  async mkroom(p) {
    const d = roomData(p);
    if (!d.topic) throw new Error("topic");
    const rid = push(r("rooms")).key;
    d.owner = S.uid;
    d.ts = serverTimestamp();
    d.no = Math.max(1, ...Object.values(S.rooms).map((x) => x.no || 1)) + 1;
    const q = d.sticky && !S.perms.roomowner && !S.perms.cprooms ? await quota("rooms") : {};
    await update(r(), { ...q, [`rooms/${rid}`]: d, [`roompass/${rid}`]: d.hasPass ? clean(p.pass, 30) : null, ...(await act("إنشاء غرفه", {}, d.topic)) });
    return rid;
  },
  // تعديل غرفتي
  async editroom(p) {
    if (!okId(p.rid)) throw new Error("bad");
    const d = roomData(p);
    if (!d.topic) throw new Error("topic");
    const old = (await get(r(`rooms/${p.rid}`))).val();
    if (!old) throw new Error("gone");
    const pass = clean(p.pass, 30);
    // كلمة المرور الفاضية في نموذج التعديل = نخلي القديمة
    if (!pass) d.hasPass = !!old.hasPass;
    const upd = {};
    for (const k in d) upd[`rooms/${p.rid}/${k}`] = d[k];
    if (pass) upd[`roompass/${p.rid}`] = pass;
    if (d.sticky && !old.sticky && !S.perms.roomowner && !S.perms.cprooms) Object.assign(upd, await quota("rooms"));
    Object.assign(upd, await act("تعديل غرفه", {}, d.topic));
    await update(r(), upd);
  },
  // غرفة عامة تلقائية (الغرفه العامه ( n )) — غير مثبتة وتنقفل لما تفضى
  async mkauto({ n, max }) {
    n = int(n, 2, 99, 2);
    const main = (await get(r("rooms/main"))).val() || {};
    await set(r(`rooms/main${n}`), {
      topic: `الغرفه العامه ( ${n} )`, about: main.about || "", welcome: main.welcome || "",
      pic: main.pic || "room.png", max: int(max, 2, 40, 40), rl: 0, rvl: 0, sticky: false, voice: false,
      color: main.color || "#000000", hasPass: false, owner: "", ts: serverTimestamp(), no: n
    });
  },
  async delroom({ rid }) {
    if (!okId(rid) || rid === "main") throw new Error("bad");
    // الغرفة العامة التلقائية ما لها كلمة مرور، وأي أحد يقفلها لما تفضى
    if (/^main[0-9]+$/.test(rid)) return update(r(), { [`rooms/${rid}`]: null, [`msgs/${rid}`]: null });
    const topic = S.rooms[rid]?.topic || "";
    await update(r(), { [`rooms/${rid}`]: null, [`roompass/${rid}`]: null, [`msgs/${rid}`]: null, [`roomkeys/${rid}`]: null, ...(await act("حذف غرفه", {}, topic)) });
  },
  // دخول غرفة (مع كلمة المرور إن وجدت)
  async rjoin({ rid, pass }) {
    if (rid === null) return set(r(`online/${S.uid}/room`), null); // خروج من الغرفة
    if (!okId(rid)) throw new Error("bad");
    const upd = { [`online/${S.uid}/room`]: rid };
    if (pass) upd[`roomkeys/${rid}/${S.uid}`] = clean(pass, 30);
    await update(r(), upd);
  },
  async report({ uid, why }) {
    if (!okId(uid)) throw new Error("bad");
    await push(r("reports"), { from: S.uid, to: uid, why: clean(why, 200), ts: serverTimestamp() });
  },

  // ===== أوامر الإدارة (المرحلة 2) — القواعد تتحقق من الصلاحية والترتيب =====
  async kick({ uid }) {
    const u = target(uid);
    await update(r(), { ...(await quota("kick")), [`kicks/${uid}/${key()}`]: kickRec("kick"), [`online/${uid}`]: null, ...roomNote(u, "( تم طرد هذا المستخدم )"), ...(await act("طرد", u)) });
  },
  // باند من الملف: بصمة الجهاز (المستوى الأول) + الآي بي
  async ban({ uid }) {
    const u = target(uid);
    const upd = { [`kicks/${uid}/${key()}`]: kickRec("ban"), [`online/${uid}`]: null, ...roomNote(u, "( تم حظر هذا المستخدم )"), ...(await act("باند", u)) };
    // باند الملف مؤقت (SITE.banMins دقيقة) وينفك لحاله
    const until = now() + SITE.banMins * 60000;
    if (okId(u.fp)) upd[`bans/f0_${u.fp}`] = { ...banRec("f0", u.fd || (await privOf(uid, "fp")) || u.fp, u.topic), until };
    if (okId(u.ih)) upd[`bans/i_${u.ih}`] = { ...banRec("i", (await privOf(uid, "ip")) || u.ih, u.topic), until };
    await update(r(), upd);
  },
  async delpic({ uid }) {
    const u = target(uid);
    const upd = { [`online/${uid}/pic`]: "pic.png", ...(await act("حذف صوره", u)) };
    if (!u.g) upd[`users/${uid}/pic`] = "pic.png";
    await update(r(), upd);
  },
  async roomkick({ uid }) {
    const u = target(uid);
    if (!u.room) throw new Error("noroom");
    await update(r(), { [`online/${uid}/room`]: null, [`rkick/${u.room}/${uid}`]: serverTimestamp(), ...roomNote(u, "( تم طرد هذا المستخدم من الغرفة )"), ...(await act("طرد من الغرفه", u)) });
  },
  async roomop({ uid }) {
    const u = target(uid);
    const rid = u.room || S.room;
    if (!okId(rid)) throw new Error("noroom");
    await update(r(), { [`rooms/${rid}/ops/${uid}`]: true, ...(await act("ترقيه الى مراقب", u)) });
  },
  async setnick({ uid, topic }) {
    const u = target(uid);
    topic = clean(topic, 40);
    if (!topic) throw new Error("bad");
    const upd = { [`online/${uid}/topic`]: topic, ...(await act("تغير الزخرفه", { ...u, topic: `${u.topic || ""} -> ${topic}` })) };
    if (!u.g) upd[`users/${uid}/topic`] = topic;
    if (uid === S.uid) S.me.topic = topic;
    await update(r(), upd);
  },
  // لايكات: من الملف أو من لوحة التحكم (حتى للعضو غير المتصل)
  async setlikes({ uid, likes }) {
    if (!okId(uid)) throw new Error("bad");
    const u = S.users[uid] || (await get(r("users/" + uid))).val() || {};
    const n = int(likes, -1e9, 1e9, 0);
    const old = (await get(r("ucount/" + uid))).val() || 0;
    await update(r(), { [`ucount/${uid}`]: n, ...(await act("لايكات", { uid, topic: `${u.topic || ""} ${old} -> ${n}` })) });
  },
  // تعيين الاشتراك: pid فاضي = سحب الصلاحيه، days = 0 دائم
  async setpower({ uid, pid, days }) {
    if (!okId(uid)) throw new Error("bad");
    const u = S.users[uid] || (await get(r("users/" + uid))).val() || {};
    days = int(days, 0, 36500, 0);
    const val = pid ? { p: clean(pid, 40), until: days ? now() + days * 864e5 : 0, by: S.uid, ts: serverTimestamp(), t: clean(u.topic, 40) } : null;
    const name = pid ? S.powers[pid]?.name || "" : "";
    await update(r(), { [`upow/${uid}`]: val, ...(await act(pid ? "صلاحيه" : "سحب الصلاحيه", { uid, topic: pid ? `${u.topic || ""} -> ${name}` : u.topic })) });
  },
  async move({ uid, rid }) {
    const u = target(uid);
    if (!okId(rid)) throw new Error("bad");
    const rm = S.rooms[rid] || {};
    await update(r(), { [`online/${uid}/room`]: rid, ...(await act("نقل", u, rm.topic)) });
  },
  // كشف النكات: كل دخول من نفس بصمة الجهاز (سجل fps)، الأحدث أولاً
  async history({ uid }) {
    const u = target(uid);
    if (!u.fp) return [];
    const v = (await get(query(r("fps"), orderByChild("fp"), equalTo(u.fp), limitToLast(100)))).val() || {};
    return Object.values(v).sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .map((x) => ({ ts: x.ts, ip: x.ip || "", t: x.t || "", un: x.un || "", fp: x.fp || "" }));
  },
  // حذف العضويه (إدارة العضويات): الاسم يرجع متاح، وبياناته واشتراكه ينشالون، ويطلع لو متصل.
  // حساب الدخول نفسه في Firebase ينحذف عند Blaze (Admin SDK).
  async deluser({ uid }) {
    if (!okId(uid)) throw new Error("bad");
    const u = (await get(r("users/" + uid))).val();
    if (!u) throw new Error("gone");
    const upd = {
      [`users/${uid}`]: null, [`names/${nameKey(u.name || u.topic)}`]: null, [`upow/${uid}`]: null, [`ucount/${uid}`]: null,
      ...(await act("حذف عضويه", { uid, topic: u.topic }))
    };
    if (S.users[uid]) { upd[`online/${uid}`] = null; upd[`kicks/${uid}/${key()}`] = kickRec("kick"); }
    await update(r(), upd);
  },
  // تغيير كلمة مرور عضو ثاني: يحتاج سيرفر (Blaze)
  async setpass() { throw new Error("blaze"); },
  // ===== لوحة التحكم =====
  async powers_save({ pid, data }) {
    const d = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (k === "name") d.name = clean(v, 40);
      else if (k === "ico") d.ico = clean(v, 80);
      else if (typeof v === "boolean") d[k] = v;
      else if (typeof v === "number") d[k] = k === "rank" ? int(v, 0, 9999, 0) : int(v, -1e6, 1e6, 0);
    }
    if (!d.name) throw new Error("name");
    pid = okId(pid) ? pid : key();
    await update(r(), { [`powers/${pid}`]: d, ...(await act("حفظ صلاحيه", { topic: d.name })) });
    return pid;
  },
  async powers_del({ pid }) {
    if (!okId(pid)) throw new Error("bad");
    const name = S.powers[pid]?.name || "";
    await update(r(), { [`powers/${pid}`]: null, ...(await act("حذف صلاحيه", { topic: name })) });
  },
  // حظر / سماح من اللوحة: رقم الجهاز (مع * للحظر العميق) أو الدوله (حرفين) أو الآي بي.
  // allow = "سماح" (استثناء يغلب الحظر)
  async ban_add({ v, allow, u: who }) {
    const { k, keyv, shown } = await parseKey(v);
    const rec = banRec(k, shown, who || "");
    if (allow) rec.a = true;
    await update(r(), { [`bans/${k}_${keyv}`]: rec, ...(await act(allow ? "سماح" : "حظر", { topic: shown })) });
  },
  // ===== المرحلة 3 =====
  // إداره الموقع
  async site_save({ data = {} }) {
    const d = siteFields(data, SITE_STR);
    for (const k of SITE_BOOL) if (k in data) d[k] = bool(data[k]);
    for (const [k, [lo, hi]] of Object.entries(SITE_NUM)) if (k in data) d[k] = int(data[k], lo, hi, lo);
    await update(r(), { ...Object.fromEntries(Object.entries(d).map(([k, v]) => ["site/" + k, v])), ...(await act("إداره الموقع")) });
  },
  async sitecode_save(code) { await set(r("sitecode"), codeFields(code)); },
  // أيقونات الموقع: favicon / prv1 / pic / room
  async site_icon({ which, src }) {
    if (!["favicon", "prv1", "pic", "room"].includes(which)) throw new Error("bad");
    await set(r("site/icons/" + which), src ? clean(src, 60) : null);
  },
  // ايقونات السوابر / الهدايا / الإبتسامات: إضافه (src) أو حذف (del) أو ترتيب (o)
  async asset_set({ kind, k, val }) {
    if (!["sico", "dro3", "emo"].includes(kind) || !/^[\w-]{1,80}$/.test(k || "")) throw new Error("bad");
    const v = val ? { src: clean(val.src, 80), o: val.o === undefined || val.o === null ? null : int(val.o, 0, 1e5, 0), del: val.del ? true : null } : null;
    await set(r(`assets/${kind}/${k}`), v);
  },
  async assets_order({ kind, list }) {
    if (!["sico", "dro3", "emo"].includes(kind)) throw new Error("bad");
    const upd = {};
    for (const x of list || []) if (/^[\w-]{1,80}$/.test(x.k || "")) { upd[`assets/${kind}/${x.k}/src`] = clean(x.src, 80); upd[`assets/${kind}/${x.k}/o`] = int(x.o, 0, 1e5, 0); }
    await update(r(), upd);
  },
  // النطاقات: إعدادات منفصلة لكل دومين
  async domain_save({ data = {}, code }) {
    const k = domKey(data.domain);
    if (!k) throw new Error("bad");
    const d = { domain: clean(data.domain, 120).toLowerCase(), ...siteFields(data, SITE_STR), bnr: bool(data.bnr), bimg: clean(data.bimg, 60) || null, ts: serverTimestamp() };
    await set(r("domains/" + k), d);
    if (code && S.owner) await set(r("domcode/" + k), codeFields(code));
    return k;
  },
  async domain_del({ k }) {
    if (!/^[\w-]{1,100}$/.test(k || "")) throw new Error("bad");
    const upd = { [`domains/${k}`]: null };
    if (S.owner) upd[`domcode/${k}`] = null;
    await update(r(), upd);
  },
  // الغرف: غرفة الدخول التلقائي
  async entry_save({ mode, rid }) {
    if (mode === "fixed" && !okId(rid)) throw new Error("bad");
    await set(r("entry"), mode === "fixed" ? { mode, rid } : { mode: "auto" });
  },
  // الفلتر
  async filter_add({ w, t }) {
    w = clean(w, 100).toLowerCase();
    if (!w || !["a", "b", "m"].includes(t)) throw new Error("bad");
    await set(push(r("filter")), { w, t, ts: serverTimestamp() });
  },
  async filter_del({ id }) { if (!okId(id)) throw new Error("bad"); await remove(r("filter/" + id)); },
  async fltlog_del({ id }) { if (!okId(id)) throw new Error("bad"); await remove(r("fltlog/" + id)); },
  // سجل الكلمه الممنوعه/المراقبه (يكتبه صاحب الرساله)
  async fltlog({ w, m, k, u }) {
    const uid = S.uid || auth.currentUser?.uid;
    if (!uid) return;
    await set(push(r("fltlog")), { w: clean(w, 100), m: clean(m, 500), u: clean(u || S.me?.topic, 60), ip: clean(myIp, 60), fp: clean(S.dev || (await import("../util.js")).deviceFp().fp, 200), uid, k: k === "m" ? "m" : "b", ts: serverTimestamp() });
  },
  // الإختصارات
  async shrt_add({ k, v }) {
    k = clean(k, 40); v = clean(v, 500);
    if (!k || !v) throw new Error("bad");
    await set(push(r("shrt")), { k, v, ts: serverTimestamp() });
  },
  async shrt_del({ id }) { if (!okId(id)) throw new Error("bad"); await remove(r("shrt/" + id)); },
  // الرسائل: ترحيب (w) وتلقائيه (a)
  async cmsg_add({ t, m, k }) {
    m = clean(m, 250);
    if (!m || !["w", "a"].includes(k)) throw new Error("bad");
    await set(push(r("cmsgs")), { t: clean(t, 100), m, k, ts: serverTimestamp() });
  },
  async cmsg_del({ id }) { if (!okId(id)) throw new Error("bad"); await remove(r("cmsgs/" + id)); },
  // غرفه الإنتظار: الإعدادات (وتنخلق الغرفة أول مرة)
  async wroom_save({ data = {} }) {
    const d = {};
    for (const k of ["active", "move", "pm", "allowlikes", "nots", "autoAllow"]) d[k] = bool(data[k]);
    d.likes = int(data.likes, 0, 1e9, 0);
    const upd = { wroom: d };
    if (d.active && !S.rooms.wait) {
      upd["rooms/wait"] = { topic: "غرفه الانتظار", about: "", welcome: "", pic: "room.png", max: 40, rl: 0, rvl: 0, sticky: true, voice: false, color: "#000000", hasPass: false, owner: "", ts: serverTimestamp(), no: 0 };
    }
    await update(r(), upd);
  },
  async wlist_add({ v, allow, u: who }) {
    const { k, keyv, shown } = await parseKey(v);
    const rec = banRec(k, shown, who || "");
    if (allow) rec.a = true;
    await set(r(`wlist/${k}_${keyv}`), rec);
  },
  async wlist_del({ id }) { if (!okList(id)) throw new Error("bad"); await remove(r("wlist/" + id)); },
  // سماح تلقائي بعد اكتمال الايكات (العضو لنفسه — القواعد تتحقق من العدد)
  async wallow_self() {
    if (!okId(S.me?.fp)) return;
    await set(r(`wlist/f0_${S.me.fp}`), { ...banRec("f0", S.me.fd || S.me.fp, S.me.topic), a: true });
  },
  // إعلان للكل (publicmsg) أو للسوابر (ppmsg)
  async announce({ m, pp }) {
    m = clean(m, 300);
    if (!m) throw new Error("bad");
    const u = { topic: clean(S.me.topic, 40), pic: S.me.pic || "pic.png", ucol: okColor(S.me.ucol), mcol: okColor(S.me.mcol), bg: /^#[0-9a-f]{6}$/i.test(S.me.bg || "") ? S.me.bg : "#ffffff", ico: clean(S.me.ico, 80) };
    if (pp) return set(push(r("pann")), { m, by: S.uid, u, ts: serverTimestamp() });
    await update(r(), { ...(await quota("publicmsg")), [`ann/${push(r("ann")).key}`]: { m, by: S.uid, u, ts: serverTimestamp() } });
  },
  async ann_del({ id, pp }) { if (!okId(id)) throw new Error("bad"); await remove(r((pp ? "pann/" : "ann/") + id)); },
  // الهديه (ايقونة من dro3) والبنر (من sico) جنب الاسم — ico فاضي = إزالة
  async gift({ uid, ico }) {
    const u = target(uid);
    ico = clean(ico, 80);
    await update(r(), { ...(ico ? await quota("upgrades") : {}), [`ugift/${uid}`]: ico ? { ico, by: S.uid, ts: serverTimestamp() } : null, ...(await act(ico ? "هديه" : "إزالة الهديه", u)) });
  },
  async banner({ uid, ico }) {
    const u = target(uid);
    ico = clean(ico, 80);
    await update(r(), { [`ubnr/${uid}`]: ico ? { ico, by: S.uid, ts: serverTimestamp() } : null, ...(await act(ico ? "بنر" : "إزالة البنر", u)) });
  },
  // Bots (أسماء وهمية) — للمالك
  async botcfg_save({ data = {} }) {
    const d = { active: bool(data.active) };
    for (const k of ["minStay", "maxStay", "minLeave", "maxLeave"]) d[k] = int(data[k], 0, 1e5, 0);
    await set(r("botcfg"), d);
  },
  async bot_save({ id, data = {} }) {
    const d = {
      topic: clean(data.topic, 40), msg: clean(data.msg, 150), pic: clean(data.pic || "pic.png", 60),
      co: /^[a-z]{2}$/.test(data.co || "") ? data.co : "--", room: okId(data.room) ? data.room : null, likes: int(data.likes, 0, 1e9, 0),
      ucol: okColor(data.ucol), mcol: okColor(data.mcol), bg: /^#[0-9a-f]{6}$/i.test(data.bg || "") ? data.bg : "#ffffff",
      ico: clean(data.ico, 80) || null, ts: serverTimestamp()
    };
    if (!d.topic) throw new Error("bad");
    id = okId(id) ? id : push(r("bots")).key;
    await set(r("bots/" + id), d);
    return id;
  },
  async bot_del({ id }) { if (!okId(id)) throw new Error("bad"); await remove(r("bots/" + id)); },
  // التفريغ (للمالك): يمسح القسم كامل
  async wipe({ what }) {
    const P = { fps: ["fps"], acts: ["acts"], fltlog: ["fltlog"], wall: ["wall"], msgs: ["msgs"], ann: ["ann", "pann"], reports: ["reports"] }[what];
    if (!P || !S.owner) throw new Error("bad");
    const upd = {};
    P.forEach((p) => { upd[p] = null; });
    await update(r(), upd);
  },
  // الصيانه: تنظيف المنتهي والقديم بدون ما يطلع أحد (كل شي هنا القواعد تسمح لأي أحد يشيله)
  async cleanup() {
    const t = now(), out = { ghosts: 0, bans: 0, subs: 0, msgs: 0, wall: 0, rooms: 0 };
    const val = (p) => get(r(p)).then((s) => s.val() || {}).catch(() => ({}));
    const [on, bans, upow, wall, rooms] = await Promise.all(["online", "bans", "upow", "wall", "rooms"].map(val));
    // رسائل كل غرفة لحالها (القراءة مسموحة بالغرفة مو القسم كامل)
    const msgs = Object.fromEntries(await Promise.all(Object.keys(rooms).map(async (rid) => [rid, await val("msgs/" + rid)])));
    const del = (p) => remove(r(p)).catch(() => {});
    const jobs = [];
    for (const [uid, u] of Object.entries(on)) if (u && u.off && (u.offAt || 0) < t - SITE.ghostMins * 60000) { jobs.push(del("online/" + uid)); out.ghosts++; }
    for (const [k, b] of Object.entries(bans)) if (b && b.until && b.until < t) { jobs.push(del("bans/" + k)); out.bans++; }
    for (const [uid, x] of Object.entries(upow)) if (x && x.until && x.until < t) { jobs.push(del("upow/" + uid)); out.subs++; }
    for (const [rid, list] of Object.entries(msgs)) for (const [mid, m] of Object.entries(list || {})) if ((m?.ts || 0) < t - 864e5) { jobs.push(del(`msgs/${rid}/${mid}`)); out.msgs++; }
    for (const [bid, m] of Object.entries(wall)) if ((m?.ts || 0) < t - 7 * 864e5) { jobs.push(del("wall/" + bid)); out.wall++; }
    // صور الحائط والخاص الأقدم من أسبوع (صور الأعضاء والغرف ما تنلمس)
    out.pics = 0;
    const pidx = await val("picidx");
    for (const [pid, x] of Object.entries(pidx)) if (x && x.k === "share" && (x.ts || 0) < t - 7 * 864e5) { jobs.push(del("pics/" + pid).then(() => del("picidx/" + pid))); out.pics++; }
    const inRoom = new Set(Object.values(on).filter((u) => u && !u.off).map((u) => u.room));
    for (const rid of Object.keys(rooms)) if (/^main[0-9]+$/.test(rid) && !inRoom.has(rid)) { jobs.push(del("rooms/" + rid)); out.rooms++; }
    await Promise.all(jobs);
    return out;
  },
  async unban({ id }) {
    if (!/^(f[0-4]|i|c)_[\w-]{1,60}$/.test(id || "")) throw new Error("bad");
    const v = (await get(r("bans/" + id))).val() || {};
    await update(r(), { [`bans/${id}`]: null, ...(await act("فك الحظر", { topic: v.v || id })) });
  }
};

// رقم الجهاز (مع * للعميق) أو الدوله (حرفين) أو الآي بي → مفتاح بنفس شكل الحظر
async function parseKey(v) {
  v = clean(v, 220);
  if (!v) throw new Error("bad");
  let k, keyv, shown = v;
  if (/^[a-z]{2}$/i.test(v)) { k = "c"; keyv = shown = v.toLowerCase(); }
  else if (/^[\d.]+$|^[0-9a-f]*:[0-9a-f:]+$/i.test(v)) { k = "i"; keyv = await ipHash(v); }
  else {
    const { level, fp } = fpParse(v);
    keyv = fpKey(fp, level);
    if (!keyv) throw new Error("bad");
    k = "f" + level; shown = fpShow(fp, level);
  }
  return { k, keyv, shown };
}
const okList = (id) => /^(f[0-4]|i|c)_[\w-]{1,60}$/.test(id || "");
const bool = (v) => v === true;
const color = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c.toUpperCase() : null);
// إعدادات الموقع المسموحة (نفس أسماء SITE في config.js)
const SITE_STR = { name: 120, title: 300, description: 1000, keywords: 3000 };
const SITE_BOOL = ["allowg", "allowreg", "rc", "bclikes", "mlikes", "mreply", "bcreply", "calls", "vpnBlock"];
const SITE_NUM = { msgstt: [1, 1440], wall_likes: [0, 1e9], wall_minutes: [0, 1e4], guestNameMax: [1, 50], registerNameMax: [1, 50],
  roomMsgLikes: [0, 1e9], pmLikes: [0, 1e9], alertLikes: [0, 1e9], fileslikes: [0, 1e9], proflikes: [0, 1e9], piclikes: [0, 1e9],
  maxshrt: [1, 10], maxIP: [1, 1000], ghostMins: [0, 1e5], callsLike: [0, 1e9] };
function siteFields(data, strs) {
  const d = {};
  for (const [k, max] of Object.entries(strs)) if (k in data) d[k] = clean(data[k], max);
  for (const k of ["sbg", "sbackground", "sbuttons"]) if (k in data) d[k] = color(data[k]);
  return d;
}
const codeFields = (c = {}) => ({ scr: clean(c.scr, 10240) || null, head: clean(c.head, 5120) || null, html: clean(c.html, 10240) || null });
// مفتاح النطاق: www.site.com → site_com
export const domKey = (h) => String(h || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").replace(/[.#$\[\]\/ ]/g, "_").slice(0, 100);

// الحد اليومي للصلاحيات الرقمية (الطرد، الإعلانات، الهدايا، الغرف الثابته) — المالك بدون حد
const QNAME = { kick: "الطرد", publicmsg: "الإعلانات", upgrades: "الهدايا", rooms: "الغرف الثابته" };
export async function quota(k) {
  const cur = (await get(r(`quota/${S.uid}/${k}`))).val();
  const fresh = !(cur && cur.s > now() - 864e5);
  const n = fresh ? 1 : (cur.n || 0) + 1;
  if (!S.owner && n > (S.perms[k] || 0)) { const e = new Error("quota"); e.msg = `لقد استنفدت عدد ${QNAME[k]} اليومي (${S.perms[k] || 0})`; throw e; }
  return { [`quota/${S.uid}/${k}`]: { n, s: fresh ? serverTimestamp() : cur.s, ts: serverTimestamp() } };
}

// أدوات أوامر الإدارة
const key = () => push(r("acts")).key;
function target(uid) {
  if (!okId(uid)) throw new Error("bad");
  return { ...(S.users[uid] || {}), uid };
}
// رسالة في غرفة المطرود باسمه (مثل العنود) — يكتبها المنفّذ، والقواعد تتحقق من صلاحيته
function roomNote(u, m) {
  if (!okId(u.room) || !u.uid) return {};
  const ps = push(r("msgs/" + u.room)).key;
  const snapU = { topic: clean(u.topic, 40), pic: u.pic || "pic.png", ucol: u.ucol || "#000000", mcol: u.mcol || "#000000", bg: u.bg || "#ffffff", ico: "" };
  return { [`msgs/${u.room}/${ps}`]: { t: "k", uid: u.uid, by: S.uid, m, ts: serverTimestamp(), u: snapU } };
}
const kickRec = (k) => ({ k, by: S.uid, t: clean(S.me.topic, 40), ts: serverTimestamp() });
const banRec = (k, v, u) => ({ k, v: clean(v, 220), u: clean(u, 40), by: S.uid, byt: clean(S.me.topic, 40), ts: serverTimestamp() });
// بيانات خاصة لعضو (الآي بي / بصمة الجهاز) — تنقرا بس لأصحاب لوحة التحكم
async function privOf(uid, f) {
  if (!uid || !S.perms.cp) return "";
  try { return (await get(r(`uprv/${uid}/${f}`))).val() || ""; } catch { return ""; }
}
// سطر في سجل "الحالات" — الآي بي مثل العنود: "آي بي المنفّذ | آي بي العضو"
async function act(type, u = {}, room) {
  const rm = room ?? (u.room && S.rooms[u.room]?.topic) ?? "";
  const tip = u.uid ? await privOf(u.uid, "ip") : "";
  return {
    [`acts/${key()}`]: {
      type, u1: clean(S.me?.topic, 60), u2: clean(u.topic, 60), room: clean(rm, 60),
      ip: clean(tip ? `${myIp} | ${tip}` : myIp, 60), by: S.uid, ts: serverTimestamp()
    }
  };
}
let myIp = "";
detectNet().then((n) => { myIp = n.ip || ""; }).catch(() => {});

let callable = null;
async function viaFunctions(type, payload) {
  if (!callable) {
    const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js");
    callable = httpsCallable(getFunctions(app), "action");
  }
  return (await callable({ type, payload })).data;
}

export async function perform(type, payload = {}) {
  // الأخضر بس بعد إرسال/إعجاب/حذف رسالة (طلب المالك) — باقي الأوامر ما تغيّر اللون
  if (/^(like|del)/.test(type) || type === "announce") touch();
  if (BACKEND === "functions") return viaFunctions(type, payload);
  const fn = local[type];
  if (!fn) throw new Error("unknown action: " + type);
  return fn(payload);
}
