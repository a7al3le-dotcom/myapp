// The chat page ("/"): the site's title, name, description and colours already in its HTML, like the original's server writes them
// (measured 2026-11-07: the original shows its name and title from the first frame; we showed them empty for ~4.5 s). See _lib/site-page.ts.
import { sitePage } from "./_lib/site-page";

type Ctx = { request: Request; env: { FIREBASE_DB_URL?: string }; next: () => Promise<Response> };
export const onRequestGet = async ({ request, env, next }: Ctx) => sitePage(request, env, await next(), "main");
