/**
 * Per-project "careful" profile and portable Handsfree profiles.
 *
 * Careful profile = the project's .claude/settings.local.json gets
 *   permissions.disableBypassPermissionsMode = "disable"   (works from any scope → bypass refused here)
 *   permissions.defaultMode = "default"                     (terminal sessions here start in Manual)
 * The VS Code extension never reads project settings for the *starting* mode, but Claude Code itself
 * refuses bypass when any scope disables it, so a conversation started in this project falls back to
 * a mode that asks — which is exactly what "careful" means.
 */
import { ClaudeSettings, isPlainObject } from './claudeSettings';

export const CAREFUL_KEYS = { disable: 'disableBypassPermissionsMode', mode: 'defaultMode' } as const;

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

export function applyCarefulProfile(input: ClaudeSettings | undefined): { next: ClaudeSettings; changed: boolean } {
  const next: ClaudeSettings = isPlainObject(input) ? clone(input) : {};
  if (!isPlainObject(next.permissions)) next.permissions = {};
  let changed = false;
  if (next.permissions[CAREFUL_KEYS.disable] !== 'disable') {
    next.permissions[CAREFUL_KEYS.disable] = 'disable';
    changed = true;
  }
  if (next.permissions[CAREFUL_KEYS.mode] !== 'default') {
    next.permissions[CAREFUL_KEYS.mode] = 'default';
    changed = true;
  }
  return { next, changed };
}

/** Removes only what the careful profile set; if the file ends up empty, `empty` is true (caller may delete it). */
export function removeCarefulProfile(input: ClaudeSettings): { next: ClaudeSettings; changed: boolean; empty: boolean } {
  const next: ClaudeSettings = clone(input);
  let changed = false;
  if (isPlainObject(next.permissions)) {
    if (next.permissions[CAREFUL_KEYS.disable] === 'disable') {
      delete next.permissions[CAREFUL_KEYS.disable];
      changed = true;
    }
    if (next.permissions[CAREFUL_KEYS.mode] === 'default') {
      delete next.permissions[CAREFUL_KEYS.mode];
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

export function buildProfile(
  claude: ClaudeSettings | undefined,
  vscode: { allow?: boolean; mode?: string },
  now: Date = new Date(),
): HandsfreeProfile {
  const p = isPlainObject(claude?.permissions) ? claude!.permissions : {};
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
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

export function parseProfile(data: unknown): HandsfreeProfile | undefined {
  if (!isPlainObject(data) || data.format !== 'handsfree-profile' || data.version !== 1) return undefined;
  if (!isPlainObject(data.claude) || !isPlainObject(data.vscode)) return undefined;
  return data as HandsfreeProfile;
}

/** Merges a profile into settings: scalar keys overwrite, ask/deny lists are unioned. */
export function applyProfile(input: ClaudeSettings | undefined, profile: HandsfreeProfile): { next: ClaudeSettings; changes: string[] } {
  const next: ClaudeSettings = isPlainObject(input) ? clone(input) : {};
  if (!isPlainObject(next.permissions)) next.permissions = {};
  const changes: string[] = [];
  const c = profile.claude;
  if (c.defaultMode !== undefined && next.permissions.defaultMode !== c.defaultMode) {
    next.permissions.defaultMode = c.defaultMode;
    changes.push('permissions.defaultMode');
  }
  if (c.disableBypassPermissionsMode !== undefined && next.permissions.disableBypassPermissionsMode !== c.disableBypassPermissionsMode) {
    next.permissions.disableBypassPermissionsMode = c.disableBypassPermissionsMode;
    changes.push('permissions.disableBypassPermissionsMode');
  }
  if (c.skipDangerousModePermissionPrompt !== undefined && next.skipDangerousModePermissionPrompt !== c.skipDangerousModePermissionPrompt) {
    next.skipDangerousModePermissionPrompt = c.skipDangerousModePermissionPrompt;
    changes.push('skipDangerousModePermissionPrompt');
  }
  for (const kind of ['ask', 'deny'] as const) {
    const incoming = c[kind];
    if (!incoming?.length) continue;
    const list: unknown[] = Array.isArray(next.permissions[kind]) ? next.permissions[kind] : [];
    const have = new Set(list.filter((r): r is string => typeof r === 'string'));
    let n = 0;
    for (const r of incoming) {
      if (!have.has(r)) {
        list.push(r);
        have.add(r);
        n++;
      }
    }
    if (n) {
      next.permissions[kind] = list;
      changes.push(`permissions.${kind} (+${n})`);
    }
  }
  return { next, changes };
}
