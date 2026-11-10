# Engineering Agent Rules — myapp

## Mission
Maintain and complete the existing Al3nood Chat application faithfully. Treat this repository as an existing production-oriented project, not a greenfield rewrite. Preserve the Arabic RTL interface, existing behavior, database paths, protocol compatibility, and user data.

## Mandatory operating prompt
Before every engineering task, apply this instruction to yourself:

> Act as the responsible senior engineer for this repository. Inspect the current branch, latest commit, working changes, project instructions, status log, and all relevant source files before acting. Trace each affected feature end-to-end across UI, state, Firebase Auth, Realtime Database operations, and Security Rules. Separate confirmed defects from risks that require runtime or rules verification. Make the smallest safe change that solves the verified problem. Never invent APIs, schemas, rules, tests, or successful results. Work on a dedicated branch, preserve all existing work, review the complete diff, run available checks, and record exact results. Never modify production data, deploy, publish Firebase Rules, or perform destructive operations without explicit owner approval. Continue to the next independently actionable task only when its dependencies and safety conditions are satisfied. Report what changed, what was tested, what remains blocked, and the exact commit/branch.

This is an execution instruction, not a substitute for inspecting and changing the actual project.

## Project identity and current architecture
- Repository: https://github.com/a7al3le-dotcom/myapp
- Default branch: `main`
- Current application in the latest inspected main commit: static HTML/CSS and JavaScript ES modules.
- Firebase SDK: 10.12.2, loaded from Google's CDN.
- Firebase services used by the client: Authentication and Realtime Database.
- Current configured Realtime Database root: `al3`.
- Main entry points: `index.html`, `cp.html`, `js/main.js`, `js/cp.js`.
- Do not assume the previous Next.js application or its deployment configuration still exists. The repository history contains a major replacement commit.

## Inspection requirements
1. Read this file and `PROJECT_STATUS.md` before starting.
2. Inspect the actual current branch and commit; do not rely on old branch names or summaries.
3. Read all affected files and their callers/callees. Search for related reads, writes, listeners, event names, and UI flows.
4. For Firebase operations, map every path to the current deployed Security Rules. A client-side permission check is never a security boundary.
5. Verify whether the Firebase project and database root match the current code before proposing schema or rules changes.
6. Do not assume a feature is complete because a button or handler exists.

## Preservation requirements
- Preserve the current frontend and original visual/behavioral compatibility.
- Preserve Arabic RTL and responsive behavior.
- Do not rewrite the application or remove existing features as a shortcut.
- Do not rename paths, fields, event names, functions, or payload shapes without a verified migration plan.
- Do not alter image storage architecture or database schema without explicit approval.
- Keep existing Base64/database image compatibility unless the owner approves a migration.
- Do not introduce paid services, Blaze billing, external hosting, TURN, LiveKit, or a new backend without approval.

## Security and production safety
- The client currently selects `BACKEND = "rules"`; Firebase Realtime Database Security Rules are therefore the actual authorization boundary for direct client writes.
- Never infer authorization from hidden buttons, `S.owner`, client-side role checks, or comments.
- Never create or publish replacement production rules from an old rules file. Rules must match the current `al3` schema and be tested in an isolated Emulator first.
- Never silently fall back to production during tests. Confirm emulator connection before any write-capable test.
- Use fake accounts and fake data only.
- Do not read, dump, or expose production user data, passwords, tokens, private messages, IP addresses, or device fingerprints.
- Treat IP/device fingerprint data as sensitive. Minimize collection and retention; never put raw values in reports.
- Treat stored site HTML, head markup, and scripts as executable code. Preserve intentional owner functionality, but verify authorization at the Rules/backend boundary.
- Review cleanup, wipe, ban, moderation, and administrative operations for authorization and blast radius.
- Never deploy, change production Firebase settings/rules, delete production data, or run destructive maintenance without explicit approval.

## Git workflow
- Never commit directly to `main`.
- Use a dedicated descriptive branch for each development phase.
- Inspect the branch head before writing and use the current blob SHA when updating files.
- Do not force-push, reset, delete branches, or overwrite user changes.
- Keep changes small and review the complete diff before considering a phase complete.
- Do not merge or deploy without owner approval.

## Testing
- Run only checks supported by the repository's actual tooling.
- Do not claim a test passed unless it was actually executed.
- For syntax checks, use a real JavaScript parser/runtime where available.
- For Firebase behavior, use Auth and Realtime Database Emulators with confirmed isolation.
- Cover guest login, member login, registration, logout, session resume, room messages, private messages, presence/disconnect, images, permissions, admin actions, and control-panel navigation as relevant.
- If no package manifest, emulator configuration, or test harness exists, document the limitation and create a safe test plan instead of inventing a test command.

## Completion and reporting
After each phase:
- State the defect and evidence.
- List changed files and commit/branch.
- State exact checks performed and their results.
- Distinguish confirmed vulnerabilities, potential risks, and unverified assumptions.
- Update `PROJECT_STATUS.md` and `docs/IMPLEMENTATION_LOG.md` when project state changes.
- List blockers and the next concrete engineering task.
- Communicate with the owner in Arabic; retain filenames, identifiers, and commands verbatim.
