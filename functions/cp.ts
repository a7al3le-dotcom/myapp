// The control panel page (/cp): its tab shows the site's name (not the address) and the site's colours from the first frame (owner, 2026-11-07:
// on the original both follow the site settings). The page then follows changes live (lib/shim/server.ts watchSiteFilesStandalone).
import { sitePage } from "./_lib/site-page";

type Ctx = { request: Request; env: { FIREBASE_DB_URL?: string }; next: () => Promise<Response> };
export const onRequestGet = async ({ request, env, next }: Ctx) => sitePage(request, env, await next(), "cp");
