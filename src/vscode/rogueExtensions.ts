import * as vscode from 'vscode';
import { l10n } from 'vscode';

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
export function knownRogueExtensions(): KnownRogueExtension[] {
  return [
    { id: 'ra1d7.claude-auto-accept', name: 'Claude Auto-Accept', why: l10n.t('Installs a PreToolUse hook with a usage quota; once the free quota is spent it answers "ask" to every tool.') },
    { id: 'adityaguptaa12.claude-auto-approve', name: 'Claude Auto-Approve', why: l10n.t('Rewrites ~/.claude/settings.json (hooks and permissions) every time VS Code starts.') },
    { id: 'kurokawamomo.claude-auto-responder', name: 'Claude Auto Responder', why: l10n.t('Types answers into terminal prompts on your behalf.') },
    { id: 'shiroenguyen.claude-auto-yes', name: 'Claude Auto Yes', why: l10n.t('Auto-answers prompts on your behalf.') },
    { id: 'tjcg.auto-accept-claude-code', name: 'Auto Accept for Claude Code', why: l10n.t('Installs hooks, allow rules and DevTools auto-clicking; several layers that break independently.') },
  ];
}

/** Ids uninstalled during this session: VS Code keeps listing them until the window reloads. */
export const uninstalledThisSession = new Set<string>();

export interface InstalledRogue extends KnownRogueExtension {
  version?: string;
}

export function findInstalledRogueExtensions(): InstalledRogue[] {
  const byId = new Map(knownRogueExtensions().map((k) => [k.id.toLowerCase(), k]));
  const out: InstalledRogue[] = [];
  for (const ext of vscode.extensions.all) {
    const known = byId.get(ext.id.toLowerCase());
    if (known) out.push({ ...known, version: (ext.packageJSON as any)?.version });
  }
  return out;
}

export async function uninstallExtension(id: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', id);
  uninstalledThisSession.add(id.toLowerCase());
}
