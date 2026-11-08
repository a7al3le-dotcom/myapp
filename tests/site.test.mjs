import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeSite, shapeValue, SITE_SCHEMA, SITE_EXECUTABLE_KEYS, EXECUTABLE_MAX } from "../lib/shim/site.ts";
import { cpNeed, cpDecision, flagOn, CP_REQUIRES } from "../lib/shim/cp-perms.ts";

const TRICKY = `Tom & "Jerry" <3 's &amp; </textarea><img src=x onerror=top.x=1>`;

test("shapeSite keeps known keys of the right type and drops everything else", () => {
  const out = shapeSite({ name: "n", mlikes: true, wall_likes: 5, callsLike: "3", maxIP: 2, evil: "x", domains: { a: 1 }, __proto__x: 1 });
  assert.deepEqual(out, { name: "n", callsLike: "3", maxIP: 2, wall_likes: 5, mlikes: true });
});
test("wrong types are dropped, not repaired into something else", () => {
  assert.deepEqual(shapeSite({ name: 5, title: { a: 1 }, mlikes: "yes", wall_likes: "5", stay: NaN, msgst: Infinity, callsLike: [1], bg: null }), {});
});
test("numbers are clamped to 0..max, text is cut at its limit", () => {
  assert.equal(shapeSite({ wall_likes: -4 }).wall_likes, 0);
  assert.equal(shapeSite({ wall_likes: 1e12 }).wall_likes, 1_000_000);
  assert.equal(shapeSite({ name: "x".repeat(500) }).name.length, 200);
  assert.equal(shapeSite({ customHead: "x".repeat(EXECUTABLE_MAX + 5) }).customHead.length, EXECUTABLE_MAX);
});
test("non-objects give an empty result", () => {
  for (const v of [null, undefined, 5, "x", [], [{ name: "x" }], true]) assert.deepEqual(shapeSite(v), {});
});
test("text is kept exactly as written: no escaping, so no double escaping", () => {
  const all = Object.fromEntries(Object.entries(SITE_SCHEMA).filter(([, k]) => k.t === "s").map(([k]) => [k, TRICKY]));
  const out = shapeSite(all);
  for (const k of Object.keys(all)) assert.equal(out[k], TRICKY.slice(0, SITE_SCHEMA[k].max), k); // only the length limit may shorten it
  assert.deepEqual(shapeSite(out), out); // applying it again (receive, then save) changes nothing
  assert.deepEqual(shapeSite(shapeSite(out)), out);
});
test("prototype tricks and inherited keys are ignored", () => {
  const polluted = Object.create({ name: "inherited" });
  assert.deepEqual(shapeSite(polluted), {});
  assert.deepEqual(shapeSite(JSON.parse('{"__proto__":{"name":"x"},"constructor":{"a":1}}')), {});
  assert.equal({}.name, undefined);
});
test("the three executable fields exist, are plain text with a hard limit, and the schema has no nested kinds", () => {
  assert.deepEqual([...SITE_EXECUTABLE_KEYS].sort(), ["customHead", "html", "script"]);
  for (const k of SITE_EXECUTABLE_KEYS) assert.deepEqual(SITE_SCHEMA[k], { t: "s", max: EXECUTABLE_MAX });
  for (const kind of Object.values(SITE_SCHEMA)) assert.ok(["s", "n", "b", "sn"].includes(kind.t));
  assert.equal(SITE_SCHEMA.domains, undefined);
  assert.equal(shapeValue({ t: "b" }, 1), undefined);
});

// ---- control-panel permission decision ----
const F = (over = {}) => ({ uid: "u1", bootstrap: "owner", power: { name: "admin" }, row: { cp: true, setpower: true, ban: true }, now: 1000, ...over });
test("cpNeed: unknown, inherited and non-string commands have no permission (so they are refused)", () => {
  for (const c of ["nope", "__proto__", "constructor", "toString", "", undefined, null, 5, {}]) assert.equal(cpNeed(c), undefined);
  assert.equal(cpNeed("sitesave"), "cpsite"); // x3 L4882
  assert.equal(cpNeed("owner"), "cpsite");
});
test("cpDecision: refuses by default", () => {
  assert.equal(cpDecision(undefined, F({ uid: "owner" })), false); // unknown command: not even the owner
  assert.equal(cpDecision("cp", F({ uid: "" })), false);
  assert.equal(cpDecision("cp", F({ power: null })), false);
  assert.equal(cpDecision("cp", F({ power: { name: "" } })), false);
  assert.equal(cpDecision("cp", F({ power: {} })), false);
  assert.equal(cpDecision("cp", F({ row: null })), false);
  assert.equal(cpDecision("cp", F({ row: {} })), false);
  assert.equal(cpDecision("cp", F({ row: { cp: false } })), false);
  assert.equal(cpDecision("cp", F({ row: { cp: 0 } })), false);
  assert.equal(cpDecision("cp", F({ row: { cp: "true" } })), false);
});
test("cpDecision: flags, expiry and the owner", () => {
  assert.equal(cpDecision("cp", F()), true);
  assert.equal(cpDecision("ban", F({ row: { ban: 5 } })), true);
  assert.equal(cpDecision("setpower", F({ row: { cp: true, setpower: false } })), false); // a rank that may look, not change
  assert.equal(cpDecision("cp", F({ power: { name: "admin", until: 500 } })), false); // expired
  assert.equal(cpDecision("cp", F({ power: { name: "admin", until: 5000 } })), true);
  assert.equal(cpDecision("owner", F()), false); // an admin rank, however high, is not the owner
  assert.equal(cpDecision("owner", F({ uid: "owner" })), true);
  assert.equal(cpDecision("owner", F({ uid: "owner", bootstrap: "" })), false);
  assert.equal(cpDecision("owner", F({ uid: "", bootstrap: "" })), false);
  assert.equal(cpDecision("setpower", F({ uid: "owner", power: null, row: null })), true);
  assert.equal(flagOn(true) && flagOn(1) && !flagOn(0) && !flagOn(false) && !flagOn("1") && !flagOn(null), true);
});
test("every control-panel command in the table names the owner or a flag", () => {
  for (const [c, n] of Object.entries(CP_REQUIRES)) assert.ok(n === "owner" || /^[a-zA-Z]+$/.test(n), c);
});

