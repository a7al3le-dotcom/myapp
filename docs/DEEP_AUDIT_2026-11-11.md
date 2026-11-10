# Deep Security and Engineering Audit — 2026-11-11

Repository: `a7al3le-dotcom/myapp`
Main commit audited: `01de78951c5f784b379d08f953e8972cdf641a57`
Rules snapshot SHA: `a405f894884d3856b75c71ac1aad9ab8e25f1994`
Engineering branch: `docs/engineering-baseline`

## Scope and method
- Inspected all 34 application HTML/CSS/JavaScript source files in the current main tree.
- Traced authentication, local/session storage, presence, device fingerprinting, permissions, direct Firebase operations, chat/private messages, rooms, images, site customization, wall, moderation, and control-panel cleanup.
- Parsed the owner-supplied 1,611-line `database.rules.json`; it contains 568 rule declarations and 443 validation declarations.
- Confirmed its root `al3` matches the client root in `js/config.js`.
- The rules snapshot's deployment status is unknown. Findings about its behavior are conditional on that snapshot matching deployed Firebase rules.

## Findings

### HIGH — Public presence exposes device fingerprints
Evidence: `al3/online/.read = true`; presence validation accepts `fp`, `f1`-`f4`, `ih`, and `fd`; `js/session.js` writes them. `js/util.js` builds `fd` from platform, device characteristics, timezone/language hashes, GPU/canvas hashes, and a persistent browser identifier.
Impact: any reader can collect live presence and link accounts/sessions to a persistent device/browser fingerprint.
Status: confirmed in supplied rules and source; deployed status unverified.
Safe next test: Emulator read as unauthenticated and ordinary authenticated users using fake presence records.

### HIGH — Public reads of individual ban records
Evidence: parent `al3/bans` read is restricted, but `al3/bans/$k/.read = true`. Ban records store `v`, `u`, `by`, and `byt`; `parseKey()` stores the raw entered IP as `v` for IP bans and device fingerprint text for device bans.
Impact: anyone who knows/derives a child key can read its record; public online fingerprint data can help derive device-ban keys. IP-ban records can disclose raw IP values.
Status: confirmed in supplied snapshot/source; deployed status unverified.
Safe next test: Emulator child read with known fake keys, parent list read, unauthenticated and normal user contexts.

### HIGH — Any authenticated user can delete active auto-room data
Evidence: `al3/rooms/$rid/.write` permits deletion when `$rid` matches `mainN`; `al3/msgs/$rid/.write` has the same authenticated deletion exception. Neither rule verifies that the room is empty. Client `delroom()` and `cleanup()` check local presence, but client checks are bypassable.
Impact: any authenticated user can remove an active auto-room and its message subtree, disrupting participants.
Status: confirmed from rules; runtime behavior not yet exercised.
Safe next test: Emulator with two fake users in an active `mainN` room; attempt room and message subtree deletion from a third ordinary account.

### HIGH — Weak passwords accepted at registration in main
Evidence: `js/ui/login.js` only rejects an empty password, while `authPass()` appends a fixed public suffix before Firebase Auth. This makes Firebase's minimum-length requirement apply to the combined value, not the user's chosen secret.
Impact: new accounts could use very short, guessable passwords.
Status: code fixed on engineering branch for new registrations (minimum 8 characters); existing accounts are not retroactively changed and still use the compatibility transform.
Safe next test: Auth Emulator registration boundary tests for 0, 1, 7, 8, and longer characters, followed by login with legacy accounts.

### MEDIUM — Public child reads of wait-list records
Evidence: `al3/wlist/$k/.read = true` while parent read is restricted.
Impact: individual allow-list entries can be read when their key is known/derived.
Status: confirmed in supplied snapshot; deployed status unverified.

### MEDIUM — Public privilege/owner metadata
Evidence: `al3/owners`, `al3/upow`, and `al3/powers` each have public read grants.
Impact: exposes owner UIDs, user-to-role assignments, and privilege definitions, supporting targeted abuse or reconnaissance.
Status: confirmed in supplied snapshot; intended public visibility not established.

### MEDIUM — Arbitrary authenticated history writes
Evidence: `al3/hist/$fp/$k/.write = "auth != null"`; client writes the current device's fingerprint history from `js/session.js`.
Impact: an authenticated user can write records under another fingerprint, potentially poisoning nickname history.
Status: confirmed in supplied snapshot; exact impact needs Emulator test.

### MEDIUM — Premature deletion of guest ghost presence
Evidence: `al3/online/$uid/.write` includes `(!newData.exists() && data.child('off').val() == true)` without comparing `offAt` to `ghostMins`.
Impact: any authenticated user can remove another user's offline/ghost presence before the configured hold expires, releasing its reserved guest name early.
Status: confirmed in supplied snapshot; deployed status unverified.

### MEDIUM — Password saved in localStorage on main
Evidence: main `js/ui/login.js` writes `p1` after login and registration and restores it into the password field.
Impact: exposure to scripts running in the same origin and to anyone with access to the browser profile.
Status: fixed in engineering branch: password writes/restoration removed and legacy key cleared. Not merged.

### LOW / CONDITIONAL — Executable site customization
Evidence: `js/site.js` executes stored `scr`, `head`, and `html`; supplied rules restrict writes to owner UIDs.
Impact: compromise of the owner account or a mismatch in deployed rules could enable site-wide stored script execution.
Status: intentional feature with high blast radius; not an unauthenticated write vulnerability based on the supplied snapshot.

### PRIVACY / DEPENDENCY — Third-party IP lookup
Evidence: `js/util.js` calls multiple external IP/country lookup services.
Impact: IP address is disclosed to whichever external lookup provider receives the request; availability and privacy depend on third parties.
Status: confirmed client behavior; policy/consent requirements not assessed.

## Work completed on engineering branch
1. Removed member-password writes to localStorage.
2. Removed password restoration from the legacy localStorage key.
3. Clear the legacy key on login initialization.
4. Require 8 characters for new registrations while retaining the existing sign-in transform for backward compatibility.
5. Added current agent instructions, project status, security baseline, and this audit report.
6. Added the owner-supplied rules snapshot unmodified for review; it was not deployed.

## Tests and verification

### Static checks
- 21/21 pre-change source assertions passed.
- 19/19 post-change assertions passed after correcting one test-harness regex-escaping assertion (the existing YouTube ID validation was valid).
- Verified the main branch still contained the old password persistence behavior.
- Verified the engineering branch no longer writes or restores the password and clears the legacy key.
- Verified the new registration minimum guard exists and sign-in compatibility remains.
- Verified rules JSON parses and the `al3` root matches the current client.
- Verified the presence/ban/wlist/history/room permission expressions described above.
- Verified message text is escaped before HTML rendering and YouTube IDs are restricted to 11 URL-safe characters before interpolation.

### Not run
- No real browser tests.
- No Firebase Auth Emulator tests.
- No Firebase Realtime Database Rules Emulator tests.
- No production rules comparison or deployment verification.
- No production data access, writes, or destructive tests.

Reason: main has no `firebase.json`, `package.json`, or test suite; Firebase CLI is absent in the execution environment; GitHub clone/network access failed because DNS resolution was unavailable. Node is present, but repository files could not be materialized into the runtime for syntax or browser testing.

## Release decision
**Do not merge or deploy the rules snapshot or security-rule changes yet.** First create an isolated Emulator harness and reproduce the permission behaviors above. Password hardening can be considered for merge after browser/Auth Emulator regression tests verify login, registration, and legacy-account compatibility.
