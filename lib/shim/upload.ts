// The reference client uploads files with an XMLHttpRequest POST and expects the file's URL back: /pic?secid=..&fn=<ext> for the profile
// picture, /upload?secid=..&fn=<ext> for a picture sent on the wall or in a private chat.
// There is no file server here, so that request is answered locally: the image is resized, stored in the database
// (images/<id>) and the URL /uploads/db-<id>.<ext> is returned. Non-image files are refused (the client shows its own error).
import { push, ref, serverTimestamp, set } from "firebase/database";
import { auth, db } from "../firebase";

// Resizes on upload and keeps lowering quality, then dimensions, until the picture fits the target size
// (about 150 KB for profile pictures, 300 KB for everything else), so the database stays small without a fixed degradation.
async function toJpeg(file: Blob, maxEdge: number, targetB64: number): Promise<{ b64: string; ct: string }> {
  const bmp = await createImageBitmap(file);
  let edge = Math.min(maxEdge, Math.max(bmp.width, bmp.height));
  let q = 0.92, b64 = "";
  for (let i = 0; i < 12; i++) {
    const k = edge / Math.max(bmp.width, bmp.height);
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.imageSmoothingQuality = "high"; g.drawImage(bmp, 0, 0, w, h);
    const url = cv.toDataURL("image/jpeg", q);
    b64 = url.slice(url.indexOf(",") + 1);
    if (b64.length <= targetB64) break;
    if (q > 0.62) q -= 0.1; else edge = Math.max(160, Math.round(edge * 0.85));
  }
  return { b64, ct: "image/jpeg" };
}

const blobB64 = (b: Blob) => new Promise<string>((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(",")[1] ?? ""); f.onerror = rej; f.readAsDataURL(b); });
class UploadXHR {
  readyState = 0; status = 0; responseText = "";
  onreadystatechange: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null;
  upload: Record<string, ((e?: unknown) => void) | null> = { onprogress: null, onerror: null, onabort: null };
  open() { /* the URL is only inspected by the interceptor */ }
  abort() { this.onabort?.(); }
  setRequestHeader() { /* not needed */ }
  async send(body: Blob) {
    try {
      if (!auth.currentUser || !(body instanceof Blob) || !body.type.startsWith("image/")) throw new Error("unsupported");
      // 800px at q=0.9 keeps avatars sharp; 1280px for pictures posted on the wall / chats (the 800 cap applies to secid=u)
      const edge = /^\/pic\?/.test(this.url) ? 800 : 1280;
      // a control-panel upload (sendfilea: icons, gifts, smileys, site pictures, banners; "a=x") keeps the file as it is: transparency and
      // animation (GIF) matter there; anything else is still turned into a JPEG
      const raw = /[?&]a=x(&|$)/.test(this.url) && /^image\/(png|gif|webp|jpeg)$/.test(body.type) && body.size <= 640000;
      const { b64, ct } = raw ? { b64: await blobB64(body), ct: body.type } : await toJpeg(body, edge, 0.9);
      if (b64.length > 880000) throw new Error("too large");
      const r = push(ref(db, "images"));
      await set(r, { uid: auth.currentUser.uid, ct, d: b64, t: serverTimestamp() });
      this.upload.onprogress?.({ loaded: 1, total: 1 });
      this.status = 200; this.readyState = 4; this.responseText = `uploads/db-${r.key}.${ct === "image/jpeg" ? "jpg" : ct.split("/")[1]}`;
      this.onreadystatechange?.();
    } catch { this.upload.onerror?.(); this.onerror?.(); }
  }
  url = "";
}

export function installUploadInterceptor() {
  const Native = window.XMLHttpRequest;
  function Patched(this: unknown) {
    const real = new Native();
    const fake = new UploadXHR();
    let useFake = false;
    return new Proxy(real, {
      get(t, k) {
        if (k === "open") return (m: string, u: string, ...r: unknown[]) => { if (m === "POST" && /^\/?(?:pic|upload)\?/.test(u)) { /* the panel posts to "upload?..." (no slash) */ useFake = true; fake.url = u; return; } (t.open as (...a: unknown[]) => void).call(t, m, u, ...r); };
        const o = (useFake ? fake : t) as unknown as Record<string | symbol, unknown>;
        const v = o[k];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(o) : v;
      },
      set(t, k, v) { ((useFake ? fake : t) as unknown as Record<string | symbol, unknown>)[k] = v; return true; },
    });
  }
  window.XMLHttpRequest = Patched as unknown as typeof XMLHttpRequest;
}
