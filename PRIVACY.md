# Privacy

**Handsfree for Claude Code makes no network requests and collects no telemetry.**

What it reads: your Claude Code user settings file (`~/.claude/settings.json` or `$CLAUDE_CONFIG_DIR/settings.json`), Claude Code managed-policy files if present, the `.claude/settings.json` / `.claude/settings.local.json` of open workspace folders, the manifest and settings of the official Claude Code extension, and the list of installed extensions (to detect known auto-accept tools). All of it stays on your machine.

What it writes: the four settings described in the README, and backups of your Claude settings file under `~/.claude/backups/handsfree/` (the newest 10 are kept). Backups are exact copies of your settings and therefore contain whatever your settings contain, including any `env` values; they keep the original file's permissions.

The Doctor's "Copy report" puts a Markdown report on **your** clipboard, with your home directory and user name replaced by placeholders and token-like values in hook commands masked. Nothing is sent anywhere unless you paste it.

If a future paid tier adds licence activation, it will be documented here before release, will send only the licence key and an anonymous machine identifier to the licensing provider, and will never send settings content.

Contact: info@tecniartgalicia.com — Tecniart Galicia SL (Argalla), Spain.
