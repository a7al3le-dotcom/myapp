// Unit tests for the output sanitiser. Run with: npm run test:unit   (no emulator needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, softEsc, safeColor, safePic, safeId, safeLink, safeFile, safeCountry, sanitizeOut } from "../lib/shim/escape.ts";

test("esc neutralises markup characters and keeps ordinary text", () => {
  assert.equal(esc(`"><img src=x onerror=alert(1)>`), "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(esc("a & b < c > d ' e"), "a &amp; b &lt; c &gt; d &#39; e");
  assert.equal(esc("مرحبا بك 123"), "مرحبا بك 123");
  assert.equal(esc(null), "");
  assert.equal(esc(42), "42");
});

test("colours accept only hex values", () => {
  assert.equal(safeColor("#aabbcc"), "#aabbcc");
  assert.equal(safeColor("#abc"), "#abc");
  assert.equal(safeColor("red;background:url(//x)"), "#000000");
  assert.equal(safeColor('#000"onmouseover="x'), "#000000");
  assert.equal(safeColor(undefined, "#111111"), "#111111");
});

test("pictures accept only our own files", () => {
  for (const ok of ["pic.png", "room.png", "uploads/db--P5NjjQMal9yTuxZT1g-.jpg", "sico/tNcRZNxtK.png", "dro3/z1ec9of6ff10.gif1609685883519.gif", "emo/1604249548786.gif", "flags/sa.png"]) assert.equal(safePic(ok), ok, ok);
  for (const bad of ["http://evil.example/x.png", "//evil/x.png", "javascript:alert(1)", 'pic.png" onerror="x', "uploads/../../etc/passwd", "data:image/png;base64,AAAA", "uploads/a b\"c.png"]) assert.equal(safePic(bad), "", bad);
  assert.equal(safePic("nope", "pic.png"), "pic.png");
});

test("ids can never break out of an inline handler", () => {
  assert.equal(safeId("pub1"), "pub1");
  assert.equal(safeId("-P5Niz0v3jPMk2cWTQwt"), "-P5Niz0v3jPMk2cWTQwt");
  assert.equal(safeId("a_b-C9"), "a_b-C9");
  for (const bad of ["x');alert(1);('", 'a"b', "a b", "a<b", "", "x".repeat(65)]) assert.equal(safeId(bad), "", bad);
});

test("links accept http(s) and our uploads only", () => {
  assert.equal(safeLink("https://www.youtube.com/watch?v=abc&t=3"), "https://www.youtube.com/watch?v=abc&t=3"); // not entity-escaped
  assert.equal(safeLink("uploads/db-x.jpg"), "uploads/db-x.jpg");
  for (const bad of ["javascript:top.x=1", "data:text/html,<script>", 'https://a.example/"onclick="x', "https://a.example/ b", "ftp://x"]) assert.equal(safeLink(bad), "", bad);
});

test("file names and countries", () => {
  assert.equal(safeFile("z1ec9of6ff10.gif1609685883519.gif"), "z1ec9of6ff10.gif1609685883519.gif");
  assert.equal(safeFile('a.gif" onerror="x'), "");
  assert.equal(safeFile("../x.gif"), "");
  assert.equal(safeCountry("sa"), "sa");
  assert.equal(safeCountry("--"), "--");
  assert.equal(safeCountry("<b>"), "--");
});

test("sanitizeOut escapes every string by default, deeply, and leaves other types alone", () => {
  const out = sanitizeOut({ topic: "<b>x</b>", msg: "a&b", n: 5, ok: true, nothing: null, list: ["<i>", { deep: "\"q\"" }], pic: "pic.png", ucol: "#123456", roomid: null });
  assert.deepEqual(out, { topic: "&lt;b&gt;x&lt;/b&gt;", msg: "a&amp;b", n: 5, ok: true, nothing: null, list: ["&lt;i&gt;", { deep: "&quot;q&quot;" }], pic: "pic.png", ucol: "#123456", roomid: null });
});

test("sanitizeOut validates by key instead of escaping", () => {
  const out = sanitizeOut({ pic: 'x" onerror="y', ucol: "red", bg: "", c: "#fff", uid: "u'1", rid: "pub1", link: "javascript:1", co: "zz", b: "tNcRZNxtK.png", ico: "" });
  assert.deepEqual(out, { pic: "pic.png", ucol: "#000000", bg: "", c: "#fff", uid: "", rid: "pub1", link: "", co: "zz", b: "tNcRZNxtK.png", ico: "" });
});

test("keys listed as raw keep the markup the shim built itself", () => {
  const html = '<div class="x" onclick="rjoin(\'pub1\')">Room</div> text';
  assert.equal(sanitizeOut({ msg: html, topic: "<b>" }, ["msg"]).msg, html);
  assert.equal(sanitizeOut({ msg: html, topic: "<b>" }, ["msg"]).topic, "&lt;b&gt;");
  assert.equal(sanitizeOut("<b>"), "&lt;b&gt;"); // a bare string payload
});

test("softEsc only replaces the characters that can open a tag", () => {
  assert.equal(softEsc(`<img src=x onerror=1> & "q" 'r'`), `‹img src=x onerror=1› & "q" 'r'`);
  assert.equal(softEsc("غرفة <1>"), "غرفة ‹1›");
});

test("soft keys get the light treatment, everything else the full one", () => {
  const out = sanitizeOut({ topic: "<b> & x", other: "<b> & x" }, { soft: ["topic"] });
  assert.deepEqual(out, { topic: "‹b› & x", other: "&lt;b&gt; &amp; x" });
});

test("rank icon: a bare file name from the power table passes, markup does not", () => {
  const out = sanitizeOut([{ name: "x", ico: "1748437312518 (1).gif" }, { name: "y", ico: "1748437311989.gif" }, { name: "z", ico: "a\" onerror=\"b.gif" }, { name: "w", ico: "../x.gif" }, { name: "v", ico: "sico/tNcRZNxtK.png" }]);
  assert.deepEqual(out.map((r) => r.ico), ["1748437312518 (1).gif", "1748437311989.gif", "", "", "sico/tNcRZNxtK.png"]);
});
