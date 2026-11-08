import test from "node:test"; import assert from "node:assert/strict";
import { buildParts, joinParts, validParts, parseOs, tok, PART_NAMES, NA } from "../lib/shim/fp.ts";
// synthetic browser values only (no browser, no account): what each kind of device would expose
const id = "0123456789abcdef0123";
const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", platform: "iPhone", hardwareConcurrency: 6, screenWidth: 390, screenHeight: 844, colorDepth: 24, devicePixelRatio: 3, maxTouchPoints: 5, language: "ar", timeZone: "Asia/Riyadh", calendar: "gregory", numberingSystem: "latn", hourCycle: "h12", gpuVendor: "Apple Inc.", gpuRenderer: "Apple GPU", canvasHash: "a1b2c3d4e5f6", blankCanvasHash: "11223344", webglParams: "MAX_TEXTURE_SIZE=16384", deviceId: id };
const note10 = { userAgent: "Mozilla/5.0 (Linux; Android 13; SM-N970F) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36", platform: "Linux armv81", uaArchitecture: "arm", uaBitness: "64", hardwareConcurrency: 8, deviceMemory: 8, screenWidth: 412, screenHeight: 869, colorDepth: 24, devicePixelRatio: 2.625, maxTouchPoints: 5, language: "ar-SA", timeZone: "Asia/Riyadh", calendar: "gregory", numberingSystem: "arab", hourCycle: "h12", gpuVendor: "Google Inc. (Qualcomm)", gpuRenderer: "ANGLE (Qualcomm, Adreno (TM) 640)", canvasHash: "ffeeddccbbaa", blankCanvasHash: "55667788", webglParams: "MAX_TEXTURE_SIZE=8192", deviceId: "fedcba9876543210fedc" };
const win = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", platform: "Win32", hardwareConcurrency: 16, deviceMemory: 8, screenWidth: 1920, screenHeight: 1080, colorDepth: 24, devicePixelRatio: 1, maxTouchPoints: 0, language: "en-US", timeZone: "America/New_York", calendar: "gregory", numberingSystem: "latn", hourCycle: "h12", gpuVendor: "Google Inc. (NVIDIA)", gpuRenderer: "ANGLE (NVIDIA GeForce RTX 3060)", canvasHash: "0a0b0c0d0e0f", blankCanvasHash: "99aabbcc", webglParams: "MAX_TEXTURE_SIZE=16384", deviceId: "00112233445566778899" };

