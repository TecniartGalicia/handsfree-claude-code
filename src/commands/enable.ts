import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { applyAutonomous, bypassDisabledByPolicy, findRogueHooks, removeHooks, RogueHook } from '../core/claudeSettings';
import { writeJsonFileAtomic } from '../core/jsonFile';
import { backupSettingsFile, pruneBackups, Snapshot } from '../core/snapshot';
import {
  log,
  offerReload,
  openFileAt,
  output,
  readClaudeSettings,
  readManagedSettings,
  recordConsent,
  resolveBackupDir,
  resolveClaudeSettingsPath,
  storeSnapshot,
} from '../vscode/env';
import { inspectOfficialExtension, readOfficialGlobalValues, writeOfficialAutonomous } from '../vscode/officialExtension';
import { findInstalledRogueExtensions, uninstallExtension } from '../vscode/rogueExtensions';

/**
 * "Enable autonomous mode":
 *   1. refuse to act on a broken file or an unsupported official extension
 *   2. explicit consent (modal)
 *   3. snapshot (byte-exact copy + previous VS Code values)
 *   4. write the two Claude keys and the two VS Code keys
 *   5. point out hooks / extensions that would defeat the setting, offer to remove them
 *   6. summary + reload
 */
export async function enableAutonomousMode(context: vscode.ExtensionContext): Promise<void> {
  const settingsPath = resolveClaudeSettingsPath();
  log(`Enable: settings file = ${settingsPath}`);

  // 1a. Official extension contract
  const contract = inspectOfficialExtension();
  if (contract.installed && !contract.supportsBypass) {
    const msg = l10n.t(
      'Your Claude Code extension ({0}) does not expose the settings this command needs ({1}). Update the Claude Code extension and try again. Nothing was changed.',
      contract.version ?? '?',
      'claudeCode.allowDangerouslySkipPermissions, claudeCode.initialPermissionMode',
    );
    void vscode.window.showErrorMessage(msg);
    log(`Enable aborted: official extension contract not satisfied ${JSON.stringify(contract)}`);
    return;
  }

  // 1b. Claude settings must be readable and valid JSON
  const current = await readClaudeSettings();
  if (!current.ok) {
    const where = current.error.line ? l10n.t(' (line {0}, column {1})', current.error.line, current.error.column ?? 1) : '';
    const open = l10n.t('Open file');
    const pick = await vscode.window.showErrorMessage(
      l10n.t('Claude Code settings file is not valid JSON{0}: {1}. Fix it first — a broken settings.json silently disables all your Claude Code settings. Nothing was changed.', where, current.error.message),
      open,
    );
    if (pick === open) await openFileAt(settingsPath, current.error.line, current.error.column);
    return;
  }

  // 1c. Policy
  if (bypassDisabledByPolicy(current.data)) {
    void vscode.window.showErrorMessage(l10n.t('Bypass mode is disabled by policy in {0} (permissions.disableBypassPermissionsMode). Nothing was changed.', settingsPath));
    return;
  }
  for (const managed of await readManagedSettings()) {
    if (managed.result.ok && bypassDisabledByPolicy(managed.result.data)) {
      void vscode.window.showErrorMessage(l10n.t('Bypass mode is disabled by a managed policy file: {0}. Nothing was changed.', managed.path));
      return;
    }
  }

  // 2. Consent
  const enable = l10n.t('Enable autonomous mode');
  const choice = await vscode.window.showWarningMessage(
    l10n.t('Let Claude Code run without asking for permission?'),
    {
      modal: true,
      detail: l10n.t(
        'This turns on Claude Code\'s own "bypass permissions" mode: Claude will read, write and run commands in your projects without confirmation prompts. That includes anything a prompt could ask for — deleting files, running scripts, pushing to git.\n\nUse it in repositories you trust and keep backups. A byte-exact copy of your current settings is saved first; "Handsfree: Revert" restores it.\n\nChanges apply to NEW Claude Code conversations.',
      ),
    },
    enable,
  );
  if (choice !== enable) {
    log('Enable cancelled by user at consent dialog');
    return;
  }
  await recordConsent(context);

  // 3. Snapshot
  const dir = resolveBackupDir();
  const backupPath = await backupSettingsFile(settingsPath, dir);
  const prevVs = contract.installed ? readOfficialGlobalValues() : {};
  const snap: Snapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    claude: { settingsPath, existedBefore: current.exists, backupPath },
    vscode: { allowDangerouslySkipPermissions: prevVs.allow, initialPermissionMode: prevVs.mode },
  };
  await storeSnapshot(context, snap);
  await pruneBackups(dir, 10);
  log(`Snapshot saved (backup: ${backupPath ?? 'none — file did not exist'})`);

  // 4. Write
  const { next, changes } = applyAutonomous(current.exists ? current.data : undefined);
  await writeJsonFileAtomic(settingsPath, next);
  for (const c of changes) log(`claude ${c.path}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
  if (contract.installed) {
    await writeOfficialAutonomous();
    log('vscode claudeCode.allowDangerouslySkipPermissions=true, claudeCode.initialPermissionMode=bypassPermissions (Global)');
  } else {
    log('Official Claude Code extension not installed — VS Code side skipped');
  }

  // 5. Things that would defeat the setting
  let hooksRemoved = 0;
  const rogueHooks = findRogueHooks(next).filter((h) => h.reason === 'known-tool');
  if (rogueHooks.length > 0) hooksRemoved = await offerRemoveHooks(settingsPath, next, rogueHooks);

  let extsRemoved = 0;
  const rogueExts = findInstalledRogueExtensions();
  for (const ext of rogueExts) {
    const uninstall = l10n.t('Uninstall');
    const keep = l10n.t('Keep');
    const pick = await vscode.window.showWarningMessage(
      l10n.t('"{0}" ({1}) is installed. It intercepts Claude Code permissions and can override the mode you just enabled. {2}', ext.name, ext.id, ext.why),
      uninstall,
      keep,
    );
    if (pick === uninstall) {
      try {
        await uninstallExtension(ext.id);
        extsRemoved++;
        log(`Uninstalled ${ext.id}`);
      } catch (e) {
        log(`Uninstall failed for ${ext.id}: ${String(e)}`);
        void vscode.window.showErrorMessage(l10n.t('Could not uninstall {0}: {1}', ext.id, String(e)));
      }
    }
  }

  // 6. Summary
  output().appendLine('');
  output().appendLine(l10n.t('Autonomous mode configured.'));
  output().appendLine(`  ${settingsPath}`);
  for (const c of changes) output().appendLine(`    ${c.path}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
  if (contract.installed) output().appendLine('  VS Code (user): claudeCode.allowDangerouslySkipPermissions = true, claudeCode.initialPermissionMode = "bypassPermissions"');
  if (backupPath) output().appendLine(`  ${l10n.t('Backup')}: ${backupPath}`);
  if (hooksRemoved) output().appendLine(`  ${l10n.t('Hooks removed')}: ${hooksRemoved}`);
  if (extsRemoved) output().appendLine(`  ${l10n.t('Extensions uninstalled')}: ${extsRemoved}`);

  const remaining = rogueExts.length - extsRemoved;
  const tail = remaining > 0 ? ' ' + l10n.t('Note: {0} conflicting extension(s) were kept; the Doctor can revisit them.', remaining) : '';
  await offerReload(
    l10n.t('Autonomous mode configured. New Claude Code conversations will start without permission prompts. Reload the window so the Claude Code extension picks up its new settings.') + tail,
  );
}

async function offerRemoveHooks(settingsPath: string, settings: Record<string, any>, hooks: RogueHook[]): Promise<number> {
  const remove = l10n.t('Remove hook(s)');
  const keep = l10n.t('Keep');
  const list = hooks.map((h) => `${h.event}${h.matcher ? ` [${h.matcher}]` : ''}: ${h.command}`).join('\n');
  const pick = await vscode.window.showWarningMessage(
    l10n.t('Your Claude settings contain {0} hook(s) from a third-party auto-accept tool. They decide permissions before Claude Code does and can override the mode you just enabled.', hooks.length),
    { modal: true, detail: list },
    remove,
    keep,
  );
  if (pick !== remove) return 0;
  const next = removeHooks(settings, hooks);
  await writeJsonFileAtomic(settingsPath, next);
  for (const h of hooks) log(`Removed hook ${h.event}[${h.groupIndex}].hooks[${h.hookIndex}]: ${h.command}`);
  return hooks.length;
}
