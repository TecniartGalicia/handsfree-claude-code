# Handsfree for Claude Code

**Let Claude Code work without asking for permission — using only its own, native settings.** One command turns on Claude Code's *bypass permissions* mode the way Anthropic designed it (no hooks, no auto-clicking, no usage quotas), one command reverts it byte-for-byte, and a **Doctor** tells you exactly *why* Claude is still asking when something else on your machine gets in the way.

> **Not affiliated with, endorsed by, or sponsored by Anthropic.** "Claude" is a trademark of Anthropic, PBC. This extension only writes settings that Claude Code and its official VS Code extension document and expose.
>
> [Leer en español](README.es.md)

---

## Why this exists

Every "auto-accept" extension out there does the same thing with a different hack: a `PreToolUse` hook that says *yes* to everything, a script that types into your terminal, or DevTools clicking the button for you. All of them sit **in front of** Claude Code's permission system, and all of them fail the same way: when the hook breaks, its paid quota runs out, or Claude Code changes a detail, you're suddenly asked to confirm *every single tool call* — and nothing on screen tells you why.

Claude Code already ships an autonomous mode. It's just spread over **four settings in two files**, plus a one-time confirmation dialog that is easy to miss inside VS Code, plus a "last mode you picked" memory in the extension that silently outranks your settings. Handsfree sets those four settings, and then gets out of the way.

## What it does

| Command | What happens |
| :-- | :-- |
| **Handsfree: Enable autonomous mode** | Shows a consent dialog listing exactly which files will change → takes a byte-exact backup → writes the four native settings below → offers to remove third-party auto-accept hooks/extensions that would override them → asks to reload. |
| **Handsfree: Revert to previous settings** | Puts both files back exactly as they were before the *first* Enable (a safety copy of the current file is taken first). |
| **Handsfree: Doctor** | Answers *"why is Claude asking me?"* — checks your machine, sorts problems → warnings → notes → OK, and offers a **Fix** for each. Copy the report (home directory and user name redacted) into a bug report or send it to a colleague. |

### The four native settings

| File | Key | Value | Effect |
| :-- | :-- | :-- | :-- |
| `~/.claude/settings.json` | `permissions.defaultMode` | `"bypassPermissions"` | Terminal sessions start without prompts. |
| `~/.claude/settings.json` | `skipDangerousModePermissionPrompt` | `true` | Pre-answers the one-time "accept responsibility" dialog Claude Code shows for bypass mode (it saves that answer to user settings anyway — this is the same key). |
| VS Code user settings | `claudeCode.allowDangerouslySkipPermissions` | `true` | The official extension refuses to start a bypass conversation without this toggle. |
| VS Code user settings | `claudeCode.initialPermissionMode` | `"bypassPermissions"` | Pins the starting mode of new conversations. Without it the extension uses **the mode you last picked in the mode indicator**, which outranks `defaultMode` — the classic "I set everything and it still asks". |

`CLAUDE_CONFIG_DIR` is honoured; the file path can also be overridden with `handsfree.claudeSettingsPath` (machine scope).

### What it deliberately does **not** do

- **No hooks.** Nothing intercepts permission decisions at runtime, so nothing can start answering "ask" behind your back.
- **No auto-clicking, no terminal typing.** Nothing to break when the UI changes.
- **No quota, no counter, no "upgrade to keep going".**
- **Nothing runs at startup.** The extension activates only when you run one of its commands.
- **No telemetry, no network.** See [PRIVACY.md](PRIVACY.md).

## The Doctor

Each check comes with a one-click fix where one is safe:

