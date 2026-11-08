// YouTube search for the chat's video button. Response shape matches what the reference client expects:
// { items: [{ thumbnail, title, channel, duration, url }] }.
// With YOUTUBE_API_KEY set it uses the free YouTube Data API v3 (10,000 units/day = about 100 searches/day);
// without a key it falls back to public Invidious instances and then to the public search page (free, no key, but less reliable).
type Item = { thumbnail: string; title: string; channel: string; duration: string; url: string };

const fmt = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const iso = (d: string) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || "");
  return m ? fmt((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) : "";
};
const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

async function viaApi(q: string, key: string): Promise<Item[]> {
  const s = await (await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${encodeURIComponent(q)}&key=${key}`)).json();
  const ids: string[] = (s.items ?? []).map((i: { id: { videoId: string } }) => i.id.videoId).filter(Boolean);
  if (!ids.length) return [];
  const v = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(",")}&key=${key}`)).json();
  const dur = new Map<string, string>((v.items ?? []).map((i: { id: string; contentDetails: { duration: string } }) => [i.id, iso(i.contentDetails.duration)]));
  return (s.items ?? []).map((i: { id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string }; default?: { url: string } } } }) => ({
    thumbnail: i.snippet.thumbnails.medium?.url ?? i.snippet.thumbnails.default?.url ?? "", title: i.snippet.title, channel: i.snippet.channelTitle,
    duration: dur.get(i.id.videoId) ?? "", url: watch(i.id.videoId),
  }));
}

const INSTANCES = ["https://yewtu.be", "https://inv.nadeko.net", "https://invidious.nerdvpn.de", "https://invidious.privacyredirect.com", "https://vid.puffyan.us"];
async function viaInvidious(q: string): Promise<Item[]> {
  for (const base of INSTANCES) {
    try {
      const r = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, { signal: AbortSignal.timeout(4500), headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const a = (await r.json()) as { type?: string; videoId: string; title: string; author: string; lengthSeconds: number; videoThumbnails?: { quality: string; url: string }[] }[];
      const out = a.filter((x) => x.videoId).slice(0, 10).map((x) => {
        const th = x.videoThumbnails?.find((t) => t.quality === "medium") ?? x.videoThumbnails?.[0];
        const url = th ? (th.url.startsWith("http") ? th.url : base + th.url) : `https://i.ytimg.com/vi/${x.videoId}/mqdefault.jpg`;
        return { thumbnail: url, title: x.title, channel: x.author, duration: fmt(x.lengthSeconds || 0), url: watch(x.videoId) };
      });
      if (out.length) return out;
    } catch { /* try the next instance */ }
  }
  return [];
}

// Last resort without any key: read the public search page's embedded data.
async function viaPage(q: string): Promise<Item[]> {
  try {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`, { signal: AbortSignal.timeout(6000), headers: { "Accept-Language": "ar,en;q=0.8", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" } });
    const html = await r.text();
    const m = /var ytInitialData = (\{[\s\S]*?\});<\/script>/.exec(html);
    if (!m) return [];
    const data = JSON.parse(m[1]);
    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
    const out: Item[] = [];
    for (const sec of sections) for (const c of sec?.itemSectionRenderer?.contents ?? []) {
      const v = c?.videoRenderer; if (!v?.videoId) continue;
      out.push({ thumbnail: v.thumbnail?.thumbnails?.slice(-1)[0]?.url ?? `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`, title: v.title?.runs?.map((x: { text: string }) => x.text).join("") ?? "", channel: v.ownerText?.runs?.[0]?.text ?? "", duration: v.lengthText?.simpleText ?? "", url: watch(v.videoId) });
      if (out.length >= 10) return out;
    }
    return out;
  } catch { return []; }
}

export async function GET(req: Request) {
  // Isolation guard: emulator mode makes no external calls.
  if (process.env.NEXT_PUBLIC_USE_EMULATOR === "1") return Response.json({ items: [], emulator: true });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return Response.json({ items: [] });
  const key = process.env.YOUTUBE_API_KEY;
  let items: Item[] = [];
  try { if (key) items = await viaApi(q, key); } catch { /* fall through to the key-less path */ }
  if (!items.length) items = await viaInvidious(q);
  if (!items.length) items = await viaPage(q);
  return Response.json({ items });
}
