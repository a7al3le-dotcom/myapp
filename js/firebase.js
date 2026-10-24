// تهيئة Firebase وأدوات المسارات
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAuth, inMemoryPersistence, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, onValue, connectDatabaseEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, ROOT } from "./config.js";

export const app = initializeApp(firebaseConfig);
// الدخول ما ينحفظ في الجهاز (كل مرة يدخل من صفحة الدخول مثل العنود).
// هذا يمنع تعليق "يتم الاتصال .." لو كانت جلسة قديمة محفوظة وصارت غير صالحة.
// الدخول ما ينحفظ: بعد تحديث الصفحة لازم تدخل بنفسك من صفحة الدخول (طلب المالك)
export const auth = initializeAuth(app, { persistence: inMemoryPersistence });
export const db = getDatabase(app);

// للتجربة المحلية فقط: ?emu=1 يربط الصفحة بمحاكي Firebase بدل القاعدة الحقيقية
if (/[?&]emu=1/.test(location.search) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
}

// r("rooms/main") → مرجع تحت مسار الشات
export const r = (path = "") => ref(db, path ? `${ROOT}/${path}` : ROOT);

// فرق ساعة الجهاز عن ساعة السيرفر
let offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
export const now = () => Date.now() + offset;
