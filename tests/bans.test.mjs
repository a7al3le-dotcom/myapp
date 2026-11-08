// Unit tests: the «الجهاز» short form (compactFp) and the ban / allow decision (bans.ts). Synthetic values only: no browser, no Firebase.
import test from "node:test"; import assert from "node:assert/strict";
import { buildParts, joinParts, compactFp } from "../lib/shim/fp.ts";
import { banPath, decide as decide0, lastCell, recMatches as rec0 } from "../lib/shim/bans.ts";
import { DEEP, deepMatch, memberMatches } from "../lib/shim/members-search.ts";
const D = { re: DEEP, match: deepMatch }; const recMatches = (p, r, c) => rec0(p, r, c, D); const decide = (a, c) => decide0(a, c, D);

const env = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0", platform: "Win32", hardwareConcurrency: 8, deviceMemory: 8, screenWidth: 1920, screenHeight: 1080, colorDepth: 24, devicePixelRatio: 1, maxTouchPoints: 0, language: "ar", timeZone: "Asia/Riyadh", gpuVendor: "Google Inc.", gpuRenderer: "ANGLE", canvasHash: "aabbccddeeff", blankCanvasHash: "11223344", webglParams: "X=1", deviceId: "0123456789abcdef0123" };
const full = joinParts(buildParts(env));

test("compactFp has the original's shape: platform | 3 | 2.3.2.2 | 2.2.2.2 | 2.2.2 | 2.2.2 | 6.3", () => {
  const c = compactFp(full);
  assert.match(c, /^Win32\|[0-9a-z]{3}\|[0-9a-z]{2}\.[0-9a-z]{3}\.[0-9a-z]{2}\.[0-9a-z]{2}\|([0-9a-z]{2}\.){3}[0-9a-z]{2}\|([0-9a-z]{2}\.){2}[0-9a-z]{2}\|([0-9a-z]{2}\.){2}[0-9a-z]{2}\|[0-9a-z]{6}\.[0-9a-z]{3}$/);
  assert.equal(c.length, 63);
});
test("compactFp: same device same string, another browser id changes only the last group, short strings stay", () => {
  assert.equal(compactFp(full), compactFp(full));
  const other = compactFp(joinParts(buildParts({ ...env, deviceId: "ffffffffffffffffffff" })));
  assert.deepEqual(other.split("|").slice(0, 6), compactFp(full).split("|").slice(0, 6));
  assert.notEqual(other.split("|")[6], compactFp(full).split("|")[6]);
  assert.equal(compactFp("Linux|107|1s.2hc"), "Linux|107|1s.2hc");
  assert.equal(compactFp(undefined), "");
});
const c = { uid: "U1", ip: "10.0.0.7", fp: "Win32|115|0d.peh.y0.0d|1e.8t.2q.e1|1i.2g.5d|1k.1z.26|0ckpy1.i0c", co: "SA" };
test("a ban matches the whole device, a part with leading stars, the IP, the country or the account", () => {
  for (const key of [c.fp, "****1k.1z.26", "Win32|115", "10.0.0.7", "sa"]) assert.ok(recMatches(banPath(key, false), { key }, c), key);
  assert.ok(recMatches("U1", { by: "x" }, c));
  for (const key of ["10.0.0.70", "KW", "zz.zz", "****", "*=Win32|115"]) assert.ok(!recMatches(banPath(key, false), { key }, c), key);
});
test("allow wins over ban; no match = not banned", () => {
  const ban = { [banPath(c.fp, false)]: { key: c.fp } }, allow = { [banPath("Win32|115", true)]: { key: "Win32|115", allow: true } };
  assert.deepEqual(decide(ban, c), { path: banPath(c.fp, false), allow: false });
  assert.equal(decide({ ...ban, ...allow }, c).allow, true);
  assert.equal(decide({ [banPath("KW", false)]: { key: "KW" } }, c), null);
});
test("record ids are safe for the list's ✕ button; «آخر حاله» format", () => {
  assert.match(banPath(c.fp, false), /^b[0-9a-z]+$/); assert.match(banPath(c.fp, true), /^a[0-9a-z]+$/);
  assert.equal(lastCell(0, 5), "--");
  assert.equal(lastCell(1000, 1000 + 25 * 3600000 + 7 * 60000 + 36 * 1000 + 701), "25:07:36:701");
});
test("deep search / deep ban: level N compares parts 3..2+N only (measured on the original)", () => {
  const F = "Win32|115|0d.peh.y0.0d|1e.8t.2q.e1|1i.2g.5d|1k.1z.26|0ckpy1.i0c";
  const ch = (k) => F.split("|").map((p, i) => (i === k ? "zz" + p.slice(2) : p)).join("|");
  const seen = (lvl, k) => deepMatch(F, "*".repeat(lvl) + "=" + ch(k));
  // rows = changed part (1..7), columns = level 1..4, exactly the table measured on al3nood.net
  const table = { 0: "YYYY", 1: "YYYY", 2: "nnnn", 3: "Ynnn", 4: "YYnn", 5: "YYYn", 6: "YYYY" };
  for (const [k, row] of Object.entries(table)) assert.equal([1, 2, 3, 4].map((l) => (seen(l, Number(k)) ? "Y" : "n")).join(""), row, "part " + (Number(k) + 1));
  assert.ok(memberMatches({ u: "x", fp: F }, "**=" + ch(6)));
  assert.ok(!memberMatches({ u: "x", fp: F }, "**=" + ch(3)));
  assert.ok(recMatches(banPath("***=" + ch(0), false), { key: "***=" + ch(0) }, { ...c, fp: F }));
  assert.ok(!recMatches(banPath("***=" + ch(4), false), { key: "***=" + ch(4) }, { ...c, fp: F }));
});
