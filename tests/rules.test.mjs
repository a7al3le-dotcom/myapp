// Security-rules tests. Run with: npm run test:rules   (starts the local emulator; never touches the cloud)
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { ref, set, get, remove, update, push, serverTimestamp } from "firebase/database";

// Rank rows shaped like the reference site's power table (only the flags the rules read).
// G3: admin also holds `history` («كشف النكات»); banner holds cp but NOT history.
const ROWS = {
  admin: { name: "admin", rank: 10000, setpower: true, ban: true, kick: 99999, roomowner: true, delbc: true, cp: true, publicmsg: 99999, upgrades: 99999, history: true },
  mod: { name: "mod", rank: 250, setpower: false, ban: false, kick: 99, roomowner: false, delbc: true, cp: false, publicmsg: 0, upgrades: 0 },
  banner: { name: "banner", rank: 400, setpower: false, ban: true, kick: 99, roomowner: true, delbc: true, cp: true, publicmsg: 0, upgrades: 0 },
};
const now = () => Date.now();
let env;
const as = (uid) => env.authenticatedContext(uid).database();
const anon = () => env.unauthenticatedContext().database();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-al3nood",
    database: { rules: readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"), host: "127.0.0.1", port: 9600 },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.database();
    await set(ref(d, "powerTable"), ROWS);
    await set(ref(d, "powers/admin1"), { level: 10000, name: "admin" });
    await set(ref(d, "powers/mod1"), { level: 250, name: "mod" });
    await set(ref(d, "powers/banner1"), { level: 400, name: "banner" });
    for (const u of ["alice", "bob", "carol", "admin1", "mod1", "banner1"]) await set(ref(d, `profiles/${u}`), { topic: u });
  });
});

const seedRoom = async (rid = "r1", owner = "alice", extra = {}) =>
  env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.database();
    await set(ref(d, `rooms/${rid}`), { topic: "room", owner, max: 10, ...extra });
    await set(ref(d, `members/${rid}/${owner}`), { joinedAt: 1 });
  });

test("signed-out users can read and write nothing", async () => {
  await assertFails(get(ref(anon(), "profiles/alice")));
  await assertFails(get(ref(anon(), "rooms")));
  await assertFails(set(ref(anon(), "profiles/x"), { topic: "x" }));
});

test("a user writes only their own profile", async () => {
  await assertSucceeds(set(ref(as("alice"), "profiles/alice"), { topic: "A", ucol: "#112233" }));
  await assertFails(set(ref(as("alice"), "profiles/bob"), { topic: "hacked" }));
  await assertFails(set(ref(as("alice"), "profiles/alice"), { topic: "A", ucol: "red" })); // bad colour
  await assertFails(set(ref(as("alice"), "profiles/alice"), { topic: "A", extra: 1 })); // unknown field
});

test("power levels: users cannot grant themselves power; admin can", async () => {
  await assertFails(set(ref(as("alice"), "powers/alice"), { level: 10000 }));
  await assertFails(set(ref(as("mod1"), "powers/alice"), { level: 100, name: "mod" })); // no setpower flag
  await assertSucceeds(set(ref(as("admin1"), "powers/alice"), { level: 250, name: "mod" })); // the level is the real rank of the named rank (S3)
  await assertFails(set(ref(as("admin1"), "powers/alice"), { level: 99999, name: "mod" }));
});

test("rooms: owner must be the creator, size within 2..40, only owner/manager edits", async () => {
  await assertSucceeds(set(ref(as("alice"), "rooms/r1"), { topic: "R", owner: "alice", max: 10 }));
  await assertFails(set(ref(as("alice"), "rooms/r2"), { topic: "R", owner: "bob", max: 10 }));
  await assertFails(set(ref(as("alice"), "rooms/r3"), { topic: "R", owner: "alice", max: 1 }));
  await assertFails(set(ref(as("alice"), "rooms/r4"), { topic: "R", owner: "alice", max: 41 }));
  await assertFails(update(ref(as("bob"), "rooms/r1"), { topic: "stolen" }));
  await assertSucceeds(update(ref(as("alice"), "rooms/r1"), { topic: "mine" }));
  await assertFails(remove(ref(as("bob"), "rooms/r1")));
  await assertSucceeds(remove(ref(as("alice"), "rooms/r1")));
});

test("rooms: a manager (power >= roomManage) can edit, a moderator cannot", async () => {
  await seedRoom();
  await assertFails(update(ref(as("mod1"), "rooms/r1"), { topic: "x" })); // 250 < 300
  await assertSucceeds(update(ref(as("banner1"), "rooms/r1"), { topic: "x" })); // 400 >= 300
});

test("room password: join needs the matching hash, joining without one fails", async () => {
  await seedRoom();
  await env.withSecurityRulesDisabled(async (c) => set(ref(c.database(), "roomSecrets/r1"), "HASH123"));
  await assertFails(set(ref(as("bob"), "members/r1/bob"), { joinedAt: now() }));
  await assertFails(set(ref(as("bob"), "members/r1/bob"), { joinedAt: now(), ph: "WRONG" }));
  await assertSucceeds(set(ref(as("bob"), "members/r1/bob"), { joinedAt: now(), ph: "HASH123" }));
  await assertFails(get(ref(as("bob"), "roomSecrets/r1"))); // non-owner cannot read the hash
  await assertSucceeds(get(ref(as("alice"), "roomSecrets/r1"))); // owner can
});

test("open room: anyone signed in can join as themselves, not as someone else", async () => {
  await seedRoom();
  await assertSucceeds(set(ref(as("bob"), "members/r1/bob"), { joinedAt: now() }));
  await assertFails(set(ref(as("bob"), "members/r1/carol"), { joinedAt: now() }));
  await assertFails(set(ref(as("bob"), "members/nope/bob"), { joinedAt: now() })); // room must exist
});

test("messages: only members read/write; cannot spoof the author", async () => {
  await seedRoom();
  const msg = (u) => ({ uid: u, msg: "hi", t: now() });
  await assertFails(get(ref(as("bob"), "messages/r1"))); // not a member
  await assertFails(set(ref(as("bob"), "messages/r1/m1"), msg("bob"))); // not a member
  await assertSucceeds(set(ref(as("alice"), "messages/r1/m1"), msg("alice")));
  await assertFails(set(ref(as("alice"), "messages/r1/m2"), msg("bob"))); // spoofed uid
  await assertSucceeds(get(ref(as("alice"), "messages/r1")));
  await assertFails(set(ref(as("alice"), "messages/r1/m3"), { uid: "alice", msg: "x".repeat(2001), t: now() })); // too long
  await assertFails(set(ref(as("alice"), "messages/r1/m4"), { uid: "alice", msg: "future", t: now() + 3600_000 })); // clock abuse
});

test("messages: authors delete their own; moderators with deleteMsg delete others; edits are impossible", async () => {
  await seedRoom();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.database();
    await set(ref(d, "members/r1/bob"), { joinedAt: 1 });
    await set(ref(d, "messages/r1/m1"), { uid: "alice", msg: "a", t: 1 });
    await set(ref(d, "messages/r1/m2"), { uid: "bob", msg: "b", t: 1 });
    await set(ref(d, "messages/r1/m3"), { uid: "alice", msg: "c", t: 1 });
  });
  await assertFails(update(ref(as("alice"), "messages/r1/m1"), { msg: "edited" })); // no edits
  await assertFails(remove(ref(as("bob"), "messages/r1/m1"))); // not his
  await assertSucceeds(remove(ref(as("alice"), "messages/r1/m1")));
  await assertSucceeds(remove(ref(as("mod1"), "messages/r1/m3"))); // 250 >= 200
});

test("bans: only holders of 'ban' can write; the banned user can read their own; banned users are blocked", async () => {
  await seedRoom();
  await assertFails(set(ref(as("mod1"), "bans/bob"), { by: "mod1", t: now() })); // 250 < 400
  await assertFails(set(ref(as("banner1"), "bans/bob"), { by: "alice", t: now() })); // forged 'by'
  await assertSucceeds(set(ref(as("banner1"), "bans/bob"), { by: "banner1", t: now(), reason: "spam" }));
  await assertSucceeds(get(ref(as("bob"), "bans/bob")));
  await assertFails(get(ref(as("carol"), "bans/bob")));
  await assertFails(set(ref(as("bob"), "members/r1/bob"), { joinedAt: now() })); // banned cannot join
  await assertFails(set(ref(as("bob"), "profiles/bob"), { topic: "still here" })); // nor edit profile
});

test("private messages: only the two participants", async () => {
  const pair = "alice_bob";
  await assertSucceeds(set(ref(as("alice"), `pm/${pair}/m1`), { uid: "alice", msg: "hey", t: now() }));
  await assertFails(set(ref(as("alice"), `pm/${pair}/m2`), { uid: "bob", msg: "forged", t: now() }));
  await assertFails(set(ref(as("carol"), `pm/${pair}/m3`), { uid: "carol", msg: "intrude", t: now() }));
  await assertFails(get(ref(as("carol"), `pm/${pair}`)));
  await assertSucceeds(get(ref(as("bob"), `pm/${pair}`)));
});

test("wall: authors post and delete their own; others cannot delete; moderators can", async () => {
  await assertSucceeds(set(ref(as("alice"), "wall/w1"), { uid: "alice", msg: "post", t: now() }));
  await assertFails(set(ref(as("bob"), "wall/w2"), { uid: "alice", msg: "forged", t: now() }));
  await assertFails(remove(ref(as("bob"), "wall/w1")));
  await assertSucceeds(remove(ref(as("mod1"), "wall/w1")));
});

test("reports: anyone can file; only reviewers read", async () => {
  await assertSucceeds(set(ref(as("alice"), "reports/p1"), { by: "alice", target: "bob", t: now(), reason: "abuse" }));
  await assertFails(set(ref(as("alice"), "reports/p2"), { by: "bob", target: "carol", t: now() }));
  await assertFails(get(ref(as("alice"), "reports")));
  await assertSucceeds(get(ref(as("banner1"), "reports"))); // 400 >= 300
});

