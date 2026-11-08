// «النطاقات»: a domain is its last two labels (x3 fn95: "https://www.site.com/x" -> "site.com"), stored under config/domains/<site,com>.
// Shared by the server (the page built for the host it was asked from) and the shim (live changes).
export const normDomain = (v: string) => {
  let d = (v || "").trim().toLowerCase();
  if (d.includes("://")) d = d.split("://")[1];
  const p = d.split("/")[0].split(":")[0].split(".");
  return p.length < 2 || !p[p.length - 1] ? "" : p[p.length - 2] + "." + p[p.length - 1];
};
export const domainKey = (d: string) => d.replace(/\./g, ",");
/** the texts a domain may have of its own (non-empty ones replace the main site's) */
export const DOMAIN_TEXT = ["name", "title", "description", "keywords", "script", "customHead", "html"] as const;
export const DOMAIN_COLOURS = ["bg", "background", "buttons"] as const;
