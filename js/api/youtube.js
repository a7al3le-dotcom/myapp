// البحث في يوتيوب — البوابة الوحيدة.
// 1) لو فيه مفتاح YouTube Data API في config (ytKey): نستخدم بحث قوقل الرسمي (ثابت، 100 بحث يومياً مجاناً).
// 2) بدون مفتاح أو لو خلص الحد: نجرب سيرفرات Piped المجانية وحدة ورا الثانية (أقل ثبات).
// عند Blaze: نقدر نحوّلها لـCloud Function بنفس الدالة search().
import { SITE } from "../config.js";

const PIPED = [
  "https://api.piped.private.coffee",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.r4fo.com",
  "https://pipedapi.leptons.xyz"
];

const cache = new Map();
const okId = (id) => /^[\w-]{11}$/.test(id || "");

async function viaGoogle(q) {
  const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${encodeURIComponent(q)}&key=${encodeURIComponent(SITE.ytKey)}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error("google " + res.status);
  const j = await res.json();
  return (j.items || []).map((it) => ({
    id: it.id && it.id.videoId,
    title: it.snippet?.title || "",
    ch: it.snippet?.channelTitle || ""
  })).filter((x) => okId(x.id));
}

async function viaPiped(q) {
  for (const base of PIPED) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const j = await res.json();
      const list = (j.items || []).map((it) => ({
        id: String(it.url || "").replace(/^.*[?&]v=/, "").slice(0, 11),
        title: it.title || "",
        ch: it.uploaderName || ""
      })).filter((x) => okId(x.id));
      if (list.length) return list;
    } catch {}
  }
  throw new Error("piped");
}

// يرجع [{id, title, ch}] أو يرمي خطأ
export async function search(q) {
  q = String(q || "").trim();
  if (!q) return [];
  if (cache.has(q)) return cache.get(q);
  let list;
  if (SITE.ytKey) {
    try { list = await viaGoogle(q); } catch { list = await viaPiped(q); }
  } else list = await viaPiped(q);
  cache.set(q, list);
  return list;
}

export const thumb = (id) => `https://img.youtube.com/vi/${id}/mqdefault.jpg`;

// رابط يوتيوب أو رقم المقطع → رقم المقطع
export function parseYt(s) {
  s = String(s || "").trim();
  const m = s.match(/(?:youtu\.be\/|[?&]v=|shorts\/|embed\/|live\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}