test("ads: only holders of 'ad' may publish", async () => {
  await assertFails(set(ref(as("bob"), "ads/a1"), { msg: "x", by: "bob", t: now() }));
  await assertSucceeds(set(ref(as("admin1"), "ads/a1"), { msg: "hello all", by: "admin1", t: now() }));
});

test("wall: likes and replies are written by their own author only; posts cannot be rewritten", async () => {
  await env.withSecurityRulesDisabled(async (c) => set(ref(c.database(), "wall/w1"), { uid: "alice", msg: "post", t: 1 }));
  await assertSucceeds(set(ref(as("bob"), "wall/w1/likes/bob"), true));
  await assertFails(set(ref(as("bob"), "wall/w1/likes/carol"), true)); // someone else's like
  await assertSucceeds(set(ref(as("bob"), "wall/w1/replies/r1"), { uid: "bob", msg: "re", t: now() }));
  await assertFails(set(ref(as("bob"), "wall/w1/replies/r2"), { uid: "alice", msg: "forged", t: now() }));
  await assertFails(set(ref(as("bob"), "wall/w1/msg"), "rewritten")); // cannot edit someone's post
  await assertFails(set(ref(as("bob"), "wall/w1"), { uid: "alice", msg: "rewritten", t: 1 }));
  await assertSucceeds(remove(ref(as("bob"), "wall/w1/replies/r1"))); // own reply
  await assertSucceeds(set(ref(as("alice"), "wall/w1/replies/r3"), { uid: "alice", msg: "x", t: now() }));
  await assertFails(remove(ref(as("bob"), "wall/w1/replies/r3"))); // not his
  await assertSucceeds(remove(ref(as("mod1"), "wall/w1/replies/r3"))); // moderator
});

test("private-chat index: owner reads; either side writes the entry; strangers cannot", async () => {
  await assertSucceeds(set(ref(as("alice"), "pmIndex/alice/bob"), { t: now(), last: "hi", unread: 0 }));
  await assertSucceeds(set(ref(as("alice"), "pmIndex/bob/alice"), { t: now(), last: "hi", unread: 1 })); // peer's entry about me
  await assertFails(set(ref(as("carol"), "pmIndex/bob/alice"), { t: now(), unread: 1 })); // third party
  await assertSucceeds(get(ref(as("bob"), "pmIndex/bob")));
  await assertFails(get(ref(as("alice"), "pmIndex/bob"))); // cannot read someone else's list
});

test("alerts: anyone sends to a user as themselves; only the recipient reads and clears", async () => {
  await assertFails(set(ref(as("alice"), "alerts/bob/a1"), { from: "alice", msg: "hello", t: now() })); // free text needs the alert flag (S3)
  await env.withSecurityRulesDisabled(async (c) => set(ref(c.database(), "alerts/bob/a1"), { from: "alice", msg: "hello", t: now() }));
  await assertFails(set(ref(as("alice"), "alerts/bob/a2"), { from: "carol", msg: "forged", t: now() }));
  await assertFails(get(ref(as("alice"), "alerts/bob")));
  await assertSucceeds(get(ref(as("bob"), "alerts/bob")));
  await assertSucceeds(remove(ref(as("bob"), "alerts/bob/a1")));
});

test("kicks: only kickRoom holders (or the user himself, to clear) write the signal", async () => {
  await assertFails(set(ref(as("alice"), "kicks/bob"), { by: "alice", t: now() }));
  await assertSucceeds(set(ref(as("mod1"), "kicks/bob"), { by: "mod1", t: now() })); // 250 >= 200
  await assertSucceeds(get(ref(as("bob"), "kicks/bob")));
  await assertFails(get(ref(as("alice"), "kicks/bob")));
  await assertSucceeds(remove(ref(as("bob"), "kicks/bob")));
});

test("profiles: a setPower holder may edit another user's decoration; others cannot", async () => {
  await assertFails(set(ref(as("mod1"), "profiles/alice"), { topic: "renamed" }));
  await assertSucceeds(set(ref(as("admin1"), "profiles/alice"), { topic: "renamed" }));
});

test("members: any signed-in user can read the whole map (room counts), signed-out cannot", async () => {
  await seedRoom();
  await assertSucceeds(get(ref(as("bob"), "members")));
  await assertFails(get(ref(anon(), "members")));
});

test("public rooms: anyone may delete an EMPTY pub room; not a populated one; not a normal room", async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.database();
    await set(ref(d, "rooms/pub1"), { topic: "p1", owner: "alice", max: 40, pub: true });
    await set(ref(d, "rooms/pub2"), { topic: "p2", owner: "alice", max: 40, pub: true });
    await set(ref(d, "members/pub2/alice"), { joinedAt: 1 });
    await set(ref(d, "rooms/r9"), { topic: "normal", owner: "alice", max: 10 });
  });
  await assertSucceeds(remove(ref(as("bob"), "rooms/pub1")));
  await assertFails(remove(ref(as("bob"), "rooms/pub2")));
  await assertFails(remove(ref(as("bob"), "rooms/r9")));
});

test("images: anyone can read; only the uploader creates; wrong type/oversize refused; owner or moderator deletes", async () => {
  const img = (u, extra = {}) => ({ uid: u, ct: "image/jpeg", d: "AAAA", t: now(), ...extra });
  await assertSucceeds(set(ref(as("alice"), "images/i1"), img("alice")));
  await assertSucceeds(get(ref(anon(), "images/i1"))); // served publicly through /uploads
  await assertFails(set(ref(as("bob"), "images/i2"), img("alice"))); // forged owner
  await assertFails(set(ref(as("alice"), "images/i3"), img("alice", { ct: "text/html" })));
  await assertFails(set(ref(as("alice"), "images/i4"), img("alice", { d: "x".repeat(900001) })));
  await assertFails(set(ref(as("bob"), "images/i1"), img("bob"))); // cannot overwrite
  await assertFails(remove(ref(as("bob"), "images/i1")));
  await assertSucceeds(remove(ref(as("mod1"), "images/i1")));
  await assertSucceeds(set(ref(as("alice"), "images/i5"), img("alice", { ct: "image/png" })));
  await assertSucceeds(remove(ref(as("alice"), "images/i5")));
});

test("rep (profile likes): +1 per like, once a minute, not on yourself, atomic with lastLike; admin may set any value", async () => {
  const { increment, update: upd } = await import("firebase/database");
  const likeOnce = (who, target) => upd(ref(as(who), "/"), { [`rep/${target}`]: increment(1), [`lastLike/${who}`]: { ".sv": "timestamp" } });
  await assertSucceeds(likeOnce("alice", "bob"));
  await assertFails(likeOnce("alice", "carol")); // within the minute
  await assertFails(likeOnce("alice", "alice")); // self
  await assertFails(set(ref(as("carol"), "rep/bob"), 99)); // free write
  await assertFails(set(ref(as("carol"), "rep/bob"), 2)); // +1 but without the lastLike update
  await assertSucceeds(likeOnce("carol", "bob"));
  await assertSucceeds(set(ref(as("admin1"), "rep/bob"), 500));
  await assertFails(set(ref(as("alice"), "lastLike/bob"), { ".sv": "timestamp" })); // someone else's slot
});

test("join/leave notices: members may write a notice of kind join/leave as themselves; other kinds are refused", async () => {
  await seedRoom();
  await env.withSecurityRulesDisabled(async (c) => set(ref(c.database(), "members/r1/bob"), { joinedAt: 1 }));
  await assertSucceeds(set(ref(as("bob"), "messages/r1/n1"), { uid: "bob", msg: "", t: now(), cls: "join" }));
  await assertSucceeds(set(ref(as("bob"), "messages/r1/n2"), { uid: "bob", msg: "", t: now(), cls: "leave" }));
  await assertFails(set(ref(as("bob"), "messages/r1/n3"), { uid: "bob", msg: "", t: now(), cls: "admin" }));
  await assertFails(set(ref(as("bob"), "messages/r1/n4"), { uid: "alice", msg: "", t: now(), cls: "join" }));
});

test("gift icon and banner: only ranks with the upgrades flag may write them on someone else's profile", async () => {
  await assertFails(set(ref(as("mod1"), "profiles/bob/gift"), "dro3/x.gif"));
  await assertSucceeds(set(ref(as("admin1"), "profiles/bob/gift"), "dro3/x.gif"));
  await assertSucceeds(set(ref(as("admin1"), "profiles/bob/b"), "1604252172995.gif"));
  await assertFails(set(ref(as("alice"), "profiles/bob/b"), "x.gif"));
});

test("room moderators (ops): the owner names them and an op may remove members from that room", async () => {
  await seedRoom();
  await env.withSecurityRulesDisabled(async (c) => { const d = c.database(); await set(ref(d, "members/r1/bob"), { joinedAt: 1 }); await set(ref(d, "members/r1/carol"), { joinedAt: 1 }); });
  await assertFails(set(ref(as("bob"), "rooms/r1/ops/bob"), true)); // cannot promote himself
  await assertSucceeds(set(ref(as("alice"), "rooms/r1/ops/bob"), true)); // owner promotes
  await assertSucceeds(remove(ref(as("bob"), "members/r1/carol"))); // op removes a member
  await assertFails(remove(ref(as("carol"), "members/r1/alice"))); // an ordinary member cannot
});

// ---------- /config: site settings belong to the owner (config/bootstrap) alone; no write is inherited from /config or the root ----------
const seedOwner = () =>
  env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.database();
    await set(ref(d, "config/bootstrap"), "owner1");
    await set(ref(d, "config/site"), { name: "موقع", mlikes: true });
    await set(ref(d, "config/msgs/m1"), { type: "w", t: "t", m: "m" });
    await set(ref(d, "powers/owner1"), { level: 10000, name: "admin" });
  });
const SITE_OK = { name: "اسم & <b>", title: "t", description: "d", keywords: "k", script: "", html: "<p>x</p>", customHead: "<meta>", bg: "FFFFFF", buttons: "", background: "", callsLike: "0", maxIP: 2, maxshrt: "1", wall_likes: 0, msgst: 3, allowg: false, mlikes: true };

