// Member search of the control panel («الأعضاء»). The original search box says "اسم العضو \ الآي بي \ الجهاز", so a row matches when the text is
// part of its name, decoration (الزخرفه), UID, IP or device string. Rows without a recorded ip / fp have those fields empty and can only match by
// name, decoration or UID. Case-insensitive, plain substring.
// Deep search («بحث عميق 1..4», the text "*=<device>" … "****=<device>"), MEASURED on al3nood.net 2026-11-05 by changing one part of a real
// device string at a time and searching each level: level N compares the device parts 3..(2+N) and ignores the others (1 = system,
// 2 = second group, 7 = browser id), so it finds the same machine in another browser. See deepMatch.
export const DEEP = /^(\*{1,4})=(.+)$/;
export function deepMatch(fp: string, q: string): boolean {
  const m = DEEP.exec(q.trim()); if (!m || !fp) return false;
  const want = m[2].trim().split("|"), have = fp.split("|");
  if (have.length !== 7 || want.length < 3 || want.length > 7) return false;
  // a cut device text (the original list has deep bans like "****=Linux|1bq|…|…|"): only the parts it still has are compared (inferred)
  let compared = 0;
  for (let i = 2; i < 2 + m[1].length && i < want.length; i++) { if (!want[i]) continue; compared++; if (want[i].toLowerCase() !== have[i].toLowerCase()) return false; }
  return compared > 0;
}
export type MemberRow = { id?: string; u: string; t?: string; ip?: string; fp?: string };
export function memberMatches(row: MemberRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (DEEP.test(s)) return typeof row.fp === "string" && deepMatch(row.fp, s);
  return [row.u, row.t, row.id, row.ip, row.fp].some((v) => typeof v === "string" && v.toLowerCase().includes(s));
}
