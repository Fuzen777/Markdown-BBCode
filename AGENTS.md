# BBCode Editor

## Scope

Portable Windows app built with Tauri 2, Rust, vanilla JavaScript, and SCEditor 3. Read DESIGN.md before changing user-facing behaviour. Nexus mod descriptions are the current target; Steam is deferred.

## Development

Run `npm install`, then `npm run tauri dev`. Use `npm run portable` for the Windows x64 portable folder under `release`. WebView2 is required. Keep frontend packages and Rust dependencies locked.

## Safety And Persistence

Never silently discard unknown BBCode or overwrite external changes. Keep original source unchanged until an actual edit. Recovery snapshots and settings belong beside the executable. Only local UI has Tauri capabilities; remote images must not receive filesystem or IPC access.

## Validation

Run `npm test`, `npm run test:ui`, `npm run lint`, `npm run build`, and Rust tests and Clippy. Keep tests focused on round trips and persistence failure cases. Do not commit generated builds, dependency folders, or user recovery data.

## Documentation

Keep DESIGN.md, FEATURES.md, and CHANGELOG.md aligned with implemented behaviour. This project shares the parent repository; stage and commit only this project's files.