test("config/site: the owner may write valid settings, nobody else (visitor, member, mod, rank holder with setpower)", async () => {
  await seedOwner();
  await assertSucceeds(set(ref(as("owner1"), "config/site"), SITE_OK));
  await assertSucceeds(update(ref(as("owner1"), "config/site"), { name: "جديد" }));
  for (const who of ["alice", "mod1", "banner1", "admin1"]) { // admin1 holds setpower and rank 10000 but is NOT the owner
    await assertFails(set(ref(as(who), "config/site/name"), "x"));
    await assertFails(set(ref(as(who), "config/site"), SITE_OK));
    await assertFails(update(ref(as(who), "config/site"), { name: "x" }));
    await assertFails(remove(ref(as(who), "config/site")));
  }
  await assertFails(set(ref(anon(), "config/site/name"), "x"));
  assert.equal((await get(ref(as("alice"), "config/site/name"))).val(), "جديد"); // all of them left it untouched
});

test("config/site: the rule is not bypassed through a parent path or a multi-path update", async () => {
  await seedOwner();
  const root = (u) => ref(as(u));
  await assertFails(update(root("admin1"), { "config/site/name": "x" }));
  await assertFails(update(root("alice"), { "config/site/name": "x" }));
  await assertFails(update(root("admin1"), { "config/site": SITE_OK }));
  await assertFails(update(root("admin1"), { config: { site: SITE_OK } }));
  await assertFails(set(ref(as("admin1"), "config"), { site: SITE_OK, bootstrap: "admin1" }));
  await assertFails(update(ref(as("admin1"), "config"), { site: SITE_OK }));
  await assertFails(update(ref(as("admin1"), "config"), { "site/name": "x" }));
  await assertFails(remove(ref(as("admin1"), "config")));
  await assertFails(set(ref(as("admin1"), "config/site/nested/deeper"), "x"));
  await assertSucceeds(update(root("owner1"), { "config/site/name": "ok" })); // the owner still can, by the same routes
});

test("config/site: only known keys, right types and sizes", async () => {
  await seedOwner();
  const o = as("owner1");
  await assertFails(set(ref(o, "config/site/evil"), "x")); // unknown key
  await assertFails(set(ref(o, "config/site/domains"), { atest: { name: "x" } })); // domains are not part of the approved structure
  await assertFails(set(ref(o, "config/site/name"), { nested: "x" })); // nested object
  await assertFails(set(ref(o, "config/site/name"), 5)); // wrong type
  await assertFails(set(ref(o, "config/site/mlikes"), "yes"));
  await assertFails(set(ref(o, "config/site/wall_likes"), "5"));
  await assertFails(set(ref(o, "config/site/wall_likes"), -1));
  await assertFails(set(ref(o, "config/site/wall_likes"), 1e12));
  await assertFails(set(ref(o, "config/site/name"), "x".repeat(201)));
  await assertFails(set(ref(o, "config/site/customHead"), "x".repeat(20001)));
  await assertFails(set(ref(o, "config/site/callsLike"), { a: 1 }));
  await assertFails(set(ref(o, "config/site"), { ...SITE_OK, extra: 1 }));
  await assertSucceeds(set(ref(o, "config/site/customHead"), "x".repeat(20000)));
  await assertSucceeds(set(ref(o, "config/site/callsLike"), 3)); // the panel sends some numbers as text, some as numbers
  await assertSucceeds(set(ref(o, "config/site/callsLike"), "3"));
});

test("config/bootstrap: no client can write it (no replacing the owner, no self-promotion to owner); everyone signed in can still read it", async () => {
  await seedOwner();
  for (const who of ["alice", "mod1", "admin1", "owner1"]) {
    await assertFails(set(ref(as(who), "config/bootstrap"), who));
    await assertFails(remove(ref(as(who), "config/bootstrap")));
    await assertFails(update(ref(as(who), "config"), { bootstrap: who }));
    await assertFails(update(ref(as(who)), { "config/bootstrap": who }));
  }
  await assertFails(set(ref(as("alice"), "powers/alice"), { level: 10000, name: "admin" })); // and an ordinary user cannot make themselves an admin either
  assert.equal((await get(ref(as("alice"), "config/bootstrap"))).val(), "owner1");
});

test("config: the other settings keep their previous permission (setpower holders and the owner write; others do not)", async () => {
  await seedOwner();
  await assertSucceeds(set(ref(as("admin1"), "config/msgs/m2"), { type: "d", t: "t", m: "m" }));
  await assertSucceeds(set(ref(as("admin1"), "config/entryRoom"), "r1"));
  await assertSucceeds(set(ref(as("admin1"), "config/shrt/a"), { name: "a", value: "b" }));
  await assertSucceeds(set(ref(as("admin1"), "config/fltr/f1"), { path: "p", type: "t", v: "v" }));
  await assertSucceeds(set(ref(as("admin1"), "config/wroomsOwr"), { active: true }));
  await assertSucceeds(set(ref(as("admin1"), "config/perms/ban"), 400));
  await assertSucceeds(set(ref(as("owner1"), "config/msgs/m3"), { type: "w", t: "t", m: "m" }));
  for (const k of ["msgs/m4", "entryRoom", "shrt/b", "fltr/f2", "wroomsOwr", "perms/ban"]) {
    await assertFails(set(ref(as("alice"), `config/${k}`), "x"));
    await assertFails(set(ref(as("mod1"), `config/${k}`), "x"));
  }
  await assertFails(set(ref(as("admin1"), "config/somethingNew"), "x")); // an unlisted child cannot be written by anyone through the client
  assert.equal((await get(ref(as("alice"), "config/site/name"))).val(), "موقع"); // everyone signed in still reads the settings
});

// ---------- the rules and shapeSite() are generated from / driven by ONE table (lib/shim/site.ts): prove they never disagree ----------
import { SITE_SCHEMA, shapeValue, SITE_NUMBER_MAX } from "../lib/shim/site.ts";

const FAMILY = "👨‍👩‍👧‍👦";
const probesFor = (kind) => {
  const out = [];
  const add = (label, v) => out.push([label, v]);
  if (kind.t === "s" || kind.t === "sn") {
    const m = kind.max;
    add("empty", ""); add("ascii max", "a".repeat(m)); add("ascii max+1", "a".repeat(m + 1));
    add("arabic max", "ع".repeat(m)); add("arabic max+1", "ع".repeat(m + 1));
    add("emoji up to max", "😀".repeat(Math.floor(m / 2))); add("emoji over max", "😀".repeat(Math.floor(m / 2) + 1));
    add("emoji split by the limit", "a".repeat(m - 1) + "😀");
    add("family split by the limit", "a".repeat(m - 5) + FAMILY);
    add("accent split by the limit", "a".repeat(m - 1) + "é");
    add("flags over max", "🇸🇦".repeat(Math.floor(m / 4) + 2));
    add("markup and entities", `<img src=x onerror=1>&amp;"'`);
  }
  if (kind.t === "n" || kind.t === "sn") {
    const m = kind.t === "sn" ? kind.nmax : kind.max;
    for (const v of [0, 1, 1.5, m, m + 1, -1, 1e308]) add(`number ${v}`, v);
  }
  add("true", true); add("false", false); add("string 5", "5"); add("number 5", 5); add("object", { a: 1 }); add("array", [1]);
  return out;
};

