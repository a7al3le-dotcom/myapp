// Who may run which command. No imports (unit-tested directly).
//
// Rule: nothing is allowed by default. A command that needs a permission is listed in one of the tables below; a command that is not listed in
// any table fails the completeness test (tests/site.test.mjs), so a new command cannot slip in unclassified.
// "owner" = the account named in /config/bootstrap. Every other requirement is a flag of the rank table (powerTable / the built-in table),
// the same flags database.rules.json reads. The shim's check mirrors the rules (it never asks for less than they do, and for the control panel
// it asks for the section's own flag when READING and for setpower when CHANGING settings); the rules stay the lock a modified client cannot pick.
export type CpNeed = string; // "owner" or a rank flag name

export const CP_REQUIRES: Record<string, CpNeed> = {
  // --- site settings: the owner only ---
  owner: "cpsite", sitesave: "cpsite", addico: "cpsite", delico: "cpsite", emo_order: "cpsite", favicon: "cpsite", prv1: "cpsite", pic: "cpsite", room: "cpsite",
  bots: "botsowner", bot_save: "botsowner", bot: "botsowner", bot_all: "botsowner", // x3 L4885: cpsite AND rank > 8998 (checked in cpDecision)
  domainsave: "cpdomains", domaindel: "cpdomains", banner_save: "cpdomains", banner_upload: "cpdomains", banner_delete: "cpdomains", // «بنر الموقع» lives in the «النطاقات» tab // the icon lists live in the same tab (cp-body #sett) // x3 L4882: the «إداره الموقع» tab is shown with cpsite (script / customHead / html stay owner-only)
  // --- reading a panel section: the least permission that section needs (its own flag; having the panel open grants nothing) ---
  logins: "cplogins", fps: "cpfps", actions: "cpactions", bans: "cpbans", rooms: "cprooms", shrt: "cpshrt", msgs: "cpmsgs",
  wrooms: "cpwrooms", subs: "cpsubs", fltr: "filter", domains: "cpdomains",
  sico: "cp", // the icon list has no flag of its own in the rank table: the general panel flag, nothing finer is guessed
  // --- changing administration settings (ranks, messages, shortcuts, filters, waiting rooms, entry room): setpower, as the rules require ---
  // each tab's changes need that tab's own flag (x3 fn90 L4866: the tab is shown with it) — linked 2026-11-06 at the owner's request
  setpower: "setpower", likes: "setLikes", powers_save: "editpower", powers_del: "editpower", set_entry_room: "cprooms",
  msgsit: "cpmsgs", msgsdel: "cpmsgs", shrtadd: "cpshrt", shrtdel: "cpshrt", fltrit: "filter", fltrdel: "filter", fltrdelx: "filter",
  wroomsOwr: "cpwrooms", owrsave: "cpwrooms", owr: "cpwrooms", "wrooms+": "cpwrooms", wroomsa: "cpwrooms", "wrooms-": "cpwrooms",
  // --- moderation done from the panel ---
  ban: "ban", unban: "unban", aban: "unban",
  // ⚙ of «الأعضاء» (x3 cp_ledit, shown with «إدارة العضويات»): the server route checks the flag and the rank order again
  pwd: "edituser", delu: "edituser",
};

export const cpNeed = (cmd: unknown): CpNeed | undefined =>
  typeof cmd === "string" && Object.prototype.hasOwnProperty.call(CP_REQUIRES, cmd) ? CP_REQUIRES[cmd] : undefined;

/** A rank flag is on when it is `true` or a positive number (the same test database.rules.json applies). */
export const flagOn = (v: unknown): boolean => v === true || (typeof v === "number" && v > 0);

export type Facts = { uid: string; bootstrap: unknown; power: { name?: unknown; until?: unknown } | null | undefined; row: Record<string, unknown> | null | undefined; now: number };

