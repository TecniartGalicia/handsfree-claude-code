import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { ClaudeSettings } from '../core/claudeSettings';
import { applyGuardrails, GUARDRAIL_TEMPLATES, installedGuardrails, removeGuardrails } from '../core/guardrails';
import { fileExists, readJsonFile, writeJsonFileAtomic } from '../core/jsonFile';
import { applyCarefulProfile, applyProfile, buildProfile, hasCarefulProfile, parseProfile, removeCarefulProfile } from '../core/profile';
import { backupSettingsFile, pruneBackups } from '../core/snapshot';
import { log, offerReload, readClaudeSettings, resolveBackupDir, resolveClaudeSettingsPath } from '../vscode/env';
import { inspectOfficialExtension, readOfficialGlobalValues, SECTION, KEY_ALLOW, KEY_MODE } from '../vscode/officialExtension';
import { ensurePro } from './licenseService';

const STATE_CAREFUL = 'handsfree.carefulFolders';

export function carefulFolders(context: vscode.ExtensionContext): string[] {
  return context.workspaceState.get<string[]>(STATE_CAREFUL) ?? [];
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file');
  if (!folders.length) {
    void vscode.window.showInformationMessage(l10n.t('Open a folder first: profiles live in the project\'s .claude/settings.local.json.'));
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
    { title: l10n.t('Which project?') },
  );
  return pick?.folder;
}

// ---------------------------------------------------------------------------
// Careful profile per project
// ---------------------------------------------------------------------------

export async function markProjectCareful(context: vscode.ExtensionContext): Promise<void> {
  if (!(await ensurePro(context, l10n.t('Per-project profiles')))) return;
  const folder = await pickFolder();
  if (!folder) return;
  const file = path.join(folder.uri.fsPath, '.claude', 'settings.local.json');
  const current = await readJsonFile<ClaudeSettings>(file);
  if (!current.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not valid JSON; fix it first. Nothing was changed.', file));
    return;
  }
  const { next, changed } = applyCarefulProfile(current.exists ? current.data : undefined);
  const yes = l10n.t('Mark as careful');
  const pick = await vscode.window.showInformationMessage(
    l10n.t('Make Claude Code ask for permission in "{0}"?', folder.name),
    {
      modal: true,
      detail: l10n.t(
        'Writes to {0}:\n  permissions.disableBypassPermissionsMode = "disable"\n  permissions.defaultMode = "default"\n\nClaude Code refuses bypass mode in this project (terminal and VS Code) and terminal sessions start in Manual. Everywhere else your autonomous mode stays as it is. The file is personal (settings.local.json); Claude Code normally keeps it out of git.',
        file,
      ),
    },
    yes,
  );
  if (pick !== yes) return;
  if (changed) await writeJsonFileAtomic(file, next);
  const list = new Set(carefulFolders(context));
  list.add(folder.uri.fsPath);
  await context.workspaceState.update(STATE_CAREFUL, [...list]);
  log(`Careful profile applied to ${file}`);
  void vscode.window.showInformationMessage(l10n.t('"{0}" is now a careful project. New Claude Code conversations here will ask.', folder.name));
}

export async function unmarkProjectCareful(context: vscode.ExtensionContext): Promise<void> {
  if (!(await ensurePro(context, l10n.t('Per-project profiles')))) return;
  const folder = await pickFolder();
  if (!folder) return;
  const file = path.join(folder.uri.fsPath, '.claude', 'settings.local.json');
  const current = await readJsonFile<ClaudeSettings>(file);
  if (!current.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not valid JSON; fix it first. Nothing was changed.', file));
    return;
  }
  if (!current.exists || !hasCarefulProfile(current.data)) {
    void vscode.window.showInformationMessage(l10n.t('"{0}" has no careful profile.', folder.name));
    return;
  }
  const { next, changed, empty } = removeCarefulProfile(current.data);
  if (empty) await fs.rm(file, { force: true });
  else if (changed) await writeJsonFileAtomic(file, next);
  await context.workspaceState.update(STATE_CAREFUL, carefulFolders(context).filter((p) => p !== folder.uri.fsPath));
  log(`Careful profile removed from ${file}${empty ? ' (file deleted)' : ''}`);
  void vscode.window.showInformationMessage(l10n.t('"{0}" is no longer a careful project.', folder.name));
}

// ---------------------------------------------------------------------------
// Guardrails (ask / deny rules in the user settings — they keep working in bypass mode)
// ---------------------------------------------------------------------------

function templateTitle(id: string): string {
  switch (id) {
    case 'destructive-shell':
      return l10n.t('Ask before destructive shell commands');
    case 'secrets':
      return l10n.t('Never read secret files');
    case 'publishing':
      return l10n.t('Ask before publishing packages or releases');
    case 'infra':
      return l10n.t('Ask before touching cloud infrastructure');
    default:
      return id;
  }
}