test("rules and shapeSite agree on every setting: what shapeValue returns the rules accept; what the rules accept shapeValue leaves alone", async () => {
  await seedOwner();
  const o = as("owner1");
  const accepted = async (key, v) => { try { await set(ref(o, `config/site/${key}`), v); return true; } catch { return false; } };
  let probes = 0, accepts = 0, rejects = 0; const problems = [];
  for (const [key, kind] of Object.entries(SITE_SCHEMA)) {
    for (const [label, v] of probesFor(kind)) {
      probes++;
      const ok = await accepted(key, v);
      if (ok) accepts++; else rejects++;
      const shaped = shapeValue(kind, v);
      if (shaped !== undefined && !(await accepted(key, shaped))) problems.push(`${key} [${label}]: shapeValue gave a value the rules refuse`);
      if (ok && shaped !== v) problems.push(`${key} [${label}]: the rules accept it but shapeValue changes or drops it`);
      if (typeof shaped === "string") assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(shaped), `${key} [${label}]: lone surrogate`);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(probes > 400 && accepts > 100 && rejects > 100, `the check must really exercise both outcomes (probes=${probes} accepted=${accepts} refused=${rejects})`);
});

test("the generated rules list exactly the keys of SITE_SCHEMA, with the shared numeric bound", async () => {
  const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8")).rules.config.site;
  const ruleKeys = Object.keys(rules).filter((k) => !k.startsWith(".") && !k.startsWith("$"));
  assert.deepEqual([...ruleKeys].sort(), Object.keys(SITE_SCHEMA).sort());
  assert.equal(rules.$other[".validate"], false);
  for (const [key, kind] of Object.entries(SITE_SCHEMA)) {
    const v = rules[key][".validate"];
    if (kind.t === "n") assert.ok(v.includes(`<= ${kind.max}`) && kind.max === SITE_NUMBER_MAX, key);
    if (kind.t === "sn") assert.ok(v.includes(`length <= ${kind.max}`) && v.includes(`<= ${kind.nmax}`), key);
    if (kind.t === "s") assert.ok(v.includes(`length <= ${kind.max}`), key);
    if (kind.t === "b") assert.ok(v.includes("isBoolean"), key);
  }
});

// =====================================================================================================================================
// S4: /actionLog. Entries are append-only, written only for a moderation action the writer is really allowed to do, with a plausible clock.
// Cast (see withRanks): owner1 = site owner, admin1 10000 (all flags), hi1 600 (setpower, ban, kick), banner1 400 (ban, kick, cp), sp1/sp2 300 (setpower only),
// mod1 250 (kick only, no cp), low1 250 (mod), alice/bob/carol ordinary. Room r1: owner alice, op bob, members alice/bob/carol.
// =====================================================================================================================================
const LOG = (type, u1, u2, extra = {}) => ({ type, u1, u2, created: now(), ...extra });
const s4 = async () => {
  await withRanks({ low1: MOD, stx: { level: 250, name: "mod", until: 1000 } }); // stx: a kick rank, but expired
  await seedRoom("r1", "alice");
  await seed(async (d) => {
    await set(ref(d, "rooms/r1/ops/bob"), { t: 1 });
    await set(ref(d, "members/r1/bob"), { joinedAt: 1 });
    await set(ref(d, "members/r1/carol"), { joinedAt: 1 });
  });
  await seedRoom("r2", "bob");
};
const put = (uid, id, v) => set(ref(as(uid), `actionLog/${id}`), v);

test("S4 actionLog: a visitor cannot forge any moderation entry (the former KNOWN GAP)", async () => {
  await s4();
  for (const t of ["ban", "kick", "delpic", "roomkick"]) await assertFails(put("carol", `f-${t}`, LOG(t, "carol", "bob", { rid: "r1" })));
  await assertFails(put("anon-less", "x", LOG("ban", "anon-less", "bob"))); // not even with a made-up identity that holds no rank
  await assertSucceeds(put("alice", "owner-of-r1", LOG("roomkick", "alice", "bob", { rid: "r1" }))); // (alice owns room r1: that one is her right)
  await assertFails(set(ref(anon(), "actionLog/z"), LOG("ban", "x", "bob")));
  await assertSucceeds(put("alice", "mine-kick", LOG("kick", "alice", "alice"))); // a person may always leave (the same right as kicks/$uid)
  await assertSucceeds(put("alice", "mine-pic", LOG("delpic", "alice", "alice")));
  await assertFails(put("alice", "mine-ban", LOG("ban", "alice", "alice")));
});

test("S4 actionLog: kick, ban and delpic need the flag the real action needs, against somebody strictly below", async () => {
  await s4();
  await assertSucceeds(put("mod1", "k1", LOG("kick", "mod1", "carol")));
  await assertFails(put("mod1", "k2", LOG("ban", "mod1", "carol"))); // kick flag only
  await assertFails(put("mod1", "k3", LOG("delpic", "mod1", "carol"))); // no setpower
  for (const t of ["hi1", "low1", "owner1", "admin1"]) await assertFails(put("mod1", `k-${t}`, LOG("kick", "mod1", t))); // higher, equal, the owner
  await assertSucceeds(put("banner1", "b1", LOG("ban", "banner1", "carol")));
  await assertSucceeds(put("banner1", "b2", LOG("kick", "banner1", "carol")));
  for (const t of ["admin1", "hi1", "owner1"]) await assertFails(put("banner1", `b-${t}`, LOG("ban", "banner1", t)));
  await assertSucceeds(put("sp1", "d1", LOG("delpic", "sp1", "carol")));
  for (const t of ["sp2", "hi1", "admin1", "owner1"]) await assertFails(put("sp1", `d-${t}`, LOG("delpic", "sp1", t)));
  await assertFails(put("sp1", "d-kick", LOG("kick", "sp1", "carol"))); // setpower is not kick
  await assertSucceeds(put("owner1", "o1", LOG("ban", "owner1", "admin1"))); // the site owner has no rank limit...
  await assertSucceeds(put("owner1", "o2", LOG("kick", "owner1", "carol")));
  await assertSucceeds(put("owner1", "o3", LOG("delpic", "owner1", "hi1")));
  await assertFails(put("owner1", "o4", LOG("ban", "owner1", "owner1"))); // ...but not against oneself
  await assertSucceeds(put("admin1", "a1", LOG("ban", "admin1", "hi1")));
  await assertFails(put("admin1", "a2", LOG("ban", "admin1", "owner1")));
});

test("S4 actionLog: roomkick only by the owner or an op of that very room (rid), never by a kick holder, and only for a member", async () => {
  await s4();
  await assertSucceeds(put("alice", "r1", LOG("roomkick", "alice", "carol", { rid: "r1", room: "room" })));
  await assertSucceeds(put("bob", "r2", LOG("roomkick", "bob", "carol", { rid: "r1" }))); // an op
  await assertFails(put("bob", "r3", LOG("roomkick", "bob", "alice", { rid: "r1" }))); // an op cannot remove the room's owner
  await assertFails(put("carol", "r4", LOG("roomkick", "carol", "bob", { rid: "r1" }))); // an ordinary member
  await assertFails(put("alice", "r5", LOG("roomkick", "alice", "carol"))); // no rid
  await assertFails(put("alice", "r6", LOG("roomkick", "alice", "carol", { rid: "r2" }))); // somebody else's room
  await assertFails(put("alice", "r7", LOG("roomkick", "alice", "bob", { rid: "r2" })));
  await assertFails(put("alice", "r8", LOG("roomkick", "alice", "low1", { rid: "r1" }))); // not a member of it
  await assertFails(put("alice", "r9", LOG("roomkick", "alice", "carol", { rid: "nope" }))); // no such room
  for (const u of ["mod1", "banner1", "hi1", "admin1", "owner1"]) await assertFails(put(u, `rk-${u}`, LOG("roomkick", u, "carol", { rid: "r1" }))); // a rank is not a room right
  await assertFails(put("bob", "r10", LOG("roomkick", "bob", "alice", { rid: "r2" }))); // bob owns r2 but alice is not in it
});

test("S4 actionLog: shape: the four types only, u2 required, no forged actor, bounded strings, unknown fields refused", async () => {
  await s4();
  const ok = LOG("kick", "mod1", "carol");
  await assertSucceeds(put("mod1", "ok", ok));
  for (const [i, bad] of [{ ...ok, type: "login" }, { ...ok, type: "" }, { ...ok, type: 5 }, { ...ok, type: "KICK" }, { ...ok, u1: "banner1" }, { ...ok, u2: undefined }, { ...ok, u2: "c".repeat(61) }, { ...ok, room: "r".repeat(121) }, { ...ok, rid: "r".repeat(61) }, { ...ok, extra: 1 }, { ...ok, created: String(now()) }, { ...ok, created: undefined }, { ...ok, u2: 7 }].entries())
    await assertFails(put("mod1", `bad${i}`, JSON.parse(JSON.stringify(bad))));
  await assertFails(put("banner1", "forged-actor", { ...ok, u1: "mod1" })); // somebody else's name as the actor
  await assertFails(put("owner1", "no-u2", { type: "kick", u1: "owner1", created: now() })); // even the site owner names the person acted upon
  await assertFails(put("owner1", "no-u2b", { type: "ban", u1: "owner1", created: now() }));
});

test("S4 actionLog: created must be within 5 minutes of Firebase's own clock (past or future)", async () => {
  await s4();
  const at = (ms) => LOG("kick", "mod1", "carol", { created: ms });
  await assertSucceeds(put("mod1", "t0", at(now())));
  await assertSucceeds(put("mod1", "t1", at(now() - 4 * 60000)));
  await assertSucceeds(put("mod1", "t2", at(now() + 4 * 60000)));
  await assertFails(put("mod1", "t3", at(now() - 6 * 60000)));
  await assertFails(put("mod1", "t4", at(now() + 6 * 60000)));
  await assertFails(put("mod1", "t5", at(1)));
  await assertFails(put("mod1", "t6", at(now() + 10 * 365 * 86400000))); // pinned to the top of the panel for years
  await assertFails(put("mod1", "t7", at(-5)));
});

test("S4 actionLog: nothing is edited, deleted or rewritten, in one path or several; a banned or expired writer writes nothing", async () => {
  await s4();
  await seed(async (d) => { await set(ref(d, "actionLog/old1"), LOG("kick", "mod1", "carol")); await set(ref(d, "actionLog/old2"), { type: "ban", u1: "x", created: 5 }); }); // old2: the old shape
  for (const u of ["mod1", "banner1", "admin1", "owner1", "alice"]) {
    await assertFails(put(u, "old1", LOG("kick", u, "carol"))); // overwrite
    await assertFails(remove(ref(as(u), "actionLog/old1"))); // delete
    await assertFails(update(ref(as(u), "actionLog/old1"), { type: "ban" })); // edit
    await assertFails(set(ref(as(u), "actionLog/old1/u2"), "bob"));
    await assertFails(remove(ref(as(u), "actionLog/old2")));
  }
  await assertFails(remove(ref(as("owner1"), "actionLog"))); // the whole node
  await assertFails(set(ref(as("owner1"), "actionLog"), { a: LOG("kick", "owner1", "carol") }));
  await assertSucceeds(update(ref(as("owner1"), "actionLog"), { b: LOG("kick", "owner1", "carol") })); // adding one lawful entry through the parent is just an append
  const m = as("mod1");
  await assertFails(update(ref(m), { "actionLog/m1": LOG("kick", "mod1", "carol"), "actionLog/m2": LOG("ban", "mod1", "carol") })); // one bad entry sinks the update
  await assertFails(update(ref(m), { "actionLog/m3": LOG("kick", "mod1", "carol"), "actionLog/old1": LOG("kick", "mod1", "carol") })); // ...and so does an overwrite
  await assertSucceeds(update(ref(m), { "actionLog/m4": LOG("kick", "mod1", "carol"), "actionLog/m5": LOG("kick", "mod1", "bob") }));
  await seed(async (d) => { await set(ref(d, "bans/mod1"), { by: "owner1", t: now() }); });
  await assertFails(put("mod1", "banned", LOG("kick", "mod1", "carol")));
  await assertFails(put("stx", "expired", LOG("kick", "stx", "carol"))); // a rank that has run out writes nothing
});

test("S4 actionLog: reading stays with the cp flag; old entries (any shape) stay readable", async () => {
  await s4();
  await seed(async (d) => { await set(ref(d, "actionLog/old"), { type: "ban", u1: "x", created: 5 }); await set(ref(d, "actionLog/old2"), LOG("kick", "mod1", "carol")); });
  await assertSucceeds(get(ref(as("banner1"), "actionLog")));
  await assertSucceeds(get(ref(as("admin1"), "actionLog/old")));
  await assertFails(get(ref(as("mod1"), "actionLog"))); // kick flag, no cp
  await assertFails(get(ref(as("alice"), "actionLog")));
  await assertFails(get(ref(anon(), "actionLog")));
});

// =====================================================================================================================================
// S3: rank hierarchy, stealth, alerts. Every "attack" is a direct write with the rules only (what a modified client could send).
// =====================================================================================================================================
const RANKS = {
  sp: { name: "sp", rank: 300, setpower: true, ban: false, kick: 0, cp: false },
  sp2: { name: "sp2", rank: 300, setpower: true, ban: false, kick: 0, cp: false },
  hi: { name: "hi", rank: 600, setpower: true, ban: true, kick: 99, cp: true, roomowner: true },
  st: { name: "st", rank: 200, setpower: false, ban: false, kick: 0, stealth: true, alert: true, upgrades: 99 },
  badrank: { name: "badrank", rank: "x", setpower: true, ban: true, kick: 99 },
  huge: { name: "huge", rank: 20000, setpower: true, ban: true, kick: 99 },
};
const seed = (fn) => env.withSecurityRulesDisabled(async (c) => fn(c.database()));
const withRanks = async (powers = {}, extra = {}) => seed(async (d) => {
  await update(ref(d, "powerTable"), { ...RANKS, admin: { ...ROWS.admin, stealth: true } });
  await set(ref(d, "config/bootstrap"), "owner1");
  await set(ref(d, "powers/owner1"), { level: 10000, name: "admin" });
  await set(ref(d, "powers/sp1"), { level: 300, name: "sp" });
  await set(ref(d, "powers/sp2"), { level: 300, name: "sp2" });
  await set(ref(d, "powers/hi1"), { level: 600, name: "hi" });
  await set(ref(d, "powers/st1"), { level: 200, name: "st" });
  for (const [k, v] of Object.entries(powers)) await set(ref(d, `powers/${k}`), v);
  for (const [k, v] of Object.entries(extra)) await set(ref(d, k), v);
  for (const u of ["owner1", "sp1", "sp2", "hi1", "st1"]) await set(ref(d, `profiles/${u}`), { topic: u });
});
const MOD = { level: 250, name: "mod" };

test("S3 powers: a setpower holder cannot promote themselves, and cannot touch their own record at all", async () => {
  await withRanks();
  await assertFails(set(ref(as("sp1"), "powers/sp1"), { level: 10000, name: "admin" }));
  await assertFails(set(ref(as("sp1"), "powers/sp1"), { level: 600, name: "hi" }));
  await assertFails(set(ref(as("sp1"), "powers/sp1"), MOD)); // not even a demotion of oneself
  await assertFails(remove(ref(as("sp1"), "powers/sp1")));
});
test("S3 powers: only ranks STRICTLY below the writer's can be given, and only to people strictly below them", async () => {
  await withRanks();
  await assertSucceeds(set(ref(as("sp1"), "powers/carol"), MOD)); // 250 < 300
  await assertFails(set(ref(as("sp1"), "powers/carol"), { level: 300, name: "sp" })); // equal
  await assertFails(set(ref(as("sp1"), "powers/carol"), { level: 400, name: "banner" })); // above
  await assertFails(set(ref(as("sp1"), "powers/carol"), { level: 10000, name: "admin" }));
  await assertFails(set(ref(as("sp1"), "powers/sp2"), MOD)); // an equal rank is not a target
  await assertFails(set(ref(as("sp1"), "powers/hi1"), MOD)); // a higher rank is not a target
  await assertFails(set(ref(as("sp1"), "powers/admin1"), MOD));
  await assertFails(set(ref(as("sp1"), "powers/owner1"), MOD)); // the owner is nobody's target
  await assertFails(set(ref(as("admin1"), "powers/owner1"), MOD));
  await assertFails(set(ref(as("admin1"), "powers/hi1b"), { level: 10000, name: "admin" })); // not even an admin makes an admin
  await assertSucceeds(set(ref(as("admin1"), "powers/hi1b"), { level: 600, name: "hi" }));
  await assertFails(set(ref(as("mod1"), "powers/carol"), MOD)); // no setpower flag
});
test("S3 powers: a rank can be taken away (empty rank or deletion) only from someone below", async () => {
  await withRanks({ low1: MOD });
  await assertSucceeds(set(ref(as("sp1"), "powers/low1"), { level: 0, name: "" })); // what the control panel writes
  await withRanks({ low2: MOD });
  await assertSucceeds(remove(ref(as("sp1"), "powers/low2")));
  await assertFails(remove(ref(as("sp1"), "powers/sp2")));
  await assertFails(remove(ref(as("sp1"), "powers/hi1")));
  await assertFails(set(ref(as("sp1"), "powers/low1"), { level: 5, name: "" })); // "no rank" must carry level 0
});
test("S3 powers: level must equal the real rank of the named rank, and the name must exist in powerTable", async () => {
  await withRanks();
  await assertFails(set(ref(as("sp1"), "powers/carol"), { level: 10000, name: "mod" })); // a misleading level
  await assertFails(set(ref(as("sp1"), "powers/carol"), { level: 1, name: "mod" }));
  await assertFails(set(ref(as("sp1"), "powers/carol"), { level: 100, name: "nonexistent" }));
  await assertFails(set(ref(as("sp1"), "powers/carol"), { level: 250, name: "mod/rank" }));
  await assertFails(set(ref(as("sp1"), "powers/carol"), { level: 250 })); // a name is required
  await assertFails(set(ref(as("sp1"), "powers/carol"), { level: 250, name: "mod", extra: 1 }));
  await assertFails(set(ref(as("owner1"), "powers/carol"), { level: 9999, name: "mod" })); // the validation applies to the owner as well
  await assertSucceeds(set(ref(as("owner1"), "powers/carol"), { level: 250, name: "mod" }));
});
test("S3 powers: the owner is exempt from the hierarchy (and only the owner)", async () => {
  await withRanks();
  await assertSucceeds(set(ref(as("owner1"), "powers/hi1"), { level: 10000, name: "admin" }));
  await assertSucceeds(set(ref(as("owner1"), "powers/carol"), { level: 10000, name: "admin" }));
  await assertSucceeds(set(ref(as("owner1"), "powers/owner1"), { level: 10000, name: "admin" })); // the first admin creates their own node
});
test("S3 powers: multi-path updates and partial writes cannot get around the checks", async () => {
  await withRanks();
  const db = as("sp1");
  // one bad path makes the whole request fail, and nothing is written
  await assertFails(update(ref(db), { "powers/carol": MOD, "powers/sp1": { level: 10000, name: "admin" } }));
  await assertFails(update(ref(db), { "powers/carol": MOD, "powers/hi1": MOD }));
  await assertFails(update(ref(db), { "powers/carol": MOD, "powerTable/mod/rank": 1 }));
  await assertFails(update(ref(db), { "powers/carol": MOD, "powerTable/sp/rank": 100000 }));
  await assertFails(update(ref(db, "powers"), { carol: MOD, sp1: { level: 10000, name: "admin" } }));
  await seed(async (d) => assert.equal((await get(ref(d, "powers/carol"))).exists(), false));
  // every path legitimate: it goes through, for several people at once
  await assertSucceeds(update(ref(db), { "powers/carol": MOD, "powers/bob": MOD }));
  await assertSucceeds(update(ref(db, "powers"), { alice: MOD }));
  // the pieces of a record alone
  await assertFails(set(ref(db, "powers/carol/name"), "admin"));
  await assertFails(set(ref(db, "powers/carol/name"), "sp")); // equal to the writer
  await assertFails(set(ref(db, "powers/carol/level"), 10000));
  await assertFails(set(ref(db, "powers/carol/level"), 9999)); // does not match the name
  await assertFails(update(ref(db, "powers/carol"), { name: "admin", level: 10000 }));
  await assertFails(update(ref(db, "powers/sp1"), { name: "admin", level: 10000 }));
  await assertFails(update(ref(db, "powers/sp1"), { level: 10000 }));
  // the whole powers object is nobody's to replace, not even the owner's
  for (const u of ["sp1", "admin1", "owner1"]) await assertFails(set(ref(as(u), "powers"), { carol: MOD }));
  for (const u of ["sp1", "admin1", "owner1"]) await assertFails(remove(ref(as(u), "powers")));
});
test("S3 powers: a corrupt rank is never read as zero, whoever carries it", async () => {
  await withRanks({ cor1: { level: 5, name: "badrank" }, cor2: { level: 5, name: "unknown-rank" }, cor3: { level: 5, name: "huge" } });
  // a target with a corrupt rank
  for (const t of ["cor1", "cor2", "cor3"]) {
    await assertFails(set(ref(as("sp1"), `powers/${t}`), MOD));
    await assertFails(remove(ref(as("sp1"), `powers/${t}`)));
    await assertFails(set(ref(as("hi1"), `bans/${t}`), { by: "hi1", t: now() }));
    await assertFails(set(ref(as("hi1"), `kicks/${t}`), { by: "hi1", t: now() }));
    await assertFails(set(ref(as("hi1"), `profiles/${t}`), { topic: "x" }));
  }
  // an actor with a corrupt rank (the rank row exists with the flags, but the rank is not a number / out of range)
  await seed(async (d) => { await set(ref(d, "powers/cor4"), { level: 5, name: "badrank" }); await set(ref(d, "powers/cor5"), { level: 5, name: "huge" }); });
  for (const a of ["cor4", "cor5"]) {
    await assertFails(set(ref(as(a), "powers/carol"), MOD));
    await assertFails(set(ref(as(a), "bans/carol"), { by: a, t: now() }));
    await assertFails(set(ref(as(a), "kicks/carol"), { by: a, t: now() }));
  }
  // a person with no record at all is an ordinary member and a fine target
  await assertSucceeds(set(ref(as("hi1"), "bans/nobody"), { by: "hi1", t: now() }));
  // an expired rank is an ordinary member (as a target) and grants nothing (as an actor)
  await seed(async (d) => { await set(ref(d, "powers/old3"), { level: 10000, name: "admin", until: 1000 }); await set(ref(d, "powers/old1"), { level: 250, name: "mod", until: 1000 }); await set(ref(d, "powers/old2"), { level: 300, name: "sp", until: 1000 }); });
  await assertSucceeds(set(ref(as("hi1"), "bans/old3"), { by: "hi1", t: now() })); // an expired administrator is an ordinary member
  await assertFails(set(ref(as("old2"), "powers/carol"), MOD));
  await assertFails(set(ref(as("old1"), "kicks/carol"), { by: "old1", t: now() }));
});
test("S3 powerTable: no client reads or writes it, not even the administrator or the owner", async () => {
  await withRanks();
  for (const u of ["alice", "mod1", "sp1", "admin1", "owner1"]) {
    await assertFails(get(ref(as(u), "powerTable")));
    await assertFails(get(ref(as(u), "powerTable/mod")));
    await assertFails(set(ref(as(u), "powerTable/mod/rank"), 1));
    await assertFails(set(ref(as(u), "powerTable/newrank"), { name: "newrank", rank: 1 }));
    await assertFails(set(ref(as(u), "powerTable"), {}));
    await assertFails(remove(ref(as(u), "powerTable")));
    await assertFails(update(ref(as(u)), { "powerTable/mod/rank": 1 }));
  }
  await assertFails(get(ref(anon(), "powerTable")));
});
test("S3 bans: only people strictly below the banner, never the owner, never oneself", async () => {
  await withRanks();
  await assertSucceeds(set(ref(as("banner1"), "bans/alice"), { by: "banner1", t: now() })); // an ordinary member
  await assertSucceeds(set(ref(as("banner1"), "bans/mod1"), { by: "banner1", t: now() })); // 250 < 400
  await assertFails(set(ref(as("banner1"), "bans/admin1"), { by: "banner1", t: now() }));
  await assertFails(set(ref(as("banner1"), "bans/hi1"), { by: "banner1", t: now() }));
  await assertFails(set(ref(as("banner1"), "bans/owner1"), { by: "banner1", t: now() }));
  await assertFails(set(ref(as("banner1"), "bans/banner1"), { by: "banner1", t: now() }));
  await seed(async (d) => set(ref(d, "powers/peer1"), { level: 400, name: "banner" }));
  await assertFails(set(ref(as("banner1"), "bans/peer1"), { by: "banner1", t: now() })); // equal rank
  await assertFails(set(ref(as("hi1"), "bans/owner1"), { by: "hi1", t: now() }));
  await assertFails(set(ref(as("admin1"), "bans/owner1"), { by: "admin1", t: now() }));
  await assertSucceeds(set(ref(as("admin1"), "bans/hi1"), { by: "admin1", t: now() }));
  await assertSucceeds(set(ref(as("owner1"), "bans/admin1"), { by: "owner1", t: now() })); // the owner is exempt
  await assertFails(set(ref(as("owner1"), "bans/owner1"), { by: "owner1", t: now() }));
  await assertFails(set(ref(as("alice"), "bans/bob"), { by: "alice", t: now() }));
  await assertFails(update(ref(as("banner1")), { "bans/carol": { by: "banner1", t: now() }, "bans/admin1": { by: "banner1", t: now() } })); // multi-path
  // lifting a ban follows the same rule
  await seed(async (d) => { await set(ref(d, "bans/hi1"), { by: "x", t: 1 }); await set(ref(d, "bans/mod1"), { by: "x", t: 1 }); });
  await assertFails(remove(ref(as("banner1"), "bans/hi1")));
  await assertSucceeds(remove(ref(as("banner1"), "bans/mod1")));
});
test("S3 kicks: only people strictly below, the person himself, or the owner", async () => {
  await withRanks();
  await assertSucceeds(set(ref(as("mod1"), "kicks/alice"), { by: "mod1", t: now() }));
  await assertFails(set(ref(as("mod1"), "kicks/banner1"), { by: "mod1", t: now() })); // 400 > 250
  await assertFails(set(ref(as("mod1"), "kicks/admin1"), { by: "mod1", t: now() }));
  await assertFails(set(ref(as("mod1"), "kicks/owner1"), { by: "mod1", t: now() }));
  await assertFails(set(ref(as("admin1"), "kicks/owner1"), { by: "admin1", t: now() }));
  await assertSucceeds(set(ref(as("admin1"), "kicks/banner1"), { by: "admin1", t: now() }));
  await assertSucceeds(set(ref(as("owner1"), "kicks/admin1"), { by: "owner1", t: now() }));
  await assertSucceeds(set(ref(as("bob"), "kicks/bob"), { by: "bob", t: now() })); // the person himself
  await assertFails(set(ref(as("alice"), "kicks/bob"), { by: "alice", t: now() }));
});
test("S3 room members: nobody puts somebody else IN a room; taking out follows the hierarchy and the room's own authority", async () => {
  await withRanks();
  await seedRoom("r1", "alice");
  await seed(async (d) => { for (const u of ["bob", "banner1", "admin1", "carol"]) await set(ref(d, `members/r1/${u}`), { joinedAt: 1 }); await set(ref(d, "rooms/r1/ops/carol"), true); });
  // adding another person (bypassing a room password) is refused to everybody with a flag, including the owner of the room and the site owner
  for (const u of ["mod1", "admin1", "alice", "carol", "owner1"]) await assertFails(set(ref(as(u), "members/r1/zed"), { joinedAt: now() }));
  // kickRoom holder: strictly below only
  await assertFails(remove(ref(as("mod1"), "members/r1/banner1")));
  await assertFails(remove(ref(as("mod1"), "members/r1/admin1")));
  await assertSucceeds(remove(ref(as("mod1"), "members/r1/bob")));
  // the room's owner and its moderators are authority inside the room; a moderator cannot remove the room's owner
  await assertSucceeds(remove(ref(as("alice"), "members/r1/banner1")));
  await assertFails(remove(ref(as("carol"), "members/r1/alice")));
  await assertSucceeds(remove(ref(as("carol"), "members/r1/admin1")));
  // joining and leaving oneself still work
  await assertSucceeds(set(ref(as("bob"), "members/r1/bob"), { joinedAt: now() }));
  await assertSucceeds(remove(ref(as("bob"), "members/r1/bob")));
});
test("S3 profiles: somebody else's profile only from strictly above (or the owner)", async () => {
  await withRanks({ low1: MOD });
  await seed(async (d) => { await set(ref(d, "profiles/low1"), { topic: "low1" }); await set(ref(d, "profiles/admin1"), { topic: "admin1" }); await set(ref(d, "profiles/carol"), { topic: "carol" }); });
  await assertSucceeds(update(ref(as("sp1"), "profiles/carol"), { pic: "" })); // an ordinary member
  await assertSucceeds(update(ref(as("sp1"), "profiles/low1"), { pic: "" })); // 250 < 300
  await assertFails(update(ref(as("sp1"), "profiles/hi1"), { pic: "" }));
  await assertFails(update(ref(as("sp1"), "profiles/sp2"), { pic: "" })); // equal
  await assertFails(update(ref(as("sp1"), "profiles/admin1"), { pic: "" }));
  await assertFails(update(ref(as("sp1"), "profiles/owner1"), { pic: "" }));
  await assertFails(update(ref(as("admin1"), "profiles/owner1"), { pic: "" }));
  await assertSucceeds(update(ref(as("alice"), "profiles/alice"), { pic: "uploads/db-mine.jpg" })); // one's own, always
  await assertSucceeds(update(ref(as("owner1"), "profiles/admin1"), { pic: "uploads/db-p.jpg" }));
  await assertFails(update(ref(as("mod1"), "profiles/carol"), { pic: "" })); // no setpower flag
});
test("S3 stealth: hidden presence needs the stealth flag", async () => {
  await withRanks();
  await assertFails(set(ref(as("alice"), "presence/alice"), { online: true, lastSeen: now(), stealth: true }));
  await assertSucceeds(set(ref(as("alice"), "presence/alice"), { online: true, lastSeen: now(), stealth: false }));
  await assertSucceeds(set(ref(as("alice"), "presence/alice"), { online: true, lastSeen: now() }));
  await assertFails(set(ref(as("mod1"), "presence/mod1"), { online: true, lastSeen: now(), stealth: true }));
  await assertSucceeds(set(ref(as("st1"), "presence/st1"), { online: true, lastSeen: now(), stealth: true }));
  await assertSucceeds(set(ref(as("admin1"), "presence/admin1"), { online: true, lastSeen: now(), stealth: true }));
  await assertFails(set(ref(as("sp1"), "presence/sp1"), { online: true, lastSeen: now(), stealth: true })); // setpower is not stealth
  await assertFails(update(ref(as("alice"), "presence/alice"), { stealth: true }));
  await assertFails(set(ref(as("st1"), "presence/alice"), { online: true, lastSeen: now(), stealth: true })); // not for somebody else
});
test("S3 alerts: free text needs the alert flag, and the system kinds need what produces them", async () => {
  await withRanks();
  const a = (db, to, v) => set(push(ref(db, `alerts/${to}`)), { t: now(), ...v });
  // free text
  await assertFails(a(as("alice"), "bob", { from: "alice", msg: "your account is hacked" }));
  await assertFails(a(as("sp1"), "bob", { from: "sp1", msg: "hi" }));
  await assertSucceeds(a(as("st1"), "bob", { from: "st1", msg: "official notice" }));
  await assertFails(a(as("st1"), "bob", { from: "alice", msg: "forged sender" }));
  await assertSucceeds(a(as("owner1"), "bob", { from: "owner1", msg: "from the owner" }));
  // like: a like sent in the last minute, no text
  await assertFails(a(as("alice"), "bob", { from: "alice", msg: "", kind: "like" }));
  await seed(async (d) => set(ref(d, "lastLike/alice"), now()));
  await assertSucceeds(a(as("alice"), "bob", { from: "alice", msg: "", kind: "like" }));
  await assertFails(a(as("alice"), "bob", { from: "alice", msg: "text smuggled in a like", kind: "like" }));
  await seed(async (d) => set(ref(d, "lastLike/carol"), now() - 120000));
  await assertFails(a(as("carol"), "bob", { from: "carol", msg: "", kind: "like" })); // an old like
  // gift: the upgrade flag
  await assertFails(a(as("alice"), "bob", { from: "alice", msg: "", kind: "gift", gift: "x.png" }));
  await assertSucceeds(a(as("st1"), "bob", { from: "st1", msg: "", kind: "gift", gift: "x.png" }));
  await assertFails(a(as("st1"), "bob", { from: "st1", msg: "text", kind: "gift", gift: "x.png" }));
  // moderator notice: only for a room the sender owns (or manages)
  await seedRoom("r1", "alice");
  await assertSucceeds(a(as("alice"), "bob", { from: "alice", msg: "r1", kind: "op" }));
  await assertFails(a(as("bob"), "carol", { from: "bob", msg: "r1", kind: "op" })); // bob does not own r1
  await assertFails(a(as("alice"), "bob", { from: "alice", msg: "no-such-room", kind: "op" }));
  await assertSucceeds(a(as("hi1"), "bob", { from: "hi1", msg: "r1", kind: "op" })); // roomManage
  // unknown kind
  await assertFails(a(as("st1"), "bob", { from: "st1", msg: "", kind: "other" }));
  // the recipient can still clear their own inbox
  await assertSucceeds(get(ref(as("bob"), "alerts/bob")));
});

// =====================================================================================================================================
// G9: which fields of profiles/$uid each writer may change. Attacks the rules directly (no app). "st1" holds the upgrades flag only (rank 200), "sp1" holds setpower only (300).
// =====================================================================================================================================
const PIC = "uploads/db-abc_123-x.jpg";
const asGuest = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).database();
const g9 = async () => {
  await withRanks({ low1: MOD, stx: { level: 200, name: "st", until: 1000 } }); // stx: the upgrades rank, but expired
  await seed(async (d) => {
    for (const u of ["low1", "stx"]) await set(ref(d, `profiles/${u}`), { topic: u, registered: true, createdAt: 5 });
    await set(ref(d, "profiles/alice"), { topic: "alice", registered: true, createdAt: 5, msg: "hi", pic: PIC, b: "old.gif", gift: "dro3/old.gif" });
    await set(ref(d, "profiles/bob"), { topic: "bob", registered: true, createdAt: 5 });
  });
};

