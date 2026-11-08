import test from "node:test"; import assert from "node:assert/strict"; import crypto from "node:crypto";
import { sha256Hex } from "../lib/shim/sha256.ts";
test("the plain-JS SHA-256 equals the platform digest (ASCII, Arabic, empty, block boundaries, long input)", () => {
  for (const s of ["", "a", "abc", "جوال-عضو", "عضو-اختبار", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "ي".repeat(500), "m" + "0123456789".repeat(40)])
    assert.equal(sha256Hex(s), crypto.createHash("sha256").update(s).digest("hex"), JSON.stringify(s).slice(0, 20));
});
