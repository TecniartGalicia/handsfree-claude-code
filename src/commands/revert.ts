import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { backupSettingsFile, restoreClaudeSettings, settingsChangedSinceSnapshot } from '../core/snapshot';
import { clearSnapshot, loadSnapshot, log, offerReload, resolveBackupDir } from '../vscode/env';
import { inspectOfficialExtension, restoreOfficialGlobalValues } from '../vscode/officialExtension';

/**
 * "Revert": put both files back exactly as they were before the FIRST un-reverted Enable.
 * The current settings file is copied first, so a Revert is itself reversible by hand.
 */
export async function revertAutonomousMode(context: vscode.ExtensionContext): Promise<void> {
  const snap = await loadSnapshot(context);
  if (!snap) {
    void vscode.window.showInformationMessage(l10n.t('Nothing to revert: "Enable autonomous mode" has not been run on this machine (or its snapshot was removed).'));
    return;
  }

  const when = new Date(snap.createdAt).toLocaleString();
  const changedSince = await settingsChangedSinceSnapshot(snap);
  const lines: string[] = [];
  lines.push(
    snap.claude.existedBefore
      ? l10n.t('• Restore {0} from the backup taken on {1}', snap.claude.settingsPath, when)
      : l10n.t('• Delete {0} (it did not exist before)', snap.claude.settingsPath),
  );
  if (changedSince) lines.push(l10n.t('  The file has been edited since autonomous mode was enabled; those edits will be lost (a copy is saved first in backups/handsfree).'));
  const unset = l10n.t('unset');
  const fmt = (v: unknown) => (v === undefined || v === null ? unset : JSON.stringify(v));
  const officialInstalled = inspectOfficialExtension().installed;
  lines.push(
    l10n.t('• VS Code (user): claudeCode.allowDangerouslySkipPermissions = {0}, claudeCode.initialPermissionMode = {1}', fmt(snap.vscode.allowDangerouslySkipPermissions), fmt(snap.vscode.initialPermissionMode)) +
      (officialInstalled ? '' : ' ' + l10n.t('(the Claude Code extension is not installed now; these will still be restored)')),
  );

  const revert = l10n.t('Revert');
  const pick = await vscode.window.showWarningMessage(l10n.t('Revert to the settings from before autonomous mode was enabled?'), { modal: true, detail: lines.join('\n') }, revert);
  if (pick !== revert) return;

  const safety = await backupSettingsFile(snap.claude.settingsPath, resolveBackupDir(), new Date(), 'before-revert');
  log(`Revert: safety copy ${safety ?? 'n/a (file missing)'}`);

  const outcome = await restoreClaudeSettings(snap);
  log(`Revert: claude settings -> ${outcome}`);
  if (outcome === 'backup-missing') {
    void vscode.window.showErrorMessage(
      l10n.t('The backup file {0} is missing, so {1} was left untouched. Edit it by hand or run the Doctor.', snap.claude.backupPath ?? '?', snap.claude.settingsPath),
    );
  }

  // The claudeCode.* keys live in VS Code's own settings, so they can be restored whether or not
  // the official extension is currently installed.
  try {
    await restoreOfficialGlobalValues({ allow: snap.vscode.allowDangerouslySkipPermissions, mode: snap.vscode.initialPermissionMode });
    log('Revert: VS Code claudeCode.* restored');
  } catch (e) {
    log(`Revert: VS Code settings restore failed: ${String(e)}`);
    void vscode.window.showErrorMessage(l10n.t('Claude settings were restored, but the VS Code settings could not be written: {0}.', String(e)));
  }

  await clearSnapshot(context);
  await offerReload(l10n.t('Previous settings restored. Reload the window so the Claude Code extension picks them up.'));
}
