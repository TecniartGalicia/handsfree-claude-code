# Contributing

Thanks for helping. This project is small on purpose; keep it that way.

## Ground rules
- The extension must never intercept permissions at runtime (no hooks, no clicking, no typing). Fixes go through Claude Code's own settings or nowhere.
- Nothing runs at startup. Commands only.
- Every user-facing string goes through `vscode.l10n.t` (or `t()` in `src/core/findings.ts`) and gets a Spanish entry in `l10n/bundle.l10n.es.json`. `node scripts/l10n-sync.mjs` reports missing/orphan keys; the unit tests fail on both.
- Pure logic lives in `src/core/` (no `vscode` import) and is unit-tested with real-world fixtures in `src/test/fixtures/`.

## Dev loop
```bash
npm install
npm run check            # typecheck + lint + unit tests
npm run test:integration # downloads VS Code once, runs hermetic tests
npm run build            # dist/extension.js
npm run package          # .vsix
```
Press F5 in VS Code to launch an Extension Development Host.

## Adding a Doctor check
1. Add the observation to `DoctorInput` (collected in `src/doctor/doctor.ts`).
2. Emit a `Finding` in `src/core/findings.ts` with a stable `id`, a severity that matches reality (an `error` must mean "Claude will ask because of this"), and a `fix` only when it is safe and reversible.
3. Add a fixture + test in `src/test/unit/findings.test.ts`, and translations.

## Releasing
Tag `vX.Y.Z` on `main`; CI packages and publishes to the Marketplace and Open VSX (see `.github/workflows/release.yml`). Update `CHANGELOG.md` first.
