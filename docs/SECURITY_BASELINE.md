# Security Baseline

## Trust boundaries
The browser client is untrusted. All authorization for direct Firebase Realtime Database operations must be enforced by deployed Security Rules. UI visibility and JavaScript role checks are usability controls only.

## Current known high-risk surfaces
- Authentication and credential lifecycle: `js/ui/login.js`, `js/firebase.js`.
- Central direct-write API: `js/api/actions.js` (`BACKEND = "rules"`).
- Site customization and executable content: `js/site.js`, `al3/sitecode`, `al3/domcode`.
- Presence and sensitive identifiers: `js/session.js`, `js/util.js`, `al3/online`, `al3/uprv`, `al3/fps`, `al3/hist`.
- Maintenance/deletion: `cleanup()` and `wipe()` in `js/api/actions.js`.
- Image data: `js/api/images.js`, `al3/pics`, `al3/picidx`.

## Current evidence limitation
The latest inspected `main` tree does not contain the current Realtime Database Rules. The older rules file in repository history belongs to a different schema and must not be deployed or treated as current. Until the deployed rules for `mychat-2d881` are verified, authorization findings for these paths remain unverified.

## Review rules
- Never test destructive or privileged actions against production.
- Never log raw IPs, fingerprints, passwords, tokens, or private messages in reports.
- Validate authorization with Emulator tests using fake users and fake data.
- Treat custom HTML/script execution as an intentional but privileged feature; verify the server-side write boundary before changing behavior.
- For every finding, record exact file/path, evidence, impact, safe reproduction, severity, and whether it is confirmed or pending verification.
