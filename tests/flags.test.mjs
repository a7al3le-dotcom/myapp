// flagCode(): what the client receives for a stored country value (lib/shim/flags.ts). Run: node --test tests/flags.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { FLAG_CODES, flagCode } from "../lib/shim/flags.ts";

test("a valid lower-case code is kept", () => { assert.equal(flagCode("EU"), "eu"); /* eu.png exists */ assert.equal(flagCode("sa"), "sa"); assert.equal(flagCode("kw"), "kw"); });
test("an old upper-case code shows the right flag (stored value untouched)", () => { assert.equal(flagCode("SA"), "sa"); assert.equal(flagCode(" Eg "), "eg"); });
test("no country -> the '?' picture", () => { for (const v of [undefined, null, "", "--", 0, {}, []]) assert.equal(flagCode(v), "--"); });
test("a code without a flag picture -> '?', never a broken image", () => { for (const v of ["zz", "xx", "A1", "T1", "123", "sau", "../x", "s"]) assert.equal(flagCode(v), "--"); });
test("every code in the list has its picture, and every picture is in the list", () => {
  const files = readdirSync(new URL("../public/flags", import.meta.url)).filter((f) => /^[a-z]{2}\.png$/.test(f)).map((f) => f.slice(0, 2));
  assert.deepEqual([...FLAG_CODES].sort(), files.sort());
});
