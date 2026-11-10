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
