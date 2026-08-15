/**
 * Per-project "careful" profile and portable Handsfree profiles.
 *
 * Careful profile = the project's .claude/settings.local.json gets
 *   permissions.disableBypassPermissionsMode = "disable"   (works from any scope → bypass refused here)
 *   permissions.defaultMode = "default"                     (terminal sessions here start in Manual;
 *                                                            only set when unset or a no-prompt mode)
 * Claude Code (≥ 2.1.211) loads settings.local.json from the git repository ROOT, so callers must
 * resolve the root first (see src/pro/features.ts).
 */
import { ClaudeSettings, isPlainObject, KNOWN_PERMISSION_MODES } from './claudeSettings';

export const CAREFUL_KEYS = { disable: 'disableBypassPermissionsMode', mode: 'defaultMode' } as const;
const NO_PROMPT_MODES = new Set(['bypassPermissions', 'dontAsk', 'auto', 'acceptEdits']);

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

export interface CarefulApply {
  next: ClaudeSettings;
  changed: boolean;
  /** defaultMode we replaced (undefined = it was unset or we left it alone). Stored so removal can restore it. */
  previousDefaultMode?: string;
  /** true when defaultMode was set to "default" by us. */
  setDefaultMode: boolean;
}

export function applyCarefulProfile(input: ClaudeSettings | undefined): CarefulApply {
  const next: ClaudeSettings = isPlainObject(input) ? clone(input) : {};
  if (!isPlainObject(next.permissions)) next.permissions = {};
  let changed = false;
  if (next.permissions[CAREFUL_KEYS.disable] !== 'disable') {
    next.permissions[CAREFUL_KEYS.disable] = 'disable';
    changed = true;
  }
  const cur = next.permissions[CAREFUL_KEYS.mode];
  let setDefaultMode = false;
  let previousDefaultMode: string | undefined;
  // A user's own "plan" (or any other prompting mode) is at least as careful — leave it alone.
  if (cur === undefined || (typeof cur === 'string' && NO_PROMPT_MODES.has(cur))) {
    if (cur !== 'default') {
      previousDefaultMode = typeof cur === 'string' ? cur : undefined;
      next.permissions[CAREFUL_KEYS.mode] = 'default';
      setDefaultMode = true;
      changed = true;
    }
  }
  return { next, changed, previousDefaultMode, setDefaultMode };
}

/**
 * Removes only what the careful profile set. `restoreDefaultMode` is what apply recorded
 * (undefined = delete the key if it is still "default"). If the file ends up empty, `empty` is true.
 */
export function removeCarefulProfile(input: ClaudeSettings, opts: { setDefaultMode?: boolean; previousDefaultMode?: string } = { setDefaultMode: true }): { next: ClaudeSettings; changed: boolean; empty: boolean } {
  const next: ClaudeSettings = clone(input);
  let changed = false;
  if (isPlainObject(next.permissions)) {
    if (next.permissions[CAREFUL_KEYS.disable] === 'disable') {
      delete next.permissions[CAREFUL_KEYS.disable];
      changed = true;
    }
    if (opts.setDefaultMode !== false && next.permissions[CAREFUL_KEYS.mode] === 'default') {
      if (opts.previousDefaultMode) next.permissions[CAREFUL_KEYS.mode] = opts.previousDefaultMode;
      else delete next.permissions[CAREFUL_KEYS.mode];
      changed = true;
    }
    if (Object.keys(next.permissions).length === 0) delete next.permissions;
  }
  return { next, changed, empty: Object.keys(next).length === 0 };
}

export function hasCarefulProfile(s: ClaudeSettings | undefined): boolean {
  return s?.permissions?.[CAREFUL_KEYS.disable] === 'disable';
}

// ---------------------------------------------------------------------------
// Portable profile (export / import) — only the keys Handsfree owns, never the whole settings file
// ---------------------------------------------------------------------------

export interface HandsfreeProfile {
  format: 'handsfree-profile';
  version: 1;
  exportedAt: string;
  claude: {
    defaultMode?: string;
    skipDangerousModePermissionPrompt?: boolean;
    disableBypassPermissionsMode?: string;
    ask?: string[];
    deny?: string[];
  };
  vscode: {
    allowDangerouslySkipPermissions?: boolean;
    initialPermissionMode?: string;
  };
}

const RULE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\(.*\))?$/;
const VSCODE_MODES = new Set(['default', 'manual', 'acceptEdits', 'plan', 'bypassPermissions']);

