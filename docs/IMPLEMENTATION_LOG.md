# Implementation Log

## 2026-11-11 — Password persistence hardening
- Branch: `fix/remove-password-localstorage`, included in `docs/engineering-baseline`.
- Commit: `21cea4ed3e6209811cf391a634b27c4d9daa5f9b`.
- Changed: `js/ui/login.js`.
- Removed local-storage password writes after member login and registration.
- Removed automatic password-field restoration from `al3_p1`.
- Added cleanup of the legacy `al3_p1` key at login initialization.
- Verification: static assertions passed; no password-key writes or reads remain in the edited login module.
- Not yet verified: browser login/registration regression, Firebase Emulator behavior, and production rules compatibility.

## 2026-11-11 — Engineering baseline and Firebase rules recovery
- Branch: `docs/engineering-baseline`.
- Draft PR: https://github.com/a7al3le-dotcom/myapp/pull/1.
- Restored current `AGENTS.md` instructions for the static HTML/JavaScript/Firebase architecture.
- Added `PROJECT_STATUS.md` and `docs/SECURITY_BASELINE.md`.
- Recovered the owner's previously supplied 1,611-line `database.rules.json` from the Library and added it unmodified to this branch.
- Parsed the rules JSON successfully and confirmed its `al3` root matches `js/config.js`.
- Identified conditional privacy exposures in the supplied snapshot: public reads of `al3/online` and `al3/bans/$k`, plus broad authenticated writes to `al3/hist/$fp/$k`.
- Deployment status of the recovered rules is not confirmed; no rules were changed or deployed.
- No browser, Firebase Emulator, or end-to-end tests were run. No production data or deployment was touched.


## 2026-11-11 — Deep audit and registration password policy
- Audited the current 34 application source files and traversed the supplied 1,611-line Firebase rules snapshot.
- Before the code change, static checks confirmed the registration accepted any non-empty password because the fixed suffix satisfied Firebase Auth's minimum-length check.
- Changed `js/ui/login.js` on `docs/engineering-baseline`: new registrations now require at least 8 characters. Existing sign-in behavior and the compatibility transform remain unchanged; this does not retroactively strengthen existing accounts.
- Existing password persistence hardening remains in this branch: no password writes/reads through `al3_p1`; legacy key is cleared during login initialization.
- Post-change static assertions passed for the password write/read removal, legacy cleanup, 8-character registration guard, and preserved sign-in path.
- Documented additional rules risks: public online fingerprints, public child reads for bans/wlist, public privilege maps, arbitrary history writes, premature ghost deletion, and authenticated deletion of active `mainN` rooms/messages.
- Runtime/browser/Emulator tests remain blocked by missing repository test setup and unavailable network/CLI. No Firebase Rules or production data changed.