// ---- cutting text at the limit never splits a character ----
import { clip, SITE_NUMBER_MAX } from "../lib/shim/site.ts";
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const FAMILY = "👨‍👩‍👧‍👦"; // man ZWJ woman ZWJ girl ZWJ boy: 11 UTF-16 units, one character
const FLAG = "🇸🇦"; // two regional indicators: 4 units, one character
const SKIN = "👍🏽"; // thumbs up + skin tone: 4 units
const COMBO = "é"; // e + combining acute: 2 units

test("clip: short text is returned untouched (no change, so nothing to double-process)", () => {
  for (const s of ["", "abc", TRICKY, FAMILY, "ع".repeat(200)]) assert.equal(clip(s, 200), s);
  assert.equal(clip("a".repeat(200), 200).length, 200);
});
test("clip: never more than max UTF-16 units (what the database rules count) and never a lone surrogate", () => {
  for (const unit of ["a", "ع", "😀", FAMILY, FLAG, SKIN, COMBO, "‍", "😀a"]) {
    for (const max of [1, 2, 3, 10, 11, 12, 40, 200]) {
      const out = clip(unit.repeat(500), max);
      assert.ok(out.length <= max, `${JSON.stringify(unit)} max=${max} len=${out.length}`);
      assert.ok(!LONE.test(out), `lone surrogate for ${JSON.stringify(unit)} max=${max}`);
    }
  }
});
test("clip: emoji at the limit stay whole", () => {
  assert.equal(clip("a".repeat(199) + "😀", 200), "a".repeat(199)); // the emoji does not fit: dropped whole, not halved
  assert.equal(clip("a".repeat(198) + "😀", 200), "a".repeat(198) + "😀"); // fits exactly
  assert.equal(clip("😀".repeat(101), 200), "😀".repeat(100));
  assert.equal(clip("a".repeat(195) + FAMILY, 200), "a".repeat(195)); // 195 + 11 > 200: the whole family goes
  assert.equal(clip("a".repeat(189) + FAMILY + "bbbb", 200), "a".repeat(189) + FAMILY + "bbbb".slice(0, 0)); // 189 + 11 = 200 exactly
  assert.equal(clip("a".repeat(198) + COMBO, 200), "a".repeat(198) + COMBO);
  assert.equal(clip("a".repeat(199) + COMBO, 200), "a".repeat(199)); // the letter would lose its accent: both are dropped, not the accent alone
  assert.equal(clip("a".repeat(196) + FLAG + FLAG, 200), "a".repeat(196) + FLAG);
  assert.equal(clip("a".repeat(197) + SKIN, 200), "a".repeat(197));
});
test("clip: idempotent, and a 200 KB value is cheap", () => {
  const big = "😀".repeat(100_000);
  const t0 = Date.now();
  const once = clip(big, 200);
  assert.ok(Date.now() - t0 < 500);
  assert.equal(clip(once, 200), once);
  assert.equal(once, "😀".repeat(100));
  assert.equal(shapeSite({ name: big }).name, once);
});
test("shapeValue uses clip for text and the shared numeric bound for numbers", () => {
  assert.equal(shapeValue(SITE_SCHEMA.name, "a".repeat(199) + "😀"), "a".repeat(199));
  assert.equal(shapeValue(SITE_SCHEMA.callsLike, "9".repeat(13)), "9".repeat(12));
  assert.equal(shapeValue(SITE_SCHEMA.callsLike, 1e12), SITE_NUMBER_MAX);
  assert.equal(shapeValue(SITE_SCHEMA.wall_likes, 1e12), SITE_NUMBER_MAX);
  assert.equal(SITE_SCHEMA.callsLike.nmax, SITE_NUMBER_MAX);
  for (const kind of Object.values(SITE_SCHEMA)) if (kind.t === "n") assert.equal(kind.max, SITE_NUMBER_MAX);
});
