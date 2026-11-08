// A stand-in for the reference site's Socket.IO server. The original client script runs unchanged;
// every command it sends is translated into Firebase operations, and Firebase changes are translated
// back into the events that client expects (payload shapes were taken from the reference site's traffic and code).
import { createUserWithEmailAndPassword, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  equalTo, get, increment, limitToLast, orderByChild, startAt, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, onValue, push, query, ref, remove, serverTimestamp, set, update,
  type Unsubscribe,
} from "firebase/database";
import { auth, db } from "../firebase";
import { PUBLIC_MAX, createPublicRoom, publicNo, type Room } from "../chat";
import { RANKS, SETTINGS, scramble, unscramble } from "./protocol";
import { DRO3, EMOS, SICO } from "./data";
import { DEFAULT_POWER, POWERS } from "./powers";
import { esc, safeFile, safeId, safePic, sanitizeOut, type SanitizeOptions } from "./escape";
import { cpDecision, cpNeed, gateDecision, gateFor, mayActOver, rankState, type Alt, type Facts, type Gate } from "./cp-perms";
import { shapeSite } from "./site";
import { sha256Hex } from "./sha256";
import { memberMatches } from "./members-search";
import { collectFp } from "./fp-collect";
import { compactFp } from "./fp";
import { banPath, banText, lastCell, type BanRec } from "./bans";
// «فلتر» column «التصنيف»: wmsgs / bmsgs as shown by the original panel (2026-11-05); amsgs had no row there, its label follows the «كلمه ممنوعه» pattern (inferred)
const IDLE_MS = 5 * 60000; // yellow after 5 minutes without a command (measured)
// What turns a yellow dot green again (measured on the original 2026-11-06, idle-orig.mjs / idle2-orig.mjs, and the owner's description): sending
// something — a room / private / wall message, a file, a like, an alert — typing («ty», sent by the page while one types in a private chat: green
// within 5 s), «تعطيل المحادثات», changing anything (profile, picture, rooms, moderation, control-panel changes). NOT: mouse moves or clicks
// without a command, reading commands (ops: stayed yellow; a control-panel read: stayed yellow), a reconnect (stayed yellow), changing room.
const ACTIVE_CMDS = new Set(["msg", "pm", "file", "bc", "likebc", "ty", "busy", "setprofile", "setpic", "action", "unick", "bnr", "bnr-", "setLikes",
  "pmsg", "ppmsg", "r+", "r^", "r-", "op+", "op-", "rinvite", "dmsg", "delbc"]);
// x3 cp_powerchange «dorrace»: the rank form's field order. A rank row is sent with these keys first, in this order, then the others.
const DORRACE = ["rank", "name", "ico", "kick", "delbc", "alert", "mynick", "unick", "ban", "bnr", "publicmsg", "ppmsg", "forcepm", "roomowner", "createroom", "rooms",
  "edituser", "setpower", "upgrades", "history", "cp", "cprooms", "cpshrt", "cpsubs", "cpmsgs", "cpwrooms", "cpsite", "cpdomains", "rjoin", "stealth", "setLikes", "dmsg",
  "rinvite", "mic", "editpower", "filter"];
const dorraceOrder = <T extends object>(row: T): T => {
  const r = row as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const k of DORRACE) if (k in r) out[k] = r[k];
  for (const k of Object.keys(r)) if (!(k in out)) out[k] = r[k];
  return out as T;
};
const CP_READS = new Set(["logins", "fps", "actions", "bans", "rooms", "shrt", "msgs", "subs", "fltr", "wrooms", "domains", "owner", "bots", "sico"]);
const lim = (v: unknown) => Math.max(1, Math.min(50, Number(v) || 50)); // «عدد أحرف ...» 1..50, 50 when unset (the original clamps the same way)
// a forbidden word in a name blocks registering / entering (checked by the server: the word list is not readable before signing in)
// guest: also «is this name free for me» (a member's name, or a guest still listed on another device AND another IP -> no); the device string goes along
// returns true, false (the name), or "maxip" (too many connected from this device: «تعدد النكات من نفس الجهاز»)
async function nameOk(name: string, guest = false, n?: unknown): Promise<boolean | "maxip"> {
  try {
    const dev = await collectFp((n ?? (typeof navigator !== "undefined" ? (navigator as unknown as { n?: Obj }).n : undefined)) as Obj | undefined).catch(() => null);
    const r = await fetch("/api/name-ok", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, parts: dev?.parts, fp: dev?.fp, ...(guest ? { guest: true } : {}) }) });
    if (!r.ok) return true; const j = await r.json(); return j.ok !== false ? true : j.reason === "maxip" ? "maxip" : false;
  } catch { return true; }
}
const FLTR_LABEL: Record<string, string> = { wmsgs: "مراقبه", bmsgs: "كلمه ممنوعه", amsgs: "كلمه مسموحه" };
import { FLAG_CODES, flagCode } from "./flags";
import { colourCss } from "./site-colors";
import { DOMAIN_TEXT, domainKey, normDomain } from "./domain";
// names / countries for a new bot (the owner can change each one afterwards, as in the original menu)
const BOT_NAMES = ["ريم", "نوف", "سارا", "لولو", "غلا", "جود", "شهد", "رهف", "دانه", "روان", "فهد", "سعود", "خالد", "ناصر", "تركي", "بدر", "ماجد", "عبدالله", "فيصل", "نواف", "همس", "قمر", "ليان", "مها", "عزوز", "سلطان", "ياسر", "حمد", "عمر", "ريان"];
const BOT_COUNTRIES = ["SA", "SA", "SA", "KW", "AE", "QA", "BH", "OM", "EG", "IQ", "JO", "YE"];
import { DESC as D_DESC, KEYWORDS as D_KEYWORDS, NAME as D_NAME, TITLE as D_TITLE } from "./site-defaults";
// «إداره الموقع» > الايقونات: favicon.ico, prv1.png (the login header logo / share picture), pic.png (a member without a picture), room.png (a
// room without one). The original replaces those root files (cp favicon / prv1 / pic / room with an uploaded fn). Here the uploaded picture is
// stored in config/files and applied AT ONCE on every open page: the tab icon, every prv1 picture, and x3's own user_pic / room_pic (x3 L1165,
// L3482, L4511 swap "pic.png" / "room.png" for them). A key that is not set keeps the built-in file.
const SITE_FILE_OK = /^uploads\/db-[\w-]{1,40}\.(png|gif|webp|jpg|ico)$/;
function applySiteFiles(f: Record<string, string>) {
  if (typeof document === "undefined") return;
  const w = window as unknown as { user_pic?: unknown; room_pic?: unknown };
  const ok = (k: string) => (typeof f[k] === "string" && SITE_FILE_OK.test(f[k]) ? f[k] : "");
  w.user_pic = ok("pic") || null; w.room_pic = ok("room") || null;
  const fav = ok("favicon") || "favicon.ico";
  document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']").forEach((l) => { if (l.getAttribute("href") !== fav) l.setAttribute("href", fav); });
  const swap = (base: string, now: string) => document.querySelectorAll<HTMLImageElement>("img").forEach((i) => {
    const cur = i.getAttribute("data-site-file") ?? ((i.getAttribute("src") || i.getAttribute("dsrc") || "").split("?")[0] === base ? base : null);
    if (cur !== base) return; i.setAttribute("data-site-file", base);
    if (i.hasAttribute("dsrc") && !i.getAttribute("src")) i.setAttribute("dsrc", now); else i.setAttribute("src", now);
  });
  swap("prv1.png", ok("prv1") || "prv1.png"); swap("favicon.ico", fav); swap("pic.png", ok("pic") || "pic.png"); swap("room.png", ok("room") || "room.png");
}
// «إداره الموقع» > the name / title / description / keywords / colours, applied LIVE on every open page when they are saved (the server writes
// them into the page on the next load, lib/server/site-settings.ts). Empty fields keep what the page already shows.
// «الرد على التنبيه» (from x5, owner's request 2026-11-06; x5 L10627-10650): an alert's notification carries an envelope «رد» button; it closes the
// notification and opens the alert window (#mmnot) for the sender, whose «إرسال» sends the alert back (x5 fn386 -> fn385, the same shape as x3 fn67).
// x3.js is not changed: x3 draws the notification as before, this adds the button to it.
// x5 (#mmnot .emobox, L14141): after opening the smiley box it clears its "left" so the box sits right under the button. x3's own handler (fn54)
// opens the same box without that step; this runs just after it (x3 appends the box in a setTimeout).
if (typeof document !== "undefined") document.addEventListener("click", (e) => {
  if (!(e.target as Element | null)?.closest?.("#mmnot .emobox")) return;
  setTimeout(() => document.querySelectorAll<HTMLElement>("#mmnot .ppop").forEach((b) => { b.style.left = ""; b.style.maxHeight = "310px"; }), 30);
});
function addAlertReply(uid: string, topic: string, send: (id: string, msg: string) => void) {
  if (typeof document === "undefined") return;
  setTimeout(() => {
    // x3 appends the notification to <body> at once (case "not"); its sender row (.uzr) shows the sender's name (.u-topic)
    const box = [...document.querySelectorAll<HTMLElement>("body > div.corner")].reverse().find((e) => !e.querySelector(".alert-reply") && [...e.querySelectorAll(".uzr .u-topic")].some((t) => t.textContent === topic));
    if (!box) return;
    const b = document.createElement("button");
    b.type = "button"; b.title = "رد"; b.className = "fl fa fa-envelope-o btn unot borderg alert-reply";
    b.setAttribute("style", "color:black;margin:2px 0px 0px 0px;width:34px;height:26px;padding:4px;text-align:center;outline:1px solid #0000001f;");
    b.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation(); box.remove();
      const $ = (window as unknown as { $?: (s: string) => { find: (s: string) => { show: () => { off: () => { on: (ev: string, f: () => void) => void } }; val: (v?: string) => string & { focus: () => void } }; modal: (a?: string) => void } }).$;
      if (!$) return;
      const m = $("#mmnot");
      m.find(".rsave").show().off().on("click", () => {
        m.modal("hide");
        const msg = String(m.find("textarea").val() ?? "").split("\n").join(" ").trim();
        if (msg) send(uid, msg);
      });
      m.modal(); (m.find("textarea").val("") as unknown as { focus: () => void }).focus?.();
    });
    (box.querySelector(".uzr") ?? box).appendChild(b);
  }, 0);
}
function applySiteText(s: Obj) {
  if (typeof document === "undefined") return;
  const str = (k: string) => (typeof s[k] === "string" && (s[k] as string).trim() !== "" ? (s[k] as string) : "");
  // an emptied field goes back to the reference page's own text at once (no reload)
  const title = str("title") || D_TITLE, desc = str("description") || D_DESC;
  const meta = (sel: string, v: string) => document.querySelectorAll<HTMLMetaElement>(sel).forEach((m) => { if (m.getAttribute("content") !== v) m.setAttribute("content", v); });
  if (document.title !== title) document.title = title;
  meta("meta[name='description']", desc); meta("meta[property='og:description']", desc);
  meta("meta[property='og:title']", title); meta("meta[name='keywords']", str("keywords") || D_KEYWORDS);
  const tl = document.getElementById("tlogins");
  // the top bar of the login screen shows the site name (x3 body: <a class="label bg"><img prv1><span>name</span>)
  document.querySelectorAll("#tlogins a.label.bg > span.flex-grow-1").forEach((e) => { const v = str("name") ? " " + str("name") + " " : D_NAME; if (e.textContent !== v) e.textContent = v; });
  if (tl) { const d = tl.querySelector(":scope > .hid"); if (d) d.textContent = str("name") ? " " + str("name") + " " : D_NAME; const h = tl.querySelector(":scope > h1"); if (h) h.textContent = " " + desc + " "; }
  let st = document.getElementById("site-colors"); if (!st) { st = document.createElement("style"); st.id = "site-colors"; document.head.appendChild(st); }
  const css = colourCss({ bg: str("bg"), background: str("background"), buttons: str("buttons") }); if (st.textContent !== css) st.textContent = css;
}
// The control panel page (/cp) runs no chat session, so it follows the site pictures on its own: its tab icon and the four previews in
// «إداره الموقع» > الايقونات change at once too (the panel window shares the opener's sign-in).
let cpFilesWatch = false;
export function watchSiteFilesStandalone() {
  if (cpFilesWatch || typeof window === "undefined") return; cpFilesWatch = true;
  const off = onAuthStateChanged(auth, (u) => {
    if (!u) return; off(); onValue(ref(db, "config/files"), (s) => applySiteFiles((s.val() ?? {}) as Record<string, string>), () => {});
    // owner 2026-11-07: on the original the panel's tab name and colours follow the site settings at once. Name (else the title) + colours,
    // this host's «النطاقات» entry winning like Server.effectiveSite (the first paint comes from functions/cp.ts)
    let site: Obj = {}, doms: Record<string, Obj> = {};
    const apply = () => {
      const d = doms[domainKey(normDomain(location.hostname))] ?? {}; const o: Obj = { ...site };
      for (const k of [...DOMAIN_TEXT, "bg", "background", "buttons"]) if (typeof d[k] === "string" && (d[k] as string).trim() !== "") o[k] = d[k];
      const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
      const t = str("name") || str("title"); if (t && document.title !== t) document.title = t;
      let st = document.getElementById("site-colors"); if (!st) { st = document.createElement("style"); st.id = "site-colors"; document.head.appendChild(st); }
      const css = colourCss({ bg: str("bg"), background: str("background"), buttons: str("buttons") }); if (st.textContent !== css) st.textContent = css;
    };
    onValue(ref(db, "config/site"), (s) => { site = (s.val() ?? {}) as Obj; apply(); }, () => {});
    onValue(ref(db, "config/domains"), (s) => { doms = (s.val() ?? {}) as Record<string, Obj>; apply(); }, () => {});
  });
}
// «النطاقات»: a domain is its last two labels (x3 fn95: "https://www.site.com/x" -> "site.com"); stored under config/domains/<site,com>.
// A page opened from a listed domain shows that domain's texts / colours / banner instead of the main site's (applied live here).
// The copyright line (public/js/site-inline-1.js) shows the chat name from the control panel's site settings, so each site shows its own name.
// textContent only: the name is shown as plain text, never as markup.
function showSiteName(v: unknown) {
  if (typeof document === "undefined") return;
  const name = typeof v === "string" ? v.trim() : "";
  document.querySelectorAll(".cop .site-name").forEach((e) => { e.textContent = name ? name + ". " : ""; });
}

// The control panel (x3.js L2692-2697) feeds these three straight into jscolor.fromString() (it throws on undefined) and the save button sends
// the pickers' values back (sett_save: $(".sbg").val(), jscolor hex without "#"). While nothing is stored, the panel shows the colours the page
// really uses — the reference page's own rules: .bg / .btn-primary #733E4C, .light #FFFFFF (index.2026-11-04-a.html) — so saving the tab as it
// is keeps the site looking the same.
const NO_COLOURS = { bg: "733E4C", background: "FFFFFF", buttons: "733E4C" };
// settings() below treats these two as ON when nothing is stored (`!== false`). The control panel must show the SAME effective value, otherwise it displays them unticked while the
// site behaves as enabled, and saving the panel as shown would switch wall likes / wall replies off by accident. Keep this list identical to the `!== false` keys of settings().
const EFFECTIVE_DEFAULTS = { bclikes: true, bcreply: true };
// The reference site's control-panel status log («الحالات») shows these Arabic labels. Read from its live log on 2026-11-03 (200 rows): طرد · طرد من الغرفه · حظر · حذف صوره · تعديل صلاحيه · لايكات · حذف الحائط · زخرفه · بنر · تعديل غرفه.
// The stored `type` stays a stable code; the panel reply maps it to the label. A type missing here is shown raw (nothing is invented). unban, op+/op- and room-message deletion are NOT here: no such row was seen in the reference log, so their label is unknown.
const ACTION_LABELS: Record<string, string> = { kick: "طرد", roomkick: "طرد من الغرفه", ban: "حظر", delpic: "حذف صوره", setpower: "تعديل صلاحيه", setlikes: "لايكات", delbc: "حذف الحائط", nick: "زخرفه", bnr: "بنر", editroom: "تعديل غرفه", dmsg: "مسح", unban: "فك الحظر", wroom: "غرفه الإنتظار", delu: "حذف عضويه", op: "مراقب", deop: "إزاله مراقب", mkroom: "انشاء غرفه", rdel: "حذف غرفه", move: "نقل" };

type Prof = { topic: string; name?: string; msg?: string; pic?: string; ucol?: string; mcol?: string; bg?: string; co?: string; registered?: boolean; busy?: boolean };
type Pw = { level: number; name?: string };
type Handler = (m: { cmd: string; data: unknown }) => void;
type Obj = Record<string, unknown>;