test("G9 own profile: banner and gift cannot be written by their owner without the upgrades flag (set, update, child path, multi-path)", async () => {
  await g9();
  const a = as("alice");
  await assertFails(update(ref(a, "profiles/alice"), { b: "mine.gif" }));
  await assertFails(update(ref(a, "profiles/alice"), { gift: "dro3/mine.gif" }));
  await assertFails(set(ref(a, "profiles/alice/b"), "mine.gif"));
  await assertFails(set(ref(a, "profiles/alice/gift"), "dro3/mine.gif"));
  await assertFails(set(ref(a, "profiles/alice"), { topic: "alice", registered: true, createdAt: 5, msg: "hi", pic: PIC, b: "mine.gif", gift: "dro3/old.gif" })); // whole object
  await assertFails(set(ref(a, "profiles/alice"), { topic: "alice", registered: true, createdAt: 5, msg: "hi", pic: PIC })); // whole object that drops the banner and the gift
  await assertFails(update(ref(a, "profiles/alice"), { topic: "fine", b: "mine.gif" })); // a lawful field next to a forbidden one
  await assertFails(update(ref(a), { "profiles/alice/topic": "fine", "profiles/alice/b": "mine.gif" })); // multi-path
  await assertFails(remove(ref(a, "profiles/alice/b")));
  await assertFails(remove(ref(a, "profiles/alice/gift")));
  const p = (await get(ref(env.authenticatedContext("owner1").database(), "profiles/alice"))).val();
  assert.equal(p.b, "old.gif"); assert.equal(p.gift, "dro3/old.gif"); assert.equal(p.topic, "alice");
});

