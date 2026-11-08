AGENTS.md — Al3nood Chat Project
1. Project Identity

Project name: Al3nood Chat
Local project directory: al3nood-chat
Original reference website: https://www.al3nood.net/

The reference website belongs to the project owner, who has administrator access.

The main objective is to reproduce the original website as faithfully as possible, including:

Design and visual appearance.
HTML structure and CSS styling.
JavaScript behavior.
Chat rooms and private messaging.
User accounts and profiles.
User permissions and administration.
Control panel and administrative tools.
Wall, posts, reactions, and images.
Notifications and online presence.
All other existing features.

The original website is the primary reference for functionality and appearance.

Do not invent features or change the original behavior without approval.

2. Mandatory Next.js Documentation

IMPORTANT: This project uses a specific installed Next.js version.

This is NOT necessarily the same Next.js version found in general training examples.

Before writing or modifying any Next.js code:

Read the documentation index: node_modules/next/dist/docs/index.md
Identify the relevant documentation inside: node_modules/next/dist/docs/01-app/ node_modules/next/dist/docs/02-pages/ node_modules/next/dist/docs/03-architecture/
Read the documentation relevant to the exact task.
Follow the installed Next.js version and its supported APIs.
Never assume that APIs, conventions, configuration options, or file structures from other Next.js versions are valid here.
Do not download or install another Next.js version to obtain documentation.
Do not modify or remove the automatically generated Next.js instructions between: BEGIN:nextjs-agent-rules END:nextjs-agent-rules
3. Project Inspection Before Work

Before starting a new task:

Read this AGENTS.md file.
Read PROJECT_STATUS.md if it exists.
Inspect the current Git branch.
Run git status.
Inspect existing files related to the requested task.
Review previous implementation and documented decisions.
Reuse existing solutions whenever possible.

Do not repeat research that has already been completed and documented unless the code or reference website has materially changed.

Do not assume that a previously planned task has actually been implemented. Verify the code and tests.

4. Original Website Reference

Reference: https://www.al3nood.net/

The owner has administrator privileges and controls the authenticated browser session.

When inspecting the reference website:

Use the available authenticated browser session.
Prefer Microsoft Edge if that is the browser already connected to the owner's session.
Do not repeatedly ask the owner to log in if an authenticated session is already available.
Inspect the actual pages, interface, controls, and behaviors.
Compare the original website against the local implementation.
Document findings in PROJECT_STATUS.md.
Record incomplete or inaccessible features instead of guessing.

The owner controls all interactions with the live website.

Never perform administrative actions, send messages, create accounts, delete content, or modify settings on the live website without explicit approval.

Never request or store the owner's password.

5. Preserve the Original Frontend

The original frontend is extremely important.

Rules:

Preserve original HTML, CSS, JavaScript, and visual behavior.
Do not rewrite the frontend from scratch.
Do not replace original scripts with simplified implementations.
Do not rename existing functions or variables without understanding their dependencies.
Do not remove existing features because they appear unused.
Do not change the visual design without a verified reason.
Preserve Arabic RTL layout.
Preserve responsive behavior across desktop and mobile.
Preserve original navigation and interactions.
Keep the original client behavior whenever possible.

Preferred implementation strategy:

Keep the original frontend and build the compatible backend around it.

Only modify frontend code when required for compatibility, security, or a specifically approved improvement.

Document every necessary frontend change.

6. Git and Backup Rules

Git is mandatory for project safety.

Never work directly on master or main.
Create a separate branch for each development phase.
Preserve existing commits and changes.
Never run destructive Git commands without explicit approval.
Never use git reset --hard.
Never delete uncommitted work.
Never overwrite existing user changes.
Review git diff before committing.
Keep backup branches intact.

Current known backup branch: backup/pre-tooling

Current development branch: tooling-setup

Verify the actual branch before relying on these names.

7. Firebase Architecture and Safety

The project uses Firebase.

Development and testing must be isolated from production.

Use local Firebase Emulators for development.

Required principles:

Use demo project identifiers.
Use fake test accounts.
Use local authentication emulation.
Use local Realtime Database emulation.
Use Firestore Emulator when required.
Use Storage Emulator when required.
Never write test data to production.
Never delete production data.
Never modify production security rules without approval.
Never expose Firebase secrets or private credentials.
Never assume that a local emulator is active without checking its actual status.

Before every automated test, verify that Firebase requests are directed to the local emulator.

If emulator isolation cannot be verified, stop the test.

Do not silently fall back to production Firebase.

8. Firebase Free Plan Restrictions

The project owner has chosen to avoid paid services and billing requirements.

Current preference:

Firebase Spark free plan.
No Blaze migration.
No billing account.
No paid external hosting.
No paid TURN services.
No paid LiveKit services.

Respect the actual Firebase quotas and current official documentation.

Do not promise unlimited users or unlimited traffic.

Measure Realtime Database downloads and concurrent connections during load testing.

Optimize subscriptions to reduce unnecessary data transfers.

Avoid subscribing every client to large database branches when only a small portion of the data is needed.

Do not migrate images to Firebase Storage without explicit approval.

Keep the existing Base64 image architecture temporarily until an approved migration plan exists.

9. WebSocket and Socket.IO Compatibility

The existing project contains a client-side compatibility layer.

Understand its implementation before changing it.

Important principles:

Preserve existing Socket.IO and Engine.IO compatibility.
Preserve existing command names.
Preserve existing event structures.
Preserve message payload compatibility.
Preserve incoming and outgoing event behavior.
Preserve room membership behavior.
Preserve private messaging.
Preserve presence and disconnect behavior.
Preserve permissions and administrative commands.

