# Implementation Log

## 2026-11-11 — Password persistence hardening
- Branch: `fix/remove-password-localstorage`
- Commit: `21cea4ed3e6209811cf391a634b27c4d9daa5f9b`
- Changed: `js/ui/login.js`
- Removed local-storage password writes after member login and registration.
- Removed automatic password-field restoration from `al3_p1`.
- Added cleanup of the legacy `al3_p1` key at login initialization.
- Verification: static assertions passed; no password-key writes or reads remain in the edited login module.
- Not yet verified: browser login/registration regression, Firebase Emulator behavior, and production rules compatibility.
- No merge, deployment, or production database operation performed.
