# Local test environment

This branch adds a local-only Firebase Emulator setup. It is intentionally configured with the demo project ID `demo-myapp-local`; it must not be run against the production Firebase project.

## Requirements

- Node.js (LTS)
- Java runtime supported by the Firebase Database Emulator
- Internet access for the first Firebase CLI download

## Start the local test environment (PowerShell)

```powershell
git clone --branch test/isolated-emulator-preview --single-branch https://github.com/a7al3le-dotcom/myapp.git myapp-emulator
cd myapp-emulator
npx firebase-tools emulators:start --project demo-myapp-local --only auth,database,hosting
```

Open the local Hosting Emulator at:

`http://127.0.0.1:5000/?emu=1`

The Emulator UI is at `http://127.0.0.1:4000`.

## Isolation rules

- Use only the `demo-myapp-local` project ID with the Emulator Suite.
- The page must show/use the emulator endpoints before any write-capable test.
- Do not remove `?emu=1` when testing.
- Do not run `firebase deploy`, `firebase database:set`, or any production command.
- Use fake accounts and fake content only.
- The tracked `database.rules.json` is a repository snapshot; its match with currently deployed production rules has not been verified. Emulator behavior using this file is not proof of deployed production behavior.
- Stop the emulators with Ctrl+C.

## What this setup does not prove

Starting the emulators and loading the page does not itself verify the complete login, registration, room, private-message, presence, image, or moderation flows. Those require explicit browser test cases and recorded results.
