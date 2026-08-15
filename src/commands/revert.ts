import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { restoreClaudeSettings } from '../core/snapshot';
import { clearSnapshot, loadSnapshot, log, offerReload } from '../vscode/env';
import { inspectOfficialExtension, restoreOfficialGlobalValues } from '../vscode/officialExtension';

/** "Revert": put both files back exactly as they were before the last Enable. */
export async function revertAutonomousMode(context: vscode.ExtensionContext): Promise<void> {
  const snap = await loadSnapshot(context);
  if (!snap) {
    void vscode.window.showInformationMessage(l10n.t('Nothing to revert: "Enable autonomous mode" has not been run on this machine (or its snapshot was removed).'));
    return;
  }

  const when = new Date(snap.createdAt).toLocaleString();
  const claudeLine = snap.claude.existedBefore
    ? l10n.t('• Restore {0} from the backup taken on {1}', snap.claude.settingsPath, when)
    : l10n.t('• Delete {0} (it did not exist before)', snap.claude.settingsPath);
  const vsLine = l10n.t(
    '• VS Code (user): claudeCode.allowDangerouslySkipPermissions = {0}, claudeCode.initialPermissionMode = {1}',
    JSON.stringify(snap.vscode.allowDangerouslySkipPermissions ?? null).replace('null', l10n.t('unset')),
    JSON.stringify(snap.vscode.initialPermissionMode ?? null).replace('null', l10n.t('unset')),
  );

  const revert = l10n.t('Revert');
  const pick = await vscode.window.showWarningMessage(
    l10n.t('Revert to the settings from before autonomous mode was enabled?'),
    { modal: true, detail: `${claudeLine}\n${vsLine}` },
    revert,
  );
  if (pick !== revert) return;

  const outcome = await restoreClaudeSettings(snap);
  log(`Revert: claude settings -> ${outcome}`);
  if (outcome === 'backup-missing') {
    void vscode.window.showErrorMessage(
      l10n.t('The backup file {0} is missing, so {1} was left untouched. Edit it by hand or run the Doctor.', snap.claude.backupPath ?? '?', snap.claude.settingsPath),
    );
  }

  if (inspectOfficialExtension().installed) {
    await restoreOfficialGlobalValues({ allow: snap.vscode.allowDangerouslySkipPermissions, mode: snap.vscode.initialPermissionMode });
    log('Revert: VS Code claudeCode.* restored');
  }

  await clearSnapshot(context);
  await offerReload(l10n.t('Previous settings restored. Reload the window so the Claude Code extension picks them up.'));
}