| Check | Why it matters |
| :-- | :-- |
| `settings.json` is valid JSON (points at the line) | A stray comma makes Claude Code ignore **all** settings in that file, silently. |
| The four native settings above | Any one missing keeps prompts coming. |
| Starting mode not pinned in the extension | The last mode picked in the indicator wins over `defaultMode`. |
| Hooks on `PreToolUse` / `PermissionRequest` from known auto-accept tools, or matching every tool | A hook answering "ask" beats any mode. Legit logging hooks are flagged as warnings, never removed unasked. |
| Third-party auto-accept extensions installed | They override the native mode; offered for uninstall (with the reason). |
| Managed policy (`managed-settings.json`) forbids bypass, pins a mode, or defines hooks | Only an administrator can change it — the Doctor tells you so instead of failing. |
| Project `.claude/settings.json` / `settings.local.json` pins a mode, disables bypass or defines hooks | Project settings win for terminal sessions; the VS Code extension never reads them for the starting mode. |
| Official extension installed and exposing the settings (validated against its manifest) | If Anthropic renames a key, Handsfree says so instead of writing junk. |
| Allow-list rules that do nothing (`Tool(*)` next to `Tool`, renamed tools, leftovers of other extensions) | Cosmetic; offered as clean-up. |
| Unreadable files (EACCES, network drive timeout) | Reported as such, never mistaken for "invalid". |

## Safety

- **Consent first.** Enable shows a modal that explains what bypass mode means and lists the files that will change. Nothing is written before you accept.
- **Backups.** A byte-exact copy of `~/.claude/settings.json` is saved to `~/.claude/backups/handsfree/` before every write (Enable, Revert, Doctor fixes). The newest 10 are kept. **Those copies contain whatever your settings contain — including `env` blocks with API keys — with the same file permissions as the original.**
- **Revert is real.** It restores the original file and the two VS Code keys, and takes a copy of the current file first. Enable → Enable → Revert still returns to the original state.
- **Never on a broken file.** If `settings.json` is invalid, nothing is written; the Doctor opens it at the offending line.
- **Bypass mode is Anthropic's, with Anthropic's rules.** `ask` and `deny` rules still apply, `rm -rf /` and `rm -rf ~` still prompt (circuit breaker), and Claude Code refuses to run in this mode as root. Read the [official warning](https://code.claude.com/docs/en/permission-modes) — use it in repositories you trust and keep backups.

## Requirements

- VS Code 1.95+ (also works in Cursor / VSCodium via Open VSX).
- Claude Code CLI; the official **Claude Code** extension (`anthropic.claude-code`) for the VS Code side. Without it, only the CLI settings are written.
- Remote-SSH / WSL / Dev Containers: runs where Claude Code runs (`extensionKind: workspace`). Extensions installed on the *other* side are not visible to the Doctor.

## FAQ

**I enabled it and Claude still asked once.** The first conversation right after installing or upgrading Claude Code ignores settings files; the second one honours them. Also reload the window after enabling.

**It asks in one project only.** That project has `.claude/settings.json` or `settings.local.json` pinning a mode or disabling bypass — the Doctor shows it. That's a per-project profile, possibly deliberate.

**It asks for `git push --force` / a specific command.** An `ask` rule (yours or your organisation's) still forces a prompt in bypass mode. That's by design.

**Does this work with `claude` in the terminal?** Yes: `permissions.defaultMode` covers terminal sessions; the two VS Code keys cover the extension.

**Can my organisation block this?** Yes. `permissions.disableBypassPermissionsMode: "disable"` in managed settings wins over everything; Handsfree detects it and refuses to write.

## Settings

| Setting | Default | Description |
| :-- | :-- | :-- |
| `handsfree.claudeSettingsPath` | `""` | Path to Claude Code's user settings file. Empty = `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`). Machine scope. |

## Contributing

MIT-licensed, built by [Argalla](https://argalla.com) (Tecniart Galicia SL). Issues and PRs at [github.com/TecniartGalicia/handsfree-claude-code](https://github.com/TecniartGalicia/handsfree-claude-code). See [CONTRIBUTING.md](CONTRIBUTING.md); security reports per [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Tecniart Galicia SL (Argalla).
