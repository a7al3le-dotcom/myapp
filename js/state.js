// الحالة المشتركة بين الملفات + ناقل أحداث بسيط
export const S = {
  uid: null,          // معرّف المستخدم الحالي
  me: null,           // بيانات تواجدي (نفس شكل online/{uid})
  member: false,      // عضو مسجل؟
  users: {},          // المتواجدين: uid → بيانات
  rooms: {},          // الغرف: rid → بيانات
  room: null,         // الغرفة الحالية
  ignored: new Set(), // المتجاهَلين (محلي)
  nonot: false,       // تعطيل التنبيهات
  inChat: false
};

const handlers = {};
export const on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
export const emit = (ev, ...a) => { (handlers[ev] || []).forEach((fn) => { try { fn(...a); } catch (e) { console.error(ev, e); } }); };

// تخزين محلي آمن
export const getv = (k, d = null) => { try { const v = localStorage.getItem("al3_" + k); return v === null ? d : v; } catch { return d; } };
export const setv = (k, v) => { try { v === null ? localStorage.removeItem("al3_" + k) : localStorage.setItem("al3_" + k, v); } catch {} };