// room title, description and welcome text: shown as plain text in the room list but possibly as markup elsewhere (the move-to-room selector)
const ROOM_TEXT: SanitizeOptions = { soft: ["topic", "about", "welcome"] };
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const HEX = /^#[0-9a-fA-F]{6}$/;
// crypto.subtle is missing on a non-secure origin (a phone opening http://192.168.x.x): fall back to the same digest in plain JS
const sha = async (s: string) => (typeof crypto !== "undefined" && crypto.subtle ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("") : sha256Hex(s));
// the client's `refr` / `r` strings as plain capped text (the server re-validates them)
const srcOf = (d: Obj) => ({ refr: typeof d.refr === "string" ? d.refr.slice(0, 100) : "", r: typeof d.r === "string" ? d.r.slice(0, 100) : "" });
const emailFor = async (name: string) => `m${(await sha(name.trim().toLowerCase())).slice(0, 40)}@members.al3nood.chat`;
const padPw = (p: string) => p + "~al3nood";
async function country(): Promise<string> {
  // a code kept from an earlier lookup (or, on the emulator, set by hand for testing): used only when it has a flag picture
  try { const c = (localStorage.getItem("co") ?? "").trim().toLowerCase(); if (FLAG_CODES.has(c)) return c; } catch { /* storage unavailable */ }
  // emulator mode: no third-party lookup, unless the tester's launcher turns it on (NEXT_PUBLIC_GEO_LOOKUP=1, set by
  // تشغيل-النسخة-المعزولة.cmd so flags show as on the real site). The automated tests never set it.
  if (process.env.NEXT_PUBLIC_USE_EMULATOR === "1" && process.env.NEXT_PUBLIC_GEO_LOOKUP !== "1") return "";
  try {
    const r = await fetch("https://get.geojs.io/v1/ip/country.json", { signal: AbortSignal.timeout(3500) });
    const co = String((await r.json()).country ?? "").toLowerCase();
    if (FLAG_CODES.has(co)) { try { localStorage.setItem("co", co); } catch { /* ignore */ } return co; }
  } catch { /* offline: leave unknown */ }
  return "";
}
// A picture uploaded through /upload (lib/shim/upload.ts) is "uploads/db-<id>.jpg". The reference server puts such a link into the message as
// <a class="uplink" href="..."> and the client (x3.js) turns it into a thumbnail / "عرض الصوره" button. Only this exact local shape is
// accepted (letters, digits, - and _ only), so nothing a user types can become markup.
const UPLOAD_LINK = /^uploads\/db-[\w-]{1,40}\.jpg$/;
const uplink = (l: unknown) => (typeof l === "string" && UPLOAD_LINK.test(l) ? `<a class="uplink" href="${l}"></a>` : "");
const pairKey = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);

// Reconnecting (x3.js lines 1031-1120 / 2000-2027, measured on al3nood.net 2026-11-05): when the connection drops the page shows «.. يتم إعاده الاتصال»
// and calls io() again every 3 s, at most 6 times; a new socket that connects sends rc2 {token, n: k} and the server answers rc, rcd [missed events], ok.
// Here the "connection" is the database's (.info/connected). The session (its Server object, still listening to the database) is kept while it is
// dropped; what it would have sent meanwhile is kept for rcd. `k` rides on every message once the login is complete («إستعاده الاتصال» on).
type Session = { server: Server; k: string; dropped: boolean; pending: [string, unknown][] };
let session: Session | null = null;
let netUp = true;
// this page's guest name was taken by a newer guest (see Server.checkReplaced): its reconnect attempts fail from then on, like the original
let replaced = false;
export class FakeSocket {
  connected = false;
  private handlers: Record<string, Handler[]> = {};
  private server: Server | null = null;
  constructor() {
    if (session?.dropped) {
      // an attempt of x3.js to come back: it succeeds only when the database connection is back (offline: an immediate failure, like a websocket)
      setTimeout(() => { if (netUp && !replaced) { this.connected = true; this.fire("connect", undefined); } else this.fire("connect_error", "offline"); }, 0); // immediate, like a websocket that cannot open (timeline then matches the original: red at 18 s)
      return;
    }
    this.startServer();
    setTimeout(() => { this.connected = true; this.fire("connect", undefined); this.server!.onConnect(); }, 0);
  }
  private startServer() { this.server = new Server((cmd, data) => this.deliver(cmd, data), () => this.fire("disconnect", "transport close")); }
  deliver(cmd: string, data?: unknown) {
    const k = session && session.server === this.server && !session.dropped ? session.k : undefined;
    this.fire("msg", { cmd: scramble(cmd), data, ...(k ? { k } : {}) });
  }
  on(ev: string, fn: Handler) { (this.handlers[ev] ||= []).push(fn); return this; }
  off() { return this; }
  removeAllListeners() { this.handlers = {}; return this; }
  private fire(ev: string, payload: unknown) { (this.handlers[ev] || []).forEach((h) => { try { h(payload as never); } catch (e) { console.error("[shim]", ev, e); } }); }
  emit(ev: string, payload: { cmd?: string; data?: unknown; token?: unknown; n?: unknown }) {
    if (ev === "rc2") {
      const s = session;
      if (!s || !s.dropped || payload?.n !== s.k) { this.fire("msg", { cmd: scramble("close"), data: {} }); return this; } // unknown session: the page closes (x3.js case "close")
      this.server = s.server; s.dropped = false;
      s.server.attach((cmd, data) => this.deliver(cmd, data), () => this.fire("disconnect", "transport close"));
      const missed = s.pending; s.pending = [];
      this.deliver("rc"); this.deliver("rcd", missed); this.deliver("ok");
      void s.server.resume();
      return this;
    }
    if (ev === "msg" && payload && payload.cmd) {
      if (!this.server) { if (session?.dropped) { session.server.dispose(); session = null; } this.startServer(); this.server!.onConnect(); } // a fresh start instead of a reconnect
      this.server!.handle(unscramble(payload.cmd), payload.data);
    }
    return this;
  }
  close() { this.connected = false; if (!(session?.dropped && session.server === this.server)) this.server?.dispose(); return this; }
  disconnect() { return this.close(); }
}

class Server {
  constructor(private out: (cmd: string, data?: unknown) => void, private drop: () => void) {}
  attach(out: (cmd: string, data?: unknown) => void, drop: () => void) { this.out = out; this.drop = drop; }
  // the database connection: dropped after login -> the page's reconnect overlay; back -> the page's next attempt succeeds (rc2)
  private watchNet() {
    let seen = false;
    this.offs.push(onValue(ref(db, ".info/connected"), (s) => {
      const up = s.val() === true; netUp = up;
      if (up) { seen = true; return; }
      if (!seen || !this.ready) return;
      this.lost = true;
      if (session && session.server === this) { session.dropped = true; const pend = session.pending; this.out = (cmd, data) => { pend.push([cmd, data]); }; }
      this.drop(); // x3.js: «غير متصل», then the overlay and its attempts
    }));
  }
  // back after a drop: this account's presence and room membership were cleared by the database's onDisconnect -> written again, list resent
  async resume() {
    const pr = ref(db, `presence/${this.uid}`);
    // the status colour is kept through a reconnect (measured on the original: yellow stays yellow, green stays green). The drop replaced the whole
    // presence node (act included), so the time of the LAST real command is written back — not now
    await update(pr, { online: true, lastSeen: Date.now(), act: this.actTime || Date.now(), drop: false }).catch(() => {});
    this.armDrop();
    if (this.cur) {
      // FIX (Problem 3): membership may have been kept (online:false by onDisconnect) - re-arm without re-adding.
      // If the member was REMOVED (kick/ban), do not re-add.
      const mref = ref(db, `members/${this.cur}/${this.uid}`);
      const mSnap = await get(mref).catch(() => null);
      if (mSnap?.exists()) {
        await update(mref, { online: true, lastSeen: Date.now() }).catch(() => {});
        onDisconnect(mref).update({ online: false, lastSeen: serverTimestamp() });
        this.listenMsgs(this.cur, Math.max(this.lastMsgT, this.msgFrom), true); // the old listener may have been cancelled while we were not a member
      } else {
        // kicked/banned while offline: do not auto-rejoin
        this.cur = null;
        this.offMsgs?.(); this.offMsgs = null;
      }
    }
    this.lost = false;
    this.sync();
  }
  // Open 1 (2026-11-07, measured on al3nod.pages.dev): after a network cut the database's onDisconnect removes our membership, and on reconnect
  // that snapshot arrived BEFORE resume(): sync() then cleared `cur`, so resume() did not re-join and the page stayed outside the room for good.
  // While the connection is lost (until resume), our own room is kept.
  private lost = false;
  // the original keeps a member whose connection dropped (tab closed, network cut) in the list, faded (imgs/s3.png), in his room, for
  // «تثبيت النكات» (site stay, minutes); measured 2026-11-06: s3 within 3-5 s, no leave notice for a network cut, still counted online.
  // drop:true + the room tell the others; the «تسجيل خروج» button writes presence without it -> removed at once.
  private stealthOn = false;
  private armDrop() {
    const od: Obj = { online: false, lastSeen: serverTimestamp(), stealth: this.stealthOn, drop: true, in: this.t0 };
    if (this.cur) od.room = this.cur;
    onDisconnect(ref(db, `presence/${this.uid}`)).set(od);
  }
  private offs: Unsubscribe[] = [];
  private uid = "";
  private ready = false;
  private t0 = Date.now();
  // live state mirrored from Firebase
  private profiles: Record<string, Prof> = {};
  private presence: Record<string, { online?: boolean; stealth?: boolean; lastSeen?: unknown }> = {};
  private members: Record<string, string[]> = {};
  private rooms: Record<string, Room & { c?: string; del?: boolean; likesReq?: number; voiceLikesReq?: number; voice?: boolean }> = {};
  private powers: Record<string, Pw> = {};
  private boot = "";
  // x3.js opens a pm / shows an alert despite «تعطيل المحادثات الخاصه» / «تعطيل التنبيهات» when it carries force:1 (L2210, L2312). The owner's
  // rule: a sender whose rank has «فتح الخاص» (forcepm) / «التنبيهات» (alert), over a STRICTLY lower rank or an ordinary member.
  private forced(from: string, flag: "forcepm" | "alert"): boolean {
    if (!from || from === this.uid) return false; // only a rank that has the flag in «الصلاحيات» (the live table), no exception
    const pw = this.powers[from] as unknown as Obj | undefined; const row = pw ? (this.rankOf(String(pw.name)) as unknown as Obj | undefined) : undefined;
    if (!row || row[flag] !== true) return false;
    const rowFor = (n: string) => this.rankOf(n) as { rank?: unknown } | undefined; const now = Date.now();
    return mayActOver(rankState(pw as Obj, rowFor, now), rankState(this.powers[this.uid] as unknown as Obj | undefined, rowFor, now), this.uid === this.boot);
  }
  private likes: Record<string, number> = {};
  private perms: Record<string, number> = {};
  private known = new Map<string, string>();
  private knownRooms = new Map<string, string>();
  private cur: string | null = null;
  private offMsgs: Unsubscribe | null = null;
  private autoJoining = false;
  private autoDone = false;
  private pmWatched = new Map<string, Unsubscribe>();
  private wallLikes = new Map<string, number>();

  // Everything the client receives passes through here. Strings are made safe on the way out (see ./escape): the original client puts them
  // into the page as markup. `raw` names keys whose value is markup built by this file; `true` skips the sanitiser (site settings for the control panel).
  private emit(cmd: string, data?: unknown, raw: readonly string[] | SanitizeOptions | true = []) {
    const safe = raw === true ? data : sanitizeOut(data, raw);
    setTimeout(() => this.out(cmd, safe), 0);
  }
  // a member whose tab died without leaving (no heartbeat for 3 minutes) is not counted in rooms or lists
  // FIX (Problem 3): include faded members (drop:true within «تثبيت النكات») so they do not vanish on a brief network cut
  private liveMembers() {
    const o: Record<string, string[]> = {};
    for (const [r, us] of Object.entries(this.membersRaw)) {
      const l = us.filter((u) => u === this.uid || this.fresh(this.presence[u]) || this.faded(u));
      if (l.length) o[r] = l;
    }
    this.members = o;
  }
  private beat = 0;
  private srcInfo: { refr: string; r: string } = { refr: "", r: "" }; // `refr` (referrer) and `r` (invite code) the client sends with g / login / reg: shown in the log's «المصدر» and «الدعوه» columns
  private fpSrc: unknown; // navigator.n as the client sent it with g / login / reg; turned into the device string by reportConn
  dispose() { this.offBots?.(); this.offBots = undefined; this.offDomains?.(); this.offDomains = undefined; this.offBanner?.(); this.offBanner = undefined; this.offFiles?.(); this.offFiles = undefined; clearInterval(this.beat); clearInterval(this.idleTick); clearTimeout(this.touchTimer); if (this.autoTimer) clearTimeout(this.autoTimer); this.stopPublicOnline(); this.offs.forEach((o) => o()); this.offMsgs?.(); this.pmWatched.forEach((o) => o()); this.offs = []; }

  // ---------- connect ----------
  onConnect() {
    this.emit("server", { online: 0 });
    // the smiley list only after login, like the original (measured 2026-11-06: 4.5 MB before its login, the 75 MB of smileys after it); sent at
    // connect it made the login screen download every smiley (x3 fn54 builds the whole box at once)
    this.emit("emos", []); this.emit("dro3", DRO3); this.emit("sico", SICO);
    this.emit("settings", SETTINGS);
    this.emit("power", this.powerObj(0, false));
  }