test("seven parts, in the documented order, each non-empty and within the allowed charset", () => {
  const p = buildParts(note10);
  assert.deepEqual(Object.keys(p), [...PART_NAMES]); assert.equal(PART_NAMES.length, 7);
  for (const k of PART_NAMES) assert.match(p[k], /^[A-Za-z0-9._+-]{1,80}$/, k);
  assert.equal(joinParts(p).split("|").length, 7); assert.ok(validParts(p));
});
test("each part carries the value that really came from the environment", () => {
  const p = buildParts(note10);
  assert.equal(p.sys, "Android_13_Linux-armv81"); assert.equal(p.cpu, "c8_m8_arm64"); assert.equal(p.scr, "869x412_d2.625_cd24_t5");
  assert.equal(p.reg, "ar-SA_Asia-Riyadh_gregory_arab_h12"); assert.match(p.gpu, /^Google-Inc.-Qualcomm_ANGLE-Qualcomm-Adreno-TM-640$/); assert.match(p.drw, /^ffeeddccbbaa-55667788-[0-9a-z]+$/); assert.equal(p.id, "fedcba9876543210fedc");
  assert.equal(buildParts(iphone).sys, "iOS_16.0_iPhone"); assert.equal(buildParts(win).sys, "Windows_10.0_Win32");
});
test("same device gives the same fingerprint; the window size, scroll and clock are not inputs at all", () => {
  assert.equal(joinParts(buildParts(note10)), joinParts(buildParts({ ...note10 })));
  // the environment type has no window size / scrollY / time field; extra fields handed in by mistake change nothing
  assert.equal(joinParts(buildParts({ ...note10, innerWidth: 300, scrollY: 900, now: Date.now() })), joinParts(buildParts(note10)));
});
test("rotating the phone (width and height swap) keeps the screen part", () => { assert.equal(buildParts({ ...note10, screenWidth: 869, screenHeight: 412 }).scr, buildParts(note10).scr); });
test("different systems and devices give different fingerprints, and the part that differs is the right one", () => {
  const [a, b, c] = [iphone, note10, win].map((e) => buildParts(e));
  for (const k of PART_NAMES) { assert.notEqual(a[k], b[k], "iphone vs note10 " + k); assert.notEqual(b[k], c[k], "note10 vs windows " + k); }
  assert.notEqual(buildParts({ ...note10, screenWidth: 360, screenHeight: 740 }).scr, b.scr);
  assert.equal(buildParts({ ...note10, screenWidth: 360 }).sys, b.sys);
  assert.notEqual(buildParts({ ...note10, hardwareConcurrency: 4 }).cpu, b.cpu);
  assert.notEqual(buildParts({ ...note10, timeZone: "Europe/Paris" }).reg, b.reg);
  assert.notEqual(buildParts({ ...note10, gpuRenderer: "Mali-G76" }).gpu, b.gpu);
  assert.notEqual(buildParts({ ...note10, canvasHash: "000000000000" }).drw, b.drw);
  assert.notEqual(buildParts({ ...note10, deviceId: "aaaaaaaaaaaaaaaaaaaa" }).id, b.id);
});
test("same hardware, two browser profiles: only the random id differs", () => {
  const x = buildParts(note10), y = buildParts({ ...note10, deviceId: "11111111111111111111" });
  for (const k of PART_NAMES) k === "id" ? assert.notEqual(x[k], y[k]) : assert.equal(x[k], y[k]);
});
test("nothing is invented: an empty environment gives unavailable markers only", () => {
  const p = buildParts({});
  assert.equal(p.gpu, NA); assert.equal(p.id, NA); assert.equal(p.cpu, `c${NA}_m${NA}_${NA}`); assert.equal(p.scr, `${NA}_d${NA}_cd${NA}_t${NA}`);
  assert.equal(p.drw, `${NA}-${NA}-${NA}`); assert.equal(p.sys, `${NA}_${NA}_${NA}`);
  assert.ok(validParts(p));
});
test("a missing memory / architecture / GPU leaves only that field unavailable", () => {
  const p = buildParts({ ...win, deviceMemory: undefined, gpuVendor: "", gpuRenderer: "" });
  assert.equal(p.cpu, "c16_m-_x64"); assert.equal(p.gpu, NA); assert.equal(buildParts({ ...iphone }).cpu, "c6_m-_-");
});
test("hostile text in the environment cannot leave the charset or break the separator", () => {
  const p = buildParts({ ...note10, platform: "<script>|x|", gpuRenderer: "a|b;c'd\"e", language: "ar|en" });
  for (const k of PART_NAMES) assert.match(p[k], /^[A-Za-z0-9._+-]{1,80}$/, k);
  assert.equal(joinParts(p).split("|").length, 7);
});
test("parseOs", () => {
  assert.deepEqual(parseOs("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), { name: "Android", version: "14" });
  assert.deepEqual(parseOs("Mozilla/5.0 (iPad; CPU OS 17_1_2 like Mac OS X)"), { name: "iOS", version: "17.1.2" });
  assert.deepEqual(parseOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), { name: "macOS", version: "10.15.7" });
  assert.deepEqual(parseOs("Mozilla/5.0 (X11; Linux x86_64)"), { name: "Linux", version: "" });
  assert.deepEqual(parseOs("", "Plan9", "1"), { name: "Plan9", version: "1" });
});
test("validParts accepts exactly seven well-formed parts, nothing else", () => {
  const p = buildParts(note10);
  assert.ok(validParts(p)); assert.ok(!validParts(null)); assert.ok(!validParts({ ...p, extra: "x" })); assert.ok(!validParts({ ...p, id: "bad id" })); assert.ok(!validParts({ ...p, sys: "" }));
  const { id: _omit, ...six } = p; assert.ok(!validParts(six)); assert.ok(!validParts({ ...p, cpu: "a".repeat(81) }));
});
test("tok keeps the allowed charset, collapses runs and caps the length", () => { assert.equal(tok("Linux armv8l"), "Linux-armv8l"); assert.equal(tok("  "), NA); assert.equal(tok("a".repeat(99), 10).length, 10); assert.equal(tok("a///b"), "a-b"); });