test("G9 own profile: the plain fields keep working (whole, partial, multi-path), and a profile is never deleted by its owner", async () => {
  await g9();
  const a = as("alice");
  await assertSucceeds(update(ref(a, "profiles/alice"), { topic: "Alice", msg: "new status", ucol: "#112233", mcol: "#445566", bg: "#778899" }));
  await assertSucceeds(update(ref(a, "profiles/alice"), { bg: "" }));
  await assertSucceeds(update(ref(a, "profiles/alice"), { busy: true }));
  await assertSucceeds(update(ref(a, "profiles/alice"), { pic: "uploads/db-zzz.png" }));
  await assertSucceeds(update(ref(a, "profiles/alice"), { pic: "" }));
  await assertSucceeds(update(ref(a, "profiles/alice"), { co: "SA" }));
  await assertSucceeds(update(ref(a), { "profiles/alice/topic": "A2", "profiles/alice/msg": "m2" })); // multi-path of plain fields
  await assertSucceeds(set(ref(a, "profiles/alice"), { topic: "A3", registered: true, createdAt: 5, b: "old.gif", gift: "dro3/old.gif" })); // whole object that keeps what it may not change
  await assertFails(remove(ref(a, "profiles/alice")));
  await assertFails(set(ref(a, "profiles/alice"), null));
  await assertFails(remove(ref(as("carol"), "profiles/carol"))); // a bare profile (no banner, gift, registered, createdAt) is not deletable either
  await assertFails(set(ref(as("carol"), "profiles/carol"), null));
  await assertFails(set(ref(a, "profiles/alice/topic"), null)); // would leave an invalid profile
  await assertFails(update(ref(a, "profiles/alice"), { extra: 1 })); // unknown field
  await assertFails(update(ref(a, "profiles/alice"), { upgrades: 99999 })); // not a profile field at all
  await assertFails(update(ref(a, "profiles/alice"), { ucol: "red" }));
});

