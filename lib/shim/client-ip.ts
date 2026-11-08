import { isIP } from "node:net";
// The address the SERVER saw. X-Forwarded-For is a list that each hop appends to; a client can pre-fill it, but cannot control what the
// nearest hop appends at the right end. So the entry counted from the RIGHT (hops = number of trusted proxies in front of this server, default 1:
// the server's own front) is the one that can be trusted; entries to its left are client-controlled and ignored.
// IPv4-mapped IPv6 is unwrapped; anything that is not an IP gives "" (nothing is recorded).
export function clientIp(h: { get(name: string): string | null }, hops = 1): string {
  const list = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const raw = list.length ? list[Math.max(0, list.length - Math.max(1, hops))] : (h.get("x-real-ip") ?? "").trim();
  const ip = raw.replace(/^::ffff:/i, "").replace(/^\[|\]$/g, "");
  return isIP(ip) ? ip : "";
}
