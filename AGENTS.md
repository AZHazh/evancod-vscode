# Repository Guidelines

## Project Structure & Module Organization

Evancod is split into two TypeScript applications. The VS Code extension host lives in `src/`; `extension.ts` is its entry point, `core/` contains the query engine and built-in tools, `services/` coordinates features, and `adapters/` isolates storage, configuration, and file-system access. The Vue 3 webview is a separate Vite project under `webview/`, with UI code in `webview/src/components`, state in `webview/src/stores`, and shared styles in `webview/src/styles`. Static extension assets belong in `resources/`, while design and implementation notes belong in `docs/` or `src/docs/`. Treat `out/`, `webview/dist/`, and packaged `.vsix` files as generated artifacts.

## Build, Test, and Development Commands

- `npm install` installs extension dependencies; run `npm run install:webview` for webview dependencies.
- `npm run watch` continuously compiles the extension. In another terminal, run `npm run dev:webview`, then press `F5` in VS Code to launch the Extension Development Host.
- `npm run compile` type-checks and emits extension code to `out/`.
- `npm run build:webview` installs dependencies and creates the production webview bundle.
- `npm run lint` checks TypeScript under `src/`; `npm test` runs the configured VS Code test runner after compilation and linting.
- `npm run vscode:prepublish` builds both application halves; `npm run package` produces a `.vsix`.

## Coding Style & Naming Conventions

Use TypeScript strict mode and the configured aliases (`@/*`). Prettier requires two-space indentation, single quotes, no semicolons, trailing commas where ES5 permits, and a 100-column width. Run ESLint before submitting. Name classes, Vue components, and exported types in `PascalCase`; use `camelCase` for functions, variables, composables, and Pinia stores. Keep tool implementations grouped by capability under `src/core/tools/<area>/`.

## Testing Guidelines

Place extension unit tests beside their module in `__tests__/` and name them `*.test.ts`, following `src/adapters/__tests__/FileSystemAdapter.test.ts`. Use isolated mocks for VS Code, storage, network, and file-system behavior. No enforced coverage threshold is configured; add focused regression tests for changed logic and manually verify webview changes through the `F5` development flow.

## Commit & Pull Request Guidelines

Recent commits use Conventional Commit prefixes, especially `feat:` (for example, `feat: 新增生图功能`). Prefer `feat:`, `fix:`, `refactor:`, or `docs:` followed by a concise imperative summary. Pull requests should explain the behavior change, list verification commands, link related issues, and include screenshots or recordings for webview changes. Keep generated bundles and unrelated formatting changes out of the diff.

## Security & Configuration

Never commit API keys, provider tokens, or local `.claude`/`.evancod` state. Store secrets through VS Code `SecretStorage`, keep provider-specific logic in the extension host, and review webview CSP changes carefully.
