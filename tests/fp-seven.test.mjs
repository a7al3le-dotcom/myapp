// Independent unit tests for the seven fingerprint parts (sys, cpu, scr, reg, gpu, drw, id). Synthetic browser values only: no browser, no Firebase, no account.
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
import { buildParts, joinParts, PART_NAMES, NA } from "../lib/shim/fp.ts";
import { getDeviceId, _resetMemoryForTests } from "../lib/shim/device-id.ts";
import { webcrypto } from "node:crypto";

const base = { userAgent: "Mozilla/5.0 (Linux; Android 13; SM-N970F) Chrome/124.0 Mobile Safari/537.36", platform: "Linux armv81", uaArchitecture: "arm", uaBitness: "64", hardwareConcurrency: 8, deviceMemory: 8, screenWidth: 412, screenHeight: 869, colorDepth: 24, devicePixelRatio: 2.625, maxTouchPoints: 5, language: "ar-SA", timeZone: "Asia/Riyadh", calendar: "gregory", numberingSystem: "arab", hourCycle: "h12", gpuVendor: "Google Inc. (Qualcomm)", gpuRenderer: "ANGLE (Qualcomm, Adreno (TM) 640)", canvasHash: "ffeeddccbbaa", blankCanvasHash: "55667788", webglParams: "MAX_TEXTURE_SIZE=8192;EXT=30", deviceId: "fedcba9876543210fedc" };
const fp = (o) => joinParts(buildParts({ ...base, ...o }));
const part = (o, k) => buildParts({ ...base, ...o })[k];
const differsOnlyIn = (o, k) => { const a = buildParts(base), b = buildParts({ ...base, ...o }); return PART_NAMES.filter((n) => a[n] !== b[n]).join(",") === k; };

// ---- 1 sys
test("sys: Android, iOS, Windows, macOS and Linux give different parts, with the version read from the UA", () => {
  const sys = (ua, platform) => part({ userAgent: ua, platform }, "sys");
  const a = sys("Mozilla/5.0 (Linux; Android 14; Pixel 8)", "Linux armv81"), i = sys("Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)", "iPhone"), w = sys("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32"), m = sys("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel"), l = sys("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64");
  assert.equal(new Set([a, i, w, m, l]).size, 5); assert.match(a, /^Android_14_/); assert.match(i, /^iOS_17\.2_/); assert.match(w, /^Windows_10\.0_/); assert.match(m, /^macOS_10\.15\.7_/); assert.match(l, /^Linux_-_/);
  assert.notEqual(sys("Mozilla/5.0 (Linux; Android 13)", "Linux armv81"), sys("Mozilla/5.0 (Linux; Android 12)", "Linux armv81")); // same OS, another version
  assert.equal(new Set([a, i, w]).has(NA), false);
});
test("sys: nothing else changes when only the operating system changes", () => { assert.ok(differsOnlyIn({ userAgent: "Mozilla/5.0 (Linux; Android 12; SM-N970F)" }, "sys")); });

// ---- 2 cpu
test("cpu: hardwareConcurrency and deviceMemory are used when present, and each one alone changes only this part", () => {
  assert.equal(part({}, "cpu"), "c8_m8_arm64");
  assert.ok(differsOnlyIn({ hardwareConcurrency: 4 }, "cpu")); assert.ok(differsOnlyIn({ deviceMemory: 4 }, "cpu")); assert.ok(differsOnlyIn({ uaBitness: "32" }, "cpu"));
});
test("cpu: absent hardwareConcurrency / deviceMemory / architecture are '-' (Safari and Firefox expose no deviceMemory): no default value is made up", () => {
  assert.equal(part({ deviceMemory: undefined }, "cpu"), "c8_m-_arm64");
  assert.equal(part({ hardwareConcurrency: undefined, deviceMemory: undefined, uaArchitecture: undefined, uaBitness: undefined, platform: "iPhone", userAgent: "iPhone" }, "cpu"), `c${NA}_m${NA}_${NA}`);
  assert.equal(part({ hardwareConcurrency: 0 }, "cpu").startsWith(`c${NA}`), true); // 0 is not a core count
  assert.equal(part({ hardwareConcurrency: NaN, deviceMemory: Infinity }, "cpu"), `c${NA}_m${NA}_arm64`);
});
test("cpu: the architecture comes from userAgentData, otherwise only from text that literally says it", () => {
  assert.match(part({ uaArchitecture: undefined, uaBitness: undefined, platform: "Linux armv81", userAgent: "x" }, "cpu"), /_arm64$/);
  assert.match(part({ uaArchitecture: undefined, uaBitness: undefined, platform: "Win32", userAgent: "Windows NT 10.0; Win64; x64" }, "cpu"), /_x64$/);
  assert.match(part({ uaArchitecture: undefined, uaBitness: undefined, platform: "MacIntel", userAgent: "Macintosh" }, "cpu"), new RegExp(`_${NA}$`)); // nothing says it -> unavailable
});

