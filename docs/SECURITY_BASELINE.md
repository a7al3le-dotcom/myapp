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