test("G9 own profile: registered and createdAt are set once, at creation", async () => {
  await g9();
  await seed(async (d) => { await remove(ref(d, "profiles/carol")); });
  const g = asGuest("newguest");
  await assertFails(set(ref(g, "profiles/newguest"), { topic: "g", registered: true, createdAt: now() })); // a guest cannot pose as registered
  await assertFails(set(ref(g, "profiles/newguest"), { topic: "g", registered: false, createdAt: now() + 3600000 })); // not from the future
  await assertFails(set(ref(g, "profiles/newguest"), { topic: "g", registered: false, createdAt: now(), b: "x.gif" })); // not with a banner
  await assertFails(set(ref(g, "profiles/newguest"), { topic: "g", registered: false, createdAt: now(), gift: "dro3/x.gif" }));
  await assertSucceeds(set(ref(g, "profiles/newguest"), { topic: "g", registered: false, createdAt: now(), co: "SA" }));
  await assertFails(update(ref(g, "profiles/newguest"), { registered: true })); // and never promoted afterwards
  await assertFails(update(ref(g, "profiles/newguest"), { createdAt: 1 }));
  await assertSucceeds(set(ref(as("carol"), "profiles/carol"), { topic: "carol", registered: true, createdAt: now(), co: "SA" })); // a registered account (password sign-in)
  await assertFails(update(ref(as("alice"), "profiles/alice"), { registered: false }));
  await assertFails(update(ref(as("alice"), "profiles/alice"), { createdAt: 1 }));
});

test("G9 pic: only '' or a picture uploaded through this site", async () => {
  await g9();
  const a = as("alice");
  for (const bad of ["p.png", "http://evil.example/x.png", "uploads/../x.jpg", "uploads/db-.jpg", "uploads/db-x.jpeg2", "uploads/db-x y.jpg", "/uploads/db-x.jpg", PIC + "a/b"]) await assertFails(update(ref(a, "profiles/alice"), { pic: bad }));
  await assertSucceeds(update(ref(a, "profiles/alice"), { pic: PIC }));
  await assertFails(update(ref(env.authenticatedContext("owner1").database(), "profiles/bob"), { pic: "p.png" })); // the owner meets the same validation
});

test("G9 upgrades holder: banner and gift on any profile (own included), set and removed; an expired rank cannot", async () => {
  await g9();
  const s = as("st1");
  await assertSucceeds(update(ref(s, "profiles/bob"), { b: "1604.gif" })); // the app writes it this way
  await assertSucceeds(update(ref(s, "profiles/bob"), { gift: "dro3/1.png" }));
  await assertSucceeds(set(ref(s, "profiles/bob/b"), "2.gif"));
  await assertSucceeds(update(ref(s, "profiles/bob"), { b: "" }));
  await assertSucceeds(update(ref(s, "profiles/bob"), { gift: "" }));
  await assertSucceeds(update(ref(s, "profiles/alice"), { b: "alice.gif" }));
  await assertSucceeds(update(ref(s, "profiles/st1"), { b: "mine.gif" })); // their own profile: it is the flag that counts, not the owner
  await assertSucceeds(remove(ref(s, "profiles/alice/gift")));
  await assertFails(update(ref(s, "profiles/bob"), { topic: "renamed" })); // the flag gives no other field
  await assertFails(update(ref(s, "profiles/bob"), { msg: "x" }));
  await assertFails(update(ref(s, "profiles/bob"), { b: "x".repeat(81) })); // validation applies
  const x = as("stx");
  await assertFails(update(ref(x, "profiles/bob"), { b: "e.gif" }));
  await assertFails(update(ref(x, "profiles/stx"), { gift: "dro3/e.gif" }));
  await seed(async (d) => { await set(ref(d, "bans/st1"), { by: "owner1", t: now() }); });
  await assertFails(update(ref(s, "profiles/bob"), { b: "banned.gif" }));
});

test("G9 setpower holder: over somebody below, only topic and pic reset to ''", async () => {
  await g9();
  const p = as("sp1");
  await assertSucceeds(update(ref(p, "profiles/low1"), { topic: "renamed" }));
  await assertSucceeds(update(ref(p, "profiles/alice"), { pic: "" })); // the picture removal
  await assertSucceeds(update(ref(p, "profiles/low1"), { topic: "r2", pic: "" }));
  for (const f of [{ msg: "x" }, { ucol: "#000000" }, { mcol: "#000000" }, { bg: "#000000" }, { busy: true }, { co: "XX" }, { registered: false }, { createdAt: 1 }, { b: "x.gif" }, { gift: "dro3/x.gif" }, { pic: PIC }, { pic: "uploads/db-ok.jpg" }]) await assertFails(update(ref(p, "profiles/low1"), f));
  await assertFails(update(ref(p), { "profiles/low1/topic": "t", "profiles/low1/b": "x.gif" })); // multi-path with one forbidden field
  await assertFails(set(ref(p, "profiles/low1"), { topic: "fresh" })); // whole-object rewrite that would drop registered / createdAt
  await assertFails(remove(ref(p, "profiles/low1")));
  await assertFails(update(ref(as("mod1"), "profiles/low1"), { topic: "no flag" }));
  // the hierarchy of S3 is untouched
  for (const t of ["sp2", "hi1", "admin1", "owner1"]) { await assertFails(update(ref(p, `profiles/${t}`), { topic: "x" })); await assertFails(update(ref(p, `profiles/${t}`), { pic: "" })); }
});

