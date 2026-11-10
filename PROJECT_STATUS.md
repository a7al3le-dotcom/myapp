# Project Status — myapp

Last inspected: 2026-11-11
Repository: https://github.com/a7al3le-dotcom/myapp
Default branch: `main`
Latest inspected main commit: `01de78951c5f784b379d08f953e8972cdf641a57`

## Current architecture (verified from source)
- Static HTML/CSS/JavaScript ES modules; no current Next.js app tree was found in the latest main commit.
- Entry pages: `index.html` and `cp.html`.
- Frontend modules are under `js/`; styles under `css/`.
- Firebase JS SDK 10.12.2 is imported from Google's CDN.
- Firebase Authentication uses `inMemoryPersistence`.
- Firebase Realtime Database root configured in `js/config.js`: `al3`.
- `js/api/actions.js` sets `BACKEND = "rules"`; direct database authorization therefore depends on deployed Realtime Database Security Rules.
- Latest main config points to Firebase project `mychat-2d881`. No credential values are repeated here.

## Repository history and rules baseline
- Commit `706f88106e4c92af1106ded49708f461e8a7bab7` replaced a large previous project state and removed 300 files, including the previous `AGENTS.md` and `database.rules.json`.
- Commit `01de78951c5f784b379d08f953e8972cdf641a57` changed the Firebase client configuration to project `mychat-2d881`.
- Latest inspected main tree contained 1,292 files and did not include `database.rules.json`, `firebase.json`, or `package.json`.
- A 1,611-line `database.rules.json` was recovered from the owner's previously supplied Library file. Its root is `al3` and its paths match the current client architecture.
- The recovered rules file was added unmodified to this engineering branch for version control. This does **not** prove that it is the currently deployed Firebase Rules version.
- The old rules file found in commit `8a8e2c4b410a65cf7a176221dd856da7e5fde4b9` uses a different schema and is not a valid replacement.

## Work completed on isolated branches
### Password persistence hardening
- Branch: `fix/remove-password-localstorage` (included in `docs/engineering-baseline`)
- Commit: `21cea4ed3e6209811cf391a634b27c4d9daa5f9b`
- File: `js/ui/login.js`
- Removed writes of member passwords to local storage.
- The login password field no longer reads a previously stored password.
- Added cleanup of the legacy `al3_p1` key on login-page initialization.
- Static post-edit assertions confirmed zero remaining `setv("p1", pass)` writes and zero `getv("p1")` reads in the edited file.
- This change is not merged into `main`.
- Browser-based login/registration regression tests have not yet been run.

### Engineering baseline
- Branch: `docs/engineering-baseline`
- Draft PR: https://github.com/a7al3le-dotcom/myapp/pull/1
- Added current agent instructions, project status, security baseline, implementation log, and the recovered rules file.

## Confirmed findings and blockers
1. **Confirmed in inspected main source:** `js/ui/login.js` stored the member password in local storage under `al3_p1` after login and registration. The isolated fix branch removes that behavior and clears the old key.
2. **High privacy exposure in the supplied rules snapshot, deployment unverified:** `al3/online` has `.read: true`. Its records require and validate `fp`, `f1`-`f4`, `ih`, and `fd`; `js/session.js` writes these values into online presence. If this snapshot is deployed, unauthenticated readers can obtain linkable device/IP-derived identifiers.
3. **High privacy exposure in the supplied rules snapshot, deployment unverified:** `al3/bans/$k` has a child-level `.read: true`, overriding the more restrictive parent read rule for individual ban records. The client stores the displayed ban identifier in `v`; for IP bans this is the raw IP supplied to `ban_add`. If deployed, ban records can disclose raw IP/device identifiers.
4. **Potential integrity issue in the supplied rules snapshot:** `al3/hist/$fp/$k` allows writes from any authenticated user, without binding the fingerprint path to the writer's own device. This needs a safe Emulator reproduction and review of the intended feature.
5. **Stored executable customization:** `js/site.js` executes custom head/HTML/script content. The supplied rules snapshot restricts writes to `sitecode` and `domcode` to owner UIDs, which is the intended trust boundary. Deployment status and owner UID integrity still need confirmation.
6. **Maintenance blast radius:** `cleanup()` removes expired presence/ban/subscription records and old messages, wall posts, images, and empty rooms. Its complete authorization and data-retention behavior need Emulator tests; do not execute it against production during review.
7. **Sensitive data handling:** source code collects IP-related data and device fingerprints and writes related records to `uprv`, `fps`, `online`, and `hist`. Access, minimization, and retention require review.
8. **Reproducibility gap:** no current `firebase.json`, `package.json`, or committed test harness was found in the inspected main tree. Local Emulator tests are not yet reproducible from main alone.

