# Privacy

**Handsfree for Claude Code collects no telemetry. The free features make no network requests at all.**

What it reads: your Claude Code user settings file (`~/.claude/settings.json` or `$CLAUDE_CONFIG_DIR/settings.json`), Claude Code managed-policy files if present, the `.claude/settings.json` / `.claude/settings.local.json` of open workspace folders, the manifest and settings of the official Claude Code extension, and the list of installed extensions (to detect known auto-accept tools). All of it stays on your machine.

What it writes: the four settings described in the README, and backups of your Claude settings file under `~/.claude/backups/handsfree/` (the newest 10 are kept). Backups are exact copies of your settings and therefore contain whatever your settings contain, including any `env` values; they keep the original file's permissions.

The Doctor's "Copy report" puts a Markdown report on **your** clipboard, with your home directory and user name replaced by placeholders and token-like values in hook commands masked. Nothing is sent anywhere unless you paste it.

**Pro licence (optional, paid).** When *you* run "Pro: enter licence key", the extension sends your licence key, this computer's host name (as the activation label) and two non-identifying fields (operating system, extension version) to Polar Software Inc.'s licence API (`api.polar.sh`), which acts as merchant of record and licence provider. Afterwards it re-validates the key at most once every 24 hours when you use a Pro feature (key + activation id only), and keeps working offline for 14 days. Nothing from your settings files is ever sent. The key is stored in VS Code's secret storage on this machine. "Pro: deactivate licence" removes it and frees the activation at Polar. Polar's privacy policy: https://polar.sh/legal/privacy.

Data controller for the extension: Tecniart Galicia SL (Argalla), Spain. Legal basis for the licence exchange: performance of the purchase contract. You can ask for deletion of your activation records at the contact below.

Contact: info@tecniartgalicia.com — Tecniart Galicia SL (Argalla), Spain.