test("G9 site owner: any valid field on somebody else's profile; nobody else touches the owner's", async () => {
  await g9();
  const o = env.authenticatedContext("owner1").database();
  await assertSucceeds(update(ref(o, "profiles/alice"), { topic: "by owner", msg: "m", b: "o.gif", gift: "dro3/o.gif", pic: PIC, busy: false }));
  await assertSucceeds(update(ref(o, "profiles/low1"), { registered: false }));
  await assertFails(update(ref(o, "profiles/alice"), { upgrades: 1 })); // validation still applies
  await assertFails(update(ref(o, "profiles/alice"), { pic: "p.png" }));
  await assertSucceeds(update(ref(o, "profiles/owner1"), { topic: "me" })); // their own plain fields
  for (const u of ["alice", "sp1", "hi1", "st1", "admin1"]) { await assertFails(update(ref(as(u), "profiles/owner1"), { topic: "x" })); }
  for (const u of ["alice", "sp1", "hi1"]) await assertFails(set(ref(as(u), "profiles/owner1/b"), "x.gif")); // (an upgrades holder may give anybody a banner, the owner included: unchanged since before G9)
});

test("G9 banned and signed-out: nothing is writable", async () => {
  await g9();
  await seed(async (d) => { await set(ref(d, "bans/alice"), { by: "owner1", t: now() }); });
  await assertFails(update(ref(as("alice"), "profiles/alice"), { topic: "x" }));
  await assertFails(update(ref(anon(), "profiles/bob"), { topic: "x" }));
  await assertFails(update(ref(anon(), "profiles/bob"), { b: "x.gif" }));
});

test("S3 owner: acts without the rank limits (ban, lift a ban, kick, edit a profile) but is nobody's target and cannot touch powerTable or break validation", async () => {
  await withRanks();
  await assertSucceeds(set(ref(as("owner1"), "bans/admin1"), { by: "owner1", t: now() }));
  await assertSucceeds(remove(ref(as("owner1"), "bans/admin1"))); // lifting a ban
  await assertSucceeds(set(ref(as("owner1"), "kicks/hi1"), { by: "owner1", t: now() }));
  await assertSucceeds(update(ref(as("owner1"), "profiles/admin1"), { pic: "uploads/db-p.jpg" }));
  await assertFails(set(ref(as("owner1"), "bans/owner1"), { by: "owner1", t: now() })); // not oneself
  await assertFails(set(ref(as("owner1"), "bans/carol"), { by: "somebody-else", t: now() })); // the usual validation still applies
  await assertFails(set(ref(as("owner1"), "powerTable/mod/rank"), 1));
  await assertFails(set(ref(as("owner1"), "powers/carol"), { level: 1, name: "mod" }));
  for (const u of ["admin1", "hi1", "sp1", "mod1"]) { // nobody else can reach the owner
    await assertFails(set(ref(as(u), "bans/owner1"), { by: u, t: now() }));
    await assertFails(set(ref(as(u), "kicks/owner1"), { by: u, t: now() }));
    await assertFails(set(ref(as(u), "powers/owner1"), { level: 0, name: "" }));
    await assertFails(remove(ref(as(u), "powers/owner1")));
    await assertFails(update(ref(as(u), "profiles/owner1"), { pic: "" }));
  }
});

// ---------------- G3: «كشف النكات» name history (nameLog) and the name written for each login (loginLog) ----------------
const row = (old, nu, by, src, at = serverTimestamp()) => ({ old, new: nu, by, at, src });
const rename = (db, uid, nu, logRow, id = "n1") => update(ref(db), { [`profiles/${uid}/topic`]: nu, ...(logRow ? { [`nameLog/${uid}/${id}`]: logRow } : {}) });

test("G3 nameLog: a member's own rename and its row are accepted together (and a rename twice gives two true rows)", async () => {
  await assertSucceeds(rename(as("alice"), "alice", "alice2", row("alice", "alice2", "alice", "self")));
  await assertSucceeds(rename(as("alice"), "alice", "alice3", row("alice2", "alice3", "alice", "self"), "n2"));
  let rows; await env.withSecurityRulesDisabled(async (c) => { rows = (await get(ref(c.database(), "nameLog/alice"))).val(); }); // (withSecurityRulesDisabled returns nothing)
  assert.deepEqual(Object.values(rows).map((r) => [r.old, r.new, r.by, r.src]), [["alice", "alice2", "alice", "self"], ["alice2", "alice3", "alice", "self"]]);
  assert.ok(Object.values(rows).every((r) => typeof r.at === "number"));
});

test("G3 nameLog: forged rows are refused (no real change, wrong old name, back-dated, written by/for somebody else, wrong source)", async () => {
  const a = as("alice");
  await assertFails(set(ref(a, "nameLog/alice/x1"), row("alice", "zzz", "alice", "self"))); // a row without the change itself
  await assertFails(rename(a, "alice", "alice9", row("fake-old", "alice9", "alice", "self"))); // old is not the stored name
  await assertFails(rename(a, "alice", "alice9", row("alice", "other-new", "alice", "self"))); // new is not the name written
  await assertFails(rename(a, "alice", "alice9", row("alice", "alice9", "alice", "self", Date.now() - 600000))); // not server time
  await assertFails(rename(a, "alice", "alice9", row("alice", "alice9", "bob", "self"))); // by = somebody else
  await assertFails(rename(a, "alice", "alice9", row("alice", "alice9", "alice", "mod"))); // "mod" on one's own name
  await assertFails(rename(a, "alice", "alice", row("alice", "alice", "alice", "self"))); // not a change
  await assertFails(rename(a, "bob", "bob2", row("bob", "bob2", "alice", "mod"))); // a member renaming somebody else
  await assertFails(set(ref(a, "nameLog/bob/x2"), row("bob", "bob2", "alice", "mod")));
  let all; await env.withSecurityRulesDisabled(async (c) => { all = (await get(ref(c.database(), "nameLog"))).val(); });
  assert.equal(all, null); // nothing at all was stored by the forged attempts
});

test("G3 nameLog: setPower over a lower rank (admin) may rename and record; a moderator without setpower may not", async () => {
  await assertSucceeds(rename(as("admin1"), "bob", "bob-by-admin", row("bob", "bob-by-admin", "admin1", "mod")));
  await assertFails(rename(as("mod1"), "carol", "carol-by-mod", row("carol", "carol-by-mod", "mod1", "mod")));
});

test("G3 nameLog: rows cannot be edited or deleted from a client", async () => {
  await assertSucceeds(rename(as("alice"), "alice", "alice2", row("alice", "alice2", "alice", "self")));
  await assertFails(update(ref(as("alice"), "nameLog/alice/n1"), { new: "rewritten" }));
  await assertFails(remove(ref(as("alice"), "nameLog/alice/n1")));
  await assertFails(remove(ref(as("admin1"), "nameLog/alice/n1")));
});

test("G3 nameLog: read needs `history` (admin yes; cp without history no; a member no; signed out no)", async () => {
  await assertSucceeds(rename(as("alice"), "alice", "alice2", row("alice", "alice2", "alice", "self")));
  await assertSucceeds(get(ref(as("admin1"), "nameLog/alice")));
  await assertFails(get(ref(as("banner1"), "nameLog/alice"))); // cp, no history
  await assertFails(get(ref(as("alice"), "nameLog/alice"))); // not even one's own
  await assertFails(get(ref(anon(), "nameLog/alice")));
});

test("G3 loginLog: the name written for a login is the profile's real name; a row without a name stays possible (old rows unchanged)", async () => {
  await assertSucceeds(set(push(ref(as("alice"), "loginLog")), { uid: "alice", topic: "alice", isreg: true, created: now() }));
  await assertFails(set(push(ref(as("alice"), "loginLog")), { uid: "alice", topic: "invented", isreg: true, created: now() }));
  await assertFails(set(push(ref(as("alice"), "loginLog")), { uid: "bob", topic: "bob", isreg: true, created: now() })); // for somebody else
  await assertSucceeds(set(push(ref(as("alice"), "loginLog")), { uid: "alice", isreg: true, created: now() })); // the pre-G3 shape
  await assertSucceeds(get(ref(as("banner1"), "loginLog"))); // cp reads the log
  await assertFails(get(ref(as("alice"), "loginLog")));
});

// ---------------- likes (reference behaviour seen 2026-11-05) ----------------
test("likes: a like on oneself counts once a minute like any like; a second one inside the minute is refused", async () => {
  await assertSucceeds(update(ref(as("alice")), { "rep/alice": 1, "lastLike/alice": serverTimestamp() }));
  await assertFails(update(ref(as("alice")), { "rep/alice": 2, "lastLike/alice": serverTimestamp() }));
  await assertFails(update(ref(as("alice")), { "rep/bob": 1, "lastLike/alice": serverTimestamp() }));
});

test("site setting pmlikes: a private message needs the likes; enough likes, a rank or the owner may send; 0 = no requirement", async () => {
  await env.withSecurityRulesDisabled(async (c) => { await set(ref(c.database(), "config/site/pmlikes"), 100); await set(ref(c.database(), "rep/bob"), 100); });
  const msg = (uid) => ({ uid, msg: "x", t: Date.now() });
  await assertFails(set(ref(as("alice"), "pm/alice_carol/m1"), msg("alice"))); // no likes
  await assertSucceeds(set(ref(as("bob"), "pm/bob_carol/m1"), msg("bob"))); // 100 likes
  await assertSucceeds(set(ref(as("mod1"), "pm/carol_mod1/m1"), msg("mod1"))); // a rank
  await env.withSecurityRulesDisabled(async (c) => set(ref(c.database(), "config/site/pmlikes"), 0));
  await assertSucceeds(set(ref(as("alice"), "pm/alice_carol/m2"), msg("alice")));
});
