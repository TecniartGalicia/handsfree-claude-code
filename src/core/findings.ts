/**
 * Doctor logic, pure: takes what was observed on the machine and returns findings.
 * The VS Code layer attaches the actual "Fix" actions and localised rendering.
 */
import {
  BYPASS_MODE,
  bypassDisabledByPolicy,
  ClaudeSettings,
  effectiveDefaultMode,
  findRogueHooks,
  findStaleAllowRules,
  RogueHook,
  StaleRule,
} from './claudeSettings';
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
  tested: boolean;
  allow?: boolean;
  mode?: string;
  allowScope: string;
  modeScope: string;
}

export interface DoctorInput {
  claudePath: string;
  claude: ReadResult<ClaudeSettings>;
  managed: { path: string; result: ReadResult<ClaudeSettings> }[];
  official: OfficialInfo;
  rogueExtensions: { id: string; name: string; why: string; version?: string }[];
  /** .claude/settings.json and .claude/settings.local.json of open workspace folders. */
  workspaceFiles: { path: string; result: ReadResult<ClaudeSettings> }[];
}

/** Message formatter with {0}-style placeholders; the VS Code layer passes vscode.l10n.t, tests use the identity below. */
export type Translate = (message: string, ...args: (string | number)[]) => string;
export const defaultT: Translate = (message, ...args) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? `{${i}}`));

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2, ok: 3 };

