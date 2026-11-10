# Security Baseline

## Trust boundaries
The browser client is untrusted. All authorization for direct Firebase Realtime Database operations must be enforced by deployed Security Rules. UI visibility and JavaScript role checks are usability controls only.

## Rules evidence
- The current main branch does not contain `database.rules.json`.
- A 1,611-line owner-supplied rules file was recovered from the Library. Its root is `al3` and it matches the current client root.
- The file is tracked unmodified on the engineering branch, but its deployment status has not been confirmed.
- Do not deploy the older, different-schema rules file found in Git history.

## Confirmed risks in the supplied rules snapshot (conditional on deployment)
1. **Public online presence read:** `al3/online/.read = true`. Each online record validates `fp`, `f1`-`f4`, `ih`, and `fd`; `js/session.js` writes those identifiers into the same public records. This exposes linkable device/IP-derived identifiers to unauthenticated readers.
2. **Public ban-record read:** `al3/bans/$k/.read = true`, even though the parent `al3/bans/.read` is restricted. A child-level allow grants read access to individual records. The client stores the displayed identifier in `v`, which is the raw input for IP bans.
3. **History write scope:** `al3/hist/$fp/$k/.write = "auth != null"` permits any authenticated account to write under any fingerprint path. Verify impact and expected semantics in an Emulator.
4. **Executable site customization:** `js/site.js` executes stored custom head markup, HTML, and script content. The supplied rules snapshot restricts `sitecode` and `domcode` writes to owner UIDs; preserve this boundary and confirm the deployed rules match.

## Other sensitive surfaces
- Authentication and credential lifecycle: `js/ui/login.js`, `js/firebase.js`.
- Central direct-write API: `js/api/actions.js` (`BACKEND = "rules"`).
- Presence and sensitive identifiers: `js/session.js`, `js/util.js`, `al3/online`, `al3/uprv`, `al3/fps`, `al3/hist`.
- Maintenance/deletion: `cleanup()` and `wipe()` in `js/api/actions.js`.
- Image data: `js/api/images.js`, `al3/pics`, `al3/picidx`.

## Review rules
- Never test destructive or privileged actions against production.
- Never log raw IPs, fingerprints, passwords, tokens, or private messages in reports.
- Validate authorization with Emulator tests using fake users and fake data.
- Do not reduce access to online/bans until guest login, public presence, and own-ban checking have been tested against the intended behavior.
- Treat custom HTML/script execution as an intentional owner-only feature; verify the write boundary before changing behavior.
- For every finding, record exact file/path, evidence, impact, safe reproduction, severity, and whether it is confirmed or pending verification.


## Deep audit findings — 2026-11-11 (supplied rules snapshot; deployment unverified)

### High
1. **Public presence/fingerprint disclosure:** `al3/online/.read = true`. Presence records validate and the client writes `fp`, `f1`-`f4`, `ih`, and `fd`. The latter contains the assembled browser/device fingerprint. Anyone can read all live presence records.
2. **Public child reads for bans:** `al3/bans/$k/.read = true` overrides the restricted parent rule for known child keys. Ban records store `v`, `u`, and moderator metadata; `v` can be a raw IP for IP bans or a device fingerprint for device bans. Public online data can make some device-ban keys derivable.
3. **Active auto-room deletion:** `al3/rooms/$rid` and `al3/msgs/$rid` allow any authenticated account to delete a room matching `mainN`, without a rule-side occupancy check. The client has a local emptiness check, but it is bypassable.
4. **Weak new-account passwords in main:** registration only rejected empty passwords while `authPass` appended a fixed public suffix before Firebase Auth. This effectively bypassed Firebase's minimum-length check for the user's chosen secret. The engineering branch now requires 8 characters for new registrations; existing login compatibility remains unchanged.

### Medium
5. **Public waitlist child reads:** `al3/wlist/$k/.read = true` permits public access to individual known allow-list records.
6. **Public privilege map:** `al3/owners`, `al3/upow`, and `al3/powers` have public reads, exposing owner UIDs, user-to-power assignments, and permission definitions.
7. **Unbound history writes:** `al3/hist/$fp/$k/.write = "auth != null"` lets any authenticated account write history under another device fingerprint.
8. **Premature ghost deletion:** `al3/online/$uid` permits any authenticated account to delete a record whenever `off == true`, without checking `offAt` against `ghostMins`. This can release another user's reserved guest name early.
9. **Password persistence on main:** current `main` still writes passwords to `al3_p1` and restores the field. The engineering branch removes these writes/reads and clears the legacy key; not merged.

### Lower / intentional but sensitive
10. **Executable owner customization:** `js/site.js` injects and executes stored `scr`, `head`, and `html`. The supplied rules snapshot restricts writes to owner UIDs, so this is an owner-only capability rather than an independently confirmed unauthenticated write. It creates a site-wide stored-XSS blast radius if the owner account or its write boundary is compromised.
11. **Third-party IP lookup:** the client requests public IP/country information from multiple external lookup providers. This is a privacy/third-party dependency consideration, not proof of data theft.

## Static checks and limitations
- Rules JSON parsed successfully; root is `al3`.
- 568 rule declarations and 443 validation declarations were traversed.
- 21/21 pre-change source assertions passed.
- 19/19 post-change assertions passed after correcting the test harness's escaped regex literal; the YouTube ID validator was already correctly constrained to 11 URL-safe characters.
- `fmt()` escapes user text before HTML rendering; message YouTube IDs are validated before interpolation.
- Main has no `firebase.json`, `package.json`, or automated test files. The Firebase client contains a localhost-only emulator connection hook, but no reproducible emulator setup is committed.
- No real browser tests, Firebase Rules Emulator tests, Auth Emulator tests, or production deployment checks were performed. Git clone failed because the execution environment could not resolve GitHub; Firebase CLI is absent.
- Do not treat these rules findings as proof of the deployed production rules until the exact deployed rules are independently confirmed.

## Remediation order
1. Build an isolated Firebase Emulator test environment and establish test accounts/data.
2. Test anonymous/member registration/login, reconnect, guest-name reservation, ban/allow precedence, active/empty auto rooms, room messages, private messages, and admin actions against the supplied rules.
3. Design a compatible private-data split for presence fingerprints, bans, and wait-list records; preserve the fields needed for ban enforcement without public reads.
4. Bind history writes to the authenticated user's current fingerprint.
5. Remove broad deletion paths for active auto rooms and non-expired ghosts through a server-trusted cleanup/occupancy design.
6. Review public privilege metadata and site-code exposure.
7. Merge the isolated login hardening only after browser and Auth Emulator regression tests pass.
