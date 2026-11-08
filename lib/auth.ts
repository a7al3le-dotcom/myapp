import {
  createUserWithEmailAndPassword,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { ref, serverTimestamp, set, onDisconnect } from "firebase/database";
import { auth, db } from "./firebase";

// Member names may be Arabic/any text, but Firebase needs an e-mail: derive a stable one from the name.
async function emailFor(name: string): Promise<string> {
  const norm = name.trim().toLowerCase();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  return `m${hex}@members.al3nood.chat`;
}
// Firebase requires >= 6 chars; pad with a constant suffix so shorter passwords still work.
const pw = (p: string) => p + "~al3nood";

export type LoginResult = { ok: true; uid: string } | { ok: false; error: string };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

async function writeProfile(uid: string, topic: string, registered: boolean, stealth: boolean) {
  await set(ref(db, `profiles/${uid}`), {
    topic: topic.slice(0, 50),
    registered,
    createdAt: Date.now(),
  });
  const p = ref(db, `presence/${uid}`);
  await set(p, { online: true, lastSeen: Date.now(), stealth });
  await onDisconnect(p).set({ online: false, lastSeen: serverTimestamp(), stealth });
}

export async function loginVisitor(rawName: string): Promise<LoginResult> {
  const name = clean(rawName);
  if (!name) return { ok: false, error: "أكتب الاسم المستعار" };
  try {
    const cred = await signInAnonymously(auth);
    await writeProfile(cred.user.uid, name, false, false);
    return { ok: true, uid: cred.user.uid };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export async function loginMember(rawName: string, pass: string, stealth: boolean): Promise<LoginResult> {
  const name = clean(rawName);
  if (!name || !pass) return { ok: false, error: "اكتب اسم العضو وكلمه المرور" };
  try {
    const cred = await signInWithEmailAndPassword(auth, await emailFor(name), pw(pass));
    await set(ref(db, `presence/${cred.user.uid}`), { online: true, lastSeen: Date.now(), stealth });
    return { ok: true, uid: cred.user.uid };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export async function registerMember(rawName: string, pass: string): Promise<LoginResult> {
  const name = clean(rawName);
  if (!name || !pass) return { ok: false, error: "اكتب اسم العضو وكلمه المرور" };
  try {
    const cred = await createUserWithEmailAndPassword(auth, await emailFor(name), pw(pass));
    await writeProfile(cred.user.uid, name, true, false);
    return { ok: true, uid: cred.user.uid };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export const logout = () => signOut(auth);

function describe(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code.includes("email-already-in-use")) return "الاسم مسجل مسبقا";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "اسم العضو او كلمه المرور غير صحيحه";
  if (code.includes("network")) return "فشل الاتصال";
  return "تعذر تنفيذ الطلب";
}
