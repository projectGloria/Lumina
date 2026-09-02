# Repository Guidelines

## Project Structure & Module Organization

Lumina is an Electron note app built with React and TypeScript. Keep process-specific code separated:

- `src/main/`: Electron lifecycle, IPC, vault access, indexing, and OS integrations.
- `src/preload/`: the typed, minimal bridge exposed to the renderer.
- `src/renderer/src/`: React UI, Zustand stores, CodeMirror editor extensions, and CSS under `styles/`.
- `src/shared/`: types, IPC channels, parsers, and process-neutral logic.
- `tests/`: Node-based Vitest tests named `*.test.ts`.
- `resources/`: packaged icons; `scripts/`: release verification utilities.

Generated output belongs in `out/` or `release/` and must not be committed.

## Build, Test, and Development Commands

Install locked dependencies with `npm ci`. Common commands are:

- `npm run dev`: start Electron with Vite hot reload.
- `npm run typecheck`: validate Node/Electron and renderer TypeScript projects.
- `npm test`: run the complete Vitest suite once.
- `npm run test:watch`: rerun affected tests during development.
- `npm run build`: create unpackaged production bundles in `out/`.
- `npm run build:win`: produce Windows artifacts; `npm run release` also verifies them.

Before submitting, run `npm run typecheck && npm test && npm run build`.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, single quotes, no semicolons, and trailing commas in multiline constructs. Strict TypeScript rejects unused locals. Use `PascalCase` for React components and exported types, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for constants. Prefer the configured `@/` and `@shared/` aliases. Keep IPC names in `src/shared/channels.ts` and expose renderer capabilities through preload rather than importing Electron APIs into UI code.

No formatter or linter is configured, so preserve nearby formatting and rely on typechecking.

## Testing Guidelines

Vitest runs in the Node environment and discovers `tests/**/*.test.ts`. Add focused tests for shared utilities, path safety, parsing, and main-process behavior. Name suites after the unit and cases by observable behavior. Use temporary directories for filesystem tests and always clean them in `finally` blocks. No coverage threshold is configured; prioritize regressions and boundary cases.

## Commit & Pull Request Guidelines

The short Git history does not establish a reliable convention. Use concise, imperative commits such as `Add quick-note shortcut handling`, and keep unrelated changes separate. Pull requests should explain the user-visible effect, list verification commands, link relevant issues, and include screenshots or a short recording for renderer changes. Call out IPC, persistence, security, or packaging impacts explicitly.