export function buildProfile(
  claude: ClaudeSettings | undefined,
  vscode: { allow?: boolean; mode?: string },
  now: Date = new Date(),
): HandsfreeProfile {
  const p = isPlainObject(claude?.permissions) ? claude!.permissions : {};
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && RULE_RE.test(x)) : undefined);
  return {
    format: 'handsfree-profile',
    version: 1,
    exportedAt: now.toISOString(),
    claude: {
      defaultMode: typeof p.defaultMode === 'string' ? p.defaultMode : undefined,
      skipDangerousModePermissionPrompt: claude?.skipDangerousModePermissionPrompt === true ? true : undefined,
      disableBypassPermissionsMode: typeof p.disableBypassPermissionsMode === 'string' ? p.disableBypassPermissionsMode : undefined,
      ask: strArr(p.ask),
      deny: strArr(p.deny),
    },
    vscode: { allowDangerouslySkipPermissions: vscode.allow, initialPermissionMode: vscode.mode },
  };
}

/** Strict validation: unknown modes, non-string rules or odd values are rejected (returns undefined). */
export function parseProfile(data: unknown): HandsfreeProfile | undefined {
  if (!isPlainObject(data) || data.format !== 'handsfree-profile' || data.version !== 1) return undefined;
  if (!isPlainObject(data.claude) || !isPlainObject(data.vscode)) return undefined;
  const c = data.claude;
  const v = data.vscode;
  const optStr = (x: unknown) => x === undefined || typeof x === 'string';
  const optBool = (x: unknown) => x === undefined || typeof x === 'boolean';
  const optRules = (x: unknown) => x === undefined || (Array.isArray(x) && x.every((r) => typeof r === 'string' && RULE_RE.test(r) && r.length <= 500));
  if (!optStr(c.defaultMode) || (c.defaultMode !== undefined && !(KNOWN_PERMISSION_MODES as readonly string[]).includes(c.defaultMode))) return undefined;
  if (!optBool(c.skipDangerousModePermissionPrompt)) return undefined;
  if (c.disableBypassPermissionsMode !== undefined && c.disableBypassPermissionsMode !== 'disable') return undefined;
  if (!optRules(c.ask) || !optRules(c.deny)) return undefined;
  if (!optBool(v.allowDangerouslySkipPermissions)) return undefined;
  if (!optStr(v.initialPermissionMode) || (v.initialPermissionMode !== undefined && !VSCODE_MODES.has(v.initialPermissionMode))) return undefined;
  return data as HandsfreeProfile;
}

/** True when importing this profile would turn on (or keep on) prompt-free operation. */
export function profileEnablesBypass(p: HandsfreeProfile): boolean {
  return p.claude.defaultMode === 'bypassPermissions' || p.vscode.initialPermissionMode === 'bypassPermissions' || p.vscode.allowDangerouslySkipPermissions === true || p.claude.skipDangerousModePermissionPrompt === true;
}

export interface ProfileChange {
  path: string;
  from: unknown;
  to: unknown;
}

/** Merges a profile into settings: scalar keys overwrite, ask/deny lists are unioned. Reports before → after. */
export function applyProfile(input: ClaudeSettings | undefined, profile: HandsfreeProfile): { next: ClaudeSettings; changes: ProfileChange[] } {
  const next: ClaudeSettings = isPlainObject(input) ? clone(input) : {};
  if (!isPlainObject(next.permissions)) next.permissions = {};
  const changes: ProfileChange[] = [];
  const c = profile.claude;
  if (c.defaultMode !== undefined && next.permissions.defaultMode !== c.defaultMode) {
    changes.push({ path: 'permissions.defaultMode', from: next.permissions.defaultMode, to: c.defaultMode });
    next.permissions.defaultMode = c.defaultMode;
  }
  if (c.disableBypassPermissionsMode !== undefined && next.permissions.disableBypassPermissionsMode !== c.disableBypassPermissionsMode) {
    changes.push({ path: 'permissions.disableBypassPermissionsMode', from: next.permissions.disableBypassPermissionsMode, to: c.disableBypassPermissionsMode });
    next.permissions.disableBypassPermissionsMode = c.disableBypassPermissionsMode;
  }
  if (c.skipDangerousModePermissionPrompt !== undefined && next.skipDangerousModePermissionPrompt !== c.skipDangerousModePermissionPrompt) {
    changes.push({ path: 'skipDangerousModePermissionPrompt', from: next.skipDangerousModePermissionPrompt, to: c.skipDangerousModePermissionPrompt });
    next.skipDangerousModePermissionPrompt = c.skipDangerousModePermissionPrompt;
  }
  for (const kind of ['ask', 'deny'] as const) {
    const incoming = c[kind];
    if (!incoming?.length) continue;
    const list: unknown[] = Array.isArray(next.permissions[kind]) ? next.permissions[kind] : [];
    const have = new Set(list.filter((r): r is string => typeof r === 'string'));
    const addedRules: string[] = [];
    for (const r of incoming) {
      if (!have.has(r)) {
        list.push(r);
        have.add(r);
        addedRules.push(r);
      }
    }
    if (addedRules.length) {
      next.permissions[kind] = list;
      changes.push({ path: `permissions.${kind}`, from: undefined, to: addedRules });
    }
  }
  return { next, changes };
}
