// الصلاحيات (المجموعات): owners/{uid} = المالك · powers/{pid} = المجموعات · upow/{uid} = مجموعة كل عضو
// S.perms = صلاحياتي الحالية، S.powers = كل المجموعات، S.upow = مجموعات الأعضاء
import { r, now } from "./firebase.js";
import { S, emit } from "./state.js";
import { get, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// الحقول بنفس ترتيب وأسماء العنود
export const POWER_FIELDS = [
  ["rank", "الترتيب", "n"], ["name", "إسم المجموعه", "s"], ["ico", "الأيقونه", "s"], ["kick", "الطرد", "n"],
  ["delbc", "حذف الحائط"], ["alert", "التنبيهات"], ["mynick", "تغير النك"], ["unick", "تغير النكات"],
  ["ban", "الباند"], ["bnr", "البنر"], ["publicmsg", "الإعلانات", "n"], ["ppmsg", "اعلانات السوابر"],
  ["forcepm", "فتح الخاص"], ["roomowner", "إدارة الغرف"], ["createroom", "انشاء الغرف"],
  ["rooms", "أقصى حد للغرف الثابته", "n"], ["edituser", "إدارة العضويات"], ["setpower", "تعيين الاشتراكات"],
  ["upgrades", "الهدايا", "n"], ["history", "كشف النكات"], ["cp", "لوحه التحكم"], ["cprooms", "الغرف"],
  ["cpshrt", "الإختصارات"], ["cpsubs", "الإشتراكات"], ["cpmsgs", "الرسائل"], ["cpwrooms", "غرفة الإنتظار"],
  ["cpsite", "إدارة الموقع"], ["cpdomains", "النطاقات"], ["rjoin", "دخول الغرف المغلقه"], ["stealth", "مخفي"],
  ["setLikes", "لايكات"], ["dmsg", "مسح الرسائل"], ["rinvite", "نقل الزوار"], ["mic", "سحب المايك"],
  ["editpower", "إدارة الصلاحيات"], ["filter", "الفلتر"]
];

S.perms = {};
S.rank = 0;
S.owner = false;
S.powers = {};
S.upow = {};
S.owners = {};

// الاشتراك فعّال؟ (until = 0 دائم)
const active = (x) => !!(x && x.p && (!x.until || x.until > now()) && S.powers[x.p]);

// مجموعة عضو (أو null)
export function powerOf(uid) {
  const x = S.upow[uid];
  return active(x) ? S.powers[x.p] : null;
}
export const isOwner = (uid) => !!S.owners[uid];
export function rankOf(uid) {
  if (isOwner(uid)) return 1e9;
  const p = powerOf(uid);
  return p ? +p.rank || 0 : 0;
}
// الأيقونة جنب الاسم — الأولوية مثل العنود: البنر (sico) ← أيقونة المجموعة ← الهدية (dro3)
S.ubnr = {};
S.ugift = {};
export const icoOf = (uid) => S.ubnr[uid]?.ico || powerOf(uid)?.ico || (S.ugift[uid]?.ico ? (S.ugift[uid].ico.startsWith("db:") ? S.ugift[uid].ico : "dro3/" + S.ugift[uid].ico) : "");
// أقدر أتصرف على هذا العضو؟ (ترتيبه أقل من ترتيبي)
export const above = (uid) => !isOwner(uid) && (S.owner || rankOf(S.uid) > rankOf(uid));

function compute() {
  const uid = S.uid;
  if (!uid) return;
  S.owner = isOwner(uid);
  const p = powerOf(uid);
  const perms = {};
  if (S.owner) {
    for (const [k, , t] of POWER_FIELDS) perms[k] = t === "n" ? 1e6 : t === "s" ? "" : true;
    perms.rank = 1e9;
    if (p) { perms.name = p.name; perms.ico = p.ico || ""; }
  } else if (p) {
    for (const [k, , t] of POWER_FIELDS) perms[k] = t === "n" ? +p[k] || 0 : t === "s" ? p[k] || "" : p[k] === true;
  }
  S.perms = perms;
  S.rank = perms.rank || 0;
  if (S.me) S.me.ico = icoOf(uid);
  emit("perms");
}

let bound = false;
// تحميل أولي قبل الدخول (عشان الدخول المخفي يعرف الصلاحية) ثم متابعة التغييرات
export async function loadPerms() {
  const [o, pw, up, bn, gf] = await Promise.all([get(r("owners")), get(r("powers")), get(r("upow")), get(r("ubnr")), get(r("ugift"))].map((p) => p.catch(() => null)));
  S.owners = o?.val() || {};
  S.powers = pw?.val() || {};
  S.upow = up?.val() || {};
  S.ubnr = bn?.val() || {};
  S.ugift = gf?.val() || {};
  compute();
  if (bound) return;
  bound = true;
  const re = () => { compute(); emit("upow"); };
  onValue(r("owners"), (s) => { S.owners = s.val() || {}; re(); });
  onValue(r("powers"), (s) => { S.powers = s.val() || {}; re(); });
  onValue(r("upow"), (s) => { S.upow = s.val() || {}; re(); });
  onValue(r("ubnr"), (s) => { S.ubnr = s.val() || {}; re(); });
  onValue(r("ugift"), (s) => { S.ugift = s.val() || {}; re(); });
  // الاشتراك ممكن ينتهي وأنا متصل
  setInterval(re, 60000);
}

// المجموعات مرتبة تنازلياً بالترتيب
export const sortedPowers = () => Object.entries(S.powers).map(([id, p]) => ({ id, ...p })).sort((a, b) => (b.rank || 0) - (a.rank || 0));