export async function chooseGuardrails(context: vscode.ExtensionContext): Promise<void> {
  if (!(await ensurePro(context, l10n.t('Guardrails')))) return;
  const settingsPath = resolveClaudeSettingsPath();
  const current = await readClaudeSettings();
  if (!current.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not valid JSON; fix it first. Nothing was changed.', settingsPath));
    return;
  }
  const installed = new Set(installedGuardrails(current.exists ? current.data : undefined));
  const items = GUARDRAIL_TEMPLATES.map((t) => ({
    label: templateTitle(t.id),
    description: t.ask ? l10n.t('{0} ask rule(s)', t.ask.length) : l10n.t('{0} deny rule(s)', t.deny?.length ?? 0),
    detail: t.detail,
    picked: installed.has(t.id),
    id: t.id,
  }));
  const picks = await vscode.window.showQuickPick(items, {
    title: l10n.t('Guardrails — rules that keep prompting or blocking even in bypass mode'),
    placeHolder: l10n.t('Select the sets you want; unselect to remove'),
    canPickMany: true,
  });
  if (!picks) return;
  const wanted = new Set(picks.map((p) => p.id));
  const toAdd = [...wanted].filter((id) => !installed.has(id));
  const toRemove = [...installed].filter((id) => !wanted.has(id));
  if (!toAdd.length && !toRemove.length) return;
  let next: ClaudeSettings = current.exists ? current.data : {};
  let removed = 0;
  if (toRemove.length) ({ next, removed } = removeGuardrails(next, toRemove));
  const { next: next2, added } = applyGuardrails(next, toAdd);
  const backup = await backupSettingsFile(settingsPath, resolveBackupDir(), new Date(), 'before-guardrails');
  await pruneBackups(resolveBackupDir(), 10, [backup]);
  await writeJsonFileAtomic(settingsPath, next2);
  log(`Guardrails: +${added.ask.length} ask, +${added.deny.length} deny, -${removed} (backup ${backup ?? 'n/a'})`);
  void vscode.window.showInformationMessage(l10n.t('Guardrails updated: {0} rule(s) added, {1} removed. They apply to new Claude Code sessions.', added.ask.length + added.deny.length, removed));
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

export async function exportProfile(context: vscode.ExtensionContext): Promise<void> {
  if (!(await ensurePro(context, l10n.t('Export / import')))) return;
  const current = await readClaudeSettings();
  if (!current.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not valid JSON; fix it first. Nothing was changed.', resolveClaudeSettingsPath()));
    return;
  }
  const vs = inspectOfficialExtension().installed ? readOfficialGlobalValues() : {};
  const profile = buildProfile(current.exists ? current.data : undefined, vs);
  const target = await vscode.window.showSaveDialog({
    title: l10n.t('Export Handsfree profile'),
    defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(), 'handsfree-profile.json')),
    filters: { JSON: ['json'] },
  });
  if (!target) return;
  await fs.writeFile(target.fsPath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  void vscode.window.showInformationMessage(l10n.t('Profile exported to {0}. It contains only permission-mode keys and ask/deny rules — never allow rules, env values or hooks.', target.fsPath));
}

export async function importProfile(context: vscode.ExtensionContext): Promise<void> {
  if (!(await ensurePro(context, l10n.t('Export / import')))) return;
  const picked = await vscode.window.showOpenDialog({ title: l10n.t('Import Handsfree profile'), canSelectMany: false, filters: { JSON: ['json'] } });
  if (!picked?.[0]) return;
  const file = picked[0].fsPath;
  const read = await readJsonFile(file);
  const profile = read.ok && read.exists ? parseProfile(read.data) : undefined;
  if (!profile) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not a Handsfree profile file.', file));
    return;
  }
  const settingsPath = resolveClaudeSettingsPath();
  const current = await readClaudeSettings();
  if (!current.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not valid JSON; fix it first. Nothing was changed.', settingsPath));
    return;
  }
  const { next, changes } = applyProfile(current.exists ? current.data : undefined, profile);
  const vsChanges: string[] = [];
  const contract = inspectOfficialExtension();
  if (contract.installed && contract.supportsBypass) {
    const cur = readOfficialGlobalValues();
    if (profile.vscode.allowDangerouslySkipPermissions !== undefined && cur.allow !== profile.vscode.allowDangerouslySkipPermissions) vsChanges.push(`${SECTION}.${KEY_ALLOW} = ${profile.vscode.allowDangerouslySkipPermissions}`);
    if (profile.vscode.initialPermissionMode !== undefined && cur.mode !== profile.vscode.initialPermissionMode) vsChanges.push(`${SECTION}.${KEY_MODE} = "${profile.vscode.initialPermissionMode}"`);
  }
  if (!changes.length && !vsChanges.length) {
    void vscode.window.showInformationMessage(l10n.t('Nothing to import: your settings already match this profile.'));
    return;
  }
  const yes = l10n.t('Import');
  const pick = await vscode.window.showWarningMessage(
    l10n.t('Import profile from {0}?', path.basename(file)),
    { modal: true, detail: [...changes.map((c) => `${settingsPath}: ${c}`), ...vsChanges.map((c) => `VS Code: ${c}`)].join('\n') + '\n\n' + l10n.t('A backup is saved first.') },
    yes,
  );
  if (pick !== yes) return;
  const backup = await backupSettingsFile(settingsPath, resolveBackupDir(), new Date(), 'before-import');
  await pruneBackups(resolveBackupDir(), 10, [backup]);
  if (changes.length) await writeJsonFileAtomic(settingsPath, next);
  if (vsChanges.length) {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    if (profile.vscode.allowDangerouslySkipPermissions !== undefined) await cfg.update(KEY_ALLOW, profile.vscode.allowDangerouslySkipPermissions, vscode.ConfigurationTarget.Global);
    if (profile.vscode.initialPermissionMode !== undefined) await cfg.update(KEY_MODE, profile.vscode.initialPermissionMode, vscode.ConfigurationTarget.Global);
  }
  log(`Profile imported from ${file}: ${changes.join(', ')}${vsChanges.length ? ' | ' + vsChanges.join(', ') : ''}`);
  await offerReload(l10n.t('Profile imported. Reload the window so the Claude Code extension picks up its settings.'));
}

/** Used by the Doctor: which project files are our own careful profiles (info, not warning). */
export async function ownedProfilePaths(context: vscode.ExtensionContext): Promise<string[]> {
  const out: string[] = [];
  for (const folder of carefulFolders(context)) {
    const f = path.join(folder, '.claude', 'settings.local.json');
    if (await fileExists(f)) out.push(f);
  }
  return out;
}
