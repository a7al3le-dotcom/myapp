import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
// the referrer / invite text that /api/conn accepts (static check of the route's own pattern)
const src = readFileSync(new URL("../app/api/conn/route.ts", import.meta.url), "utf8");
const m = /const SRC_OK = \/(.+)\/u;/.exec(src); const SRC_OK = m ? new RegExp(m[1], "u") : null;
test("the route has a SRC_OK pattern", () => assert.ok(SRC_OK));
test("hosts, short codes and Arabic text are accepted", () => { for (const v of ["www.google.com", "inv42", "*", "t.co", "https://a.b/c?d=1&e=2", "دعوة-12"]) assert.ok(SRC_OK.test(v), v); });
test("markup, quotes, control characters, empty and over-long text are rejected", () => { for (const v of ["<script>", "a\"b", "a'b", "a\nb", "a\u0000b", "", "x".repeat(101), "a<b"]) assert.ok(!SRC_OK.test(v), JSON.stringify(v)); });
test("only the per-login record stores them, never memberConn", () => {
  const lines = src.split(/\r?\n/);
  const row = lines.find((l) => l.includes("const row: Record")) ?? "";
  const put = lines.find((l) => l.includes("loginConn/${log}")) ?? "";
  assert.ok(row && !/refr|inv/.test(row)); assert.ok(/refr/.test(put));
});
