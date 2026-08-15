import * as vscode from 'vscode';
import { l10n } from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { backupDir, claudeSettingsPath, managedSettingsCandidates, managedSettingsDropinDir } from '../core/paths';
import { readJsonFile, ReadResult } from '../core/jsonFile';
import { ClaudeSettings } from '../core/claudeSettings';
import { loadSnapshotFile, retireSnapshotFile, saveSnapshot, Snapshot } from '../core/snapshot';

export const OUTPUT_NAME = 'Handsfree for Claude Code';
const STATE_SNAPSHOT = 'handsfree.lastSnapshot';
const STATE_CONSENT = 'handsfree.consentAcceptedAt';

let channel: vscode.OutputChannel | undefined;

export function output(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel(OUTPUT_NAME);
  return channel;
}

export function log(line: string): void {
  output().appendLine(`[${new Date().toISOString()}] ${line}`);
}

/** Resolves the Claude settings path honouring the `handsfree.claudeSettingsPath` override. */
export function resolveClaudeSettingsPath(): string {
  const override = vscode.workspace.getConfiguration('handsfree').get<string>('claudeSettingsPath') ?? '';
  return claudeSettingsPath(override);
}

export function resolveBackupDir(): string {
  return backupDir(resolveClaudeSettingsPath());
}

export async function readClaudeSettings(timeoutMs?: number): Promise<ReadResult<ClaudeSettings>> {
  return readJsonFile<ClaudeSettings>(resolveClaudeSettingsPath(), timeoutMs);
}

/** Managed (policy) settings, if any exist on this machine. */
/**
 * File-based managed (policy) settings: the main managed-settings.json plus every non-hidden
 * *.json in managed-settings.d/ (alphabetical), the way Claude Code merges them.
 */
export async function readManagedSettings(timeoutMs?: number): Promise<{ path: string; result: ReadResult<ClaudeSettings> }[]> {
  const out: { path: string; result: ReadResult<ClaudeSettings> }[] = [];
  for (const p of managedSettingsCandidates()) {
    const result = await readJsonFile<ClaudeSettings>(p, timeoutMs);
    if (result.exists) out.push({ path: p, result });
  }
  for (const p of await listDropins(managedSettingsDropinDir())) {
    const result = await readJsonFile<ClaudeSettings>(p, timeoutMs);
    if (result.exists) out.push({ path: p, result });
  }
  return out;
}

async function listDropins(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
    return names
      .filter((n) => n.endsWith('.json') && !n.startsWith('.'))
      .sort()
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

export async function storeSnapshot(context: vscode.ExtensionContext, snap: Snapshot): Promise<void> {
  await context.globalState.update(STATE_SNAPSHOT, snap);
  try {
    await saveSnapshot(resolveBackupDir(), snap);
  } catch (e) {
    log(`Could not write snapshot file: ${String(e)}`);
  }
}

export async function loadSnapshot(context: vscode.ExtensionContext): Promise<Snapshot | undefined> {
  const fromState = context.globalState.get<Snapshot>(STATE_SNAPSHOT);
  if (fromState && fromState.version === 1) return fromState;
  return loadSnapshotFile(resolveBackupDir());
}

/** Forget the snapshot everywhere (state + file) so a second Revert cannot replay it. */
export async function clearSnapshot(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(STATE_SNAPSHOT, undefined);
  try {
    await retireSnapshotFile(resolveBackupDir());
  } catch (e) {
    log(`Could not retire snapshot file: ${String(e)}`);
  }
}

export async function recordConsent(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(STATE_CONSENT, new Date().toISOString());
}

/** Opens a file in the editor, optionally at a 1-based line/column. */
export async function openFileAt(file: string, line?: number, column?: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(doc);
  if (line) {
    const pos = new vscode.Position(Math.max(0, line - 1), Math.max(0, (column ?? 1) - 1));
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

export async function offerReload(message: string): Promise<void> {
  const reload = l10n.t('Reload Window');
  const later = l10n.t('Later');
  const pick = await vscode.window.showInformationMessage(message, reload, later);
  if (pick === reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
}