  // «حالة» dots (imgs/sN.png), measured on al3nood.net 2026-11-05 with two guests: 0 green while active, 1 yellow after 5 minutes without any
  // command (changed between 300 s and 330 s), 2 red with «تعطيل المحادثات», back to green on the next command (busy off at 760 s -> green).
  private lastTouch = 0;
  private idleTick = 0;
  // the time of the LAST command is what counts (the original: any command, even «ty», turns the dot green; nothing else does — mouse moves and
  // clicks without a command change nothing, measured 2026-11-06 idle-orig.mjs). At most one write per 30 s, but a command inside that window is
  // written when it closes, so the stored time is always the real last command (before, it could be up to 30 s early -> yellow too soon).
  private lastCmd = 0;
  private actTime = 0; // the act value this page last stored (login, then each real command)
  private touchTimer = 0;
  private touch() {
    if (!this.uid) return;
    this.lastCmd = Date.now();
    const write = () => { this.touchTimer = 0; this.lastTouch = Date.now(); this.actTime = this.lastCmd; if (this.uid && !this.replacedDone) update(ref(db, `presence/${this.uid}`), { act: this.lastCmd }).catch(() => {}); };
    const since = Date.now() - this.lastTouch;
    if (since >= 30000) write(); else if (!this.touchTimer) this.touchTimer = window.setTimeout(write, 30000 - since);
  }
  private statOf(u: string, p: Prof): number {
    if (this.faded(u)) return 3;
    if (p.busy) return 2;
    const act = Number((this.presence[u] as { act?: unknown } | undefined)?.act) || 0;
    return act && Date.now() - act > IDLE_MS ? 1 : 0;
  }
  // «غرفه الانتظار» restrictions (the panel stores the ticked «منع ...» boxes as pm / allowlikes / nots = false)
  private waitBlocks(cmd: string, data: unknown): boolean {
    if (!this.waiting()) return false;
    const d = (data ?? {}) as Obj;
    const no = (msg: string) => { this.emit("not", { msg, type: "danger" }); return true; };
    if (cmd === "rjoin" && String(d.id ?? "") !== Server.WROOM) return no("لا يمكنك مغادره غرفه الانتظار");
    if ((cmd === "pm" || cmd === "file") && this.owr.pm !== true) return no("الخاص غير متاح في غرفه الانتظار");
    if (cmd === "action" && d.cmd === "like" && this.owr.allowlikes !== true) return no("الإعجاب غير متاح في غرفه الانتظار");
    if (cmd === "action" && d.cmd === "not" && this.owr.nots !== true) return no("التنبيهات غير متاحه في غرفه الانتظار");
    return false;
  }
  handle(cmd: string, data: unknown) {
    if (this.uid && (ACTIVE_CMDS.has(cmd) || (cmd === "cp" && !CP_READS.has(String((data as Obj | null)?.cmd ?? ""))))) this.touch();
    if (this.waitBlocks(cmd, data)) return; // «غرفه الانتظار»
    // the reference server answers an alert from somebody without enough likes with its likes message (seen 2026-11-05), before anything else
    // alerts: «إداره الموقع» > التنبيهات likes, for everybody (the owner's rule 2026-11-06: no exception, the admin too). The «التنبيهات» flag
    // only lets an alert through «تعطيل التنبيهات» of a lower rank (force).
    if (cmd === "action" && (data as Obj | null)?.cmd === "not" && this.likesBlock("notlikes")) return;
    // commands that need a permission wait for a fresh check first (nothing runs, and nothing is written, when it fails)
    const g = gateFor(cmd, (data ?? {}) as Obj);
    if (!g) return this.dispatch(cmd, data);
    this.gateAllowed(g.gate, cmd, (data ?? {}) as Obj).then((ok) => { if (ok) this.dispatch(cmd, data); else this.emit("not", { msg: "ليس لديك صلاحية لهذا الأمر", type: "danger" }); }, () => this.emit("not", { msg: "ليس لديك صلاحية لهذا الأمر", type: "danger" }));
  }
  private dispatch(cmd: string, data: unknown) {
    const d = (data ?? {}) as Obj;
    const run = (p: Promise<unknown>) => p.catch((e) => console.error("[shim]", cmd, e));
    switch (cmd) {
      case "online": run(this.publicOnline()); break;
      case "g": run(this.login({ ...d, password: null })); break;
      case "login": run(this.login(d)); break;
      case "reg": run(this.register(d)); break;
      case "logout": run(this.logout()); break;
      case "rjoin": run(this.rjoin(String(d.id), String(d.pwd ?? ""))); break;
      // card > «نقل»: the member is sent to the chosen room (with the room password the mover typed); his own session does the move
      case "rinvite": { const id = safeId(String(d.id ?? "")), rid = safeId(String(d.rid ?? "")); if (id && rid && this.rooms[rid]) run(set(ref(db, `moves/${id}`), { by: this.uid, rid, t: serverTimestamp(), ...(d.pwd ? { pwd: String(d.pwd).slice(0, 100) } : {}) }).then(() => this.log("move", id, this.rooms[rid]?.topic ?? ""))); break; }
      case "rleave": this.autoDone = true; run(this.leaveCurrent(false).then(() => this.sync())); break;
      // FIX (Problem 5): pass the parent message id (pid / parentId) so replies go to their own subtree, not the main wall/feed
      case "msg": run(this.say(String(d.msg ?? ""), d.pid ? String(d.pid) : (d.parentId ? String(d.parentId) : undefined))); break;
      case "dmsg": if (this.cur && d.mi) { const room = this.cur, mi = String(d.mi); run(get(ref(db, `messages/${room}/${mi}/uid`)).then((a) => remove(ref(db, `messages/${room}/${mi}`)).then(() => this.log("dmsg", String(a.val() ?? ""), this.rooms[room]?.topic ?? "")))); } break;
      case "r+": run(this.roomCreate(d)); break;
      case "r^": run(this.roomEdit(d)); break;
      case "r-": run(this.roomDelete(String(d.id))); break;
      case "setprofile": run(this.setProfile(d)); break;
      case "setpic": run(this.setPic(String(d.pic ?? ""))); break;
      case "busy": run(update(ref(db, `profiles/${this.uid}`), { busy: !!d.busy })); break;
      case "pm": run(this.sendPm(String(d.id), String(d.msg ?? ""))); break;
      case "file": if (UPLOAD_LINK.test(String(d.link ?? "")) && !this.likesBlock("fileslikes")) run(this.sendPm(String(d.pm), String(d.link))); break;
      // FIX (Problem 5): wall replies carry pid (the parent wall post id)
      case "bc": run(this.wallPost(String(d.msg ?? ""), String(d.link ?? ""), d.pid ? String(d.pid) : undefined)); break;
      case "likebc": run(set(ref(db, `wall/${d.bid}/likes/${this.uid}`), true)); break;
      case "delbc": run(this.delWall(String(d.bid))); break;
      case "pmsg": case "ppmsg": run(set(push(ref(db, "ads")), { msg: String(d.msg ?? "").slice(0, 500), by: this.uid, t: serverTimestamp(), ...(cmd === "ppmsg" ? { special: true } : {}) })); break;
      case "setLikes": run(this.setLikes(String(d.id), d.likes)); break;
      case "bnr": run(update(ref(db, `profiles/${d.u2}`), { b: String(d.bnr ?? "").replace(/^sico\//, "").slice(0, 80) }).then(() => this.log("bnr", String(d.u2)))); break;
      case "bnr-": run(update(ref(db, `profiles/${d.u2}`), { b: "" })); break;
      // the room editor (x3.js) asks for the room's moderators when it opens: {roomid}; the answer is the same list op+/op- send back
      case "ops": { const rid = safeId(String(d.roomid ?? "")) || this.cur || ""; if (rid) this.emit("ops", this.opList(rid)); break; }
      case "op+": run(this.opAdd(String(d.lid))); break;
      case "op-": run(this.opDel(String(d.lid))); break;
      case "unick": if (String(d.id) === this.uid && !this.hasFlag("mynick")) { this.emit("not", { msg: "ليس لديك صلاحية لهذا الأمر", type: "danger" }); break; } run(this.setNick(String(d.id), String(d.nick ?? ""))); break; // own nick: «تغير النك» (x3 L4129)
      // «كشف النكات» from the member card: the client sends the member's id as a bare string (x3.js upro, `.uh`)
      case "uh": run(this.nameHistory(typeof data === "string" ? data : String(d.id ?? ""))); break;
      case "action": run(this.action(d)); break;
      case "cp": run(this.cp(d)); break;
      case "cpi": { const [id, inner] = (data as [string, [string, Obj]]) ?? []; if (inner?.[0] === "cp") run(this.cp(inner[1] ?? {}, id)); break; }
      // the page of somebody with «تعطيل المحادثات الخاصه» / «تعطيل التنبيهات» answers a pm / an alert with nopm / nonot {id: sender}; the original
      // then shows the SENDER an alert from that member (measured 2026-11-06, nopm-orig.mjs): «هذا المستخدم لا يقبل المحادثات الخاصه» / «... التنبيهات الخاصه»
      case "nopm": case "nonot": { const to = String((data as Obj | null)?.id ?? ""); if (to && to !== this.uid && this.profiles[to]) set(push(ref(db, `alerts/${to}`)), { from: this.uid, msg: "", t: serverTimestamp(), kind: cmd }).catch(() => {}); break; }
      // «يكتب الآن»: the page sends ty [peer, 1|0] while its private box holds text / is emptied (x3 L2052); the original relays it to the peer as
      // ty [sender, 1|0], whose open chat window with the sender shows / hides the dots (x3 L2303; measured 2026-11-06, typing-orig.mjs)
      case "ty": { const a = Array.isArray(data) ? data : []; const to = safeId(String(a[0] ?? "")); if (to && to !== this.uid && this.uid) { const r = ref(db, `typing/${to}/${this.uid}`); set(r, a[1] === 1 ? 1 : 0).catch(() => {}); if (a[1] === 1) onDisconnect(r).set(0).catch(() => {}); } break; } // the owner's choice (2026-11-06): a tab closed while typing turns the dots OFF (the original leaves them on)
      case "diag": case "cpi": break; // advisory messages with no stored effect
      default: console.debug("[shim] unhandled command", cmd, data);
    }
  }

  // ---------- online list on the login screen ----------
  private offOnline?: Unsubscribe;
  private onlineSent = new Set<string>();
  private onlineTick = 0;
  private offSiteOut?: Unsubscribe;
  // ---------- Bots ----------
  private bots: Record<string, Obj> = {};
  private botsCfg: Obj = {};
  private offBots?: Unsubscribe;
  private watchBots() {
    if (this.offBots) return;
    const a = onValue(ref(db, "config/bots"), (s) => { this.bots = (s.val() ?? {}) as Record<string, Obj>; if (this.ready) this.sync(); });
    const b = onValue(ref(db, "config/botsCfg"), (s) => { this.botsCfg = (s.val() ?? {}) as Obj; if (this.ready) this.sync(); });
    this.offBots = () => { a(); b(); };
  }
  private isBot(u: string) { return u.startsWith("bot-") && !!this.bots[u]; }
  private onlineBots(): string[] {
    if (this.botsCfg.bots_active === false) return [];
    const real = new Set(Object.keys(this.presence).filter((u) => this.fresh(this.presence[u]) || this.faded(u)).map((u) => this.profiles[u]?.name ?? this.profiles[u]?.topic));
    return Object.keys(this.bots).filter((id) => this.bots[id]?.online === true && !real.has(String(this.bots[id].topic ?? "")));
  }
  private botRoom(id: string): string | null {
    const or = String(this.bots[id]?.or ?? ""); if (or && this.rooms[or]) return or;
    const pubs = Object.values(this.rooms).filter((r) => r.pub && !r.hasPass).sort((x, y) => x.id.localeCompare(y.id));
    if (!pubs.length) return null; let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return pubs[h % pubs.length].id;
  }
  private botObj(id: string) {
    const b = this.bots[id];
    return { id, lid: id, username: String(b.topic ?? ""), topic: String(b.topic ?? ""), msg: String(b.msg ?? "(غير مسجل)"), pic: String(b.pic || "pic.png"), power: "guest", roomid: this.botRoom(id),
      ucol: String(b.ucol || "#000000"), mcol: "#000000", bg: String(b.bg || ""), co: flagCode(b.co), rep: Number(b.rep) || 0, ico: "", b: "", busy: false, stat: 0 };
  }
  private botRow(id: string) { const b = this.bots[id]; return { id, stat: this.onlineBots().includes(id) ? 0 : 1, co: String(b.co ?? "--"), topic: String(b.topic ?? ""), msg: String(b.msg ?? ""), rep: Number(b.rep) || 0, or: b.or ?? null, pic: String(b.pic || "pic.png"), bg: String(b.bg || ""), ucol: String(b.ucol || "#000000") }; }
  private waitMark = false;
  private owr: Obj = {};
  private released = false;
  private waiting() { return this.waitMark && !this.released && (this.owr.active === true); }
  private static readonly WROOM = "wroom";
  private checkWaitRelease() {
    if (!this.waiting()) return;
    const need = Math.max(0, Number(this.owr.likes) || 0);
    if (need > 0 && (this.likes[this.uid] ?? 0) >= need && (this.owr.autoAllow === true || this.owr.move === true)) {
      this.released = true;
      if (this.owr.move === true) { const pub = Object.values(this.rooms).filter((r) => r.pub).sort((a, b) => this.roomCount(a.id) - this.roomCount(b.id))[0]; if (pub) void this.rjoin(pub.id, ""); }
    }
  }
  private async enterWaitRoom() {
    if (!this.waiting() || this.cur === Server.WROOM) return;
    const r = ref(db, `rooms/${Server.WROOM}`);
    if (!(await get(r).catch(() => null))?.exists()) await set(r, { topic: "غرفه الانتظار", owner: this.uid, max: 40, wroom: true, pinned: true, createdAt: Date.now() }).catch(() => {});
    await new Promise((res) => setTimeout(res, 300));
    await this.rjoin(Server.WROOM, "", true);
  }
  private domains: Record<string, Obj> = {};
  private offDomains?: Unsubscribe;
  private hostDomain() { return typeof location !== "undefined" ? (this.domains[domainKey(normDomain(location.hostname))] ?? null) : null; }
  private effectiveSite(): Obj {
    const d = this.hostDomain(); if (!d) return this.site;
    const o: Obj = { ...this.site };
    for (const k of [...DOMAIN_TEXT, "bg", "background", "buttons"]) if (typeof d[k] === "string" && (d[k] as string).trim() !== "") o[k] = d[k];
    return o;
  }
  private watchDomains() {
    if (this.offDomains) return;
    this.offDomains = onValue(ref(db, "config/domains"), (s) => { this.domains = (s.val() ?? {}) as Record<string, Obj>; applySiteText(this.effectiveSite()); this.emitBanner(); });
  }
  private emitBanner() {
    const d = this.hostDomain();
    const bnr = d ? { enabled: d.bannerEnabled === true, image: typeof d.bannerImage === "string" ? d.bannerImage : "" } : { enabled: this.banner.enabled === true, image: this.banner.image ?? "" };
    this.emit("banner", bnr);
  }
  private domainItems() {
    const o: Obj = {};
    for (const v of Object.values(this.domains)) if (v && typeof v.domain === "string") o[v.domain] = { ...v, status: 2 };
    return o;
  }
  private banner: { enabled?: boolean; image?: string } = {};
  private offBanner?: Unsubscribe;
  private watchBanner() {
    if (this.offBanner) return;
    this.offBanner = onValue(ref(db, "config/banner/_main"), (s) => { this.banner = (s.val() ?? {}) as { enabled?: boolean; image?: string }; this.emitBanner(); });
    this.watchDomains();
  }
  private stopPublicOnline() { this.offSiteOut?.(); this.offSiteOut = undefined; this.offOnline?.(); this.offOnline = undefined; this.onlineSent.clear(); clearInterval(this.onlineTick); this.onlineTick = 0; }
  private async publicOnline() {
    if (this.uid || this.offOnline) return;
    if (!auth.currentUser) await signInAnonymously(auth);
    this.watchFiles(); this.watchBanner(); this.watchBots();
    get(ref(db, "config/site/name")).then((s) => showSiteName(s.val()), () => {});
    await new Promise<void>((done) => {
      let first = true;
      this.offSiteOut = onValue(ref(db, "config/site"), (s) => { this.site = (s.val() ?? {}) as Obj; applySiteText(this.effectiveSite()); showSiteName(this.effectiveSite().name); if (!this.uid) this.emit("settings", this.settings()); if (first) { first = false; done(); } }, () => done());
    });
    if (this.uid || this.offOnline) return;
    let first = true;
    const refresh = async () => {
      if (this.uid) return;
      const pres = this.presence;
      const ids = Object.keys(pres).filter((u) => (this.fresh(pres[u]) || this.faded(u)) && !pres[u]!.stealth && !this.superseded(u))
        .sort((a, c) => (Number((pres[c] as { in?: unknown }).in) || 0) - (Number((pres[a] as { in?: unknown }).in) || 0));
      await Promise.all(ids.filter((u) => !this.profiles[u]).map(async (u) => {
        const p = (await get(ref(db, `profiles/${u}`)).catch(() => null))?.val();
        if (p) this.profiles[u] = p as Prof;
      }));
      if (this.uid) return;
      const pub = (u: string) => { const o = this.userObj(u); return { id: o.id, topic: o.topic, msg: o.msg, pic: o.pic, bg: o.bg, ucol: o.ucol, co: o.co, ico: o.ico }; };
      const now = [...ids.filter((u) => this.profiles[u] && !this.superseded(u)), ...this.onlineBots()];
      if (first) {
        first = false;
        this.emit("online", now.map(pub));
        now.forEach((u) => this.onlineSent.add(u));
      } else {
        for (const u of now) if (!this.onlineSent.has(u)) { this.onlineSent.add(u); this.emit("online+", pub(u)); }
        for (const u of [...this.onlineSent]) if (!now.includes(u)) { this.onlineSent.delete(u); this.emit("online-", u); }
      }
      this.emit("server", { online: this.onlineCount() });
    };
    this.offOnline = onValue(ref(db, "presence"), (s) => { this.presence = (s.val() ?? {}) as typeof this.presence; void refresh(); }, () => this.stopPublicOnline());
    this.onlineTick = window.setInterval(() => void refresh(), 15000);
  }

  // ---------- auth ----------
  private async login(d: Obj) {
    const password = d.password == null ? null : String(d.password);
    const name = password === null ? String(d.username ?? "") : clean(String(d.username ?? ""));
    this.fpSrc = d.fp; this.srcInfo = srcOf(d);
    if (!name) return this.emit("login", { msg: password === null ? "badname" : "noname" });
    const ok = await nameOk(name, password === null, d.fp);
    if (ok === "maxip") return this.refuseLogin("لقد تجاوزت عدد الأسماء المسموح بها من هذا الجهاز");
    if (!ok) return this.emit("login", { msg: "badname" });
    if (password === null) {
      const site = await this.siteNow();
      if (site.allowg === false) return this.refuseLogin("دخول الزوار مغلق حاليا");
      if (name.length > lim(site.guestNameMax)) return this.emit("login", { msg: "badname" });
    }
    try {
      if (password === null) {
        const prev = auth.currentUser;
        if (prev?.isAnonymous && (await get(ref(db, `profiles/${prev.uid}`)).catch(() => null))?.exists()) await signOut(auth);
        const c = await signInAnonymously(auth);
        const co = await country();
        const pref = ref(db, `profiles/${c.user.uid}`);
        if ((await get(pref)).exists()) await this.writeProfile(c.user.uid, { topic: name.slice(0, 50), ...(co ? { co } : {}) }, "login");
        else await set(pref, { name: name.slice(0, 50), topic: name.slice(0, 50), registered: false, createdAt: Date.now(), ...(co ? { co } : {}) });
      } else {
        const c = await signInWithEmailAndPassword(auth, await emailFor(name), padPw(password));
        const co = await country();
        if (co) await update(ref(db, `profiles/${c.user.uid}`), { co }).catch(() => {});
        if (!(await get(ref(db, `profiles/${c.user.uid}/name`)).catch(() => null))?.exists()) await update(ref(db, `profiles/${c.user.uid}`), { name: name.slice(0, 50) }).catch(() => {});
      }
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      console.error("[shim] login failed:", password === null ? "guest" : "member", code || e);
      if (code.includes("user-not-found")) return this.emit("login", { msg: "noname" });
      if (password !== null && /wrong-password|invalid-credential|invalid-login|invalid-email/.test(code)) return this.emit("login", { msg: "wrong" });
      return this.refuseLogin("تعذر الدخول، حاول مرة أخرى");
    }
    await this.start(!!d.stealth);
  }

  private async register(d: Obj) {
    const name = clean(String(d.username ?? "")), password = String(d.password ?? "");
    if (!name || !password) return this.emit("login", { msg: "badname" });
    if (!(await nameOk(name))) return this.emit("login", { msg: "badname" });
    {
      const site = await this.siteNow();
      if (site.allowreg === false) return this.refuseLogin("تسجيل العضويات مغلق حاليا");
      if (name.length > lim(site.registerNameMax)) return this.emit("login", { msg: "badname" });
    }
    try {
      const c = await createUserWithEmailAndPassword(auth, await emailFor(name), padPw(password));
      const co = await country();
      await set(ref(db, `profiles/${c.user.uid}`), { name: name.slice(0, 50), topic: name.slice(0, 50), registered: true, createdAt: Date.now(), ...(co ? { co } : {}) });
      await this.reportConn(d.fp, null, srcOf(d));
      await signOut(auth);
      this.emit("login", { msg: "reg" });
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      this.emit("login", { msg: code.includes("email-already-in-use") ? "usedname" : "badname" });
    }
  }

  private async reportConn(n: unknown, log?: string | null, src?: { refr: string; r: string }) {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const { parts, fp } = await collectFp((n ?? (typeof navigator !== "undefined" ? (navigator as unknown as { n?: Obj }).n : undefined)) as Obj | undefined);
      await fetch("/api/conn", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ fp, parts, ...(log ? { log } : {}), ...(src?.refr ? { refr: src.refr } : {}), ...(src?.r ? { r: src.r } : {}) }), keepalive: true });
    } catch { /* not recorded */ }
  }

