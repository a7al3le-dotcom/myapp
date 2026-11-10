# Project Status — myapp

Last inspected: 2026-11-11
Repository: https://github.com/a7al3le-dotcom/myapp
Default branch: `main`
Latest inspected main commit: `01de78951c5f784b379d08f953e8972cdf641a57`

## Current architecture (verified from source)
- Static HTML/CSS/JavaScript ES modules; no current Next.js app tree was found in the latest main commit.
- Entry pages: `index.html` and `cp.html`.
- Frontend modules are under `js/`; styles under `css/`.
- Firebase JS SDK 10.12.2 is imported from the Google CDN.
- Firebase Authentication uses `inMemoryPersistence`.
- Firebase Realtime Database root configured in `js/config.js`: `al3`.
- `js/api/actions.js` sets `BACKEND = "rules"`; direct database authorization therefore depends on the deployed Realtime Database Security Rules.
- Latest main config points to Firebase project `mychat-2d881`. No credential values are repeated here.

## Repository history and state
- Commit `706f88106e4c92af1106ded49708f461e8a7bab7` replaced a large previous project state and removed 300 files, including the previous `AGENTS.md` and `database.rules.json`.
- Commit `01de78951c5f784b379d08f953e8972cdf641a57` changed the Firebase client configuration to project `mychat-2d881`.
- Latest inspected main tree contained 1,292 files.
- The old `AGENTS.md` and old `database.rules.json` are retrievable from commit `8a8e2c4b410a65cf7a176221dd856da7e5fde4b9`, but describe the previous Next.js/Firebase schema and must not be restored as live configuration.
- The old rules use a different root/schema (for example `config`, `profiles`, `messages`, `images`) and are not a valid replacement for the current `al3` schema.

## Work completed on isolated branches
### Password persistence hardening
- Branch: `fix/remove-password-localstorage`
- Commit: `21cea4ed3e6209811cf391a634b27c4d9daa5f9b`
- File: `js/ui/login.js`
- Removed writes of member passwords to `localStorage`.
- The login password field no longer reads a previously stored password.
- Added cleanup of the legacy `al3_p1` key on login-page initialization.
- Static post-edit assertions confirmed zero remaining `setv("p1", pass)` writes and zero `getv("p1")` reads in the edited file.
- This change is not merged into `main`.
- Browser-based login/registration regression tests have not yet been run.

## Confirmed findings and blockers
1. **Confirmed in the inspected main source:** `js/ui/login.js` stored the member password in local storage under `al3_p1` after login and registration. The isolated fix branch removes that behavior and clears the old key.
2. **Critical verification blocker:** `database.rules.json` is absent from the latest main tree. The deployed rules for Firebase project `mychat-2d881` have not been retrieved or verified.
3. **Authorization depends on missing evidence:** `js/api/actions.js` uses direct client writes (`BACKEND = "rules"`). Operations such as site-code writes and cleanup depend on Security Rules; client-side checks alone cannot protect them.
4. **Potential stored-XSS impact, authorization unverified:** `js/site.js` executes stored custom head markup, HTML, and script content loaded from Realtime Database. This may be intentional owner customization, but the write permissions for `al3/sitecode` and `al3/domcode` must be verified against the current deployed rules.
5. **Potential destructive-operation exposure, authorization unverified:** `cleanup()` removes expired presence/ban/subscription records and old messages, wall posts, images, and empty rooms. Its effective permission and blast radius depend on current deployed rules and actual data shape. Do not execute it against production during review.
6. **Sensitive data handling:** source code collects IP-related data and device fingerprints and writes related records to database paths such as `uprv`, `fps`, and `online`. Access, minimization, and retention need rules verification.
7. **Reproducibility gap:** no current `package.json`, `firebase.json`, or committed current rules file was found in the inspected main tree. Local emulator and automated regression setup are therefore not yet reproducible from the repository alone.

## Tests performed
- Inspected latest repository metadata, commit history, tree, and key source files through GitHub.
- Verified the password-storage change with static source assertions before writing the isolated branch.
- No browser, Firebase Emulator, production-rules, or end-to-end tests have been executed.
- No production database writes, rule deployments, merges, or deployments were performed.

## Next engineering sequence
1. Obtain and verify the exact deployed Realtime Database Rules for `mychat-2d881` without modifying them.
2. Reconstruct a path/operation authorization matrix for every database read/write in `js/`.
3. Add a reproducible local-only Firebase Emulator configuration and tests, ensuring no fallback to production.
4. Test the password-removal branch through login, registration, logout, and page reload using fake accounts.
5. Review and harden site-code authorization, cleanup blast radius, device/IP data access and retention, and other confirmed issues.
6. Review remaining features and complete the application incrementally without changing its established behavior.

## Non-negotiable limits
No production rules changes, database migrations, data deletion, paid services, or deployment without explicit owner approval.
