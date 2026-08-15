/**
 * Doctor logic, pure: takes what was observed on the machine and returns findings.
 * The VS Code layer attaches the actual "Fix" actions and localised rendering.
 *
 * Facts this relies on (Claude Code docs, Aug 2026):
 *  - VS Code extension picks the starting mode in this order: (1) claudeCode.initialPermissionMode,
 *    (2) the mode last picked in the mode indicator (Manual/Edit/Auto), (3) permissions.defaultMode
 *    from managed or ~/.claude/settings.json, (4) built-in default. It NEVER reads a project's
 *    .claude/settings*.json for the starting mode. Bypass additionally needs
 *    claudeCode.allowDangerouslySkipPermissions.
 *  - Terminal sessions: --permission-mode flag > permissions.defaultMode from any settings file
 *    (project/local win over user) > built-in default.
 *  - permissions.disableBypassPermissionsMode = "disable" works from ANY scope (managed, user, project).
 *  - Hook decisions never override deny/ask rules; a hook answering "ask" still prompts.
 *  - The bypass "accept responsibility" dialog is saved to user settings (skipDangerousModePermissionPrompt).
 */
import {
  BYPASS_MODE,
  bypassDisabledByPolicy,
  ClaudeSettings,
  effectiveDefaultMode,
  findRogueHooks,
  findStaleAllowRules,
  isPlainObject,
  matcherIsWildcard,
  RogueHook,
  StaleRule,
} from './claudeSettings';
import { allTemplateRules } from './guardrails';
import { ReadResult } from './jsonFile';

export type Severity = 'error' | 'warn' | 'info' | 'ok';

export type FixKind =
  | { kind: 'enable' }
  | { kind: 'remove-hooks'; hooks: RogueHook[] }
  | { kind: 'uninstall-extension'; id: string }
  | { kind: 'clean-allow'; rules: string[] }
  | { kind: 'open-file'; path: string; line?: number; column?: number };

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  fix?: FixKind;
}

/** Minimal shape of what the VS Code layer knows about the official extension. */
export interface OfficialInfo {
  installed: boolean;
  version?: string;
  supportsBypass: boolean;
  /** true = version is older than the oldest version this release was tested with */
  olderThanTested: boolean;
  allow?: boolean;
  mode?: string;
}

export interface DoctorInput {
  claudePath: string;
  claude: ReadResult<ClaudeSettings>;
  managed: { path: string; result: ReadResult<ClaudeSettings> }[];
  /** Managed files found at locations Claude Code no longer reads (e.g. C:\ProgramData\ClaudeCode on Windows). */
  legacyManagedFiles?: string[];
  official: OfficialInfo;
  rogueExtensions: { id: string; name: string; why: string; version?: string }[];
  /** Extensions uninstalled during this session (still visible to the API until reload). */
  uninstalledPendingReload: string[];
  /** .claude/settings.json and .claude/settings.local.json of open workspace folders. */
  workspaceFiles: { path: string; result: ReadResult<ClaudeSettings> }[];
  /** Project files that are Handsfree "careful" profiles (Pro): reported as info, not warning. */
  ownedProfilePaths?: string[];
}

/** Message formatter with {0}-style placeholders; the VS Code layer passes vscode.l10n.t, tests use the identity below. */
export type Translate = (message: string, ...args: (string | number)[]) => string;
export const defaultT: Translate = (message, ...args) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? `{${i}}`));

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2, ok: 3 };

