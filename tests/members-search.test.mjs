import test from "node:test"; import assert from "node:assert/strict";
import { memberMatches } from "../lib/shim/members-search.ts";
// synthetic rows only (no database, no account): the logic of the box
const row = { u: "جوال-سوبر-٢", t: "جوال-سوبر-٢", ip: "109.74.37.54", fp: "Linux|107|1s.2hc.1b.2i" };
test("empty text matches everything", () => { assert.ok(memberMatches(row, "")); assert.ok(memberMatches(row, "   ")); });
test("name, ip and device each match as a part of the text", () => { assert.ok(memberMatches(row, "سوبر")); assert.ok(memberMatches(row, "109.74")); assert.ok(memberMatches(row, "linux|107")); });
test("case does not matter and unrelated text does not match", () => { assert.ok(memberMatches({ u: "Roy", ip: "", fp: "" }, "rOY")); assert.ok(!memberMatches(row, "zzzz")); });
test("empty ip / fp (today's data) never match a non-empty text", () => { assert.ok(!memberMatches({ u: "عضو", t: "عضو", ip: "", fp: "" }, "109.74")); });
test("UID matches, upper/lower case, and a deep-search prefix is plain text (UNKNOWN in the original): matches nothing", () => {
  const r = { id: "RkSrgtWTro17QAKiax2s9Xy07Ej6", u: "عضو", t: "عضو", ip: "", fp: "" };
  assert.ok(memberMatches(r, "rksrgtwt")); assert.ok(memberMatches(r, "RkSrgtWTro17QAKiax2s9Xy07Ej6")); assert.ok(!memberMatches(r, "RkSrgtWTro17QAKiax2s9Xy07Ej7"));
  assert.ok(!memberMatches({ u: "a", fp: "Linux|1|2" }, "*=Linux|1|2"));
});
