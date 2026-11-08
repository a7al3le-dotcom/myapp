// /emo/<name>: an uploaded picture from the database, otherwise the built-in file (functions/_lib/picture.ts)
import { servePicture } from "../_lib/picture";
import type { Env } from "../_lib/fb";
export const onRequestGet = (ctx: { request: Request; env: Env; params: { name?: string | string[] } }) => servePicture(ctx);
