/**
 * Pure logic over Claude Code's settings.json. No `vscode` imports here so it is unit-testable.
 *
 * Only the keys Claude Code itself documents are touched:
 *   permissions.defaultMode           -> "bypassPermissions"
 *   skipDangerousModePermissionPrompt -> true   (the "I accept the risk" dialog, pre-answered)
 */

export type ClaudeSettings = Record<string, any>;

export const BYPASS_MODE = 'bypassPermissions';
export const KNOWN_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'] as const;

export interface Change {
  path: string;
  from: unknown;
  to: unknown;
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Returns a new settings object with autonomous mode applied, plus the list of changes made. */
export function applyAutonomous(input: ClaudeSettings | undefined): { next: ClaudeSettings; changes: Change[] } {
  const next: ClaudeSettings = isPlainObject(input) ? clone(input) : {};
  const changes: Change[] = [];

  // Valid JSON whose root is not an object (an array, a number, a string…): Claude Code ignores such a
  // file anyway, but replacing it silently would hide a real loss — record it so the consent dialog shows it.
  if (input !== undefined && !isPlainObject(input)) changes.push({ path: '', from: input, to: {} });

  if (!isPlainObject(next.permissions)) {
    if (next.permissions !== undefined) changes.push({ path: 'permissions', from: next.permissions, to: {} });
    next.permissions = {};
  }
  if (next.permissions.defaultMode !== BYPASS_MODE) {
    changes.push({ path: 'permissions.defaultMode', from: next.permissions.defaultMode, to: BYPASS_MODE });
    next.permissions.defaultMode = BYPASS_MODE;
  }
  if (next.skipDangerousModePermissionPrompt !== true) {
    changes.push({ path: 'skipDangerousModePermissionPrompt', from: next.skipDangerousModePermissionPrompt, to: true });
    next.skipDangerousModePermissionPrompt = true;
  }
  return { next, changes };
}

export function effectiveDefaultMode(s: ClaudeSettings | undefined): string | undefined {
  const m = s?.permissions?.defaultMode;
  return typeof m === 'string' ? m : undefined;
}

/** True when this settings object forbids bypass mode (usually via managed/policy settings). */
export function bypassDisabledByPolicy(s: ClaudeSettings | undefined): boolean {
  return s?.permissions?.disableBypassPermissionsMode === 'disable';
}

// ---------------------------------------------------------------------------
// Hooks that pre-decide permissions (the failure mode this extension exists to avoid)
// ---------------------------------------------------------------------------

/** Hook events whose JSON output can decide a permission on the user's behalf. */
export const PERMISSION_HOOK_EVENTS = ['PreToolUse', 'PermissionRequest'] as const;

/** Command fragments used by known third-party auto-accept tools. */
export const KNOWN_ROGUE_HOOK_PATTERNS: RegExp[] = [
  /claude-auto-accept/i,
  /claude-auto-approve/i,
  /claude-auto-yes/i,
  /claude-auto-responder/i,
  /auto[-_]?accept/i,
  /auto[-_]?approve/i,
  /permissionDecision["']?\s*:\s*["']allow/i,
  /decision["']?\s*:\s*["']approve/i,
];

export interface RogueHook {
  event: string;
  /** Index inside settings.hooks[event]. */
  groupIndex: number;
  /** Index inside settings.hooks[event][groupIndex].hooks. */
  hookIndex: number;
  matcher: string | undefined;
  command: string;
  reason: 'known-tool' | 'wildcard';
}

/** Representative tool names; a matcher that accepts all of them is treated as "every tool". */
const PROBE_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent', 'WebFetch', 'NotebookEdit'];

/**
 * Claude Code treats `matcher` as a regular expression ("*" is special-cased to mean everything).
 * Returns true when the matcher applies to every tool: missing/empty, "*", or a regex such as
 * ".*", "^.*$", ".+", "(.*)" that matches all representative tool names.
 */
export function matcherIsWildcard(matcher: string | undefined): boolean {
  if (matcher === undefined) return true;
  const m = matcher.trim();
  if (m === '' || m === '*') return true;
  let re: RegExp;
  try {
    re = new RegExp(m);
  } catch {
    return false; // invalid regex: Claude Code will not match anything with it
  }
  return PROBE_TOOLS.every((t) => re.test(t));
}

/**
 * Finds command hooks on permission-deciding events that either match a known auto-accept tool
 * or apply to every tool ("*" / empty / catch-all regex matcher). The latter may be legitimate
 * (logging), so callers should present them as warnings, not errors.
 */
export function findRogueHooks(s: ClaudeSettings | undefined): RogueHook[] {
  const out: RogueHook[] = [];
  const hooks = s?.hooks;
  if (!isPlainObject(hooks)) return out;
  for (const event of PERMISSION_HOOK_EVENTS) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    groups.forEach((group: any, groupIndex: number) => {
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) return;
      const matcher: string | undefined = typeof group.matcher === 'string' ? group.matcher : undefined;
      const wildcard = matcherIsWildcard(matcher);
      group.hooks.forEach((h: any, hookIndex: number) => {
        if (!isPlainObject(h) || h.type !== 'command' || typeof h.command !== 'string') return;
        const command: string = h.command;
        if (KNOWN_ROGUE_HOOK_PATTERNS.some((re) => re.test(command))) {
          out.push({ event, groupIndex, hookIndex, matcher, command, reason: 'known-tool' });
        } else if (wildcard) {
          out.push({ event, groupIndex, hookIndex, matcher, command, reason: 'wildcard' });
        }
      });
    });
  }
  return out;
}

/**
 * Removes the given hooks and prunes empty groups / events / the hooks object itself.
 * A hook is only removed when the entry at (event, groupIndex, hookIndex) still has the same
 * command — so stale indices (file edited since the findings were computed) never delete
 * somebody else's hook. Returns the new settings and how many hooks were actually removed.
 */
export function removeHooks(input: ClaudeSettings, toRemove: RogueHook[]): ClaudeSettings {
  return removeHooksDetailed(input, toRemove).next;
}

export function removeHooksDetailed(input: ClaudeSettings, toRemove: RogueHook[]): { next: ClaudeSettings; removed: number; skipped: RogueHook[] } {
  const next = clone(input);
  const skipped: RogueHook[] = [];
  let removed = 0;
  if (!isPlainObject(next.hooks)) return { next, removed, skipped: [...toRemove] };
  const byEvent = new Map<string, Map<number, Map<number, RogueHook>>>();
  for (const r of toRemove) {
    if (!byEvent.has(r.event)) byEvent.set(r.event, new Map());
    const g = byEvent.get(r.event)!;
    if (!g.has(r.groupIndex)) g.set(r.groupIndex, new Map());
    g.get(r.groupIndex)!.set(r.hookIndex, r);
  }
  for (const [event, groups] of byEvent) {
    const arr = next.hooks[event];
    if (!Array.isArray(arr)) {
      for (const g of groups.values()) skipped.push(...g.values());
      continue;
    }
    const kept: any[] = [];
    arr.forEach((group: any, gi: number) => {
      const wanted = groups.get(gi);
      if (!wanted || !isPlainObject(group) || !Array.isArray(group.hooks)) {
        if (wanted) skipped.push(...wanted.values());
        kept.push(group);
        return;
      }
      const remaining = group.hooks.filter((h: any, hi: number) => {
        const r = wanted.get(hi);
        if (!r) return true;
        const same = isPlainObject(h) && h.command === r.command;
        if (same) removed++;
        else skipped.push(r);
        return !same;
      });
      if (remaining.length > 0) kept.push({ ...group, hooks: remaining });
    });
    // groups referenced beyond the array length
    for (const [gi, wanted] of groups) if (gi >= arr.length) skipped.push(...wanted.values());
    if (kept.length > 0) next.hooks[event] = kept;
    else delete next.hooks[event];
  }
  if (Object.keys(next.hooks).length === 0) delete next.hooks;
  return { next, removed, skipped };
}

// ---------------------------------------------------------------------------
// Allow-list hygiene
// ---------------------------------------------------------------------------

export interface StaleRule {
  rule: string;
  reason: 'redundant-wildcard' | 'renamed-tool' | 'foreign' | 'unknown-mcp-pattern';
  detail: string;
}

/** Tools that no longer exist under that name in current Claude Code releases. */
const RENAMED_TOOLS: Record<string, string> = {
  Task: 'Agent',
  MultiEdit: 'Edit',
};

// Only bare pseudo-tools (`__claude-auto-approve__`, `auto-accept`) — never `Tool(pattern)` rules, where
// "auto-accept" may simply be part of a legitimate command (`Bash(npm run auto-accept-check *)`).
const FOREIGN_RULE_PATTERNS: RegExp[] = [/^__.*__$/, /^[^()]*auto[-_]?accept[^()]*$/i, /^[^()]*auto[-_]?approve[^()]*$/i];

/**
 * Flags allow-list entries that do nothing (or belong to other tools). Conservative on purpose:
 * `Tool(*)` is only flagged when the bare `Tool` rule is also present, because then it is redundant
 * for sure; on its own we leave it alone.
 */
export function findStaleAllowRules(allow: unknown): StaleRule[] {
  if (!Array.isArray(allow)) return [];
  const rules = allow.filter((r): r is string => typeof r === 'string');
  const bare = new Set(rules.filter((r) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(r)));
  const out: StaleRule[] = [];
  for (const rule of rules) {
    const wild = /^([A-Za-z_][A-Za-z0-9_]*)\(\*\)$/.exec(rule);
    if (wild && bare.has(wild[1])) {
      out.push({ rule, reason: 'redundant-wildcard', detail: `"${wild[1]}" already allows everything for that tool` });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(RENAMED_TOOLS, rule)) {
      out.push({ rule, reason: 'renamed-tool', detail: `Tool "${rule}" is now "${RENAMED_TOOLS[rule]}"` });
      continue;
    }
    if (rule === 'mcp__*(*)') {
      out.push({ rule, reason: 'unknown-mcp-pattern', detail: 'MCP rules take the form "mcp__server" or "mcp__server__tool"' });
      continue;
    }
    if (FOREIGN_RULE_PATTERNS.some((re) => re.test(rule))) {
      out.push({ rule, reason: 'foreign', detail: 'Left behind by a third-party auto-accept extension' });
    }
  }
  return out;
}

export function removeAllowRules(input: ClaudeSettings, rules: string[]): { next: ClaudeSettings; removed: number } {
  const next = clone(input);
  const set = new Set(rules);
  let removed = 0;
  if (isPlainObject(next.permissions) && Array.isArray(next.permissions.allow)) {
    const before = next.permissions.allow.length;
    next.permissions.allow = next.permissions.allow.filter((r: unknown) => !(typeof r === 'string' && set.has(r)));
    removed = before - next.permissions.allow.length;
  }
  return { next, removed };
}
