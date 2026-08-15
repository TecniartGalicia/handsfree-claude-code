# Changelog

All notable changes to this extension are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/TecniartGalicia/handsfree-claude-code/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/TecniartGalicia/handsfree-claude-code/releases/tag/v0.1.0