// ---- 3 scr: pixel ratio is never used alone
test("scr: two different devices with the SAME pixel ratio still differ (ratio alone does not identify a device)", () => {
  const a = part({ screenWidth: 390, screenHeight: 844, devicePixelRatio: 3 }, "scr"), b = part({ screenWidth: 430, screenHeight: 932, devicePixelRatio: 3 }, "scr");
  assert.notEqual(a, b); assert.equal(a.split("_")[1], b.split("_")[1]); // same d3 token, different part
});
test("scr: two devices with nearly equal pixel ratios (2.625 / 2.75 / 2.6) are told apart by the size and kept apart from each other", () => {
  const list = [[412, 869, 2.625], [412, 915, 2.625], [412, 892, 2.75], [360, 800, 2.6], [411, 731, 2.625]];
  const parts = list.map(([w, h, d]) => part({ screenWidth: w, screenHeight: h, devicePixelRatio: d }, "scr")); assert.equal(new Set(parts).size, list.length);
});
test("scr: the same size with a different pixel ratio differs; float noise in the ratio does not (2.625 === 2.6250000001)", () => {
  assert.notEqual(part({ devicePixelRatio: 2.625 }, "scr"), part({ devicePixelRatio: 3 }, "scr"));
  assert.equal(part({ devicePixelRatio: 2.6250000001 }, "scr"), part({ devicePixelRatio: 2.625 }, "scr"));
  assert.equal(part({ devicePixelRatio: 2.62499999 }, "scr"), part({ devicePixelRatio: 2.625 }, "scr"));
  assert.notEqual(part({ devicePixelRatio: 2.62 }, "scr"), part({ devicePixelRatio: 2.625 }, "scr")); // a real 0.005 gap is still visible
});
test("scr: colour depth and touch points each change only this part; a window resize or a rotation never does", () => {
  assert.ok(differsOnlyIn({ colorDepth: 30 }, "scr")); assert.ok(differsOnlyIn({ maxTouchPoints: 10 }, "scr"));
  assert.equal(fp({ screenWidth: 869, screenHeight: 412 }), fp({})); // rotation: width and height swap
  assert.equal(fp({ innerWidth: 300, innerHeight: 200, outerWidth: 1, scrollY: 999, visualViewportWidth: 123, now: 1 }), fp({})); // none of these is an input
});

// ---- 4 reg
test("reg: language, time zone, calendar, numbering and hour cycle each change only this part", () => {
  for (const o of [{ language: "en-US" }, { timeZone: "Europe/Paris" }, { calendar: "islamic-umalqura" }, { numberingSystem: "latn" }, { hourCycle: "h23" }]) assert.ok(differsOnlyIn(o, "reg"), JSON.stringify(o));
  assert.equal(part({}, "reg"), "ar-SA_Asia-Riyadh_gregory_arab_h12");
});
test("reg: absent Intl values are '-', not defaults", () => { assert.equal(part({ language: undefined, timeZone: undefined, calendar: undefined, numberingSystem: undefined, hourCycle: undefined }, "reg"), [NA, NA, NA, NA, NA].join("_")); });

// ---- 5 gpu
test("gpu: vendor and renderer (WebGL unmasked values) both count; either alone is kept; none gives '-'", () => {
  assert.ok(differsOnlyIn({ gpuVendor: "ARM" }, "gpu")); assert.ok(differsOnlyIn({ gpuRenderer: "Mali-G76" }, "gpu"));
  assert.equal(part({ gpuVendor: "", gpuRenderer: "Mali-G76" }, "gpu"), `${NA}_Mali-G76`); assert.equal(part({ gpuVendor: "ARM", gpuRenderer: "" }, "gpu"), `ARM_${NA}`);
  assert.equal(part({ gpuVendor: undefined, gpuRenderer: undefined }, "gpu"), NA);
});