Do not introduce a new WebSocket server unless explicitly approved.

Do not replace the existing protocol with a different protocol.

Document every discovered command and event in a protocol reference document.

Distinguish verified commands from commands inferred from source code.

10. Testing Requirements

Use local testing only.

Available tools include:

Playwright.
Chromium.
Firebase Auth Emulator.
Firebase Realtime Database Emulator.
Firebase Firestore Emulator when needed.
Firebase Storage Emulator when needed.
TypeScript.
ESLint.

Testing must cover:

Registration.
Login and logout.
Guest access.
User profiles.
Room creation and joining.
Room messages.
Private messages.
Online presence.
Disconnect handling.
Wall posts.
Reactions.
Images.
Permissions.
Administrative commands.
Control panel navigation.

Use multiple independent browser contexts to test multiple users.

Use fake data only.

Do not send test messages to real users.

Do not use real accounts for automated tests.

Report actual test results, not assumed results.

11. Playwright Browser Inspection

When using Playwright:

Inspect the original website only through the owner's authorized session.
Do not intercept or modify live user actions.
Do not inject commands into the original website.
Do not collect passwords, cookies, authentication tokens, or private messages.
Do not save sensitive network payloads.
Use passive inspection where possible.
Use fake accounts for local testing.
Store temporary test artifacts outside the project directory.
Delete temporary artifacts when no longer needed.
12. Image Handling

Current image storage uses the existing database architecture.

Do not change the database schema without approval.

Image improvements may include:

WebP conversion.
Image compression.
Image size limits.
Lazy loading.
Browser caching.
Image replacement.
Image deletion where supported by existing permissions.

Maintain backward compatibility with existing image references.

Do not migrate existing images automatically.

Do not delete old images without a separately approved migration and cleanup process.

13. Control Panel and Permissions

The administrative interface must be reproduced faithfully.

Inspect and document:

User management.
User roles.
Permission levels.
Room administration.
Bans and kicks.
Reports.
Filters.
Device information.
IP-related features.
Administrative logs.
Site configuration.
Moderation controls.

Do not assume that a button is secure merely because it is hidden in the interface.

Verify authorization against the backend rules.

Do not weaken existing security rules to make a feature work.

14. Deferred Features

The following features are outside the current implementation scope unless explicitly approved:

LiveKit.
TURN servers.
Full voice and video calling.
Automated bots.
Paid external services.
Production database migrations.
Firebase Storage migration.
GitHub Pages deployment.
New hosting providers.

Keep deferred features documented without implementing them.

15. GitHub and Hosting

The current preference is to use GitHub for source-code storage and version control.

Do not create accounts on additional hosting platforms.

Do not deploy the application without approval.

GitHub Pages is static hosting and cannot directly execute a custom Node.js or WebSocket server.

Before considering static export:

Inspect all dynamic routes.
Inspect Route Handlers.
Inspect image delivery.
Inspect absolute paths.
Test the actual production build.
Verify compatibility with the required Firebase architecture.

Do not change next.config.ts for static export without approval.

16. Persistent Project Documentation

Maintain these project documents:

PROJECT_STATUS.md

Current project state.
Completed work.
Pending tasks.
Active development phase.
Latest Git branch.
Test results.
Known problems.
Next recommended step.

docs/REFERENCE_ANALYSIS.md

Original website structure.
Page layouts.
Visual design.
Feature behavior.
Reference screenshots where appropriate.
Differences between original and local versions.

docs/WEBSOCKET_PROTOCOL.md

WebSocket commands.
Incoming events.
Outgoing events.
Payload structures.
Connection lifecycle.
Verified protocol details.

docs/FIREBASE_SCHEMA.md

Database paths.
Data structures.
Security rules.
Emulator configuration.
Database relationships.

docs/IMPLEMENTATION_LOG.md

Changes made.
Files modified.
Reasons for changes.
Tests performed.
Results.

Create the docs directory if it does not exist.

Update documentation after each completed phase.

Do not claim that a feature is complete unless its implementation has been verified.

17. Development Workflow

Work in small, controlled phases.

For each phase:

Review existing implementation.
Review applicable Next.js documentation.
Identify required changes.
Explain the intended scope.
Preserve existing behavior.
Implement only the approved changes.
Run TypeScript checks.
Run ESLint.
Run relevant automated tests.
Inspect Git diff.
Update PROJECT_STATUS.md.
Report completed work and remaining issues.

Do not combine unrelated changes into one phase.

Do not silently expand the scope.

18. Approval Requirements

Explicit approval is required before:

Modifying production Firebase.
Changing database schemas.
Changing security rules.
Migrating images.
Rewriting the frontend.
Introducing a new backend architecture.
Introducing paid services.
Deploying to a live environment.
Performing destructive operations.
Modifying the original live website.

Routine local development and approved tests may proceed without repeatedly asking for permission.

19. Communication and Reporting

Communicate clearly and accurately.

After each phase, report:

What was completed.
Which files changed.
What was tested.
Actual test results.
Remaining issues.
Any decisions required from the owner.

Do not claim success without verification.

Do not repeat previous research unnecessarily.

Use Arabic when communicating with the project owner.

Keep technical identifiers, filenames, commands, and code in their original form.

20. Final Project Objective

Build a faithful and fully functional local implementation of Al3nood Chat.

Preserve the original frontend and user experience.

Implement compatible backend functionality.

Maintain Firebase security and free-plan awareness.

Ensure local development is isolated from production.

Keep the project documented and recoverable across development sessions.

The original Al3nood website remains the source of truth.

The project owner's explicit decisions take priority over assumptions or recommendations.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
