import * as vscode from 'vscode';

export interface KnownRogueExtension {
  id: string;
  name: string;
  /** Why it conflicts, in one line. */
  why: string;
}

/**
 * Third-party extensions that intercept Claude Code permissions (hooks, terminal typing, DOM clicking).
 * Any of them can override the native mode we configure — or, as seen in the wild, start returning
 * "ask" for every tool once a paid quota runs out.
 */
export const KNOWN_ROGUE_EXTENSIONS: KnownRogueExtension[] = [
  { id: 'ra1d7.claude-auto-accept', name: 'Claude Auto-Accept', why: 'PreToolUse hook with a usage quota; answers "ask" to everything once the free quota is spent' },
  { id: 'adityaguptaa12.claude-auto-approve', name: 'Claude Auto-Approve', why: 'Rewrites ~/.claude/settings.json (hooks + permissions) on every VS Code start' },
  { id: 'kurokawamomo.claude-auto-responder', name: 'Claude Auto Responder', why: 'Types answers into terminal prompts; conflicts with the native mode' },
  { id: 'shiroenguyen.claude-auto-yes', name: 'Claude Auto Yes', why: 'Auto-answers prompts on your behalf' },
  { id: 'tjcg.auto-accept-claude-code', name: 'Auto Accept for Claude Code', why: 'Installs hooks, allow rules and DevTools auto-clicking; four layers that break independently' },
];

export interface InstalledRogue extends KnownRogueExtension {
  version?: string;
}

export function findInstalledRogueExtensions(): InstalledRogue[] {
  const byId = new Map(KNOWN_ROGUE_EXTENSIONS.map((k) => [k.id.toLowerCase(), k]));
  const out: InstalledRogue[] = [];
  for (const ext of vscode.extensions.all) {
    const known = byId.get(ext.id.toLowerCase());
    if (known) out.push({ ...known, version: (ext.packageJSON as any)?.version });
  }
  return out;
}

export async function uninstallExtension(id: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', id);
}
