import { get, onDisconnect, onChildAdded, onChildRemoved, onValue, push, ref, remove, serverTimestamp, set, update, type Unsubscribe } from "firebase/database";
import { auth, db } from "./firebase";

export type Room = { id: string; pub?: boolean; pic?: string; topic: string; owner: string; max: number; about?: string; welcome?: string; hasPass?: boolean; createdAt?: number };
export type Profile = { topic: string; msg?: string; pic?: string; ucol?: string; mcol?: string; bg?: string; registered?: boolean };
export type Msg = { id: string; uid: string; msg: string; t: number; topic?: string; pic?: string; ucol?: string; mcol?: string };

const uid = () => auth.currentUser!.uid;

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function watchRooms(cb: (rooms: Room[]) => void): Unsubscribe {
  return onValue(ref(db, "rooms"), (s) => {
    const v = (s.val() ?? {}) as Record<string, Omit<Room, "id">>;
    cb(Object.entries(v).map(([id, r]) => ({ id, ...r })));
  });
}

export function watchMembers(rid: string, cb: (uids: string[]) => void): Unsubscribe {
  return onValue(ref(db, `members/${rid}`), (s) => cb(Object.keys(s.val() ?? {})));
}

// rid -> uids of everyone currently inside that room
export function watchAllMembers(cb: (m: Record<string, string[]>) => void): Unsubscribe {
  return onValue(ref(db, "members"), (s) => {
    const out: Record<string, string[]> = {};
    s.forEach((c) => { out[c.key!] = Object.keys(c.val() ?? {}); });
    cb(out);
  });
}

// uids that are online and not in stealth mode
export function watchOnline(cb: (uids: string[]) => void): Unsubscribe {
  return onValue(ref(db, "presence"), (s) => {
    const out: string[] = [];
    s.forEach((c) => { const v = c.val() as { online?: boolean; stealth?: boolean }; if (v?.online && !v.stealth) out.push(c.key!); });
    cb(out);
  });
}

export function watchPowers(cb: (p: Record<string, number>) => void): Unsubscribe {
  return onValue(ref(db, "powers"), (s) => {
    const out: Record<string, number> = {};
    s.forEach((c) => { out[c.key!] = Number(c.child("level").val() ?? 0); });
    cb(out);
  });
}

export async function permLevel(name: string): Promise<number> {
  const v = (await get(ref(db, `config/perms/${name}`))).val();
  return typeof v === "number" ? v : Infinity;
}

const profileCache = new Map<string, Profile>();
export async function profileOf(u: string): Promise<Profile> {
  const hit = profileCache.get(u);
  if (hit) return hit;
  const p = ((await get(ref(db, `profiles/${u}`))).val() ?? { topic: "؟" }) as Profile;
  profileCache.set(u, p);
  return p;
}
export const invalidateProfile = (u: string) => profileCache.delete(u);

export async function createRoom(f: { topic: string; about?: string; welcome?: string; pass?: string; max?: number }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const topic = f.topic.trim();
  if (!topic) return { ok: false, error: "اكتب اسم الغرفه" };
  const max = Math.min(40, Math.max(2, Number(f.max) || 10));
  const id = push(ref(db, "rooms")).key!;
  const data: Record<string, unknown> = { topic: topic.slice(0, 80), owner: uid(), max, createdAt: Date.now() };
  if (f.about?.trim()) data.about = f.about.trim().slice(0, 200);
  if (f.welcome?.trim()) data.welcome = f.welcome.trim().slice(0, 300);
  const pass = f.pass?.trim();
  if (pass) data.hasPass = true;
  try {
    await set(ref(db, `rooms/${id}`), data);
    if (pass) await set(ref(db, `roomSecrets/${id}`), await sha(pass));
    return { ok: true, id };
  } catch { return { ok: false, error: "تعذر انشاء الغرفه" }; }
}

export const PUBLIC_MAX = 40;
/** Owner value of public rooms: not a user id, so no visitor ever owns a public room. */
export const SYSTEM_OWNER = "system";
export const publicName = (n: number) => `الغرفه العامه ( ${n} )`;
export const publicNo = (r: Room) => (r.pub ? Number(/\(\s*(\d+)\s*\)/.exec(r.topic)?.[1] ?? 0) : 0);
// Public rooms are created on demand with the lowest free number; id is deterministic so two racing creators collide harmlessly.
export async function createPublicRoom(n: number): Promise<Room | null> {
  const id = `pub${n}`;
  const data = { topic: publicName(n), owner: uid(), max: PUBLIC_MAX, pub: true, createdAt: Date.now() };
  let created = false;
  try { await set(ref(db, `rooms/${id}`), data); created = true; } catch { /* someone else created it first */ }
  // The rules require a new room to name its creator as owner, and an owner may remove members. A public room must not belong to
  // whichever visitor happened to arrive first, so the creator hands it to the system straight away. Only a creator can do this
  // (the rules let the current owner edit the room); the room then has no person as its owner, rank powers still apply.
  if (created) { try { await update(ref(db, `rooms/${id}`), { owner: SYSTEM_OWNER }); data.owner = SYSTEM_OWNER; } catch { /* keep going: the room works either way */ } }
  return { id, ...data };
}
export async function deleteRoom(id: string) {
  await remove(ref(db, `rooms/${id}`));
  await remove(ref(db, `roomSecrets/${id}`)).catch(() => {});
}

export async function joinRoom(r: Room, pass?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (r.hasPass && !pass) return { ok: false, error: "الغرفه محميه بكلمه مرور" };
  const data: Record<string, unknown> = { joinedAt: Date.now() };
  if (r.hasPass) data.ph = await sha(pass!);
  try {
    const mref = ref(db, `members/${r.id}/${uid()}`);
    await set(mref, data);
    onDisconnect(mref).remove(); // closing the tab leaves the room
    return { ok: true };
  } catch { return { ok: false, error: r.hasPass ? "كلمه المرور غير صحيحه" : "تعذر الدخول للغرفه" }; }
}

export const leaveRoom = (rid: string) => remove(ref(db, `members/${rid}/${uid()}`));

export function watchMessages(rid: string, onAdd: (m: Msg) => void, onDel: (id: string) => void): Unsubscribe {
  const q = ref(db, `messages/${rid}`);
  const a = onChildAdded(q, (s) => onAdd({ id: s.key!, ...(s.val() as Omit<Msg, "id">) }));
  const d = onChildRemoved(q, (s) => onDel(s.key!));
  return () => { a(); d(); };
}

export async function sendMessage(rid: string, text: string, me: Profile) {
  const msg = text.replace(/\s+$/g, "").slice(0, 2000);
  if (!msg.trim()) return false;
  const m: Record<string, unknown> = { uid: uid(), msg, t: serverTimestamp(), topic: me.topic.slice(0, 120) };
  if (me.pic) m.pic = me.pic;
  if (me.ucol) m.ucol = me.ucol;
  if (me.mcol) m.mcol = me.mcol;
  await set(push(ref(db, `messages/${rid}`)), m);
  return true;
}

export const deleteMessage = (rid: string, mid: string) => remove(ref(db, `messages/${rid}/${mid}`));
export const saveProfile = (p: Partial<Profile>) => update(ref(db, `profiles/${uid()}`), p);