// ---- 6 drw
test("drw: canvas, blank canvas and WebGL parameters each change only this part, and the same inputs always give the same value", () => {
  assert.ok(differsOnlyIn({ canvasHash: "000000000000" }, "drw")); assert.ok(differsOnlyIn({ blankCanvasHash: "00000000" }, "drw")); assert.ok(differsOnlyIn({ webglParams: "MAX_TEXTURE_SIZE=4096;EXT=12" }, "drw"));
  const runs = Array.from({ length: 200 }, () => part({}, "drw")); assert.equal(new Set(runs).size, 1);
});
test("drw: a browser without canvas / WebGL gives '-' for what it lacks, never a substitute", () => {
  assert.equal(part({ canvasHash: undefined, blankCanvasHash: undefined, webglParams: undefined }, "drw"), `${NA}-${NA}-${NA}`);
  assert.match(part({ webglParams: undefined }, "drw"), new RegExp(`-${NA}$`));
});

// ---- 7 id (persistence is tested on the real storage logic, with fakes for localStorage / cookie)
const rand = (n) => webcrypto.getRandomValues(new Uint8Array(n));
const jar = (v = null) => ({ get: () => v, set: (x) => { v = x; }, raw: () => v });
test("id: survives a reload (new page, same storage) and a logout + login (logout never touches it)", () => {
  _resetMemoryForTests(); const local = jar(), cookie = jar();
  const first = getDeviceId({ local, cookie, rand }).id;
  _resetMemoryForTests(); assert.equal(getDeviceId({ local, cookie, rand }).id, first); // "reload": module state is gone, storage remains
  const src = readFileSync(new URL("../lib/shim/server.ts", import.meta.url), "utf8");
  const i0 = src.indexOf("private async logout()"); const logout = i0 < 0 ? "" : src.slice(i0, src.indexOf("// ---------- session start", i0)); assert.ok(logout.length > 50, "logout() found");
  assert.ok(!/al3nood_did|localStorage|document\.cookie|removeItem|clear\(/.test(logout), "logout does not touch the stored id");
  assert.equal(getDeviceId({ local, cookie, rand }).id, first); // "login again"
});
test("id: the id fills only part 7 and is never a substitute for the UID: the server keys records by the verified token's uid", () => {
  assert.ok(differsOnlyIn({ deviceId: "00000000000000000000" }, "id"));
  const route = readFileSync(new URL("../app/api/conn/route.ts", import.meta.url), "utf8");
  assert.ok(/uid = r\.ok \? String\(\(await r\.json\(\)\)\.users\?\.\[0\]\?\.localId/.test(route), "uid comes from the verified token lookup");
  assert.ok(!/body\.uid|body\.id\b|body\.deviceId|parts\.id/.test(route), "the route never takes a uid or id from the body");
  assert.ok(/memberConn\/\$\{encodeURIComponent\(uid\)\}/.test(route), "records are keyed by uid");
  for (const f of ["fp.ts", "device-id.ts", "fp-collect.ts"]) { const s = readFileSync(new URL("../lib/shim/" + f, import.meta.url), "utf8"); assert.ok(!/signIn|auth\.|currentUser|password|token/i.test(s.replace(/\/\/.*$/gm, "")), f + " has no authentication code"); }
});
test("id: an invalid or missing id gives '-' (the id is not invented inside the builder)", () => { assert.equal(part({ deviceId: undefined }, "id"), NA); assert.equal(part({ deviceId: "XYZ" }, "id"), NA); assert.equal(part({ deviceId: "<script>" }, "id"), NA); });

// ---- the whole fingerprint
test("one different part gives a different fingerprint, in each of the seven positions", () => {
  const ref = fp({});
  const changes = { sys: { userAgent: "Mozilla/5.0 (Linux; Android 12)" }, cpu: { hardwareConcurrency: 6 }, scr: { screenWidth: 360, screenHeight: 780 }, reg: { timeZone: "Asia/Dubai" }, gpu: { gpuRenderer: "Mali-G78" }, drw: { canvasHash: "abababababab" }, id: { deviceId: "11111111111111111111" } };
  for (const [k, o] of Object.entries(changes)) { const v = fp(o); assert.notEqual(v, ref, k); const i = PART_NAMES.indexOf(k); const a = ref.split("|"), b = v.split("|"); assert.deepEqual(a.map((x, j) => x === b[j]), a.map((_, j) => j !== i), `only position ${i} (${k}) differs`); }
});
test("the unified string has exactly seven '|' separated parts for any input, including empty and hostile ones", () => {
  for (const o of [{}, { platform: "a|b", language: "|", gpuRenderer: "x|y|z", timeZone: "||" }, { userAgent: "\n\u0000<>", deviceId: "|" }]) assert.equal(fp(o).split("|").length, 7);
  assert.equal(joinParts(buildParts({})).split("|").length, 7);
});
test("no part is a constant: with an all-different environment every part differs from an empty one", () => { const e = buildParts({}), f = buildParts(base); for (const k of PART_NAMES) assert.notEqual(e[k], f[k], k); });