## Tests performed
- Inspected latest repository metadata, commit history, tree, and key source files through GitHub.
- Parsed the recovered 1,611-line rules file as JSON and inspected its path-level read/write rules.
- Verified that the recovered rules root `al3` matches the current `js/config.js` root.
- Verified the password-storage change with static source assertions before writing the isolated branch.
- Compared the draft branch against main; only the intended login file, rules baseline, and engineering documentation differ.
- No browser, Firebase Emulator, production-rules, or end-to-end tests have been executed.
- No production database writes, rule deployments, merges, or deployments were performed.

## Next engineering sequence
1. Confirm whether the recovered rules snapshot is exactly what is currently deployed to Firebase project `mychat-2d881`.
2. Reproduce the public-read exposure for `online` and `bans/$k` in a local Emulator using fake records.
3. Design a compatible private-data separation for IP/device identifiers without breaking guest login, online lists, ban checks, or moderator workflows.
4. Review the history-write rule and bind writes to the correct authenticated user's fingerprint.
5. Add a reproducible local-only Firebase Emulator configuration and regression tests, ensuring no fallback to production.
6. Test the password-removal branch through login, registration, logout, and page reload using fake accounts.
7. Review cleanup, site-code authorization, and every database operation against the rules matrix.

## Non-negotiable limits
No production rules changes, database migrations, data deletion, paid services, or deployment without explicit owner approval.


## Deep audit update — 2026-11-11
- Audited all 34 application HTML/CSS/JavaScript source files listed in the current main tree, including authentication, session/presence, permissions, actions, chat, private messages, rooms, wall, images, site customization, and control panel.
- Parsed the 1,611-line rules snapshot (568 rule declarations; 443 validation declarations). Its root matches the current client root `al3`.
- The snapshot is still not confirmed as the deployed rules for Firebase project `mychat-2d881`.
- Confirmed static findings are recorded in `docs/DEEP_AUDIT_2026-11-11.md`.
- Pre-change static test set: 21/21 assertions passed, including detection of the existing password-storage behavior in main and verification of the previously prepared password-removal branch.
- Password hardening updated on this branch: new registrations now require at least 8 characters; existing login transformation is preserved to avoid breaking current accounts. Legacy localStorage password storage is removed and old key cleared.
- Post-change static test set: 19 assertions passed after correcting one test assertion's escaping (the YouTube ID validator itself was already present and valid). These are source-level assertions, not browser or Firebase runtime tests.
- No Firebase Emulator tests or browser end-to-end tests were run. The repository has no `firebase.json`, `package.json`, or test suite, Firebase CLI is not installed in the execution environment, and GitHub clone/network access failed due DNS resolution.
- No rules, production data, Firebase settings, or deployment were changed.

### Additional confirmed risks requiring Emulator validation
- `al3/online/.read = true` exposes current presence records, including device fingerprint fields.
- `al3/bans/$k/.read = true` and `al3/wlist/$k/.read = true` grant public reads to individual records despite restricted parent reads.
- `al3/owners`, `al3/upow`, and `al3/powers` are publicly readable, exposing owner UIDs and privilege assignments.
- `al3/hist/$fp/$k` allows any authenticated user to write under any fingerprint.
- Any authenticated user can delete an offline presence record via `online/$uid` whenever `off == true`, without waiting for configured `ghostMins`.
- Any authenticated user can delete `mainN` auto-room metadata and the corresponding room message subtree through the current rules; occupancy is not checked in the rule. This can disrupt active rooms.
- The client-only `cleanup()` routine is not an authorization boundary; each delete is governed by the rules. Several broad old-data cleanup permissions need emulator tests.
- Custom site/domain scripts are intentionally executable. The supplied snapshot restricts writes to owners, but deployment and owner-account security remain unverified.
