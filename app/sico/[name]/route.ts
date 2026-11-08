// An icon / gift / smiley uploaded from the control panel (db-<id>.<ext>) is shown under the same folder as the built-in ones (x3: "sico/" + name);
// the built-in files are served from public/sico first.
import { servePicture } from "@/lib/server/picture";
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) { return servePicture(req, ctx); }
