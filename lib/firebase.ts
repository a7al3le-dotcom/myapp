import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserSessionPersistence, connectAuthEmulator, getAuth, initializeAuth, type Auth,
} from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Isolation guard: the emulator flag and a "demo-" project id must go together. This makes it impossible to run
// against the real project while believing you are on the emulators (or the other way round).
const emuEnv = process.env.NEXT_PUBLIC_USE_EMULATOR === "1";
const demoProject = (config.projectId ?? "").startsWith("demo-");
if (emuEnv !== demoProject) {
  throw new Error(
    emuEnv
      ? "[isolation] NEXT_PUBLIC_USE_EMULATOR=1 but the Firebase project is not a demo- project. Use `npm run dev:emu`."
      : "[isolation] A demo- Firebase project is configured but the emulator flag is off. Use `npm run dev:emu`.",
  );
}

export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config);
// Same as getAuth() (firebase/auth: initializeAuth with these three persistences) WITHOUT browserPopupRedirectResolver. This project never
// signs in by popup or redirect, and on phones and Safari that resolver preloads https://apis.google.com/js/api.js at start-up: an internet
// request even on the emulators. Server-side rendering keeps getAuth(); a second initialisation (hot reload) reuses the existing instance.
function makeAuth(): Auth {
  if (typeof window === "undefined") return getAuth(app);
  // ONE TAB = ONE SESSION, as on the reference site: the sign-in lives in this tab only (sessionStorage), so a second tab can hold another
  // account without replacing this one. It survives a refresh of the same tab; a window opened from it (window.open, e.g. /cp) gets a copy.
  try { return initializeAuth(app, { persistence: browserSessionPersistence }); }
  catch { return getAuth(app); }
}
export const auth: Auth = makeAuth();
export const db: Database = getDatabase(app);

// Set NEXT_PUBLIC_USE_EMULATOR=1 to run against the local emulators (no cloud writes).
declare global {
  var __fbEmu: boolean | undefined;
}
// ?emu=1 in the page URL (or the env flag) points this tab at the local emulators, so tests never touch the cloud database.
const wantEmu = process.env.NEXT_PUBLIC_USE_EMULATOR === "1" || (typeof location !== "undefined" && new URLSearchParams(location.search).has("emu"));
if (wantEmu && !globalThis.__fbEmu) {
  // ISOLATED COPY (phone testing): a page opened by a private LAN address (http://192.168.x.x:3310) reaches the emulators on that same
  // address (forwarded by scripts/lan-proxy.mjs); localhost / 127.0.0.1 keep the old behaviour. Only private IPv4 ranges qualify.
  const emuHost = typeof location !== "undefined" && /^(192\.168|10|172\.(1[6-9]|2\d|3[01]))\.[\d.]+$/.test(location.hostname) ? location.hostname : "127.0.0.1";
  connectAuthEmulator(auth, `http://${emuHost}:9699`, { disableWarnings: true });
  connectDatabaseEmulator(db, emuHost, 9600);
  globalThis.__fbEmu = true;
}
