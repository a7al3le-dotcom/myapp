// /api/youtube/search on Cloudflare Pages (x3 showYtSearch). The key is the Cloudflare secret YOUTUBE_API_KEY (optional).
import { ytSearch } from "../../../lib/youtube-search";
export const onRequestGet = async ({ request, env }: { request: Request; env: { YOUTUBE_API_KEY?: string } }) => {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const items = q.length < 2 ? [] : await ytSearch(q, env.YOUTUBE_API_KEY);
  return new Response(JSON.stringify({ items }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
