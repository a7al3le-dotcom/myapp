import test from "node:test"; import assert from "node:assert/strict";
import { getDeviceId, newDeviceId, _resetMemoryForTests } from "../lib/shim/device-id.ts";
import { webcrypto } from "node:crypto";
const rand = (n) => webcrypto.getRandomValues(new Uint8Array(n));
const jar = (init = null, { failSet = false, failGet = false } = {}) => { let v = init; return { get: () => { if (failGet) throw new Error("blocked"); return v; }, set: (x) => { if (failSet) throw new Error("blocked"); v = x; }, raw: () => v }; };
test.beforeEach(() => _resetMemoryForTests());

test("first call creates a random 20-hex id and stores it in both places; later calls (visits, logins, reloads) return the same one", () => {
  const local = jar(), cookie = jar(), env = { local, cookie, rand };
  const a = getDeviceId(env); assert.match(a.id, /^[0-9a-f]{20}$/); assert.equal(a.from, "new"); assert.equal(local.raw(), a.id); assert.equal(cookie.raw(), a.id);
  for (let i = 0; i < 5; i++) assert.equal(getDeviceId(env).id, a.id);
});
test("a second browser profile (empty storage) gets a different id; ids are random, not derived from anything", () => {
  const ids = new Set(Array.from({ length: 50 }, () => getDeviceId({ local: jar(), cookie: jar(), rand }).id)); assert.equal(ids.size, 50);
  assert.match(newDeviceId(() => new Uint8Array(10)), /^0{20}$/); // the id is exactly the random bytes, nothing else is mixed in
});
test("localStorage cleared but the cookie survives: same id comes back and is restored", () => {
  const first = getDeviceId({ local: jar(), cookie: jar(), rand }).id; const local = jar(), cookie = jar(first);
  assert.equal(getDeviceId({ local, cookie, rand }).id, first); assert.equal(local.raw(), first);
});
test("cookie cleared but localStorage survives: same id, cookie restored", () => {
  const first = getDeviceId({ local: jar(), cookie: jar(), rand }).id; const local = jar(first), cookie = jar();
  assert.equal(getDeviceId({ local, cookie, rand }).id, first); assert.equal(cookie.raw(), first);
});
test("a corrupted stored value is ignored and replaced by a valid one", () => {
  const local = jar("<script>"), cookie = jar("zz"); const r = getDeviceId({ local, cookie, rand }); assert.match(r.id, /^[0-9a-f]{20}$/); assert.equal(local.raw(), r.id);
});
test("storage blocked (private mode): never throws, the id is stable within the page and flagged as memory", () => {
  const env = { local: jar(null, { failSet: true, failGet: true }), cookie: jar(null, { failSet: true, failGet: true }), rand };
  const a = getDeviceId(env); assert.equal(a.from, "memory"); assert.match(a.id, /^[0-9a-f]{20}$/); assert.equal(getDeviceId(env).id, a.id);
});
test("only localStorage blocked: the cookie carries the id", () => {
  const cookie = jar(), env = { local: jar(null, { failSet: true, failGet: true }), cookie, rand }; const a = getDeviceId(env); assert.equal(a.from, "new"); assert.equal(cookie.raw(), a.id); assert.equal(getDeviceId(env).id, a.id);
});
