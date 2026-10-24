// الأسماء الوهمية (Bots): تدخل وتطلع لحالها حسب إعدادات اللوحة.
// بدون سيرفر: كل جهاز يحسب نفس الجدول من الوقت ورقم البوت، فالكل يشوف نفس الشي.
import { r, now } from "../firebase.js";
import { S } from "../state.js";
import { SITE } from "../config.js";
import { onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { putUser, dropUser } from "./users.js";

let bots = {}, cfg = {};
const on_ = new Set();

function h32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
// متصل الحين؟ الوقت مقسوم لفترات (أطول تواجد + أطول غياب) وفي كل فترة يتواجد مده عشوائية ثابتة
export function botOnline(id, t = now(), c = cfg) {
  if (!c.active) return null;
  const minS = Math.max(1, +c.minStay || 0), maxS = Math.max(minS, +c.maxStay || 0);
  const minL = Math.max(0, +c.minLeave || 0), maxL = Math.max(minL, +c.maxLeave || 0);
  const slot = (maxS + maxL) * 60000;
  const k = Math.floor(t / slot);
  const h = h32(id + ":" + k);
  const gap = (minL + ((h >>> 4) % (maxL - minL + 1))) * 60000;
  const stay = Math.min(slot - gap, (minS + (h % (maxS - minS + 1))) * 60000) || slot;
  const start = k * slot + ((h >>> 12) % Math.max(1, slot - stay - gap + 1));
  return t >= start && t < start + stay ? start : null;
}

function tick() {
  const t = now();
  for (const [id, b] of Object.entries(bots)) {
    const uid = "bot_" + id, st = b && botOnline(id, t);
    if (!st) { if (on_.has(uid)) { on_.delete(uid); dropUser(uid); } continue; }
    const room = b.room && S.rooms[b.room] ? b.room : SITE.defaultRoom;
    on_.add(uid);
    putUser(uid, {
      bot: true, topic: b.topic, msg: b.msg || "", pic: b.pic || "pic.png", ucol: b.ucol || "#000000", mcol: b.mcol || "#000000",
      bg: b.bg || "#ffffff", co: b.co || "--", ico: b.ico || "", room, likes: b.likes || 0, g: false,
      h: (h32(id) % 99) + 1, ts: st, la: t, busy: false
    });
  }
  for (const uid of [...on_]) if (!bots[uid.slice(4)]) { on_.delete(uid); dropUser(uid); }
}

export function initBots() {
  onValue(r("botcfg"), (s) => { cfg = s.val() || {}; tick(); }, () => {});
  onValue(r("bots"), (s) => { bots = s.val() || {}; tick(); }, () => {});
  setInterval(tick, 30000);
}
