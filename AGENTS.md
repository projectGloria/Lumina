# Repository Guidelines

## Project Structure & Module Organization
Lumina is a local-first Electron note app using React, CodeMirror, and Zustand.
- `src/main/`: Electron lifecycle, vault filesystem access, IPC handlers, search, music, and speech services.
- `src/preload/`: renderer-facing bridge and API declarations.
- `src/renderer/src/`: React UI, `editor/`, Zustand `store/`, and `styles/`.
- `src/shared/`: shared types, IPC channels, and reusable logic.
- `extension/`: standalone browser web clipper; see its README for installation.
- `resources/`: application icons and optional speech packs; `scripts/` contains packaging utilities.
- `out/` and `release/`: generated build and packaging output; do not commit them.

## Build, Test, and Development Commands
- `npm ci`: install dependencies from the lockfile.
- `npm run dev`: launch Electron with development updates.
- `npm run typecheck`: check main/preload and renderer TypeScript projects.
- `npm test` / `npm run test:watch`: run Vitest once or in watch mode.
- `npm run build`: compile the application into `out/`.
- `npm start`: preview the compiled application.
- `npm run build:dir`: create an unpacked application.
- `npm run build:win`: build Windows installer and portable artifacts.
- `npm run release`: build Windows artifacts and verify signatures, metadata, and package contents using PowerShell.

## Coding Style & Naming Conventions
Follow existing TypeScript: two-space indentation, single quotes, and no statement-ending semicolons. Use PascalCase for React components and types, camelCase for functions and variables, and descriptive module names such as `musicStore.ts`. TypeScript strict mode is enabled; no formatter or linter is configured. Use `@shared/*` across application layers and `@/*` for renderer imports. Keep filesystem operations in main-process services and expose capabilities through the preload bridge.

## Testing Guidelines
Vitest uses the Node environment and discovers `tests/**/*.test.ts`. Quick Note tests cover cache persistence, destination configuration, and note creation; no coverage threshold is configured. Add focused regression tests for changed logic, especially shared helpers and path handling. Before submitting, run typechecking, relevant tests, and a build; manually verify affected Electron UI flows using a disposable vault.

## Commit & Pull Request Guidelines
History uses descriptive subjects, sometimes prefixed by an area such as `Home:` or `Icon:`, alongside uninformative `V` commits. Prefer descriptive, imperative subjects explaining the change. For PRs, describe behavior and rationale, link relevant issues, report validation, and include screenshots for visual changes.

## Configuration & User Data
Keep personal vaults, clipper tokens, and downloaded speech binaries out of commits. Use ignored `test-vault/` for manual fixtures; speech packs belong in ignored `resources/speech/`.