## 2026-11-11 — Owner preference: preserve simple password flow
- Owner requested keeping the existing password format/behavior for easy guest/member registration and login.
- Removed the 8-character minimum guard from `js/ui/login.js`.
- Preserved `authPass(p) => p + "@al3nood"`, the existing member sign-in path, and acceptance of any non-empty user-entered password (subject to Firebase Auth's resulting password validation).
- Preserved the separate security hardening that avoids storing the plaintext password in localStorage, clears the old `al3_p1` key, and leaves the password field blank on page load.
- Immediate source-level verification: confirmed the minimum-length guard is absent, the compatibility transform remains, registration still rejects an empty password, login still uses the same transform, and legacy password persistence remains removed.
- Commit: `c047f4ca2c4db908c1213322ce4d32ce0151d1b9`.
- Not yet run: real browser registration/login, Auth Emulator, and live-page tests. This is a draft branch change, not yet available on `main`.
- Owner delivery preference recorded in `AGENTS.md`: report step-by-step, test after each isolated fix, record exact outcomes before moving on.


## 2026-11-11 — Post-change verification
- Re-fetched `js/ui/login.js`, `AGENTS.md`, `PROJECT_STATUS.md`, `docs/IMPLEMENTATION_LOG.md`, and `docs/DEEP_AUDIT_2026-11-11.md` from `docs/engineering-baseline`.
- Ran 14 targeted source assertions after removing the 8-character registration guard.
- Result: 14/14 PASS, 0 FAIL.
- Confirmed: no minimum-length guard; existing `authPass()` transformation preserved for registration and login; empty password still rejected; no plaintext password storage/restoration; legacy key cleanup remains; password field blank on page load; owner preference and per-change testing workflow recorded.
- Test class: source-level assertions only. No browser, Auth Emulator, Realtime Database Emulator, or live-page tests were run.
- The change is in the draft engineering branch, not `main`.


## 2026-11-11 — Isolated local emulator setup
- Baseline: branch `docs/engineering-baseline`, commit `d4a395e98254f2fc61e8925f09fc3b9aff85bffe`; no `firebase.json`, package manifest, or test harness was present at repository root.
- Created dedicated branch `test/isolated-emulator-preview`.
- Added `firebase.json`: local Auth (9099), Realtime Database (9000), Hosting (5000), Emulator UI (4000); database rules point to the tracked snapshot.
- Updated `js/firebase.js`: local mode is limited to localhost/127.0.0.1 and `?emu=1`; app identity/database namespace switch to `demo-myapp-local`; Auth and RTDB emulator endpoints remain local.
- Added `docs/LOCAL_TESTING.md` with the PowerShell command: `npx firebase-tools emulators:start --project demo-myapp-local --only auth,database,hosting`.
- Immediate post-change verification after re-fetching files: 8/8 source/config assertions PASS, 0 FAIL (valid JSON/config ports, rules path, demo project ID, localhost guard, local Auth/RTDB endpoints, snapshot caveat, rules file presence).
- Test class: static/source configuration checks only. Firebase CLI was not started; no browser or Auth/RTDB behavior was tested.
- Important limitation: the tracked rules file is an unverified snapshot and may not match deployed production rules.
- Online preview: not deployed. Firebase integration connection and a separate test Firebase project are still required.
- Latest implementation commit before this documentation append: `b8ab4d1e24579b509c37f660fe013f2c12e27cb1`.


## 2026-11-11 — Java version preflight for local emulators
- Branch: `test/isolated-emulator-preview`.
- Updated `run-local.ps1` to require Java 21 or newer and parse the active `java -version` output before opening Edge or invoking Firebase Emulator Suite. Missing/unreadable/older Java now produces a direct remediation message.
- Updated `docs/LOCAL_TESTING.md` to state the JDK 21+ requirement and use the launcher script in PowerShell.
- Verification: PowerShell parser accepted the complete script; targeted regex checks correctly extracted Java 17 and 21 majors. No Firebase CLI, package manager, Edge, or emulator was run; this avoids downloading dependencies and honors the user's report that their environment currently activates Java 17.
- Commit: `2ed6d810fed618f40ae6af2c7255eaab08732376` (documentation) preceded this log update; launcher commit: `857572b5414ab5d275f711052fc2d2ee2b1901f9`.
- No application code, Firebase settings/rules, deployment, production data, or PR merge changed.


## 2026-11-11 — Resilient Microsoft Edge launch
- Confirmed from the owner's PowerShell error and source review: a stale `msedge` command/alias or failed `Start-Process` could terminate `run-local.ps1` before Firebase Emulator Suite started.
- Updated the launcher to use only an existing Edge executable path and catch launch failures as warnings with the local preview URL; emulator startup continues.
- Updated `docs/LOCAL_TESTING.md` to explain this fallback.
- Verification: re-fetched current script; PowerShell parser passed and targeted source checks confirmed the Edge warning fallback and Firebase CLI exit-code handling. Did not launch Edge or emulators in this check.
- Launcher commit: `14827bb52a2c60bbabcb7a4eaad389f960c6acf9`; docs commit: `00a87e4439b83d4dec1166cdc60ff23c7d30e7cb`.
- No app code, Firebase config/rules, production data, deployment, or merge changed.
