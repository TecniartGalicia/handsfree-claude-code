# Changelog

All notable changes to this extension are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-08-15

Verified end to end against the live Polar API (real purchase flow, activation, validation, deactivation, disable/revoke from the dashboard). Findings, all fixed:

### Fixed
- **Licence — revoked or disabled keys switch Pro off at the next check.** Polar answers `404 "License key is no longer active."` for a revoked/disabled key (not a 200 with a status, as assumed); that explicit answer is now final for the next 24 h instead of being treated as a soft failure with the 14-day offline grace. It is still re-checked after 24 h, so a re-enabled key comes back on its own.
- **Licence — rate limit.** Polar's licence endpoints return HTTP 429 (`Retry-After: 30`) after a handful of calls. Activate, deactivate and the forced "licence status" now retry once, honouring `Retry-After` (capped at 60 s), and a still-busy server gets a clear message instead of "Network problem: HTTP 429". Background re-validation never waits (a 429 there is a transient failure covered by the grace period).
- **Licence — safer re-activation.** The new activation is created before the previous slot on this computer is freed, so a failed re-activation never loses a working activation; when the same key is at its activation limit, the old slot is freed and activation retried once (if that retry still fails, the state says so honestly instead of keeping a dead activation id).
- **Licence — activation removed elsewhere.** A key that is fine but whose activation for this computer was removed (Polar customer portal, or activated on other computers) now reports exactly that — "enter the key again" — instead of "key not recognised", and Pro stays off until re-activated (the activation limit is not bypassed).
- **Licence — no resurrection through the grace period.** Once Polar has said revoked / disabled / not found, a later network failure keeps that answer instead of turning Pro back on for the offline grace; only a fresh positive answer does (still re-asked every 24 h).
- Progress notifications for "deactivate" and "licence status" (they may wait for the rate limit); the activation notification is cancellable.

## [0.1.0] - 2026-08-15

### Added
- **Enable autonomous mode**: consent dialog, byte-exact backup, writes the four native settings (`permissions.defaultMode`, `skipDangerousModePermissionPrompt`, `claudeCode.allowDangerouslySkipPermissions`, `claudeCode.initialPermissionMode`), offers to remove known third-party auto-accept hooks and extensions, then reload.
- **Revert**: restores the original file and VS Code keys from before the first Enable; safety copy of the current file first.
- **Doctor**: validity of `settings.json` (with line/column), the four settings, unpinned starting mode, permission-deciding hooks (known tools vs catch-all vs narrow), conflicting extensions, managed policy, project overrides, official-extension contract validation, stale allow rules, unreadable files. One-click fixes, "fix all", Markdown report with home directory and user name redacted, secrets masked.
- English and Spanish UI.
- Honours `CLAUDE_CONFIG_DIR`; `handsfree.claudeSettingsPath` (machine scope) to override the file path.
- File-based managed policy support (`managed-settings.json` + `managed-settings.d/`), Program Files location on Windows.

### Added (Pro, optional one-time licence via Polar)
- **Careful profile per project**: `disableBypassPermissionsMode` (+ `defaultMode: default` unless a prompting mode is already pinned) in the repository's `.claude/settings.local.json` (git root); the Doctor reports it as a deliberate profile. Removing it is free.
- **Guardrails**: ready-made `ask` / `deny` rule sets (destructive shell, secret files, publishing, cloud infra) that Claude Code enforces even in bypass mode; toggle per set; removal takes only what Handsfree added and is free.
- **Export / import** of a minimal, validated Handsfree profile (mode keys + ask/deny rules only), with before → after preview and the bypass warning when relevant.
- **Status bar** indicator after the first Handsfree command in a window.
- Licence commands: enter key, deactivate, status, get a licence. Offline grace of 14 days; validation throttled to once per 24 h; a bad answer is retried after 24 h.

### Security
- Nothing runs at startup; no hooks; no network; no telemetry.
- Never writes to an invalid settings file; never rewrites when nothing would change.

[Unreleased]: https://github.com/TecniartGalicia/handsfree-claude-code/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/TecniartGalicia/handsfree-claude-code/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/TecniartGalicia/handsfree-claude-code/releases/tag/v0.1.0
