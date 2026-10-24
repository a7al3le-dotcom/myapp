// نقطة البداية: تشغيل كل الأجزاء
import { S, on } from "./state.js";
import { SITE } from "./config.js";
import { tickAgo, ago, flagSrc, countryName, fpKey, fpParse, fpShow } from "./util.js";
import { r } from "./firebase.js";
import { get, query, orderByKey, limitToLast, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { perform } from "./api/actions.js";
import { POWER_FIELDS, sortedPowers } from "./perms.js";
import { SICO } from "./data/sico.js";
import { initPanel, openPanel } from "./ui/panel.js";
import { initEmoji } from "./ui/emoji.js";
import { initColors } from "./ui/colors.js";
import { initLogin } from "./ui/login.js";
import { initUsers } from "./ui/users.js";
import { initRooms, join, leaveRoom, ensureMainRoom, autoJoin } from "./ui/rooms.js";
import { initChat } from "./ui/chat.js";
import { initWall } from "./ui/wall.js";
import { initPm } from "./ui/pm.js";
import { initProfile } from "./ui/profile.js";
import { initNotify } from "./ui/notify.js";
import { initSettings } from "./ui/settings.js";
import { initExtras } from "./ui/extras.js";
import { initBots } from "./ui/bots.js";
import { loadSite, LISTS, mergeList, assetKey, hostKey } from "./site.js";
import { upload, url as picUrl } from "./api/images.js";
import { domKey } from "./api/actions.js";
import { SITE as SITE_ } from "./config.js";
import { COUNTRIES } from "./data/countries.js";

const $ = window.jQuery;

// إعدادات الموقع من لوحة التحكم قبل رسم الصفحة (الاسم، الألوان، طول الأسماء...)
await loadSite();

initPanel();
initEmoji();
initColors();
initLogin();
initUsers();
initRooms();
initChat();
initWall();
initPm();
initProfile();
initNotify();
initSettings();
initExtras();
initBots();

$("#rleave").on("click", leaveRoom);
on("rjoin", (rid) => join(rid));

// بعد الدخول: ندخل الغرفة الأساسية
on("enter", async () => {
  openPanel("users", "المتواجدين"); // العنود يفتح قائمة المتواجدين بعد الدخول
  await ensureMainRoom();
  for (let i = 0; i < 30 && !S.rooms[SITE.defaultRoom]; i++) await new Promise((ok) => setTimeout(ok, 200));
  autoJoin();
});

setInterval(tickAgo, 30000);

// جسر لوحة التحكم (cp.html): اللوحة تنفتح من الشات وتستخدم نفس الاتصال (مثل العنود: window.opener)
// القراءة من هنا، وكل أمر يمر من perform في actions.js
window.AL3 = {
  S, perform, POWER_FIELDS, sortedPowers, ago, flagSrc, countryName, SICO, fpKey, fpParse, fpShow,
  SITE: SITE_, LISTS, mergeList, assetKey, hostKey, domKey, upload, picUrl, COUNTRIES,
  // نافذة إداره الغرفه (نفس اللي في الشات) — تنفتح من تبويب الغرف في اللوحة
  roomCount: (rid) => Object.values(S.users).filter((u) => u.room === rid).length,
  async read(path, last) {
    const q = last ? query(r(path), orderByKey(), limitToLast(last)) : r(path);
    return (await get(q)).val();
  },
  listen(path, cb) { return onValue(r(path), (s) => cb(s.val()), () => cb(null)); }
};