export function sortFindings(f: Finding[]): Finding[] {
  return [...f].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

const hookLine = (h: RogueHook) => `${h.event}${h.matcher !== undefined ? ` [${h.matcher}]` : ''}: ${maskSecrets(h.command)}`;

/** Commands can carry tokens (curl -H "Authorization: ..."). Mask anything that looks like one before it reaches a report. */
export function maskSecrets(s: string): string {
  return s
    .replace(/(authorization\s*[:=]\s*["']?(?:bearer|basic|token)?\s*)([^\s"']+)/gi, '$1***')
    .replace(/\b(bearer\s+)([^\s"']{6,})/gi, '$1***')
    .replace(/((?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*["']?)([^\s"']+)/gi, '$1***')
    .replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]{6,}/g, '$1***')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{4})[A-Za-z0-9]{10,}/g, '$1***');
}

function staleRuleText(r: StaleRule, t: Translate): string {
  switch (r.reason) {
    case 'redundant-wildcard':
      return t('{0} — redundant: the bare tool rule already allows everything for that tool', r.rule);
    case 'renamed-tool':
      return t('{0} — that tool no longer exists under this name', r.rule);
    case 'unknown-mcp-pattern':
      return t('{0} — MCP rules take the form "mcp__server" or "mcp__server__tool"', r.rule);
    case 'foreign':
      return t('{0} — left behind by a third-party auto-accept extension', r.rule);
  }
}

function unreadableFinding(id: string, title: string, r: Extract<ReadResult<ClaudeSettings>, { ok: false }>, path: string, severity: Severity, t: Translate): Finding {
  const isRead = !!r.error.code;
  return {
    id,
    severity,
    title: isRead ? t('{0} could not be read ({1})', title, r.error.code ?? '?') : t('{0} is not valid JSON', title),
    detail: `${path}\n${r.error.message}`,
    fix: isRead ? undefined : { kind: 'open-file', path, line: r.error.line, column: r.error.column },
  };
}

export function evaluate(input: DoctorInput, t: Translate = defaultT): Finding[] {
  const out: Finding[] = [];
  const claude = input.claude;
  const fileOk = claude.ok;
  const settings: ClaudeSettings | undefined = claude.ok && claude.exists ? claude.data : undefined;
  const settingsUsable = fileOk && (settings === undefined || isPlainObject(settings));

  // ---- 1. Policy (managed files first: they cannot be overridden by anything) -----------------
  let policyBlocks = false;
  for (const m of input.managed) {
    if (!m.result.exists) continue;
    if (!m.result.ok) {
      out.push(unreadableFinding('policy.managed-invalid', t('Managed policy file'), m.result, m.path, 'warn', t));
      continue;
    }
    const md = m.result.data;
    if (bypassDisabledByPolicy(md)) {
      policyBlocks = true;
      out.push({ id: 'policy.managed', severity: 'error', title: t('Bypass mode is disabled by a managed policy'), detail: t('{0} forbids bypassPermissions. Only an administrator can change that file; autonomous mode cannot be enabled on this machine.', m.path) });
    }
    const mMode = effectiveDefaultMode(md);
    if (mMode && mMode !== BYPASS_MODE) {
      out.push({ id: 'policy.managed-mode', severity: 'warn', title: t('A managed policy pins the starting mode to "{0}"', mMode), detail: t('{0} sets permissions.defaultMode. Managed settings outrank your user settings; only an administrator can change that.', m.path) });
    }
    const mHooks = findRogueHooks(md);
    if (mHooks.length) {
      out.push({ id: 'policy.managed-hooks', severity: 'warn', title: t('A managed policy defines {0} permission-deciding hook(s)', mHooks.length), detail: `${m.path}\n` + mHooks.map(hookLine).join('\n') });
    }
  }

  for (const legacy of input.legacyManagedFiles ?? []) {
    out.push({ id: `policy.legacy:${legacy}`, severity: 'info', title: t('A managed settings file exists at a location Claude Code no longer reads'), detail: t('{0} — Claude Code 2.1.75 and later only read managed settings from the Program Files location; this file has no effect.', legacy) });
  }

  // ---- 2. User settings file health ----------------------------------------------------------
  if (!claude.ok) {
    const isRead = !!claude.error.code;
    const where = !isRead && claude.error.line ? t(' at line {0}, column {1}', claude.error.line, claude.error.column ?? 1) : '';
    out.push({
      id: isRead ? 'claude.unreadable' : 'claude.json-invalid',
      severity: 'error',
      title: isRead ? t('Claude settings file could not be read ({0})', claude.error.code ?? '?') : t('Claude settings file is not valid JSON{0}', where),
      detail: isRead
        ? `${input.claudePath}\n${claude.error.message}`
        : t('{0}\n{1}\nA broken settings.json makes Claude Code ignore ALL settings in it — modes, allow rules, everything. This is the most common cause of "it suddenly asks for everything".', claude.error.message, input.claudePath),
      fix: isRead ? undefined : { kind: 'open-file', path: input.claudePath, line: claude.error.line, column: claude.error.column },
    });
  } else if (!claude.exists) {
    out.push({ id: 'claude.missing', severity: 'info', title: t('No Claude settings file yet'), detail: t('{0} does not exist. "Enable autonomous mode" will create it.', input.claudePath) });
  } else if (!isPlainObject(settings)) {
    out.push({ id: 'claude.not-object', severity: 'error', title: t('Claude settings file is not a JSON object'), detail: input.claudePath, fix: { kind: 'open-file', path: input.claudePath } });
  }

  if (settingsUsable && bypassDisabledByPolicy(settings)) {
    policyBlocks = true;
    out.push({ id: 'policy.user', severity: 'error', title: t('Bypass mode is disabled in your own settings'), detail: t('{0} sets permissions.disableBypassPermissionsMode = "disable". Remove that key if you want autonomous mode.', input.claudePath), fix: { kind: 'open-file', path: input.claudePath } });
  }
  const enableFix: FixKind | undefined = policyBlocks ? undefined : { kind: 'enable' };

  // ---- 3. Claude keys (only when the file is trustworthy) ------------------------------------
  if (settingsUsable) {
    const mode = effectiveDefaultMode(settings);
    if (mode === 'auto') {
      out.push({
        id: 'claude.defaultMode',
        severity: 'warn',
        title: t('Claude default permission mode is "auto" (a classifier reviews actions), not bypassPermissions'),
        detail: t('permissions.defaultMode in {0}. Auto mode is the official default on Pro/Max/Team plans and the safer choice: a second model approves routine actions and blocks dangerous ones. If auto already works for you, you do not need bypass mode. Enable autonomous mode only if you want zero prompts.', input.claudePath),
        fix: enableFix,
      });
    } else if (mode !== BYPASS_MODE) {
      out.push({
        id: 'claude.defaultMode',
        severity: 'warn',
        title: t('Claude default permission mode is {0}, not bypassPermissions', mode ? `"${mode}"` : t('unset')),
        detail: t('permissions.defaultMode in {0}. Terminal sessions start in this mode; the VS Code extension uses it only when claudeCode.initialPermissionMode is unset and you have not picked a mode in the indicator.', input.claudePath),
        fix: enableFix,
      });
    } else {
      out.push({ id: 'claude.defaultMode', severity: 'ok', title: t('Claude default permission mode is bypassPermissions') });
    }
    if (settings?.skipDangerousModePermissionPrompt !== true) {
      out.push({
        id: 'claude.skipDialog',
        severity: 'warn',
        title: t('Bypass-mode responsibility dialog is not pre-accepted'),
        detail: t('skipDangerousModePermissionPrompt is not true in {0}. Claude Code shows a one-time "accept responsibility" dialog when a session starts in bypass mode and saves the answer to user settings; inside the VS Code extension that dialog is easy to miss, and until it is answered the mode does not engage.', input.claudePath),
        fix: enableFix,
      });
    } else {
      out.push({ id: 'claude.skipDialog', severity: 'ok', title: t('Bypass-mode responsibility dialog pre-accepted') });
    }

    // ---- 4. Hooks ------------------------------------------------------------------------------
    const hooks = findRogueHooks(settings);
    const knownWide = hooks.filter((h) => h.reason === 'known-tool' && matcherIsWildcard(h.matcher));
    const knownNarrow = hooks.filter((h) => h.reason === 'known-tool' && !matcherIsWildcard(h.matcher));
    const wild = hooks.filter((h) => h.reason === 'wildcard');
    if (knownWide.length) {
      out.push({
        id: 'hooks.known-tool',
        severity: 'error',
        title: t('{0} hook(s) that auto-approve permissions for every tool', knownWide.length),
        detail: knownWide.map(hookLine).join('\n') + '\n' + t('Typically left by a third-party auto-accept tool. They decide every permission before Claude Code does; when their quota runs out or they break, every tool call starts asking. They override any mode you configure.'),
        fix: { kind: 'remove-hooks', hooks: knownWide },
      });
    }
    if (knownNarrow.length) {
      out.push({
        id: 'hooks.known-tool-narrow',
        severity: 'warn',
        title: t('{0} hook(s) that auto-approve specific tools', knownNarrow.length),
        detail: knownNarrow.map(hookLine).join('\n') + '\n' + t('These approve on your behalf for the tools they match. Harmless if they are yours; remove them if they came from a tool you no longer use.'),
        fix: { kind: 'remove-hooks', hooks: knownNarrow },
      });
    }
    if (wild.length) {
      out.push({
        id: 'hooks.wildcard',
        severity: 'warn',
        title: t('{0} PreToolUse/PermissionRequest hook(s) matching every tool', wild.length),
        detail: wild.map(hookLine).join('\n') + '\n' + t('A hook that answers "ask" or "deny" wins over any permission mode. If this hook is yours and only logs, keep it; otherwise remove it.'),
        fix: { kind: 'remove-hooks', hooks: wild },
      });
    }
    if (!hooks.length && settings) out.push({ id: 'hooks.none', severity: 'ok', title: t('No permission-deciding hooks in {0}', input.claudePath) });

    // ---- 4b. Ask rules: they force a prompt even in bypass mode (that is their point) --------------
    const askRules: string[] = Array.isArray(settings?.permissions?.ask) ? settings!.permissions.ask.filter((r: unknown): r is string => typeof r === 'string') : [];
    if (askRules.length) {
      const ours = allTemplateRules();
      const mine = askRules.filter((r) => ours.has(r)).length;
      out.push({
        id: 'ask.rules',
        severity: 'info',
        title: t('{0} ask rule(s) force a prompt even in bypass mode ({1} from Handsfree guardrails)', askRules.length, mine),
        detail: askRules.map(maskSecrets).join('\n') + '\n' + t('This is by design: an explicit ask rule always prompts. Use "Handsfree: Guardrails" to change the Handsfree sets, or edit permissions.ask in {0}.', input.claudePath),
      });
    }

    // ---- 5. Allow-list hygiene ---------------------------------------------------------------
    const stale: StaleRule[] = findStaleAllowRules(settings?.permissions?.allow);
    if (stale.length) {
      out.push({
        id: 'allow.stale',
        severity: 'info',
        title: t('{0} allow rule(s) that do nothing', stale.length),
        detail: stale.map((s) => staleRuleText(s, t)).join('\n'),
        fix: { kind: 'clean-allow', rules: stale.map((s) => s.rule) },
      });
    }
  }

  // ---- 6. Official extension -----------------------------------------------------------------
  const o = input.official;
  if (!o.installed) {
    out.push({ id: 'ext.missing', severity: 'info', title: t('Claude Code extension (anthropic.claude-code) is not installed or is disabled'), detail: t('The VS Code side of autonomous mode is skipped. Terminal sessions still honour permissions.defaultMode.') });
  } else if (!o.supportsBypass) {
    out.push({ id: 'ext.contract', severity: 'error', title: t('Claude Code extension {0} does not expose the bypass settings', o.version ?? '?'), detail: t('claudeCode.allowDangerouslySkipPermissions / claudeCode.initialPermissionMode are missing or do not accept "bypassPermissions". Update the Claude Code extension.') });
  } else {
    if (o.olderThanTested) out.push({ id: 'ext.untested', severity: 'info', title: t('Claude Code extension {0} is older than the versions this release was tested with', o.version ?? '?'), detail: t('Its settings still validate, so everything should work. If it does not, update the Claude Code extension or open an issue.') });
    if (o.allow !== true) {
      out.push({ id: 'ext.allow', severity: 'warn', title: t('Claude Code extension does not allow bypass mode'), detail: t('claudeCode.allowDangerouslySkipPermissions is {0}. Without it the extension starts a "bypassPermissions" conversation in Manual mode instead.', o.allow === undefined ? t('unset') : String(o.allow)), fix: enableFix });
    } else {
      out.push({ id: 'ext.allow', severity: 'ok', title: t('Claude Code extension allows bypass mode') });
    }
    if (o.mode === undefined) {
      out.push({
        id: 'ext.mode',
        severity: 'warn',
        title: t('Starting mode of new conversations is not pinned'),
        detail: t('claudeCode.initialPermissionMode is unset. The extension then uses the mode you last picked in the mode indicator (Manual / Edit automatically / Auto), which outranks permissions.defaultMode — that is why a sticky "Auto" pick keeps asking even with defaultMode = bypassPermissions. Pin it with "Enable autonomous mode".'),
        fix: enableFix,
      });
    } else if (o.mode !== BYPASS_MODE) {
      out.push({ id: 'ext.mode', severity: 'warn', title: t('New conversations start in {0} mode', `"${o.mode}"`), detail: t('claudeCode.initialPermissionMode = {0} (VS Code user settings). This wins over everything else the extension consults.', `"${o.mode}"`), fix: enableFix });
    } else {
      out.push({ id: 'ext.mode', severity: 'ok', title: t('New conversations start in bypassPermissions mode') });
    }
    out.push({ id: 'ext.first-session', severity: 'info', title: t('Right after installing or upgrading Claude Code, its first conversation ignores settings files'), detail: t('That first conversation may still ask; the second one honours your settings. Nothing to fix.') });
  }

  // ---- 7. Conflicting extensions -------------------------------------------------------------
  for (const e of input.rogueExtensions) {
    if (input.uninstalledPendingReload.includes(e.id.toLowerCase())) {
      out.push({ id: `rogue.${e.id}`, severity: 'info', title: t('{0} uninstalled — reload the window to finish', e.name), detail: e.id });
      continue;
    }
    out.push({ id: `rogue.${e.id}`, severity: 'error', title: t('Conflicting extension installed: {0}', e.name), detail: `${e.id}${e.version ? ` v${e.version}` : ''}\n${e.why}`, fix: { kind: 'uninstall-extension', id: e.id } });
  }
  if (!input.rogueExtensions.length) out.push({ id: 'rogue.none', severity: 'ok', title: t('No conflicting auto-accept extensions (in this window)') });

  // ---- 8. Project overrides ------------------------------------------------------------------
  for (const w of input.workspaceFiles) {
    if (!w.result.exists) continue;
    if (!w.result.ok) {
      out.push(unreadableFinding(`ws.invalid:${w.path}`, t('Project settings file'), w.result, w.path, 'error', t));
      continue;
    }
    const wd = w.result.data;
    if (!isPlainObject(wd)) continue;
    const wsMode = effectiveDefaultMode(wd);
    const ownedFile = (input.ownedProfilePaths ?? []).some((p) => p.toLowerCase() === w.path.toLowerCase());
    if (wsMode && wsMode !== BYPASS_MODE && !(ownedFile && wsMode === 'default')) {
      out.push({ id: `ws.mode:${w.path}`, severity: 'warn', title: t('This project pins terminal sessions to "{0}" mode', wsMode), detail: t('{0} sets permissions.defaultMode. Project settings win over user settings for terminal sessions started here (VS Code conversations are not affected: the extension never reads project settings for the starting mode). Expected if this is a deliberate per-project profile.', w.path), fix: { kind: 'open-file', path: w.path } });
    }
    if (bypassDisabledByPolicy(wd)) {
      const owned = (input.ownedProfilePaths ?? []).some((p) => p.toLowerCase() === w.path.toLowerCase());
      out.push({
        id: `ws.policy:${w.path}`,
        severity: owned ? 'info' : 'warn',
        title: owned ? t('Careful profile active in this project (set with Handsfree)') : t('This project disables bypass mode'),
        detail: owned
          ? t('{0} — Claude asks for permission here on purpose. "Handsfree: Remove careful profile" turns it off.', w.path)
          : t('{0} sets permissions.disableBypassPermissionsMode = "disable": sessions in this project (terminal and VS Code) fall back to a mode that asks. Expected if this is a deliberate "careful" profile.', w.path),
        fix: { kind: 'open-file', path: w.path },
      });
    }
    const wsHooks = findRogueHooks(wd);
    if (wsHooks.length) {
      out.push({ id: `ws.hooks:${w.path}`, severity: 'warn', title: t('This project defines {0} permission-deciding hook(s)', wsHooks.length), detail: `${w.path}\n` + wsHooks.map(hookLine).join('\n'), fix: { kind: 'open-file', path: w.path } });
    }
  }

  return sortFindings(out);
}

export function summarize(findings: Finding[]): { errors: number; warnings: number; infos: number; oks: number } {
  return {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
    infos: findings.filter((f) => f.severity === 'info').length,
    oks: findings.filter((f) => f.severity === 'ok').length,
  };
}

/**
 * "Fix everything fixable": one Enable at most (it is idempotent and shows its own consent),
 * all hook removals merged into a single operation, uninstalls, allow-list clean-up.
 * Only errors and the Enable-family warnings are included; wildcard hooks are excluded because
 * their own text says "keep it if it is yours".
 */
export function planFixAll(findings: Finding[]): FixKind[] {
  const plan: FixKind[] = [];
  let enable = false;
  const hooks: RogueHook[] = [];
  const uninstall = new Set<string>();
  const rules = new Set<string>();
  for (const f of findings) {
    if (!f.fix || f.severity === 'ok' || f.severity === 'info') continue;
    if (f.fix.kind === 'open-file') continue;
    if (f.id === 'hooks.wildcard' || f.id === 'hooks.known-tool-narrow') continue;
    switch (f.fix.kind) {
      case 'enable':
        enable = true;
        break;
      case 'remove-hooks':
        hooks.push(...f.fix.hooks);
        break;
      case 'uninstall-extension':
        uninstall.add(f.fix.id);
        break;
      case 'clean-allow':
        f.fix.rules.forEach((r) => rules.add(r));
        break;
    }
  }
  if (hooks.length) plan.push({ kind: 'remove-hooks', hooks });
  if (rules.size) plan.push({ kind: 'clean-allow', rules: [...rules] });
  for (const id of uninstall) plan.push({ kind: 'uninstall-extension', id });
  if (enable) plan.push({ kind: 'enable' });
  return plan;
}