  // FIX (Problem 1): when kicked, do NOT write a leave notice from the kicked user's own session -
  // the moderator already wrote the distinctive «kicked» notice. Membership removal still happens.
  private async logout(opts: { kicked?: boolean } = {}) {
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }
    this.autoGen = (this.autoGen ?? 0) + 1;
    if (this.uid) {
      const pr = ref(db, `presence/${this.uid}`), gone = { online: false, lastSeen: Date.now(), stealth: false, drop: false };
      onDisconnect(pr).set(gone).catch(() => {});
      set(pr, gone).catch(() => {});
    }
    await this.leaveCurrent(!opts.kicked);
    await signOut(auth).catch(() => {});
  }

  // ---------- session start ----------
  private async start(requestedStealth: boolean) {
    let stealth = requestedStealth;
    this.stopPublicOnline();
    this.uid = auth.currentUser!.uid;
    this.t0 = Date.now() - 2000;
    if (stealth) { const f = await this.permFacts(); stealth = !!f && cpDecision("stealth", f); }
    const pr = ref(db, `presence/${this.uid}`);
    this.actTime = Date.now();
    await set(pr, { online: true, lastSeen: Date.now(), stealth, act: this.actTime, in: Date.now() });
    this.lastTouch = Date.now();
    this.stealthOn = stealth; this.armDrop();
    window.addEventListener("pagehide", () => { if (this.cur && !(session && session.dropped)) set(push(ref(db, `messages/${this.cur}`)), this.notice("leave")).catch(() => {}); });
    this.idleTick = window.setInterval(() => { if (this.ready) this.sync(); }, 15000);
    this.beat = window.setInterval(() => { update(pr, { lastSeen: Date.now() }).catch(() => {}); if (this.ready) { this.liveMembers(); this.sync(); } }, 60000);
    for (const k of ["setPower", "ban", "kickRoom", "roomManage", "deleteMsg", "viewReports", "ad"]) {
      const v = (await get(ref(db, `config/perms/${k}`)).catch(() => null))?.val();
      if (typeof v === "number") this.perms[k] = v;
    }
    try {
      const boot = (await get(ref(db, "config/bootstrap"))).val();
      this.boot = typeof boot === "string" ? boot : "";
      if (boot === this.uid) {
        if (!(await get(ref(db, "powerTable"))).exists()) { const up: Obj = {}; for (const r of POWERS) up[this.rankKey(String(r.name))] = r; await update(ref(db, "powerTable"), up); }
        if ((await get(ref(db, `powers/${this.uid}/level`))).val() !== 10000) await set(ref(db, `powers/${this.uid}`), { level: 10000, name: "admin" });
      }
    } catch { /* not the bootstrap user, or rules not yet published */ }
    const me = ((await get(ref(db, `profiles/${this.uid}`)).catch(() => null))?.val() ?? {}) as Prof;
    const logRef = push(ref(db, "loginLog"));
    set(logRef, { uid: this.uid, ...(typeof me.topic === "string" && me.topic ? { topic: me.topic.slice(0, 120) } : {}), ...(me.co ? { co: me.co } : {}), isreg: !!me.registered, created: Date.now() }).catch(() => {}).finally(() => { void this.reportConn(this.fpSrc, logRef.key, this.srcInfo); });
    let first = 0;
    const gate = () => { if (++first === 5) this.finishLogin(); };
    const watch = (path: string, fn: (v: unknown) => void) => {
      let seen = false;
      this.offs.push(onValue(ref(db, path), (s) => { fn(s.val()); if (!seen) { seen = true; gate(); } else if (this.ready) this.sync(); }));
    };
    watch("profiles", (v) => { this.profiles = (v ?? {}) as Record<string, Prof>; });
    watch("presence", (v) => { this.presence = (v ?? {}) as typeof this.presence; this.liveMembers(); if (this.ready) this.emit("server", { online: this.onlineCount() }); });
    watch("members", (v) => { const m = (v ?? {}) as Record<string, Obj>; this.membersRaw = Object.fromEntries(Object.entries(m).map(([r, u]) => [r, Object.keys(u)])); this.liveMembers(); });
    watch("rooms", (v) => { this.rooms = Object.fromEntries(Object.entries((v ?? {}) as Record<string, Omit<Room, "id">>).map(([id, r]) => [id, { id, ...r }])); });
    watch("powers", (v) => { this.powers = (v ?? {}) as Record<string, Pw>; });
    this.offs.push(onValue(ref(db, "config/fltr"), (s) => { const w: string[] = [], bad: string[] = []; s.forEach((c) => { const v = c.val() as { path?: string; v?: string }; if ((v?.path === "wmsgs" || v?.path === "bmsgs") && v.v) w.push(String(v.v)); if (v?.path === "bmsgs" && v.v) bad.push(String(v.v)); }); this.watched = w.reverse(); this.forbidden = bad; }));
    this.offs.push(onValue(ref(db, "config/shrt"), (s) => { const o: Record<string, string> = {}; s.forEach((c) => { const v = c.val() as { name: string; value: string }; if (v?.name) o[v.name] = v.value; }); this.shrt = o; }));
    this.watchFiles(); this.watchBanner(); this.watchBots();
    this.offs.push(onValue(ref(db, "config/wroomsOwr"), (s) => { this.owr = (s.val() ?? {}) as Obj; this.checkWaitRelease(); if (this.ready) void this.enterWaitRoom(); }));
    this.offs.push(onValue(ref(db, `waitRoom/${auth.currentUser?.uid ?? "-"}`), (s) => { this.waitMark = s.val() === true; if (this.ready) void this.enterWaitRoom(); }));
    this.offs.push(onValue(ref(db, "config/ico"), (s) => {
      const v = (s.val() ?? {}) as Record<string, unknown>; const list = (k: string, d: string[]) => (Array.isArray(v[k]) ? (v[k] as unknown[]).filter((x): x is string => typeof x === "string") : d);
      const next = { sico: list("sico", SICO), dro3: list("dro3", DRO3), emo: list("emo", EMOS) };
      const changed = JSON.stringify(next) !== JSON.stringify(this.ico); this.ico = next;
      if (this.ready && changed) { this.emit("sico", next.sico); this.emit("dro3", next.dro3); this.emit("emos", next.emo); }
    }));
    this.offs.push(onValue(ref(db, "config/site"), (s) => { this.site = (s.val() ?? {}) as Obj; showSiteName(this.effectiveSite().name); applySiteText(this.effectiveSite()); if (this.ready) this.emit("settings", this.settings()); }));
    this.offs.push(onValue(ref(db, "powerTable"), (s) => {
      const rows = Object.values((s.val() ?? {}) as Record<string, (typeof POWERS)[number]>);
      const next = (rows.length ? [...rows].sort((a, b) => Number(b.rank) - Number(a.rank)) : POWERS).map(dorraceOrder);
      const changed = JSON.stringify(next) !== JSON.stringify(this.table); this.table = next;
      if (this.ready && changed) { this.emit("powers", this.table); this.emit("power", this.powerObj(0, false)); }
    }));
    this.offs.push(onValue(ref(db, "rep"), (s) => { const o: Record<string, number> = {}; s.forEach((c) => { o[c.key!] = Number(c.val()) || 0; }); this.likes = o; this.checkWaitRelease(); if (this.ready) this.sync(); }));
  }

  private finishLogin() {
    const me = this.profiles[this.uid] ?? { topic: "?" };
    const lvl = this.levelOf(this.uid);
    if (me.registered) this.emit("login", { msg: "ok", id: this.uid, username: me.name || me.topic, ...this.powerObj(lvl, true), power: this.powers[this.uid]?.name || "user", guest: false, token: "fb", ttoken: "fb", nowall: false });
    else this.emit("login", { msg: "ok", id: this.uid, username: me.name || me.topic, power: 0, guest: true, ttoken: "guest_" + this.uid });
    this.emit("powers", this.table);
    this.emit("power", this.powerObj(lvl, !!me.registered));
    this.emit("rlist", Object.values(this.rooms).map((r) => this.roomObj(r)), ROOM_TEXT);
    for (const r of Object.values(this.rooms)) this.knownRooms.set(r.id, JSON.stringify(this.roomObj(r)));
    const users = this.visibleUsers().map((u) => this.userObj(u));
    this.emit("ulist", users);
    for (const u of users) this.known.set(u.id, JSON.stringify(u));
    if (this.site.rc === false) { session = null; this.emit("ok"); this.emit("nok"); }
    else { session = { server: this, k: Math.random().toString(36).slice(2) + Date.now().toString(36), dropped: false, pending: [] }; this.emit("ok"); }
    this.watchNet();
    this.emit("sico", this.ico.sico); this.emit("dro3", this.ico.dro3); this.emit("emos", this.ico.emo);
    this.emit("settings", this.settings());
    this.emit("server", { online: this.onlineCount() });
    this.welcomeDue = true;
    setTimeout(() => { if (this.welcomeDue) { this.welcomeDue = false; void this.welcome(); } }, 5000);
    this.ready = true;
    this.autoMessages();
    this.listenWall(); this.listenAlerts(); this.listenAds(); this.listenPm(); this.listenSelfKick(); this.listenTyping();
    this.autoJoin();
    setTimeout(() => void this.enterWaitRoom(), 1500);
  }
    // ---------- Firebase state -> the client's incremental events ----------
  private sync() {
    this.checkReplaced();
    const now = new Set(Object.keys(this.rooms));
    for (const id of now) {
      const o = this.roomObj(this.rooms[id]); const j = JSON.stringify(o);
      if (!this.knownRooms.has(id)) { this.knownRooms.set(id, j); this.emit("r+", o, ROOM_TEXT); }
      else if (this.knownRooms.get(id) !== j) { this.knownRooms.set(id, j); this.emit("r^", o, ROOM_TEXT); }
    }
    for (const id of [...this.knownRooms.keys()]) if (!now.has(id)) { this.knownRooms.delete(id); this.emit("r-", { id }); }
    const vis = new Map(this.visibleUsers().map((u) => [u, this.userObj(u)]));
    for (const [u, o] of vis) {
      const j = JSON.stringify(o); const prev = this.known.get(u);
      if (!prev) { this.known.set(u, j); this.emit("u+", o); continue; }
      if (prev === j) continue;
      const p = JSON.parse(prev) as Obj; this.known.set(u, j);
      if (p.roomid !== o.roomid) this.emit("ur", [u, o.roomid]);
      const diff: Obj = { id: u };
      for (const k of Object.keys(o)) if (k !== "roomid" && JSON.stringify((o as Obj)[k]) !== JSON.stringify(p[k])) diff[k] = (o as Obj)[k];
      if (["topic", "msg", "ucol", "mcol", "bg"].some((k) => k in diff)) for (const k of ["topic", "msg", "ucol", "mcol", "bg"]) diff[k] = (o as Obj)[k];
      if (Object.keys(diff).length > 1) this.emit("u^", diff);
    }
    for (const u of [...this.known.keys()]) if (!vis.has(u)) { this.known.delete(u); this.emit("u-", u); }
    // FIX (Problem 3): also keep `cur` when our own row is faded (drop within «تثبيت النكات»), not only when `lost` is true.
    if (this.cur && !this.lost
        && !(this.members[this.cur] ?? []).includes(this.uid)
        && !this.faded(this.uid)) {
      this.cur = null;
      this.offMsgs?.();
      this.offMsgs = null;
    }
    // Rooms flagged "delete when empty" go away once their last member leaves.
    for (const r of Object.values(this.rooms)) {
      const n = (this.members[r.id]?.length ?? 0) + this.fadedIn(r.id);
      if (n > 0) this.occupied.add(r.id);
      else if (r.pub ? Date.now() - (r.createdAt ?? 0) > 10000 : r.del && (this.occupied.has(r.id) || Date.now() - (r.createdAt ?? 0) > 86400000)) remove(ref(db, `rooms/${r.id}`)).catch(() => {});
    }
    const mine = JSON.stringify(this.powerObj(0, false));
    if (this.myPower !== undefined && this.myPower !== mine) this.emit("power", JSON.parse(mine));
    this.myPower = mine;
    this.autoJoin();
  }
  private myPower: string | undefined;
  private occupied = new Set<string>();
  private membersRaw: Record<string, string[]> = {};
  private shrt: Record<string, string> = {};
  private forbidden: string[] = [];
  private watched: string[] = [];
  private site: Obj = {};
  private ico: { sico: string[]; dro3: string[]; emo: string[] } = { sico: SICO, dro3: DRO3, emo: EMOS };
  private files: Record<string, string> = {};
  private offFiles?: Unsubscribe;
  private watchFiles() {
    if (this.offFiles) return;
    this.offFiles = onValue(ref(db, "config/files"), (s) => {
      const prev = this.files; this.files = (s.val() ?? {}) as Record<string, string>; applySiteFiles(this.files);
      if (!this.ready) return;
      if (prev.pic !== this.files.pic) for (const u of this.known.keys()) if (!(this.profiles[u]?.pic)) this.emit("u^", { id: u, pic: "pic.png" });
      if (prev.room !== this.files.room) for (const r of Object.values(this.rooms)) if (!r.pic) this.emit("r^", this.roomObj(r), ROOM_TEXT);
    });
  }

  // ---------- rooms ----------
  private roomOf(u: string): string | null {
    if (u === this.uid && this.lost && this.cur) return this.cur;
    for (const [r, us] of Object.entries(this.members)) if (us.includes(u)) return r;
    const p = this.presence[u] as { room?: unknown } | undefined; const r = this.faded(u) && typeof p?.room === "string" ? p.room : "";
    return r && this.rooms[r] ? r : null;
  }
  private roomObj(r: Server["rooms"][string]) {
    return {
      id: r.id, topic: r.topic, hashtag: "#" + (r.pub ? publicNo(r) : r.id), pic: r.pic || "room.png", owner: r.owner || "", max: r.max,
      uco: (this.members[r.id] ?? []).filter((u) => !this.presence[u]?.stealth).length + this.fadedIn(r.id) + this.onlineBots().filter((b) => this.botRoom(b) === r.id).length, needpass: !!r.hasPass, v: !!r.voice, l: r.likesReq ?? 0, nos: false, b: false, m: [null, null, null, null, null],
      ops: Object.keys((r as { ops?: Record<string, boolean> }).ops ?? {}), delete: !!(r.pub || r.del), wroom: (r as { wroom?: boolean }).wroom === true, c: r.c || "#000000",
      about: r.about || (r.pub ? "غرفه عامه .." : ""), welcome: r.welcome || "", vl: r.voiceLikesReq ?? 0, rev: false,
    };
  }
  private roomFields(d: Obj) {
    const f: Obj = {};
    if (d.topic != null) f.topic = clean(String(d.topic)).slice(0, 80);
    if (d.about != null) f.about = String(d.about).slice(0, 200);
    if (d.welcome != null) f.welcome = String(d.welcome).slice(0, 300);
    if (d.max != null) f.max = Math.min(40, Math.max(2, Number(d.max) || 10));
    if (d.l != null) f.likesReq = Math.max(0, Number(d.l) || 0);
    if (d.vl != null) f.voiceLikesReq = Math.max(0, Number(d.vl) || 0);
    if (d.v != null) f.voice = !!d.v;
    if (d.delete != null) f.del = !!d.delete;
    if (typeof d.c === "string" && HEX.test(d.c)) f.c = d.c;
    if (typeof d.pic === "string") { const pic = safePic(d.pic.replace(/^https?:\/\/[^/]+\//, "").replace(/^\//, "")); f.pic = pic === "room.png" || pic === (this.files as { room?: string }).room ? "" : pic; }
    return f;
  }
  private async roomCreate(d: Obj) {
    if (!this.powerObj(0, false).createroom) return this.emit("not", { msg: "ليس لديك صلاحية إنشاء غرفة", type: "danger" });
    const f = this.roomFields(d);
    if (!f.topic) return;
    const id = push(ref(db, "rooms")).key!;
    const pass = String(d.pass ?? "").trim();
    await set(ref(db, `rooms/${id}`), { max: 10, ...f, owner: this.uid, createdAt: Date.now(), ...(pass ? { hasPass: true } : {}) });
    this.log("mkroom", String(f.topic ?? ""), this.rooms[this.cur ?? ""]?.topic ?? "", id);
    if (pass) await set(ref(db, `roomSecrets/${id}`), await sha(pass));
  }
  private async roomEdit(d: Obj) {
    const id = String(d.id); const f = this.roomFields(d);
    const pass = d.pass != null ? String(d.pass).trim() : "";
    if (pass) { f.hasPass = true; await set(ref(db, `roomSecrets/${id}`), await sha(pass)); }
    const old = { ...(this.rooms[id] ?? {}) } as Obj;
    await update(ref(db, `rooms/${id}`), f);
    const changed = Object.entries(f).some(([k, v]) => k !== "del" && String(v ?? "") !== String(old[k] ?? "")) || !!pass;
    const voice = "voice" in f && !!f.voice !== !!old.voice ? `${f.voice ? "تفعيل" : "تعطيل"}: تفعيل الصوتيه` : "";
    if (changed) this.log("editroom", voice, String(f.topic ?? old.topic ?? ""));
  }
  private async roomDelete(id: string) {
    this.log("rdel", this.rooms[id]?.topic ?? "", "", id);
    await remove(ref(db, `rooms/${id}`));
    await remove(ref(db, `roomSecrets/${id}`)).catch(() => {});
  }

  private roomCount(id: string): number { return (this.members[id]?.length ?? 0) + this.fadedIn(id) + this.onlineBots().filter((b) => this.botRoom(b) === id).length; }

  private async autoJoin() {
    if (!this.ready || this.cur || this.autoJoining || this.autoDone) return;
    this.autoJoining = true;
    try {
      const fixed = String((await get(ref(db, "config/entryRoom")).catch(() => null))?.val() ?? "");
      const fr = fixed ? this.rooms[fixed] : undefined;
      if (fr && this.roomCount(fixed) < (fr.max || PUBLIC_MAX)) { await this.rjoin(fixed, "", true); if (this.cur) { this.autoDone = true; return; } }
      for (let i = 0; i < 5 && !this.cur; i++) {
        const n = (r: { id: string }) => this.roomCount(r.id);
        const pubs = Object.values(this.rooms).filter((r) => r.pub).sort((a, b) => n(a) - n(b) || publicNo(a) - publicNo(b));
        let t = pubs.find((r) => n(r) < (r.max || PUBLIC_MAX));
        if (!t) { let n = 1; const used = new Set(pubs.map(publicNo)); while (used.has(n)) n++; t = (await createPublicRoom(n)) ?? undefined; }
        if (!t) break;
        await this.rjoin(t.id, "", true);
        if (!this.cur) await new Promise((r) => setTimeout(r, 400));
      }
      if (this.cur) this.autoDone = true;
    } finally { this.autoJoining = false; }
  }

  private welcomeDue = false;
  // FIX (Problem 3): use update({online:false,...}) for onDisconnect instead of remove(), so a network cut does NOT
  // erase membership. The fading logic (faded()) keeps the row for «تثبيت النكات» minutes; a real leave (leaveCurrent)
  // still removes it. Also refuse to join a room the user was kicked from (kicks/<uid> exists).
  private async rjoin(id: string, pwd: string, auto = false) {
    const r = this.rooms[id] ?? (auto ? ({ id, hasPass: false } as Server["rooms"][string]) : undefined);
    if (!r || this.cur === id) return;
    // FIX (Problem 2): a kicked user must not be able to re-join until the kick is cleared
    const kicked = (await get(ref(db, `kicks/${this.uid}`)).catch(() => null))?.exists();
    if (kicked) { if (auto) this.autoDone = false; this.emit("not", { msg: "تم طردك من هذه الغرفة", type: "danger" }); return; }
    this.autoDone = true;
    const data: Obj = { joinedAt: Date.now(), online: true, lastSeen: Date.now() };
    if (r.hasPass) data.ph = await sha(pwd);
    let from = 0;
    try {
      await this.leaveCurrent(false);
      const mref = ref(db, `members/${id}/${this.uid}`);
      await set(mref, data);
      // FIX (Problem 3): onDisconnect marks offline instead of removing, so the row survives a brief network cut
      onDisconnect(mref).update({ online: false, lastSeen: serverTimestamp() });
      const jref = push(ref(db, `messages/${id}`));
      await set(jref, this.notice("join")).catch(() => {});
      await new Promise((res) => setTimeout(res, 250));
      from = Number((await get(ref(db, `messages/${id}/${jref.key}/t`)).catch(() => null))?.val()) || Date.now() - 5000;
    } catch { if (auto) this.autoDone = false; return; }
    this.cur = id;
    this.armDrop();
    this.emit("ur", [this.uid, id]);
    if (this.known.has(this.uid)) { const o = this.userObj(this.uid); this.known.set(this.uid, JSON.stringify({ ...o, roomid: id })); }
    this.listenMsgs(id, from);
    this.sync();
  }
  private seenMsg = new Set<string>();
  private lastMsgT = 0;
  private msgFrom = 0;
  // FIX (Problem 1, 5): distinguish kicked (leave with msg:"kicked") from a normal logout (msg:"logout") and from a silent drop.
  // FIX (Problem 5): listen to replies/<rid>/<pid> as a separate subtree so replies stay inside their own box.
  private listenMsgs(id: string, from: number, again = false) {
    this.offMsgs?.();
    if (!again) this.msgFrom = from;
    const q = query(ref(db, `messages/${id}`), orderByChild("t"), startAt(from));
    const a = onChildAdded(q, (s) => {
      if (this.seenMsg.has(id + "/" + s.key)) return;
      this.seenMsg.add(id + "/" + s.key);
      const m = s.val() as Obj; const u = String(m.uid); const p = this.profiles[u];
      if (typeof m.t === "number" && m.t > this.lastMsgT) this.lastMsgT = m.t;
      // FIX (Problem 5): ignore anything with a parent id - it belongs to replies/, never to the wall
      if (m.pid || m.parentId) return;
      const base = { uid: u, lid: u, topic: m.topic ?? p?.topic ?? "", pic: m.pic ?? p?.pic ?? "pic.png", mi: s.key, t: m.t, ucol: m.ucol ?? p?.ucol ?? "#000000", mcol: m.mcol ?? p?.mcol ?? "#000000", bg: p?.bg ?? "", s: false };
      if ((m.cls === "join" || m.cls === "leave") && this.presence[u]?.stealth && !this.canSee(u)) return;
      if (m.cls === "join") {
        const rt = this.rooms[id]?.topic ?? "";
        const escRt = rt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        this.emit("msg", { ...base, msg: `<div class="fl btn btn-primary dots roomh border corner minix" style="margin-left:-4px;padding:4px;max-width:180px;min-width:60px;" onclick="rjoin('${safeId(id)}')">${escRt}</div> هذا المستخدم قد دخل`, class: "hmsg", roomid: id, rid: id, rt }, ["msg"]);
        if (u === this.uid && this.welcomeDue) { this.welcomeDue = false; void this.welcome(); }
      } else if (m.cls === "leave") {
        // FIX (Problem 1): three distinct cases - kicked, self logout, silent drop
        const label = m.msg === "kicked" ? "( تم طرد هذا المستخدم )"
                    : m.msg === "logout" ? "( تسجيل خروج )"
                    :                      "(هذا المستخدم قد غادر الدردشه)";
        this.emit("msg", { ...base, msg: label, class: "hmsg lqd", roomid: id, rid: id });
      } else this.emit("msg", { ...base, msg: m.msg });
    });
    const d = onChildRemoved(q, (s) => this.emit("dmsg", s.key));
    // FIX (Problem 5): listen to the replies subtree for this room, keyed by parent message id
    const repliesRootRef = ref(db, `replies/${id}`);
    const aR = onChildAdded(repliesRootRef, (parentSnap) => {
      const parentId = parentSnap.key!;
      const rChild = onChildAdded(ref(db, `replies/${id}/${parentId}`), (rSnap) => {
        const key = `${id}/${parentId}/${rSnap.key}`;
        if (this.seenMsg.has(key)) return;
        this.seenMsg.add(key);
        const rr = rSnap.val() as Obj; const ru = String(rr.uid); const rp = this.profiles[ru];
        this.emit("reply", {
          rid: id, pid: parentId, mi: rSnap.key, uid: ru, lid: ru,
          topic: rr.topic ?? rp?.topic ?? "", pic: rr.pic ?? rp?.pic ?? "pic.png",
          msg: rr.msg, t: rr.t,
          ucol: rr.ucol ?? rp?.ucol ?? "#000000",
          mcol: rr.mcol ?? rp?.mcol ?? "#000000",
          bg: rp?.bg ?? "", s: false,
        }, ["msg"]);
      });
      this.offs.push(rChild);
    });
    this.offMsgs = () => { a(); d(); aR(); };
  }

  private leaveOd: ReturnType<typeof onDisconnect> | null = null;
  private notice(cls: "join" | "leave", msg = ""): Obj {
    const p = this.profiles[this.uid] ?? { topic: "?" };
    const m: Obj = { uid: this.uid, msg, t: serverTimestamp(), topic: p.topic.slice(0, 120), cls };
    if (p.pic) m.pic = p.pic;
    if (p.ucol) m.ucol = p.ucol;
    if (p.mcol) m.mcol = p.mcol;
    return m;
  }
  private async leaveCurrent(withNotice: boolean) {
    if (!this.cur) return;
    const id = this.cur; this.cur = null;
    await this.leaveOd?.cancel().catch(() => {}); this.leaveOd = null;
    if (!withNotice) this.armDrop();
    if (withNotice) await set(push(ref(db, `messages/${id}`)), this.notice("leave", "logout")).catch(() => {});
    this.offMsgs?.(); this.offMsgs = null;
    // Real leave (user chose logout/leave): truly remove the membership row.
    await onDisconnect(ref(db, `members/${id}/${this.uid}`)).cancel().catch(() => {});
    await remove(ref(db, `members/${id}/${this.uid}`)).catch(() => {});
  }

  // FIX (Problem 4): verify membership server-side on every send; reply path uses replies/<room>/<pid>.
  private async say(text0: string, parentId?: string) {
    let text = text0;
    { let n = 0; const max = Math.max(1, Number(this.site.maxshrt) || 1); text = text.split(/(\s+)/).map((w) => (this.shrt[w] !== undefined && n < max ? (n++, this.shrt[w]) : w)).join(""); }
    if (!this.cur || !text) return;
    const p = this.profiles[this.uid]; if (!p) return;
    // FIX (Problem 4): server-side membership check - not just this.cur
    const isMember = (await get(ref(db, `members/${this.cur}/${this.uid}`)).catch(() => null))?.exists();
    if (!isMember) {
      this.emit("not", { msg: "أنت لست عضواً في هذه الغرفة", type: "danger" });
      this.cur = null; this.offMsgs?.(); this.offMsgs = null;
      return;
    }
    if (this.isForbidden(text)) return this.watchCheck(text);

    if (parentId) {
      // FIX (Problem 5): reply path - verify parent exists, write under replies/<room>/<pid>/<mid>, never under messages/
      const parent = (await get(ref(db, `messages/${this.cur}/${parentId}`)).catch(() => null))?.val() as Obj | null;
      if (!parent) { this.emit("not", { msg: "الرسالة الأصلية غير موجودة", type: "danger" }); return; }
      const mid = push(ref(db, `replies/${this.cur}/${parentId}`)).key!;
      const reply: Obj = {
        uid: this.uid, msg: text.slice(0, 2000), t: serverTimestamp(),
        topic: p.topic.slice(0, 120), pid: parentId,
      };
      if (p.pic) reply.pic = p.pic;
      if (p.ucol) reply.ucol = p.ucol;
      if (p.mcol) reply.mcol = p.mcol;
      try {
        await set(ref(db, `replies/${this.cur}/${parentId}/${mid}`), reply);
        this.watchCheck(text);
      } catch (e) {
        console.error("[shim] reply failed", e);
        this.emit("not", { msg: "تعذّر إرسال الرد، تحقق من الاتصال", type: "danger" });
      }
      return;
    }

    const mid = push(ref(db, `messages/${this.cur}`)).key!;
    const m: Obj = { uid: this.uid, msg: text.slice(0, 2000), t: serverTimestamp(), topic: p.topic.slice(0, 120) };
    if (p.pic) m.pic = p.pic;
    if (p.ucol) m.ucol = p.ucol;
    if (p.mcol) m.mcol = p.mcol;
    try {
      await set(ref(db, `messages/${this.cur}/${mid}`), m);
      this.watchCheck(text);
    } catch (e) {
      console.error("[shim] say failed", e);
      this.emit("not", { msg: "تعذّر إرسال الرسالة، تحقق من الاتصال", type: "danger" });
    }
  }
  private refuseLogin(msg: string) { this.emit("not", { msg, type: "danger" }); this.emit("login", { msg: "closed" }); }
  private async siteNow(): Promise<Obj> {
    try { if (!auth.currentUser) await signInAnonymously(auth); const v = (await get(ref(db, "config/site"))).val(); if (v) this.site = v as Obj; } catch { /* keep the cached one */ }
    return this.site;
  }
  private isForbidden(text: string) { return this.forbidden.some((w) => text.includes(w)); }
  private watchCheck(text: string) {
    const v = this.watched.filter((w) => text.includes(w)).join(", ");
    if (!v) return;
    void (async () => { try {
      const token = await auth.currentUser?.getIdToken(); if (!token) return;
      await fetch("/api/fltr", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ v, msg: text }), keepalive: true });
    } catch { /* not logged */ } })();
  }

  // ---------- room moderators (ops) ----------
  private opIds(rid: string): string[] { return Object.keys((this.rooms[rid] as { ops?: Record<string, boolean> } | undefined)?.ops ?? {}); }
  private opList(rid: string) { return this.opIds(rid).map((lid) => ({ lid, topic: this.profiles[lid]?.topic ?? "", pic: this.profiles[lid]?.pic || "pic.png" })); }
  private async opAdd(lid: string) {
    if (!this.cur || !lid) return;
    await set(ref(db, `rooms/${this.cur}/ops/${lid}`), true);
    this.log("op", lid, this.rooms[this.cur]?.topic ?? "", this.cur);
    await set(push(ref(db, `alerts/${lid}`)), { from: this.uid, msg: this.cur, t: serverTimestamp(), kind: "op" });
    this.emit("alert", { msg: "تمت الترقية بنجاح", type: "success" });
    setTimeout(() => this.emit("ops", this.opList(this.cur ?? "")), 600);
  }
  private async opDel(lid: string) {
    if (!this.cur || !lid) return;
    this.log("deop", lid, this.rooms[this.cur]?.topic ?? "", this.cur);
    await remove(ref(db, `rooms/${this.cur}/ops/${lid}`));
    setTimeout(() => this.emit("ops", this.opList(this.cur ?? "")), 600);
  }

  // ---------- profile ----------
  private async setProfile(d: Obj) {
    const f: Obj = {};
    if (typeof d.topic === "string" && clean(d.topic)) f.topic = clean(d.topic).slice(0, 120);
    if (typeof d.msg === "string") f.msg = d.msg.slice(0, 200);
    if (typeof d.ucol === "string" && HEX.test(d.ucol)) f.ucol = d.ucol;
    if (typeof d.mcol === "string" && HEX.test(d.mcol)) f.mcol = d.mcol;
    if (typeof d.bg === "string" && (d.bg === "" || HEX.test(d.bg))) f.bg = d.bg;
    const me = this.profiles[this.uid];
    const changes = (typeof f.topic === "string" && f.topic !== me?.topic) || (typeof f.msg === "string" && f.msg !== (me?.msg ?? ""))
      || (typeof f.ucol === "string" && f.ucol !== (me?.ucol || "#000000")) || (typeof f.mcol === "string" && f.mcol !== (me?.mcol || "#000000")) || (typeof f.bg === "string" && f.bg !== (me?.bg || ""));
    if (changes && this.likesBlock("proflikes")) return;
    await this.writeProfile(this.uid, f, "self");
  }
  private async writeProfile(target: string, fields: Obj, src: "self" | "login" | "mod") {
    const up: Obj = {};
    for (const [k, v] of Object.entries(fields)) up[`profiles/${target}/${k}`] = v;
    if (typeof fields.topic === "string") {
      const old = (await get(ref(db, `profiles/${target}/topic`))).val();
      if (typeof old === "string" && old !== "" && old !== fields.topic) {
        const id = push(ref(db, `nameLog/${target}`)).key;
        up[`nameLog/${target}/${id}`] = { old, new: fields.topic, by: auth.currentUser?.uid ?? this.uid, at: serverTimestamp(), src };
      }
    }
    if (Object.keys(up).length) await update(ref(db), up);
  }
  private async nameHistory(target: string) {
    const uid = safeId(target);
    const NA = "غير مسجل";
    const rows: { u: string; t: string; _ip: string; _fp: string; c: number; at: number }[] = [];
    if (uid) {
      const devOf = (fp: unknown) => { const id = typeof fp === "string" ? fp.split("|")[6] ?? "" : ""; return id && id !== "-" ? id : ""; };
      const conns = ((await get(ref(db, "loginConn")).catch(() => null))?.val() ?? {}) as Record<string, Obj>;
      const ips = new Set<string>(), devs = new Set<string>();
      for (const v of Object.values(conns)) if (v.uid === uid) { if (typeof v.ip === "string" && v.ip) ips.add(v.ip); const d = devOf(v.fp); if (d) devs.add(d); }
      const uids = new Set<string>([uid]);
      for (const v of Object.values(conns)) if (typeof v.uid === "string" && ((typeof v.ip === "string" && ips.has(v.ip)) || devs.has(devOf(v.fp)))) uids.add(v.uid);
      for (const u of uids) {
        const changes = ((await get(ref(db, `nameLog/${u}`)).catch(() => null))?.val() ?? {}) as Record<string, Obj>;
        for (const v of Object.values(changes)) {
          const at = Number(v.at); if (!Number.isFinite(at)) continue;
          rows.push({ u: String(v.old || NA), t: String(v.new || NA), _ip: NA, _fp: "", c: at, at });
        }
        const logins = ((await get(query(ref(db, "loginLog"), orderByChild("uid"), equalTo(u))).catch(() => null))?.val() ?? {}) as Record<string, Obj>;
        for (const [key, v] of Object.entries(logins)) {
          const at = Number(v.created); if (!Number.isFinite(at) || typeof v.topic !== "string" || v.topic === "") continue;
          const conn = conns[key] ?? (((await get(ref(db, `loginConn/${key}`)).catch(() => null))?.val() ?? {}) as Obj);
          rows.push({ u: v.topic, t: v.topic, _ip: typeof conn.ip === "string" && conn.ip ? conn.ip : NA, _fp: compactFp(conn.fp), c: at, at });
        }
      }
    }
    rows.sort((a, b) => a.at - b.at);
    this.emit("uh", rows.map(({ at: _at, ...r }) => r));
  }
  private async setPic(pic: string) {
    const ok = pic === "pic.png" || /^uploads\/db-[\w-]+\.\w{2,4}$/.test(pic);
    if (!ok) return;
    if (this.likesBlock("piclikes")) return;
    await update(ref(db, `profiles/${this.uid}`), { pic: pic === "pic.png" ? "" : pic });
  }

  // ---------- private messages ----------
  private async sendPm(peer: string, text: string) {
    const msg = text.slice(0, 2000); if (!peer || !msg.trim()) return;
    if (this.likesBlock("pmlikes")) return;
    if (this.isForbidden(msg)) {
      const p = this.profiles[this.uid];
      this.emit("pm", { uid: this.uid, lid: this.uid, pm: peer, topic: p?.topic ?? "", pic: p?.pic ?? "pic.png", msg: esc(msg), mi: "x" + Date.now().toString(36), t: Date.now(), ucol: p?.ucol ?? "#000000", mcol: p?.mcol ?? "#000000", bg: p?.bg ?? "", s: false }, ["msg"]);
      return this.watchCheck(msg);
    }
    await set(push(ref(db, `pm/${pairKey(this.uid, peer)}`)), { uid: this.uid, msg, t: serverTimestamp() });
    this.watchCheck(String(msg));
    const last = msg.slice(0, 200);
    await update(ref(db, `pmIndex/${this.uid}/${peer}`), { t: serverTimestamp(), last, unread: 0 });
    await update(ref(db, `pmIndex/${peer}/${this.uid}`), { t: serverTimestamp(), last, unread: increment(1) });
  }
  private listenPm() {
    this.offs.push(onValue(ref(db, `pmIndex/${this.uid}`), (s) => {
      s.forEach((c) => {
        const peer = c.key!; if (this.pmWatched.has(peer)) return;
        const q = query(ref(db, `pm/${pairKey(this.uid, peer)}`), limitToLast(50));
        this.pmWatched.set(peer, onChildAdded(q, (m) => {
          const v = m.val() as Obj; if (Number(v.t) < this.t0) return;
          const u = String(v.uid); const p = this.profiles[u];
          this.emit("pm", { ...(this.forced(u, "forcepm") ? { force: 1 } : {}), uid: u, lid: u, pm: u === this.uid ? peer : u, topic: p?.topic ?? "", pic: p?.pic ?? "pic.png", msg: uplink(v.msg) || esc(String(v.msg ?? "")), t: v.t, ucol: p?.ucol ?? "#000000", mcol: p?.mcol ?? "#000000", bg: p?.bg ?? "", s: false }, ["msg"]);
        }));
      });
    }));
  }

  // ---------- wall ----------
  // FIX (Problem 5): wall replies go to wall/<id>/replies/<rid>, never into the wall feed itself.
  private async wallPost(msg: string, link: string, parentId?: string) {
    const p = this.profiles[this.uid]; if (!p || (!msg.trim() && !link)) return;
    if (this.likesBlock("wall_likes")) return;
    if (link && this.likesBlock("fileslikes")) return;
    if (parentId) {
      const parent = (await get(ref(db, `wall/${parentId}`)).catch(() => null))?.val();
      if (!parent) { this.emit("not", { msg: "الرسالة الأصلية غير موجودة", type: "danger" }); return; }
      const rid = push(ref(db, `wall/${parentId}/replies`)).key!;
      const reply: Obj = { uid: this.uid, msg: msg.slice(0, 2000), t: serverTimestamp(), topic: p.topic.slice(0, 120) };
      if (p.pic) reply.pic = p.pic;
      await set(ref(db, `wall/${parentId}/replies/${rid}`), reply);
      this.watchCheck(msg);
      return;
    }
    const gap = (Number(this.site.wall_minutes) || 0) * 60000;
    if (gap > 0) {
      const last = Object.values(((await get(query(ref(db, "wall"), limitToLast(100))).catch(() => null))?.val() ?? {}) as Record<string, Obj>).filter((w) => w.uid === this.uid).reduce((a, w) => Math.max(a, Number(w.t) || 0), 0);
      const left = last + gap - Date.now();
      if (left > 0) return this.emit("not", { msg: `يمكنك الكتابه في الحائط بعد ${Math.ceil(left / 60000)} دقيقه`, type: "danger" });
    }
    const v: Obj = { uid: this.uid, msg: msg.slice(0, 2000), t: serverTimestamp(), topic: p.topic.slice(0, 120) };
    if (p.pic) v.pic = p.pic;
    if (link) v.link = link.slice(0, 300);
    if (msg && this.isForbidden(String(v.msg))) return this.watchCheck(String(v.msg));
    await set(push(ref(db, "wall")), v);
    if (msg) this.watchCheck(String(v.msg));
  }
  private bcObj(id: string, v: Obj) {
    const u = String(v.uid); const p = this.profiles[u];
    return { uid: u, lid: u, topic: v.topic ?? p?.topic ?? "", pic: v.pic ?? p?.pic ?? "pic.png", msg: esc(String(v.msg ?? "")) + uplink(v.link), bid: id, t: v.t, link: v.link ?? "", ucol: p?.ucol ?? "#000000", mcol: p?.mcol ?? "#000000", bg: p?.bg ?? "", likes: Object.keys((v.likes ?? {}) as Obj).length, ico: "", s: false };
  }
  private listenWall() {
    const q = query(ref(db, "wall"), limitToLast(100));
    const seen = new Set<string>(); const buf: unknown[] = []; let flushed = false;
    this.offs.push(onChildAdded(q, (s) => {
      if (seen.has(s.key!)) return; seen.add(s.key!);
      const v = s.val() as Obj;
      // FIX (Problem 5): ignore rows that are replies (they live under wall/<id>/replies, not on the wall itself)
      if (v.pid || v.parentId) return;
      this.wallLikes.set(s.key!, Object.keys((v.likes ?? {}) as Obj).length);
      const o = this.bcObj(s.key!, v);
      if (!flushed) buf.push(o); else this.emit("bc", o, ["msg"]);
    }));
    this.offs.push(onChildChanged(q, (s) => {
      const n = Object.keys(((s.val() as Obj).likes ?? {}) as Obj).length;
      if (n > (this.wallLikes.get(s.key!) ?? 0)) this.emit("bc^", { bid: s.key });
      this.wallLikes.set(s.key!, n);
    }));
    this.offs.push(onChildRemoved(q, (s) => this.emit("delbc", { bid: s.key })));
    // FIX (Problem 5): listen to wall replies so they reach the wall's own reply box, never the wall feed
    const aW = onChildAdded(ref(db, "wall"), (wallSnap) => {
      const bid = wallSnap.key!;
      const rChild = onChildAdded(ref(db, `wall/${bid}/replies`), (rSnap) => {
        const key = `bc/${bid}/${rSnap.key}`;
        if (this.seenMsg.has(key)) return; this.seenMsg.add(key);
        const rv = rSnap.val() as Obj; const ru = String(rv.uid); const rp = this.profiles[ru];
        this.emit("bcreply", {
          bid, rid: rSnap.key, uid: ru, lid: ru,
          topic: rv.topic ?? rp?.topic ?? "", pic: rv.pic ?? rp?.pic ?? "pic.png",
          msg: rv.msg, t: rv.t,
          ucol: rp?.ucol ?? "#000000", mcol: rp?.mcol ?? "#000000", bg: rp?.bg ?? "", s: false,
        }, ["msg"]);
      });
      this.offs.push(rChild);
    });
    this.offs.push(aW);
    get(q).then(() => { flushed = true; this.emit("bclist", buf, ["msg"]); });
  }

  // ---------- alerts / announcements / removal signals ----------
  private listenAlerts() {
    this.offs.push(onChildAdded(ref(db, `alerts/${this.uid}`), (s) => {
      const v = s.val() as Obj; const u = String(v.from); const p = this.profiles[u];
      if (v.kind === "like") this.emit("not", { force: 1, silentWhenNonot: 1, id: u, user: u, uid: u, topic: p?.topic ?? "", pic: p?.pic ?? "pic.png", bg: p?.bg ?? "", ucol: p?.ucol ?? "#000000", msg: 'حصلت على إعجاب <i class="fa fa-heart" style="color:red;"></i>', t: v.t }, ["msg"]);
      else if (v.kind === "gift") this.emit("not", { user: u, uid: u, topic: p?.topic ?? "", pic: p?.pic ?? "pic.png", msg: `هدية <img src="dro3/${safeFile(v.gift)}" style="max-height:30px;max-width:100px;">`, t: v.t }, ["msg"]);
      else if (v.kind === "nopm" || v.kind === "nonot") this.emit("not", { silentWhenNonot: 1, user: u, uid: u, topic: p?.topic ?? "", pic: p?.pic ?? "pic.png", msg: v.kind === "nopm" ? "هذا المستخدم لا يقبل المحادثات الخاصه" : "هذا المستخدم لا يقبل التنبيهات الخاصه", t: v.t });
      else if (v.kind === "op") { this.emit("alert", { msg: "تم ترقيتك كمراقب في " + (this.rooms[String(v.msg)]?.topic ?? ""), type: "success" }); this.emit("rops", this.opList(String(v.msg))); }
      else { this.emit("not", { ...(this.forced(u, "alert") ? { force: 1 } : {}), user: u, msg: v.msg, uid: u, topic: p?.topic ?? "", pic: p?.pic ?? "pic.png", traceId: "a" + s.key, t: v.t }); addAlertReply(u, String(p?.topic ?? ""), (id, msg) => this.handle("action", { cmd: "not", id, msg })); }
      remove(s.ref).catch(() => {});
    }));
  }
  private listenTyping() {
    const on = (s: { key: string | null; val(): unknown }) => { if (s.key) this.emit("ty", [s.key, s.val() === 1 ? 1 : 0]); };
    this.offs.push(onChildAdded(ref(db, `typing/${this.uid}`), on), onChildChanged(ref(db, `typing/${this.uid}`), on));
  }
  private listenAds() {
    this.offs.push(onChildAdded(query(ref(db, "ads"), limitToLast(1)), (s) => {
      const v = s.val() as Obj; if (Number(v.t) < this.t0) return;
      const u = String(v.by); const p = this.profiles[u];
      this.emit(v.special ? "ppmsg" : "pmsg", { uid: u, lid: u, topic: p?.topic ?? "", pic: p?.pic ?? "pic.png", msg: v.msg, mi: s.key, t: v.t, ucol: p?.ucol ?? "#000000", mcol: p?.mcol ?? "#000000", bg: p?.bg ?? "", s: false });
    }));
  }
  // FIX (Problem 1, 2): when the server-side kick fires, treat it as a kick - no logout notice written by us, no
  // «تسجيل خروج» shown to others. The moderator's own write already produced the distinctive notice.
  private listenSelfKick() {
    const gone = async () => { this.emit("close", {}); await this.logout({ kicked: true }); };
    this.offs.push(onValue(ref(db, `kicks/${this.uid}`), (s) => { if (s.exists()) { remove(s.ref).catch(() => {}); void gone(); } }));
    this.offs.push(onValue(ref(db, `bans/${this.uid}`), (s) => { if (s.exists()) void gone(); }));
    this.offs.push(onValue(ref(db, `moves/${this.uid}`), (s) => { const v = s.val() as { rid?: string; pwd?: string } | null; if (!v) return; remove(s.ref).catch(() => {}); if (v.rid) void this.rjoin(String(v.rid), String(v.pwd ?? "")).catch(() => {}); }));
  }

  // ---------- user actions (the modal) and admin commands ----------
  private log(type: string, u2 = "", room = "", rid = "", d = "") {
    set(push(ref(db, "actionLog")), { type, u1: this.uid, u2: u2.slice(0, 320), ...(room ? { room: room.slice(0, 320) } : {}), ...(rid ? { rid: rid.slice(0, 60) } : {}), ...(d ? { d: d.slice(0, 120) } : {}), created: Date.now() }).catch(() => {});
  }
  private async setLikes(id: string, raw: unknown) {
    const now = Math.max(0, Number(raw) || 0), old = this.likes[id] ?? 0;
    await set(ref(db, `rep/${id}`), now);
    this.log("setlikes", id, "", "", `${old} -> ${now}`);
  }
  private async delWall(bid: string) {
    const author = String((await get(ref(db, `wall/${bid}/uid`))).val() ?? "");
    await remove(ref(db, `wall/${bid}`));
    if (author) this.log("delbc", author);
  }
  private async setNick(id: string, nick: string) {
    const old = this.profiles[id]?.topic ?? "";
    await this.writeProfile(id, { topic: nick.slice(0, 120) }, id === this.uid ? "self" : "mod");
    if (id !== this.uid) this.log("nick", id, `الزخرفه القديمه: ${old}`);
  }
  // FIX (Problem 1, 2): the kick case now does everything the request needs:
  //   - writes a distinctive "kicked" notice in the room (visible to all members, even if the target is offline)
  //   - removes the target's membership row directly (server-side, not relying on the target's session)
  //   - resets presence to NOT faded and clears onDisconnect so reconnects cannot re-add
  //   - arms the kicks/<uid> marker so the target's own session cannot rejoin
  private async action(d: Obj) {
    const id = String(d.id ?? "");
    if (["kick", "ban", "roomkick", "delpic"].includes(String(d.cmd))) this.log(String(d.cmd), id, this.rooms[this.roomOf(id) ?? ""]?.topic ?? "", this.roomOf(id) ?? "");
    switch (d.cmd) {
      case "like": await this.like(id); break;
      case "report": await set(push(ref(db, "reports")), { by: this.uid, target: id, t: Date.now() }); break;
      case "kick": {
        const room = this.roomOf(id);
        if (room) {
          // 1) distinctive room notice (written by the moderator, not the target)
          const p = this.profiles[id];
          const note: Obj = { uid: id, msg: "kicked", t: serverTimestamp(), topic: (p?.topic ?? "?").slice(0, 120), cls: "leave" };
          if (p?.pic) note.pic = p.pic;
          if (p?.ucol) note.ucol = p.ucol;
          if (p?.mcol) note.mcol = p.mcol;
          await set(push(ref(db, `messages/${room}`)), note).catch(() => {});
          // 2) remove membership row (server-side)
          await onDisconnect(ref(db, `members/${room}/${id}`)).cancel().catch(() => {});
          await remove(ref(db, `members/${room}/${id}`)).catch(() => {});
        }
        // 3) clear presence to NOT faded and drop the disconnect handlers so reconnects do not silently re-add
        await onDisconnect(ref(db, `presence/${id}`)).cancel().catch(() => {});
        await set(ref(db, `presence/${id}`), { online: false, lastSeen: Date.now(), stealth: false, drop: false }).catch(() => {});
        // 4) kick marker so rjoin() refuses to re-add
        await set(ref(db, `kicks/${id}`), { by: this.uid, t: serverTimestamp() });
        break;
      }
      case "ban": { const dev = compactFp((await get(ref(db, `memberConn/${id}/fp`)).catch(() => null))?.val()); await set(ref(db, `bans/${id}`), { by: this.uid, t: serverTimestamp(), ...(dev ? { key: dev } : {}) }); } await set(ref(db, `kicks/${id}`), { by: this.uid, t: serverTimestamp() }).catch(() => {}); break;
      case "roomkick": { const r = this.roomOf(id); if (r) await remove(ref(db, `members/${r}/${id}`)); break; }
      case "delpic": await update(ref(db, `profiles/${id}`), { pic: "" }); break;
      case "not": await set(push(ref(db, `alerts/${id}`)), { from: this.uid, msg: String(d.msg ?? "").slice(0, 500), t: serverTimestamp() }); break;
      case "gift": {
        const g = String(d.gift ?? "").slice(0, 100);
        if (g === "") { await update(ref(db, `profiles/${id}`), { gift: "" }); break; }
        await update(ref(db, `profiles/${id}`), { gift: "dro3/" + g });
        await set(push(ref(db, `alerts/${id}`)), { from: this.uid, msg: "", t: serverTimestamp(), kind: "gift", gift: g });
        break;
      }
      default: console.debug("[shim] unhandled action", d.cmd);
    }
  }
  private async like(target: string) {
    if (!target) return;
    try { await update(ref(db), { [`rep/${target}`]: increment(1), [`lastLike/${this.uid}`]: serverTimestamp() }); } catch { return; }
    await set(push(ref(db, `alerts/${target}`)), { from: this.uid, msg: "", t: serverTimestamp(), kind: "like" }).catch(() => {});
  }
  private likesShort(key: string) { const need = Number(this.site[key]) || 0; return need > 0 && (this.likes[this.uid] ?? 0) < need; }
  private hasFlag(f: string) { const n = this.powers[this.uid]?.name; const row = n ? (this.rankOf(String(n)) as unknown as Obj | undefined) : undefined; return (!!this.boot && this.boot === this.uid) || (!!row && (row[f] === true || (typeof row[f] === "number" && (row[f] as number) > 0))); }
  private likesBlock(key: "pmlikes" | "notlikes" | "proflikes" | "wall_likes" | "fileslikes" | "piclikes"): boolean {
    const need = Number(this.site[key]) || 0;
    if (!this.likesShort(key)) return false;
    const msg = key === "pmlikes" ? `المحادثات الخاصه تتطلب منك الحصول على ${need} إعجاب`
      : key === "notlikes" ? `التنبيهات تتطلب منك الحصول على ${need} إعجاب`
      : key === "proflikes" ? `يجب الحصول على ${need} إعجاب لتغير الزخرفه والحاله`
      : key === "wall_likes" ? `للكتابه على الحائط يتطلب منك الحصول على ${need} إعجاب`
      : key === "fileslikes" ? `إرسال الملفات يتطلب منك الحصول على ${need} إعجاب`
      : `يجب الحصول على ${need} إعجاب لتغير الصوره`;
    this.emit("not", { msg, type: "danger" });
    return true;
  }
  // ---------- control panel ----------
  private async cpAllowed(cmd: string): Promise<boolean> {
    const need = cpNeed(cmd);
    if (!need || !this.uid) return false;
    const facts = await this.permFacts();
    return !!facts && cpDecision(need, facts);
  }
  private async gateAllowed(g: Gate, cmd: string, d: Obj): Promise<boolean> {
    if (!this.uid) return false;
    try {
      const rel: Partial<Record<Alt, boolean>> = {};
      const target = String(cmd === "unick" || cmd === "action" || cmd === "rinvite" ? d.id ?? "" : "");
      const roomId = cmd === "r^" || cmd === "r-" ? String(d.id ?? "") : cmd === "op+" || cmd === "op-" ? (this.cur ?? "") : cmd === "action" && d.cmd === "roomkick" ? (this.roomOf(String(d.id ?? "")) ?? "") : "";
      for (const a of g.alt ?? []) {
        if (a === "self") rel.self = target !== "" && target === this.uid;
        else if (a === "author") {
          const path = cmd === "dmsg" ? (this.cur && d.mi ? `messages/${this.cur}/${String(d.mi)}/uid` : "") : cmd === "delbc" && d.bid ? `wall/${String(d.bid)}/uid` : "";
          rel.author = !!path && (await get(ref(db, path))).val() === this.uid;
        } else if (a === "roomOwner") rel.roomOwner = !!roomId && (await get(ref(db, `rooms/${roomId}/owner`))).val() === this.uid;
        else if (a === "roomOp") rel.roomOp = !!roomId && (await get(ref(db, `rooms/${roomId}/ops/${this.uid}`))).val() === true;
        else if (a === "emptyPublicRoom") {
          const r = roomId ? ((await get(ref(db, `rooms/${roomId}`))).val() as Obj | null) : null;
          rel.emptyPublicRoom = !!r && (r.pub === true || r.del === true) && !(await get(ref(db, `members/${roomId}`))).exists();
        }
      }
      if (g.alt?.some((a) => a !== "below" && rel[a] === true)) return true;
      const facts = await this.permFacts();
      if (facts && g.over) rel.below = await this.belowTarget(target, facts);
      return !!facts && gateDecision(g, facts, rel);
    } catch { return false; }
  }
  private async permFacts(): Promise<Facts | null> {
    try {
      const [boot, pw] = await Promise.all([get(ref(db, "config/bootstrap")), get(ref(db, `powers/${this.uid}`))]);
      const power = pw.val() as { name?: unknown; until?: unknown } | null;
      let row: Record<string, unknown> | undefined;
      if (typeof power?.name === "string" && power.name !== "") row = (await this.rankRows())[this.rankKey(power.name)];
      return { uid: this.uid, bootstrap: boot.val(), power, row, now: Date.now() };
    } catch { return null; }
  }
  private async rankRows(): Promise<Record<string, Record<string, unknown>>> {
    try {
      const t = (await get(ref(db, "powerTable"))).val() as Record<string, Record<string, unknown>> | null;
      if (t && typeof t === "object" && Object.keys(t).length) return t;
    } catch { /* not readable by clients */ }
    const o: Record<string, Record<string, unknown>> = {};
    for (const r of POWERS) o[this.rankKey(String(r.name))] = r as Record<string, unknown>;
    return o;
  }
  private async belowTarget(target: string, facts: Facts): Promise<boolean> {
    try {
      if (!target) return false;
      const rows = await this.rankRows(); const rowFor = (n: string) => rows[this.rankKey(n)] as { rank?: unknown } | undefined;
      const mine = rankState(facts.power as Obj | null, rowFor, facts.now);
      const theirs = rankState((await get(ref(db, `powers/${target}`))).val() as Obj | null, rowFor, facts.now);
      const owner = (typeof facts.bootstrap === "string" && facts.bootstrap === target) || target === facts.uid;
      return mayActOver(mine, theirs, owner);
    } catch { return false; }
  }
  private async cpTargetOk(cmd: string, d: Obj): Promise<boolean> {
    if (cmd !== "setpower" && cmd !== "ban" && cmd !== "unban" && cmd !== "aban") return true;
    const facts = await this.permFacts(); if (!facts) return false;
    const target = String(cmd === "ban" ? d.type ?? d.id ?? "" : d.id ?? d.type ?? "");
    if (!target) return false;
    if (cmd !== "setpower" && !this.profiles[target]) return true;
    const owner = typeof facts.bootstrap === "string" && facts.bootstrap !== "" && facts.bootstrap === this.uid;
    if (owner) return target !== this.uid;
    if (!(await this.belowTarget(target, facts))) return false;
    if (cmd !== "setpower") return true;
    const rows = await this.rankRows(); const rowFor = (n: string) => rows[this.rankKey(n)] as { rank?: unknown } | undefined;
    const mine = rankState(facts.power as Obj | null, rowFor, facts.now);
    const given = this.rankOf(String(d.power));
    if (!given) return true;
    return typeof mine === "number" && typeof given.rank === "number" && given.rank < mine;
  }
  private cpMsgsCache: Record<string, Obj> | null = null;
  private async cp(d: Obj, cpi?: string): Promise<void> {
    const cmd = String(d.cmd ?? "");
    if (!(await this.cpAllowed(cmd)) || !(await this.cpTargetOk(cmd, d))) { this.emit("not", { msg: "ليس لديك صلاحية لهذا الأمر", type: "danger" }); return; } const before = this.cpBefore(cmd, d);
    return this.cpRun(d, cpi).then(() => this.cpLog(cmd, d, before));
  }
  private cpBefore(cmd: string, d: Obj): Obj {
    if (cmd === "sitesave") return { site: shapeSite(this.site) };
    if (cmd === "msgsdel") return { t: String((this.cpMsgsCache?.[String(d.id)] as Obj | undefined)?.t ?? "") };
    if (cmd === "set_entry_room") return { label: this.rooms[String(d.id ?? d.room ?? "")]?.topic ?? "" };
    if (cmd === "bot") return { name: String(this.bots[String(d.id ?? "")]?.topic ?? "") };
    return {};
  }
  private cpLog(cmd: string, d: Obj, b: Obj) {
    const L = (label: string, u2 = "", room = "") => this.log("cpx", u2, room, "", label);
    switch (cmd) {
      case "sitesave": {
        const was = (b.site ?? {}) as Obj, next = shapeSite(d.data) as Obj;
        const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(was[k]));
        return L("إعدادات الموقع", "حفظ", changed.length ? changed.join("، ") : "بدون تغييرات");
      }
      case "domainsave": return L("النطاقات", "تعديل", normDomain(String((d.data as Obj | undefined)?.domain ?? "")));
      case "domaindel": return L("النطاقات", "حذف", normDomain(String(d.d ?? "")));
      case "addico": return L("إضافه ايقونه", "", `${String(d.tar ?? "")}/${String(d.pid ?? "").replace(/^uploads\//, "")}`);
      case "delico": return L("حذف ايقونه", "", String(d.pid ?? ""));
      case "emo_order": return L("ترتيب الايقونات");
      case "favicon": case "prv1": case "pic": case "room": return L("صور الموقع", cmd);
      case "powers_save": return L("تعديل مجموعه", String((d.power as Obj | undefined)?.name ?? ""));
      case "powers_del": return L("حذف مجموعه", String(d.name ?? ""));
      case "set_entry_room": return L("غرفه الدخول", String(b.label || "تلقائي"));
      case "msgsit": return L(d.type === "w" ? "إضافه ترحيب" : "إضافه رساله تلقائيه", String(d.t ?? ""));
      case "msgsdel": return L("حذف رساله", String(b.t ?? ""));
      case "shrtadd": return L("إضافه اختصار", String(d.name ?? ""));
      case "shrtdel": return L("حذف اختصار", String(d.name ?? ""));
      case "fltrit": return L("إضافه فلتر", String(d.v ?? ""), String(d.path ?? ""));
      case "aban": return L("سماح", String(d.type ?? ""));
      case "bot_save": return L("Bots", "حفظ");
      case "bot_all": return L("Bots", d.online === true ? "دخول للكل" : "خروج للكل");
      case "bot": return L("Bots", d.add === true ? "إضافه" : d.del === true ? "حذف" : "تعديل", String(b.name ?? ""));
      case "banner_save": case "banner_upload": case "banner_delete": return L("بنر الموقع", cmd === "banner_save" ? "حفظ" : cmd === "banner_upload" ? "رفع" : "حذف", normDomain(String(d.domain ?? "")));
      case "pwd": return L("كلمه المرور", this.profiles[String(d.id ?? "")]?.topic ?? String(d.id ?? ""));
    }
  }
  private async cpRun(d: Obj, cpi?: string): Promise<void> {
    const cmd = String(d.cmd ?? "");
    const R = (name: string, data: unknown) => this.emit(name, cpi ? { cpi, data } : data, name === "cp_owner" ? true : name === "cp_rooms" ? ROOM_TEXT : []);
    const day = 86400000;
    switch (cmd) {
      case "setpower": {
        const rk = this.rankOf(String(d.power)); const oldName = this.powers[String(d.id)]?.name ?? ""; const days = Number(d.days) || 0;
        await set(ref(db, `powers/${d.id}`), { level: rk ? Number(rk.rank) : 0, name: rk ? rk.name : "", ...(days > 0 ? { until: Date.now() + days * day } : {}) });
        this.log("setpower", String(d.id), oldName ? `[${oldName}]` : "-[]", "", rk ? rk.name : "");
        break;
      }
      case "likes": await this.setLikes(String(d.id), d.likes); break;
      case "pwd": case "delu": {
        const tok = await auth.currentUser?.getIdToken().catch(() => ""); if (!tok) break;
        const res = (await fetch("/api/member-admin", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ cmd, id: String(d.id ?? ""), pwd: String(d.pwd ?? "") }) }).then((r) => r.json()).catch(() => ({}))) as { ok?: boolean; refused?: boolean };
        if (res.refused) this.emit("not", { msg: "ليس لديك صلاحية لهذا الأمر", type: "danger" });
        else if (res.ok) { this.emit("not", { msg: cmd === "pwd" ? "تم تغيير كلمه المرور" : "تم حذف العضويه", type: "success" }); if (cmd === "delu") return this.cpRun({ cmd: "logins" }, cpi); }
        break;
      }
      case "powers_save": { const row = d.power as { name: string; rank: number }; if (row?.name !== undefined) { await this.seedTable(); await set(ref(db, `powerTable/${this.rankKey(String(row.name))}`), row); } break; }
      case "powers_del": { await this.seedTable(); await remove(ref(db, `powerTable/${this.rankKey(String(d.name))}`)); break; }
      case "bans": {
        const b = ((await get(ref(db, "bans"))).val() ?? {}) as Record<string, BanRec>;
        const now = Date.now();
        R("cp_bans", Object.entries(b).map(([id, v]) => ({ id, user: "", type: v.key ? v.key : this.profiles[id]?.topic ?? banText(id, v), date: v.allow ? "سماح" : "دائم", co: Number(v.hits) || 0, lc: lastCell(v.last, now) })));
        break;
      }
      case "unban": { const id = String(d.id ?? ""); const b = (await get(ref(db, `bans/${id}`)).catch(() => null))?.val() as BanRec | null; await remove(ref(db, `bans/${id}`)); if (b) this.log("unban", this.profiles[id] ? id : banText(id, b)); break; }
      case "ban": case "aban": { const text = String(d.type ?? "").trim().slice(0, 300); if (text) { await set(ref(db, `bans/${cmd === "ban" && this.profiles[text] ? text : banPath(text, cmd === "aban")}`), { by: this.uid, t: serverTimestamp(), reason: "manual", key: text, ...(cmd === "aban" ? { allow: true } : {}) }); if (cmd === "ban") this.log("ban", text); } break; }
      case "subs": {
        R("cp_subs", Object.entries(this.powers).filter(([, w]) => w.name).map(([id, w]) => {
          const until = Number((w as Pw & { until?: number }).until) || 0;
          return { id, user: this.profiles[id]?.topic ?? id, topic: this.profiles[id]?.topic ?? id, pic: this.profiles[id]?.pic || "pic.png", power: w.name, rank: Number(w.level) || 0, end: until, days: until ? Math.ceil((until - Date.now()) / day) : 0, ls: 0 };
        }));
        break;
      }
      case "rooms": {
        const fixed = String((await get(ref(db, "config/entryRoom"))).val() ?? "");
        R("cp_rooms", { rooms: Object.values(this.rooms).map((r) => ({ id: r.id, topic: r.topic, pic: r.pic || "room.png", user: this.profiles[r.owner]?.topic ?? "", ac: this.members[r.id]?.length ?? 0, pw: !!r.hasPass })), fixedEntryRoom: fixed });
        break;
      }
      case "set_entry_room": {
        const id = String(d.id ?? d.room ?? ""); await set(ref(db, "config/entryRoom"), id);
        R("cp_entry_room", { fixedEntryRoom: id, label: this.rooms[id]?.topic ?? "" });
        break;
      }
      case "owner": R("cp_owner", { site: { ...NO_COLOURS, ...EFFECTIVE_DEFAULTS, ...shapeSite(this.site) }, readonly: false, sico: this.ico.sico, dro3: this.ico.dro3, emo: this.ico.emo }); break;
      case "addico": {
        const tar = String(d.tar ?? ""), name = String(d.pid ?? "").replace(/^uploads\//, "");
        if (!["sico", "dro3", "emo"].includes(tar) || !/^db-[\w-]{1,40}\.(png|gif|webp|jpg)$/.test(name)) break;
        const cur = this.ico[tar as "sico"]; if (cur.includes(name)) break;
        await set(ref(db, `config/ico/${tar}`), [...cur, name]);
        R("ico+", `${tar}/${name}`);
        break;
      }
      case "delico": {
        const [tar, name] = String(d.pid ?? "").split("/");
        if (!["sico", "dro3", "emo"].includes(tar) || !name) break;
        const cur = this.ico[tar as "sico"]; if (!cur.includes(name)) break;
        await set(ref(db, `config/ico/${tar}`), cur.filter((x) => x !== name));
        R("ico-", `${tar}/${name}`);
        break;
      }
      case "favicon": case "prv1": case "pic": case "room": {
        const fn = String(d.fn ?? ""); if (!SITE_FILE_OK.test(fn)) break;
        await set(ref(db, `config/files/${cmd}`), fn);
        break;
      }
      case "bots": {
        const c = this.botsCfg, ids = Object.keys(this.bots);
        R("cp_bots", { bots_minStay: String(c.bots_minStay ?? 0), bots_maxStay: String(c.bots_maxStay ?? 0), bots_minLeave: String(c.bots_minLeave ?? 0), bots_maxLeave: String(c.bots_maxLeave ?? 0), bots_active: c.bots_active !== false, max: Number(c.max) || 100, used: ids.length });
        R("cp_bots", ids.map((id) => this.botRow(id)));
        break;
      }
      case "bot_save": {
        const n = (v: unknown) => Math.max(0, Math.min(100000, Math.floor(Number(v) || 0)));
        await update(ref(db, "config/botsCfg"), { bots_active: d.bots_active === true, bots_minStay: n(d.bots_minStay), bots_maxStay: n(d.bots_maxStay), bots_minLeave: n(d.bots_minLeave), bots_maxLeave: n(d.bots_maxLeave) });
        return this.cpRun({ cmd: "bots" }, cpi);
      }
      case "bot_all": {
        const up: Obj = {}; for (const id of Object.keys(this.bots)) up[`${id}/online`] = d.online === true;
        if (Object.keys(up).length) await update(ref(db, "config/bots"), up);
        return this.cpRun({ cmd: "bots" }, cpi);
      }
      case "bot": {
        if (d.add === true) {
          const max = Number(this.botsCfg.max) || 100; if (Object.keys(this.bots).length >= max) break;
          const taken = new Set([...Object.values(this.bots).map((b) => String(b.topic)), ...Object.values(this.profiles).map((p) => String(p.name ?? p.topic))]);
          let name = ""; for (let i = 0; i < 50 && (!name || taken.has(name)); i++) name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + (i > 5 ? String(Math.floor(Math.random() * 90) + 10) : "");
          const id = "bot-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          await set(ref(db, `config/bots/${id}`), { topic: name, msg: "(غير مسجل)", co: BOT_COUNTRIES[Math.floor(Math.random() * BOT_COUNTRIES.length)], pic: "pic.png", ucol: "#000000", bg: "", rep: 0, online: true, t: Date.now() });
          return this.cpRun({ cmd: "bots" }, cpi);
        }
        const id = String(d.id ?? ""); if (!this.isBot(id)) break;
        if (d.del === true) { await remove(ref(db, `config/bots/${id}`)); break; }
        const f: Obj = {};
        if (typeof d.topic === "string" && d.topic.trim().length > 1) f.topic = clean(d.topic).slice(0, 50);
        if (typeof d.msg === "string" && d.msg.trim().length > 1) f.msg = d.msg.slice(0, 200);
        if (typeof d.co === "string" && FLAG_CODES.has(d.co.toLowerCase())) f.co = d.co.toUpperCase();
        if (typeof d.ucol === "string" && HEX.test(d.ucol)) f.ucol = d.ucol;
        if (typeof d.bg === "string" && (d.bg === "" || HEX.test(d.bg))) f.bg = d.bg;
        if (typeof d.online === "boolean") f.online = d.online;
        if (typeof d.pic === "string" && (d.pic === "pic.png" || /^uploads\/db-[\w-]{1,40}\.(png|gif|webp|jpg)$/.test(d.pic))) f.pic = d.pic;
        if (typeof d.or === "string") { const r = this.rooms[d.or]; if (r && !r.hasPass && !(r.pub || r.del)) f.or = d.or; }
        if (Object.keys(f).length) await update(ref(db, `config/bots/${id}`), f);
        break;
      }
      case "emo_order": {
        const want = (Array.isArray(d.d) ? d.d : []).map(String), cur = this.ico.emo;
        const next = [...want.filter((x, i) => cur.includes(x) && want.indexOf(x) === i), ...cur.filter((x) => !want.includes(x))];
        if (JSON.stringify(next) !== JSON.stringify(cur)) await set(ref(db, "config/ico/emo"), next);
        break;
      }
      case "sitesave": {
        const next = shapeSite(d.data);
        if (Object.keys(next).length) await update(ref(db, "config/site"), next);
        R("cp_owner", { site: { ...NO_COLOURS, ...EFFECTIVE_DEFAULTS, ...shapeSite(this.site), ...next }, readonly: false });
        break;
      }
      case "logins": {
        const q = String(d.q ?? "").trim().toLowerCase(), i = Math.max(0, Number(d.i) || 0);
        const conn = ((await get(ref(db, "memberConn")).catch(() => null))?.val() ?? {}) as Record<string, { ip?: unknown; fp?: unknown }>;
        const rows = Object.entries(this.profiles).filter(([, p]) => p.registered).map(([id, p]) => ({
          id, u: p.name || p.topic, t: p.topic, pic: p.pic || "pic.png", power: this.powers[id]?.name ?? "", rep: this.likes[id] ?? 0, fp: compactFp(conn[id]?.fp), ip: typeof conn[id]?.ip === "string" ? String(conn[id].ip) : "", ac: 0,
          lastseen: Number((this.presence[id] as { lastSeen?: number } | undefined)?.lastSeen) || 0, regdate: Number((p as { createdAt?: number }).createdAt) || 0,
        })).filter((r) => memberMatches(r, q)).sort((a, b) => b.regdate - a.regdate);
        R("cp_logins", [...rows.slice(i, i + 100), { d: Date.now(), i }]);
        break;
      }
      case "fps": {
        const q = String(d.q ?? "").trim().toLowerCase(), i = Math.max(0, Number(d.i) || 0);
        const all = Object.entries(((await get(ref(db, "loginLog"))).val() ?? {}) as Record<string, Obj>).map(([id, v]) => ({ id, v })).sort((a, b) => Number(b.v.created) - Number(a.v.created));
        const conn = ((await get(ref(db, "loginConn")).catch(() => null))?.val() ?? {}) as Record<string, Obj>;
        const nm = (v: Obj) => (typeof v.topic === "string" && v.topic ? v.topic : "غير مسجل");
        const rows = all.filter((x) => memberMatches({ u: String(x.v.topic ?? ""), t: String(x.v.topic ?? ""), id: String(x.v.uid ?? ""), ip: String(conn[x.id]?.ip ?? ""), fp: compactFp(conn[x.id]?.fp) }, q)).slice(i, i + 50).map(({ id, v }) => ({
          id, fp: compactFp(conn[id]?.fp), pic: this.profiles[String(v.uid)]?.pic || "pic.png", isreg: v.ban ? "محظور" : v.isreg || this.profiles[String(v.uid)]?.registered ? "عضو" : "زائر", username: this.profiles[String(v.uid)]?.name || nm(v), topic: nm(v), co: flagCode(v.co), ip: String(conn[id]?.ip ?? ""), refr: String(conn[id]?.refr ?? ""), r: String(conn[id]?.r ?? ""), dt: "", td: "", ac: 1, created: Number(v.created), a: [],
        }));
        R("cp_fps", [...rows, { d: Date.now(), i }]);
        break;
      }
      case "actions": {
        const q = String(d.q ?? "").trim().toLowerCase(), i = Math.max(0, Number(d.i) || 0);
        const all = Object.values(((await get(ref(db, "actionLog"))).val() ?? {}) as Record<string, Obj>).sort((a, b) => Number(b.created) - Number(a.created));
        const conn = ((await get(ref(db, "memberConn")).catch(() => null))?.val() ?? {}) as Record<string, { ip?: unknown }>;
        const ipOf = (u: unknown) => (typeof conn[String(u)]?.ip === "string" ? String(conn[String(u)].ip) : "");
        const ipCell = (v: Obj) => { const a = ipOf(v.u1), b = v.u2 && conn[String(v.u2)] ? ipOf(v.u2) : ""; return v.type === "delu" ? `${a} |` : b ? `${a} | ${b}` : a; };
        const who = (u: unknown) => this.profiles[String(u)]?.topic ?? String(u ?? "");
        const u2Cell = (v: Obj) => (v.type === "delu" ? String(v.d ?? "") : v.type === "setlikes" ? `${who(v.u2)} ${String(v.d ?? v.room ?? "")}` : v.type === "setpower" ? `[${String(v.d ?? "")}]${who(v.u2)}` : who(v.u2));
        const roomCell = (v: Obj) => (v.type === "setlikes" ? "" : String(v.room ?? ""));
        const rows = all.map((v) => ({ type: v.type === "cpx" ? String(v.d ?? "") : ACTION_LABELS[String(v.type)] ?? String(v.type), u1: who(v.u1), u2: u2Cell(v), room: roomCell(v), ip: ipCell(v), created: Number(v.created) }))
          .filter((x) => !q || `${x.type} ${x.u1} ${x.u2}`.toLowerCase().includes(q)).slice(i, i + 200);
        R("cp_actions", [...rows, { d: Date.now(), i }]);
        break;
      }
      case "msgs": { const all = ((await get(ref(db, "config/msgs"))).val() ?? {}) as Record<string, Obj>; this.cpMsgsCache = all; R("cp_msgs", Object.entries(all).map(([id, v]) => ({ id, type: String(v.type), t: String(v.t), m: String(v.m) }))); break; }
      case "msgsit": await set(push(ref(db, "config/msgs")), { type: d.type === "w" ? "w" : "d", t: String(d.t ?? "").slice(0, 120), m: String(d.m ?? "").slice(0, 1000) }); return this.cpRun({ cmd: "msgs" }, cpi);
      case "msgsdel": await remove(ref(db, `config/msgs/${d.id}`)); return this.cpRun({ cmd: "msgs" }, cpi);
      case "shrt": R("cp_shrt", Object.entries(this.shrt).map(([name, value]) => ({ name, value }))); break;
      case "shrtadd": if (d.name) await set(ref(db, `config/shrt/${(await sha(String(d.name))).slice(0, 20)}`), { name: String(d.name).slice(0, 40), value: String(d.value ?? "").slice(0, 300) }); return this.cpRun({ cmd: "shrt" }, cpi);
      case "shrtdel": await remove(ref(db, `config/shrt/${(await sha(String(d.name))).slice(0, 20)}`)); return this.cpRun({ cmd: "shrt" }, cpi);
      case "fltr": R("cp_fltr", { a: Object.entries(((await get(ref(db, "config/fltr"))).val() ?? {}) as Record<string, Obj>).map(([id, v]) => ({ id, path: String(v.path), type: FLTR_LABEL[String(v.path)] ?? String(v.type), v: String(v.v), hits: 0, last: 0, target: 0 })), b: Object.entries(((await get(ref(db, "fltrLog")).catch(() => null))?.val() ?? {}) as Record<string, Obj>).reverse().map(([id, v]) => ({ id, v: String(v.v ?? ""), msg: String(v.msg ?? ""), topic: String(v.topic ?? ""), ip: String(v.ip ?? "") })), c: [] }); break;
      case "fltrdelx": await remove(ref(db, `fltrLog/${String(d.id ?? "")}`)); break;
      case "fltrit": if (d.v) await set(push(ref(db, "config/fltr")), { path: String(d.path ?? ""), type: String(d.type ?? d.path ?? ""), v: String(d.v).slice(0, 100) }); return this.cpRun({ cmd: "fltr" }, cpi);
      case "fltrdel": await remove(ref(db, `config/fltr/${d.id}`)); break;
      case "wrooms": {
        const l = ((await get(ref(db, "config/wroomsList"))).val() ?? {}) as Record<string, BanRec>; const now = Date.now();
        R("cp_wrooms", { owr: ((await get(ref(db, "config/wroomsOwr"))).val() ?? { active: false, autoAllow: false, move: false, nots: false, pm: false, allowlikes: false, likes: 0 }) as Obj,
          ar: Object.entries(l).map(([id, v]) => ({ id, user: "", type: v.key ?? banText(id, v), date: v.allow ? "سماح" : "دائم", co: Number(v.hits) || 0, lc: lastCell(v.last, now) })) });
        break;
      }
      case "wrooms+": case "wroomsa": case "wrooms-": {
        if (cmd === "wrooms-") { const id = safeId(String(d.id ?? "")) || "-"; const e = (await get(ref(db, `config/wroomsList/${id}`)).catch(() => null))?.val() as { key?: string } | null; await remove(ref(db, `config/wroomsList/${id}`)); if (e) this.log("wroom", "حذف", `حذف: ${e.key ?? id}`); }
        else { const text = String(d.type ?? "").trim().slice(0, 300); if (text) await set(ref(db, `config/wroomsList/${banPath(text, cmd === "wroomsa")}`), { by: this.uid, t: serverTimestamp(), key: text, ...(cmd === "wroomsa" ? { allow: true } : {}) }); }
        return this.cpRun({ cmd: "wrooms" }, cpi);
      }
      case "owr": case "wroomsOwr": case "owrsave": {
        const s = ((d.data ?? d) ?? {}) as Obj;
        const owr = { active: s.active === true, autoAllow: s.autoAllow === true, move: s.move === true, nots: s.nots === true, pm: s.pm === true, allowlikes: s.allowlikes === true, likes: Math.max(0, Math.min(100, Math.floor(Number(s.likes) || 0))) };
        await set(ref(db, "config/wroomsOwr"), owr);
        this.log("wroom", "حفظ", `تفعيل: ${owr.active ? "تفعيل" : "تعطيل"}`);
        R("cp_wrooms", { owr, ar: [] });
        break;
      }
      case "domains": R("cp_domains", { items: this.domainItems(), readonly: false }); R("cp_banner", { enabled: this.banner.enabled === true, image: this.banner.image ?? "" }); break;
      case "domainsave": {
        const v = (d.data ?? {}) as Obj; const dom = normDomain(String(v.domain ?? "")); if (!dom) break;
        const k = domainKey(dom), old = this.domains[k] ?? {};
        const item: Obj = { domain: dom };
        for (const f of DOMAIN_TEXT) item[f] = String(v[f] ?? "").slice(0, f === "script" || f === "html" || f === "customHead" ? 20000 : 1000);
        for (const f of ["bg", "background", "buttons"]) { const c = String(v[f] ?? ""); item[f] = /^#?[0-9a-fA-F]{3,8}$/.test(c) ? c : ""; }
        if (old.bannerEnabled !== undefined) item.bannerEnabled = old.bannerEnabled === true;
        if (typeof old.bannerImage === "string") item.bannerImage = old.bannerImage;
        await set(ref(db, `config/domains/${k}`), item);
        this.domains[k] = item; R("cp_domains", { items: this.domainItems(), readonly: false });
        break;
      }
      case "domaindel": {
        const dom = normDomain(String(d.d ?? "")); if (!dom) break;
        await remove(ref(db, `config/domains/${domainKey(dom)}`));
        delete this.domains[domainKey(dom)]; R("cp_domains", { items: this.domainItems(), readonly: false });
        break;
      }
      case "banner_save": case "banner_upload": case "banner_delete": {
        const dom = normDomain(String(d.domain ?? ""));
        if (dom) {
          const k = domainKey(dom), it = { ...(this.domains[k] ?? {}) }; if (!it.domain) break;
          if (cmd === "banner_save") it.bannerEnabled = d.enabled === true;
          if (cmd === "banner_upload") { const fn = String(d.fn ?? ""); if (!/^uploads\/db-[\w-]{1,40}\.(png|gif|webp|jpg)$/.test(fn)) break; it.bannerImage = fn; }
          if (cmd === "banner_delete") delete it.bannerImage;
          await set(ref(db, `config/domains/${k}`), it); this.domains[k] = it;
          R("cp_banner", { enabled: it.bannerEnabled === true, image: typeof it.bannerImage === "string" ? it.bannerImage : "" });
          break;
        }
        const next = { ...this.banner };
        if (cmd === "banner_save") next.enabled = d.enabled === true;
        if (cmd === "banner_upload") { const fn = String(d.fn ?? ""); if (!/^uploads\/db-[\w-]{1,40}\.(png|gif|webp|jpg)$/.test(fn)) break; next.image = fn; }
        if (cmd === "banner_delete") delete next.image;
        await set(ref(db, "config/banner/_main"), next);
        R("cp_banner", { enabled: next.enabled === true, image: next.image ?? "" });
        break;
      }
      case "sico": R("cp_sico", this.ico.sico); break;
      default: console.debug("[shim] unhandled cp", cmd, d);
    }
  }
  private async seedTable() {
    if ((await get(ref(db, "powerTable"))).exists()) return;
    const up: Obj = {};
    for (const r of POWERS) up[this.rankKey(String(r.name))] = r;
    await update(ref(db, "powerTable"), up);
  }

  private settings() {
    const n = (k: string, d: number) => (typeof this.site[k] === "number" ? (this.site[k] as number) : d);
    return { ...SETTINGS, roomMsgLikes: n("roomMsgLikes", 0), guestNameMax: n("guestNameMax", 50), registerNameMax: n("registerNameMax", 50), mlikes: !!this.site.mlikes, mreply: !!this.site.mreply, bcreply: this.site.bcreply !== false, bclikes: this.site.bclikes !== false, calls: !!this.site.calls };
  }
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private autoGen?: number;
  private skew = 0;
  private autoMessages() {
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }
    this.autoGen = (this.autoGen ?? 0) + 1; const gen = this.autoGen;
    onValue(ref(db, ".info/serverTimeOffset"), (s) => { this.skew = Number(s.val()) || 0; }, { onlyOnce: true });
    const tick = async () => {
      if (!this.ready || gen !== this.autoGen) return;
      const period = Math.max(1, Number(this.site.msgst) || 5) * 60000;
      const now = Date.now() + this.skew, slot = Math.floor(now / period);
      this.autoTimer = setTimeout(async () => {
        const all = Object.values(((await get(ref(db, "config/msgs")).catch(() => null))?.val() ?? {}) as Record<string, { type: string; t: string; m: string }>).filter((v) => v.type === "d");
        if (all.length && this.ready) { const v = all[(slot + 1) % all.length]; this.emit("msg", { class: "pmsgc", user: "", uid: "", lid: "", topic: v.t, ucol: "#ff0000", pic: "room.png", msg: v.m, t: Date.now() }); }
        void tick();
      }, (slot + 1) * period - now + 50);
    };
    void tick();
  }
  private async welcome() {
    const m = ((await get(ref(db, "config/msgs"))).val() ?? {}) as Record<string, { type: string; t: string; m: string }>;
    for (const v of Object.values(m)) if (v.type === "w") this.emit("msg", { class: "pmsgc", user: "", uid: "", lid: "", topic: v.t, ucol: "#ff0000", pic: "room.png", msg: v.m, t: Date.now() });
  }

  // ---------- object builders ----------
  private onlineCount() { return Object.keys(this.presence).filter((u) => (this.fresh(this.presence[u]) || this.faded(u)) && !this.presence[u]?.stealth && !this.superseded(u)).length + this.onlineBots().length; }
  private table: typeof POWERS = POWERS;
  private rankKey(name: string) { return name === "" ? "_" : name.replace(/[.$#\[\]/]/g, "-"); }
  private rankOf(name: string) { return this.table.find((p) => p.name === name); }
  private levelOf(u: string) { return this.powers[u]?.level ?? 0; }
  private fresh(p?: { online?: boolean; lastSeen?: unknown }) { return !!p?.online && (typeof p.lastSeen !== "number" || Date.now() - p.lastSeen < 180000); }
  private faded(u: string) {
    const p = this.presence[u] as { online?: boolean; drop?: boolean; lastSeen?: unknown } | undefined;
    return !!p && !p.online && p.drop === true && typeof p.lastSeen === "number" && Date.now() - p.lastSeen < Math.max(1, parseInt(String(this.site.stay)) || 1) * 60000;
  }
  private guestName(u: string): string | null { const p = this.profiles[u]; return p && !p.registered ? String(p.name ?? p.topic ?? "") : null; }
  private superseded(u: string) {
    const n = this.guestName(u); if (n === null) return false;
    const since = (x: string) => Number((this.presence[x] as { in?: unknown } | undefined)?.in) || 0;
    const mine = since(u);
    return Object.keys(this.presence).some((v) => v !== u && since(v) > mine && (this.fresh(this.presence[v]) || this.faded(v)) && this.guestName(v) === n);
  }
  private replacedDone = false;
  private checkReplaced() {
    if (this.replacedDone || !this.ready || !this.uid || !this.superseded(this.uid)) return;
    this.replacedDone = true; replaced = true;
    clearInterval(this.beat); clearInterval(this.idleTick); if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }
    const me = this.uid, room = this.cur;
    void (async () => {
      await onDisconnect(ref(db, `presence/${me}`)).cancel().catch(() => {});
      await this.leaveOd?.cancel().catch(() => {}); this.leaveOd = null;
      if (room) { await onDisconnect(ref(db, `members/${room}/${me}`)).cancel().catch(() => {}); await remove(ref(db, `members/${room}/${me}`)).catch(() => {}); }
      await set(ref(db, `presence/${me}`), { online: false, lastSeen: Date.now(), stealth: false });
    })();
    if (session && session.server === this) { session.dropped = true; const pend = session.pending; this.out = (cmd, data) => { pend.push([cmd, data]); }; }
    this.drop();
  }
  private fadedIn(rid: string) { return Object.keys(this.presence).filter((u) => this.faded(u) && !this.superseded(u) && (this.presence[u] as { room?: unknown }).room === rid && !(this.members[rid] ?? []).includes(u)).length; }
  private rankNo(u: string) { const n = this.powers[u]?.name; const r = n ? Number((this.rankOf(String(n)) as { rank?: unknown } | undefined)?.rank) : 0; return Number.isFinite(r) ? r : 0; }
  private canSee(u: string) { const p = this.presence[u]; return (this.fresh(p) || this.faded(u)) && (u === this.uid || !this.superseded(u)) && (!p!.stealth || u === this.uid || this.rankNo(this.uid) >= this.rankNo(u)); }
  private visibleUsers() { return [...Object.keys(this.profiles).filter((u) => this.canSee(u) || u === this.uid), ...this.onlineBots()]; }
  private userObj(u: string) {
    if (this.isBot(u)) return this.botObj(u) as ReturnType<Server["userObjReal"]>;
    return this.userObjReal(u);
  }
  private userObjReal(u: string) {
    const p = this.profiles[u] ?? { topic: "?" }; const w = this.powers[u];
    return {
      id: u, lid: u, username: p.name || p.topic, topic: p.topic, msg: p.msg ?? (p.registered ? "(عضو جديد)" : "(غير مسجل)"), pic: p.pic || "pic.png",
      power: w?.name || (p.registered ? "user" : "guest"), roomid: this.roomOf(u), ucol: p.ucol || "#000000", mcol: p.mcol || "#000000", bg: p.bg || "",
      ...(this.presence[u]?.stealth ? { s: true } : {}),
      co: flagCode(p.co), rep: this.likes[u] ?? 0, ico: (p as Prof & { gift?: string; b?: string }).gift || ((p as Prof & { b?: string }).b ? "sico/" + (p as Prof & { b?: string }).b : ""), b: (p as Prof & { b?: string }).b ?? "", busy: !!p.busy, stat: this.statOf(u, p),
    };
  }
  private powerObj(_level: number, _registered: boolean) {
    const name = this.powers[this.uid]?.name;
    const row = this.table.find((p) => p.name === name);
    return { ...(row ?? DEFAULT_POWER) };
  }
}