export function sortFindings(f: Finding[]): Finding[] {
  return [...f].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function evaluate(input: DoctorInput, t: Translate = defaultT): Finding[] {
  const out: Finding[] = [];
  const claude = input.claude;

  // 1. Settings file health
  if (!claude.ok) {
    const where = claude.error.line ? t(' at line {0}, column {1}', claude.error.line, claude.error.column ?? 1) : '';
    out.push({
      id: 'claude.json-invalid',
      severity: 'error',
      title: t('Claude settings file is not valid JSON{0}', where),
      detail: t('{0}\n{1}\nA broken settings.json makes Claude Code ignore ALL settings in it — modes, allow rules, everything. This is the most common cause of "it suddenly asks for everything".', claude.error.message, input.claudePath),
      fix: { kind: 'open-file', path: input.claudePath, line: claude.error.line, column: claude.error.column },
    });
    return sortFindings(out); // nothing else about that file is trustworthy
  }
  const settings: ClaudeSettings | undefined = claude.exists ? claude.data : undefined;
  if (!claude.exists) {
    out.push({ id: 'claude.missing', severity: 'info', title: t('No Claude settings file yet'), detail: t('{0} does not exist. "Enable autonomous mode" will create it.', input.claudePath) });
  }

  // 2. Policy
  if (bypassDisabledByPolicy(settings)) {
    out.push({ id: 'policy.user', severity: 'error', title: t('Bypass mode is disabled in your own settings'), detail: t('{0} sets permissions.disableBypassPermissionsMode = "disable". Remove that key if you want autonomous mode.', input.claudePath), fix: { kind: 'open-file', path: input.claudePath } });
  }
  for (const m of input.managed) {
    if (m.result.ok && m.result.exists && bypassDisabledByPolicy(m.result.data)) {
      out.push({ id: 'policy.managed', severity: 'error', title: t('Bypass mode is disabled by a managed policy'), detail: t('{0} forbids bypassPermissions. Only an administrator can change that file; autonomous mode cannot be enabled on this machine.', m.path) });
    } else if (!m.result.ok) {
      out.push({ id: 'policy.managed-invalid', severity: 'warn', title: t('Managed policy file is not valid JSON'), detail: m.path, fix: { kind: 'open-file', path: m.path, line: m.result.error.line, column: m.result.error.column } });
    }
  }

  // 3. Claude keys
  const mode = effectiveDefaultMode(settings);
  if (mode !== BYPASS_MODE) {
    out.push({
      id: 'claude.defaultMode',
      severity: 'warn',
      title: t('Claude default permission mode is "{0}", not "bypassPermissions"', mode ?? t('unset')),
      detail: t('permissions.defaultMode in {0}. Without it, new sessions from the CLI or the extension fall back to a mode that asks.', input.claudePath),
      fix: { kind: 'enable' },
    });
  } else {
    out.push({ id: 'claude.defaultMode', severity: 'ok', title: t('Claude default permission mode is bypassPermissions') });
  }
  if (settings?.skipDangerousModePermissionPrompt !== true) {
    out.push({
      id: 'claude.skipDialog',
      severity: 'warn',
      title: t('Bypass-mode confirmation dialog has not been accepted'),
      detail: t('skipDangerousModePermissionPrompt is not true in {0}. Claude Code shows a one-time "are you sure" dialog for bypass mode; inside the VS Code extension that dialog is easy to miss, and until it is accepted the mode does not engage.', input.claudePath),
      fix: { kind: 'enable' },
    });
  } else {
    out.push({ id: 'claude.skipDialog', severity: 'ok', title: t('Bypass-mode confirmation dialog accepted') });
  }

  // 4. Hooks
  const hooks = findRogueHooks(settings);
  const known = hooks.filter((h) => h.reason === 'known-tool');
  const wild = hooks.filter((h) => h.reason === 'wildcard');
  if (known.length) {
    out.push({
      id: 'hooks.known-tool',
      severity: 'error',
      title: t('{0} hook(s) from a third-party auto-accept tool', known.length),
      detail: known.map((h) => `${h.event}${h.matcher ? ` [${h.matcher}]` : ''}: ${h.command}`).join('\n') + '\n' + t('These hooks decide every permission before Claude Code does. When their quota runs out or they break, every tool call starts asking. They override any mode you configure.'),
      fix: { kind: 'remove-hooks', hooks: known },
    });
  }
  if (wild.length) {
    out.push({
      id: 'hooks.wildcard',
      severity: 'warn',
      title: t('{0} PreToolUse/PermissionRequest hook(s) matching every tool', wild.length),
      detail: wild.map((h) => `${h.event}${h.matcher ? ` [${h.matcher}]` : ''}: ${h.command}`).join('\n') + '\n' + t('A hook that answers "ask" or "deny" wins over any permission mode. If this hook is yours and only logs, keep it; otherwise remove it.'),
      fix: { kind: 'remove-hooks', hooks: wild },
    });
  }
  if (!hooks.length && settings) out.push({ id: 'hooks.none', severity: 'ok', title: t('No permission-deciding hooks') });

  // 5. Allow-list hygiene
  const stale: StaleRule[] = findStaleAllowRules(settings?.permissions?.allow);
  if (stale.length) {
    out.push({
      id: 'allow.stale',
      severity: 'info',
      title: t('{0} allow rule(s) that do nothing', stale.length),
      detail: stale.map((s) => `${s.rule} — ${s.detail}`).join('\n'),
      fix: { kind: 'clean-allow', rules: stale.map((s) => s.rule) },
    });
  }

  // 6. Official extension
  const o = input.official;
  if (!o.installed) {
    out.push({ id: 'ext.missing', severity: 'warn', title: t('Claude Code extension (anthropic.claude-code) is not installed'), detail: t('The VS Code side of autonomous mode is skipped. The CLI still honours permissions.defaultMode.') });
  } else if (!o.supportsBypass) {
    out.push({ id: 'ext.contract', severity: 'error', title: t('Claude Code extension {0} does not expose the bypass settings', o.version ?? '?'), detail: t('claudeCode.allowDangerouslySkipPermissions / claudeCode.initialPermissionMode are missing or do not accept "bypassPermissions". Update the Claude Code extension.') });
  } else {
    if (!o.tested) out.push({ id: 'ext.untested', severity: 'info', title: t('Claude Code extension {0} is newer than the versions this release was tested with', o.version ?? '?'), detail: t('Its settings still validate, so everything should work. If it does not, please open an issue.') });
    if (o.allow !== true) {
      out.push({ id: 'ext.allow', severity: 'warn', title: t('Claude Code extension does not allow bypass mode'), detail: t('claudeCode.allowDangerouslySkipPermissions is {0} ({1} scope). Without it the extension refuses to start a conversation in bypass mode.', String(o.allow), o.allowScope), fix: { kind: 'enable' } });
    } else {
      out.push({ id: 'ext.allow', severity: 'ok', title: t('Claude Code extension allows bypass mode') });
    }
    if (o.mode !== BYPASS_MODE) {
      const scopeNote = o.modeScope === 'workspace' || o.modeScope === 'workspaceFolder' ? ' ' + t('(set at {0} scope — a per-project profile; the user setting is not what applies here)', o.modeScope) : '';
      out.push({ id: 'ext.mode', severity: o.modeScope.startsWith('workspace') ? 'info' : 'warn', title: t('New conversations start in "{0}" mode', o.mode ?? t('default')), detail: t('claudeCode.initialPermissionMode = {0}.', String(o.mode)) + scopeNote, fix: o.modeScope.startsWith('workspace') ? undefined : { kind: 'enable' } });
    } else {
      out.push({ id: 'ext.mode', severity: 'ok', title: t('New conversations start in bypassPermissions mode') });
    }
  }

  // 7. Conflicting extensions
  for (const e of input.rogueExtensions) {
    out.push({ id: `rogue.${e.id}`, severity: 'error', title: t('Conflicting extension installed: {0}', e.name), detail: `${e.id}${e.version ? ` v${e.version}` : ''}\n${e.why}`, fix: { kind: 'uninstall-extension', id: e.id } });
  }
  if (!input.rogueExtensions.length) out.push({ id: 'rogue.none', severity: 'ok', title: t('No conflicting auto-accept extensions') });

  // 8. Workspace overrides
  for (const w of input.workspaceFiles) {
    if (!w.result.exists) continue;
    if (!w.result.ok) {
      out.push({ id: `ws.invalid:${w.path}`, severity: 'error', title: t('Project settings file is not valid JSON'), detail: `${w.path}\n${w.result.error.message}`, fix: { kind: 'open-file', path: w.path, line: w.result.error.line, column: w.result.error.column } });
      continue;
    }
    const wsMode = effectiveDefaultMode(w.result.data);
    if (wsMode && wsMode !== BYPASS_MODE) {
      out.push({ id: `ws.mode:${w.path}`, severity: 'info', title: t('This project overrides the permission mode to "{0}"', wsMode), detail: t('{0} sets permissions.defaultMode. Project settings win over user settings — expected if this is a deliberate per-project profile.', w.path), fix: { kind: 'open-file', path: w.path } });
    }
    if (bypassDisabledByPolicy(w.result.data)) {
      out.push({ id: `ws.policy:${w.path}`, severity: 'warn', title: t('This project disables bypass mode'), detail: w.path, fix: { kind: 'open-file', path: w.path } });
    }
    const wsHooks = findRogueHooks(w.result.data);
    if (wsHooks.length) {
      out.push({ id: `ws.hooks:${w.path}`, severity: 'warn', title: t('This project defines {0} permission-deciding hook(s)', wsHooks.length), detail: `${w.path}\n` + wsHooks.map((h) => `${h.event}: ${h.command}`).join('\n'), fix: { kind: 'open-file', path: w.path } });
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
