import test from "node:test"; import assert from "node:assert/strict";
import { clientIp } from "../lib/shim/client-ip.ts";
const H = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });
test("the entry counted from the right is the one the server's own hop saw; client-prefilled entries on the left are ignored", () => {
  assert.equal(clientIp(H({ "x-forwarded-for": "6.6.6.6, 109.74.37.54" })), "109.74.37.54");
  assert.equal(clientIp(H({ "x-forwarded-for": "6.6.6.6, 109.74.37.54, 10.0.0.1" }), 2), "109.74.37.54");
  assert.equal(clientIp(H({ "x-forwarded-for": "109.74.37.54" })), "109.74.37.54");
  assert.equal(clientIp(H({ "x-forwarded-for": "::ffff:192.168.1.30" })), "192.168.1.30");
  assert.equal(clientIp(H({ "x-forwarded-for": "2a02:cb80:4013:b31a:50:f4ff:fe00:1" })), "2a02:cb80:4013:b31a:50:f4ff:fe00:1");
});
test("falls back to x-real-ip; anything that is not an ip records nothing", () => {
  assert.equal(clientIp(H({ "x-real-ip": "41.200.47.70" })), "41.200.47.70");
  assert.equal(clientIp(H({ "x-forwarded-for": "<script>" })), ""); assert.equal(clientIp(H({})), "");
});
