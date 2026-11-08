import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CP_REQUIRES, GATES, OPEN_COMMANDS, SELF_CHECKED, DEFERRED_TO_S3, cpDecision, gateDecision, gateFor, rankState, mayActOver } from "../lib/shim/cp-perms.ts";

const SRC = readFileSync(new URL("../lib/shim/server.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const between = (from, to) => { const a = SRC.indexOf(from); const b = SRC.indexOf(to, a + 1); assert.ok(a > 0 && b > a, `markers ${from} / ${to}`); return SRC.slice(a, b); };
const casesOf = (block) => [...block.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);
// "action" is only the container of the action sub-commands, which are read from action() itself
const topCommands = () => casesOf(between("private dispatch(cmd: string", "// ---------- auth ----------")).filter((c) => c !== "action");
const actionCommands = () => casesOf(between("private async action(d: Obj)", "// Reference behaviour: every like")).map((c) => `action:${c}`);

// ---- completeness: no command can exist without being classified ----
test("completeness: every command the shim handles is classified (open, self-checked, gated or deferred to S3)", () => {
  const top = topCommands(), act = actionCommands();
  assert.ok(top.length > 25 && act.length >= 8, `parsed ${top.length} commands and ${act.length} actions: the markers must still match the source`);
  const known = new Set([...OPEN_COMMANDS, ...SELF_CHECKED, ...DEFERRED_TO_S3, ...Object.keys(GATES)]);
  const missing = [...top, ...act].filter((c) => !known.has(c));
  assert.deepEqual(missing, [], "an unclassified command: add it to OPEN_COMMANDS, SELF_CHECKED, GATES or DEFERRED_TO_S3 in lib/shim/cp-perms.ts");
});
test("completeness: every control-panel command has a requirement, and every requirement belongs to a real command", () => {
  const cp = casesOf(between("private async cpRun(d: Obj", "// first edit of the rank table"));
  assert.ok(cp.length > 25);
  assert.deepEqual(cp.filter((c) => !(c in CP_REQUIRES)), []);
  assert.deepEqual(Object.keys(CP_REQUIRES).filter((c) => !cp.includes(c)), []);
});
test("completeness: the tables name only real commands and never classify one twice", () => {
  const all = new Set([...topCommands(), ...actionCommands()]);
  const listed = [...Object.keys(GATES), ...OPEN_COMMANDS, ...SELF_CHECKED, ...DEFERRED_TO_S3];
  for (const k of listed) assert.ok(all.has(k), `${k} is listed but the shim has no such command`);
  assert.equal(new Set(listed).size, listed.length, "a command is classified twice");
});
test("the gate runs before anything: handle() asks first and dispatch() only runs after an answer; cp() asks before cpRun()", () => {
  const h = between("  handle(cmd: string, data: unknown) {", "private dispatch(cmd: string");
  assert.match(h, /gateFor\(/);
  assert.match(h, /gateAllowed\(/);
  assert.match(h, /if \(!g\) return this\.dispatch\(/);
  assert.match(h, /if \(ok\) this\.dispatch\(/);
  assert.match(SRC, /if \(!\(await this\.cpAllowed\(cmd\)\) \|\| !\(await this\.cpTargetOk\(cmd, d\)\)\)[^\n]*return;[^\n]*\n\s+return this\.cpRun\(/);
});

// ---- control panel: reading needs the section's own flag, changing settings needs setpower ----
test("panel sections: each READ needs the section's own flag", () => {
  const read = { logins: "cplogins", fps: "cpfps", actions: "cpactions", bans: "cpbans", rooms: "cprooms", shrt: "cpshrt", msgs: "cpmsgs", wrooms: "cpwrooms", subs: "cpsubs", fltr: "filter", domains: "cpdomains", bots: "botsowner", sico: "cp" }; // bots: x3 L4885 (cpsite + rank > 8998)
  for (const [c, f] of Object.entries(read)) assert.equal(CP_REQUIRES[c], f, c);
});
test("panel settings: every CHANGE needs the flag of its own tab, like the original (x3 fn90)", () => {
  const own = { msgsit: "cpmsgs", msgsdel: "cpmsgs", shrtadd: "cpshrt", shrtdel: "cpshrt", fltrit: "filter", fltrdel: "filter", wroomsOwr: "cpwrooms", owrsave: "cpwrooms", owr: "cpwrooms", set_entry_room: "cprooms", setpower: "setpower" };
  for (const [c, f] of Object.entries(own)) assert.equal(CP_REQUIRES[c], f, c);
  assert.equal(CP_REQUIRES.likes, "setLikes");
  for (const c of ["powers_save", "powers_del"]) assert.equal(CP_REQUIRES[c], "editpower", c); // x3 L4873: the «الصلاحيات» tab is shown with editpower
  assert.equal(CP_REQUIRES.sitesave, "cpsite"); // x3 L4882
  assert.equal(CP_REQUIRES.owner, "cpsite");
  assert.equal(CP_REQUIRES.ban, "ban");
  assert.equal(CP_REQUIRES.unban, "unban");
  assert.equal(CP_REQUIRES.aban, "unban");
});
const F = (over = {}) => ({ uid: "u", bootstrap: "owner", power: { name: "r" }, row: {}, now: 1000, ...over });
test("opening the panel grants nothing: the general cp flag alone neither reads a section nor changes anything", () => {
  const row = { cp: true };
  for (const c of ["logins", "fps", "actions", "bans", "rooms", "shrt", "msgs", "wrooms", "subs", "fltr", "domains", "bots"]) assert.equal(cpDecision(CP_REQUIRES[c], F({ row })), false, c);
  for (const c of ["msgsit", "shrtadd", "fltrit", "wroomsOwr", "set_entry_room", "ban", "unban", "sitesave"]) assert.equal(cpDecision(CP_REQUIRES[c], F({ row })), false, c);
});
test("messages, shortcuts, filters and moderation are separate: one flag opens only its own commands", () => {
  const only = (flag) => Object.keys(CP_REQUIRES).filter((c) => cpDecision(CP_REQUIRES[c], F({ row: { [flag]: true } }))).sort();
  assert.deepEqual(only("cpmsgs"), ["msgs", "msgsdel", "msgsit"]);
  assert.deepEqual(only("cpshrt"), ["shrt", "shrtadd", "shrtdel"]);
  assert.deepEqual(only("filter"), ["fltr", "fltrdel", "fltrdelx", "fltrit"]);
  assert.deepEqual(only("cpwrooms"), ["owr", "owrsave", "wrooms", "wrooms+", "wrooms-", "wroomsOwr", "wroomsa"]); // + the list
  assert.deepEqual(only("cprooms"), ["rooms", "set_entry_room"]);
  assert.deepEqual(only("cpsite"), ["addico", "delico", "emo_order", "favicon", "owner", "pic", "prv1", "room", "sitesave"]); // the tab's icons and site pictures too
  assert.deepEqual(only("cpbans"), ["bans"]);
  assert.deepEqual(only("unban"), ["aban", "unban"]);
  assert.deepEqual(only("ban"), ["ban"]);
  assert.deepEqual(only("setpower"), ["setpower"]);
});

// ---- commands outside the panel ----
test("gateFor finds the gate of a command and of an action sub-command, and nothing for open commands", () => {
  assert.equal(gateFor("dmsg", {})?.key, "dmsg");
  assert.equal(gateFor("action", { cmd: "ban" })?.key, "action:ban");
  assert.equal(gateFor("action", { cmd: "like" }), undefined);
  assert.equal(gateFor("msg", {}), undefined);
  assert.equal(gateFor("action", {}), undefined);
  assert.equal(gateFor("action", null), undefined);
  assert.equal(gateFor("__proto__", {}), undefined);
  assert.equal(gateFor("action", { cmd: "constructor" }), undefined);
});
test("gateDecision: the flag, or one of the relations the rules already allow; nothing else", () => {
  const g = GATES.dmsg; // «مسح الرسائل» (dmsg) or author
  assert.equal(gateDecision(g, F({ row: {} }), {}), false);
  assert.equal(gateDecision(g, F({ row: { delbc: true } }), {}), false); // the wall flag does not delete room messages
  assert.equal(gateDecision(g, F({ row: { dmsg: true } }), {}), true);
  assert.equal(gateDecision(g, F({ row: {} }), { author: true }), true);
  assert.equal(gateDecision(g, F({ row: {} }), { author: false, self: true }), false); // a relation the gate does not list is ignored
  assert.equal(gateDecision(g, F({ uid: "" }), { author: true }), false);
  assert.equal(gateDecision(g, F({ power: null, row: null }), {}), false);
  assert.equal(gateDecision(g, F({ row: { dmsg: true }, power: { name: "r", until: 5 } }), {}), false); // expired
  assert.equal(gateDecision(GATES["action:ban"], F({ row: { ban: 1 } }), { below: true }), true); // ...against somebody below
  assert.equal(gateDecision(GATES["action:ban"], F({ row: {} }), { self: true }), false); // nobody bans through a relation
  assert.equal(gateDecision(GATES["r-"], F({ row: {} }), { emptyPublicRoom: true }), true);
  assert.equal(gateDecision(GATES["r^"], F({ row: {} }), { emptyPublicRoom: true }), false); // only deleting, not editing
  assert.equal(gateDecision(GATES["action:roomkick"], F({ row: {} }), { roomOp: true }), true);
  assert.equal(gateDecision(GATES["op+"], F({ row: {} }), { roomOp: true }), false); // a moderator cannot appoint moderators
  assert.equal(gateDecision(GATES.unick, F({ uid: "owner", row: null, power: null }), {}), true); // the owner passes
});
test("every gate asks for a flag, and the flags are the ones database.rules.json uses", () => {
  const RULE_FLAGS = new Set(["setpower", "ban", "kick", "roomowner", "delbc", "cp", "publicmsg", "upgrades", "alert", "stealth", "history", "rinvite", "setLikes", "dmsg", "bnr", "ppmsg", "unick"]); // history: nameLog (G3); rinvite: moves (card > «نقل»)
  for (const [k, g] of Object.entries(GATES)) { assert.ok(g.flag, k); assert.ok(RULE_FLAGS.has(g.flag), `${k}: ${g.flag}`); }
});

// ---- owner, setpower, ban and unban are independent of each other ----
const ALL_FLAGS = ["setpower", "ban", "unban", "kick", "delbc", "upgrades", "publicmsg", "roomowner", "cp", "cplogins", "cpfps", "cpactions", "cpbans", "cprooms", "cpshrt", "cpmsgs", "cpwrooms", "cpsubs", "filter", "cpdomains", "cpbots", "alert", "stealth", "history", "cpsite", "dmsg", "bnr", "ppmsg", "unick", "editpower", "setLikes"];
const ITEMS = [
  ...Object.entries(CP_REQUIRES).map(([c, need]) => ({ id: `cp:${c}`, flag: need, open: (facts) => cpDecision(need, facts) })),
  ...Object.entries(GATES).map(([k, g]) => ({ id: `gate:${k}`, flag: g.flag, open: (facts) => gateDecision(g, facts, { below: true }) })), // the flag on its own, against somebody below
];
const opensWith = (row) => ITEMS.filter((i) => i.open(F({ row }))).map((i) => i.id).sort();
test("one flag on its own opens only the commands that name that flag (no leakage between setpower, ban, unban and the rest)", () => {
  for (const flag of ALL_FLAGS) {
    const opened = opensWith({ [flag]: true });
    const expected = ITEMS.filter((i) => i.flag === flag).map((i) => i.id).sort();
    assert.deepEqual(opened, expected, flag);
  }
  const s = new Set(opensWith({ setpower: true })), b = new Set(opensWith({ ban: true })), u = new Set(opensWith({ unban: true }));
  for (const x of s) assert.ok(!b.has(x) && !u.has(x), x);
  for (const x of b) assert.ok(!s.has(x) && !u.has(x), x);
  assert.ok(s.size >= 1 && b.size >= 2 && u.size === 2);
});
test("«إداره الموقع» opens only with cpsite (x3 L4882): every other flag switched on does not open it", () => {
  const everything = Object.fromEntries(ALL_FLAGS.filter((f) => f !== "cpsite").map((f) => [f, true]));
  const opened = opensWith(everything);
  assert.ok(!opened.includes("cp:sitesave") && !opened.includes("cp:owner"));
  assert.ok(opensWith({ cpsite: true }).includes("cp:sitesave"));
  assert.ok(opened.includes("cp:ban") && opened.includes("cp:unban") && opened.includes("cp:msgsit")); // everything else is open to the full rank
});
test("the owner (and only the owner) opens every command, with or without any rank", () => {
  for (const i of ITEMS) {
    assert.equal(i.open(F({ uid: "owner", power: null, row: null })), true, i.id);
    assert.equal(i.open(F({ uid: "someone", bootstrap: "owner", power: null, row: null })), false, i.id);
    assert.equal(i.open(F({ uid: "owner", bootstrap: "", power: null, row: null })), false, i.id);
    assert.equal(i.open(F({ uid: "owner", bootstrap: null, power: null, row: null })), false, i.id);
    assert.equal(i.open(F({ uid: "owner", bootstrap: 5, power: null, row: null })), false, i.id);
  }
});

// ---- S3: the rank hierarchy in the shim's early refusal (the rules are the lock; tests/rules.test.mjs attacks them directly) ----
const ROW = { admin: { rank: 10000 }, hi: { rank: 600 }, sp: { rank: 300 }, mod: { rank: 250 }, bad: { rank: "x" }, big: { rank: 20000 }, neg: { rank: -1 }, nan: { rank: NaN } };
const rowFor = (n) => ROW[n];
const NOW = 5000;
test("rankState: none / a valid number / corrupt, and an expired rank is an ordinary member", () => {
  assert.equal(rankState(null, rowFor, NOW), "none");
  assert.equal(rankState(undefined, rowFor, NOW), "none");
  assert.equal(rankState({ name: "", level: 0 }, rowFor, NOW), "none"); // the empty rank the panel writes
  assert.equal(rankState({ name: "sp", level: 300, until: 100 }, rowFor, NOW), "none"); // expired
  assert.equal(rankState({ name: "sp", level: 300, until: 9000 }, rowFor, NOW), 300);
  assert.equal(rankState({ name: "admin", level: 10000 }, rowFor, NOW), 10000);
  for (const bad of [{ name: "unknown", level: 1 }, { name: "bad", level: 1 }, { name: "big", level: 1 }, { name: "neg", level: 1 }, { name: "nan", level: 1 }, { name: 5 }, {}, { name: "" , level: 3 }, "x", 7])
    assert.equal(rankState(bad, rowFor, NOW), "corrupt", JSON.stringify(bad)); // never zero
});
test("mayActOver: strictly below only; an ordinary member is a target; the owner and oneself never are; a corrupt rank refuses", () => {
  assert.equal(mayActOver(300, 250, false), true);
  assert.equal(mayActOver(300, 300, false), false); // equal
  assert.equal(mayActOver(300, 600, false), false);
  assert.equal(mayActOver(300, "none", false), true);
  assert.equal(mayActOver(300, "corrupt", false), false);
  assert.equal(mayActOver("corrupt", "none", false), false); // a corrupt actor
  assert.equal(mayActOver("none", "none", false), false); // an ordinary member acts on nobody
  assert.equal(mayActOver(10000, "none", true), false); // owner / self
});
test("gates that act on a person carry the hierarchy; the flag alone is not enough, a relation still is", () => {
  for (const k of ["unick", "action:kick", "action:ban", "action:roomkick", "action:delpic"]) assert.equal(GATES[k].over, true, k);
  const g = GATES["action:ban"];
  assert.equal(gateDecision(g, F({ row: { ban: true } }), {}), false);
  assert.equal(gateDecision(g, F({ row: { ban: true } }), { below: true }), true);
  assert.equal(gateDecision(g, F({ row: {} }), { below: true }), false); // below without the flag
  assert.equal(gateDecision(g, F({ uid: "owner", row: null, power: null }), {}), true); // the owner is exempt
  const k = GATES["action:kick"];
  assert.equal(gateDecision(k, F({ row: {} }), { self: true }), true); // leaving by oneself still works
  assert.equal(gateDecision(k, F({ row: { kick: 99 } }), {}), false);
  assert.equal(gateDecision(k, F({ row: { kick: 99 } }), { below: true }), true);
  assert.equal(gateDecision(GATES["action:roomkick"], F({ row: {} }), { roomOwner: true }), true); // the room's owner needs no rank
});
test("free-text alerts need the «إداره الموقع» notlikes likes, for everybody, and nothing is deferred any more", () => {
  // no permission gate: the notlikes likes are checked before anything (server.ts handle) and by the rules (alerts likesOk); the alert flag only forces
  assert.equal(GATES["action:not"], undefined);
  assert.deepEqual([...DEFERRED_TO_S3], []);
});