/** Pure decision from facts the caller has just read from the database. Anything missing means "no". */
export function cpDecision(need: CpNeed | undefined, facts: Facts): boolean {
  if (!need || !facts.uid) return false;
  if (typeof facts.bootstrap === "string" && facts.bootstrap !== "" && facts.bootstrap === facts.uid) return true; // the owner
  if (need === "owner") return false;
  const p = facts.power;
  if (!p || typeof p.name !== "string" || p.name === "") return false;
  if (typeof p.until === "number" && p.until < facts.now) return false; // an expired rank grants nothing
  if (need === "botsowner") return !!facts.row && flagOn(facts.row.cpsite) && Number(facts.row.rank) > 8998; // «Bots» (x3 L4885)
  return !!facts.row && flagOn(facts.row[need]);
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Commands outside the control panel (chat window, user card, room tools)
// ------------------------------------------------------------------------------------------------------------------------------------------
/** Ways a person can be allowed WITHOUT the rank flag, taken from what database.rules.json already allows:
 *  self = the command is about their own account; author = they wrote the message / wall post; roomOwner = they own the room;
 *  roomOp = they are a moderator of that room; emptyPublicRoom = a public (or throw-away) room nobody is in. */
export type Alt = "self" | "author" | "roomOwner" | "roomOp" | "emptyPublicRoom" | "below";
/** over: the flag only counts against somebody STRICTLY below the person acting (the rank hierarchy of S3); the relations in `alt` still stand. */
export type Gate = { flag?: string; alt?: readonly Alt[]; over?: true };

// ---- rank hierarchy ----
export type RankState = number | "none" | "corrupt";
/** The rank of a person, from their record in /powers and the rank rows. "none" = an ordinary member (no record, an expired one, or the empty rank
 *  the control panel writes when a rank is taken away). A number = a valid rank (0..10000). "corrupt" = anything else (a name the table does not know, a
 *  rank that is not a number or is out of range): never treated as zero. */
export function rankState(power: { name?: unknown; level?: unknown; until?: unknown } | null | undefined, rowFor: (name: string) => { rank?: unknown } | undefined, now: number): RankState {
  if (power === null || power === undefined) return "none";
  if (typeof power !== "object") return "corrupt";
  if (typeof power.until === "number" && power.until < now) return "none";
  if (power.name === "" && power.level === 0) return "none";
  if (typeof power.name !== "string") return "corrupt";
  const r = rowFor(power.name)?.rank;
  return typeof r === "number" && Number.isFinite(r) && r >= 0 && r <= 10000 ? r : "corrupt";
}
/** may somebody of rank `actor` act on somebody of rank `target`? Only on an ordinary member or a STRICTLY lower rank, never on the owner, never on oneself. */
export function mayActOver(actor: RankState, target: RankState, targetIsOwnerOrSelf: boolean): boolean {
  if (targetIsOwnerOrSelf || typeof actor !== "number") return false;
  return target === "none" || (typeof target === "number" && target < actor);
}

/** Key = the command name, or "action:<name>" for the sub-commands of `action`. Requirements mirror database.rules.json exactly. */
export const GATES: Record<string, Gate> = {
  dmsg: { flag: "dmsg", alt: ["author"] }, // messages/$rid/$mid: the author or «مسح الرسائل» (x3 L3858 myPower.dmsg)
  delbc: { flag: "delbc", alt: ["author"] }, // wall/$id: the author or deleteMsg
  pmsg: { flag: "publicmsg" }, ppmsg: { flag: "ppmsg" }, // ads: «الإعلانات»; super ads: «اعلانات السوابر» (x3 L3641)
  uh: { flag: "history" }, // «كشف النكات»: nameLog is read with the `history` flag (G3); loginLog / loginConn keep their own rules (cp / cplogins)
  setLikes: { flag: "setLikes" }, // rep/$uid: the «لايكات» flag (x3 L4174 shows the likes box with myPower.setLikes); oneself included (owner 2026-11-06)
  bnr: { flag: "bnr" }, "bnr-": { flag: "bnr" }, // profiles/$uid/b: «البنر» (x3 L4221 myPower.bnr)
  unick: { flag: "unick", alt: ["self"], over: true }, // «تغير النكات» over a lower rank; oneself needs «تغير النك» (mynick, checked in server.ts) (x3 L4129)
  "r^": { flag: "roomowner", alt: ["roomOwner"] }, // rooms/$rid: the owner or roomManage
  "r-": { flag: "roomowner", alt: ["roomOwner", "emptyPublicRoom"] },
  "op+": { flag: "roomowner", alt: ["roomOwner"] }, "op-": { flag: "roomowner", alt: ["roomOwner"] }, // rooms/$rid/ops lives under the room's rule
  "action:kick": { flag: "kick", alt: ["self"], over: true }, // kicks/$uid: kickRoom against somebody below, or the person himself
  "action:ban": { flag: "ban", over: true }, // bans/$uid: the "ban" permission against somebody below
  "action:roomkick": { flag: "kick", alt: ["self", "roomOwner", "roomOp"], over: true }, // members/$rid/$uid
  "action:delpic": { flag: "kick", alt: ["self"], over: true }, // profiles/$uid: shown with the kick flag (x3 L4223)
  "action:gift": { flag: "upgrades" },
  rinvite: { flag: "rinvite", over: true }, // moves/$uid: «نقل الزوار» against somebody below (card > room list > «نقل») // profiles/$uid/gift: the "upgrade" permission
};

/** Needs no rank: ordinary use by any session (the rules still apply to what they write). */
export const OPEN_COMMANDS: readonly string[] = [
  "online", "g", "login", "reg", "logout", "rjoin", "rleave", "msg", "setprofile", "setpic", "busy", "pm", "bc", "likebc", "nopm", "nonot", "ty", "diag",
  "action:like", "action:report",
  "action:not", // an alert: no permission, only the «إداره الموقع» notlikes likes (checked first in server.ts and by the rules); the alert flag only forces
  "file", // a picture in a private chat: the same as pm (the pm rules apply to what it writes)
  "ops", // the moderators of a room for the room editor: room data any signed-in user may read
];
/** Check their permission themselves, on their own path (room creation by rank; the control panel through CP_REQUIRES). */
export const SELF_CHECKED: readonly string[] = ["r+", "cp", "cpi"];
/** Commands that wait for a later stage. Empty since S3 closed the last one (free-text alerts); the completeness test still reads it. */
export const DEFERRED_TO_S3: readonly string[] = [];

/** The gate for an incoming command, if it has one. */
export function gateFor(cmd: string, data: { cmd?: unknown } | null | undefined): { key: string; gate: Gate } | undefined {
  const key = cmd === "action" ? `action:${String(data?.cmd ?? "")}` : cmd;
  return Object.prototype.hasOwnProperty.call(GATES, key) ? { key, gate: GATES[key] } : undefined;
}

/** Pure decision for a gate: one of the relations holds, or the rank flag (or ownership of the site) does. */
export function gateDecision(g: Gate, facts: Facts, rel: Partial<Record<Alt, boolean>>): boolean {
  if (!facts.uid) return false;
  if (g.alt?.some((a) => a !== "below" && rel[a] === true)) return true;
  if (!g.flag || !cpDecision(g.flag, facts)) return false;
  if (!g.over) return true;
  const owner = typeof facts.bootstrap === "string" && facts.bootstrap !== "" && facts.bootstrap === facts.uid;
  return owner || rel.below === true; // the owner is exempt from the hierarchy; everybody else needs a target strictly below them
}
