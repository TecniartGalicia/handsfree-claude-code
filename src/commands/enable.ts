import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { applyAutonomous, BYPASS_MODE, bypassDisabledByPolicy, findRogueHooks, removeHooksDetailed, RogueHook } from '../core/claudeSettings';
import { writeJsonFileAtomic } from '../core/jsonFile';
import { backupSettingsFile, pruneBackups, sha256, Snapshot } from '../core/snapshot';
import {
  loadSnapshot,
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
 *   1. refuse to act on a broken file, an unsupported official extension, or a policy that forbids bypass
 *   2. nothing to do? say so and stop (never rewrite the file or the snapshot for no reason)
 *   3. explicit consent (modal) — shows exactly which files will change
 *   4. snapshot: byte-exact copy + previous VS Code values; an existing un-reverted snapshot is kept,
 *      so Enable → Enable → Revert still returns to the ORIGINAL state
 *   5. write the two Claude keys and the two VS Code keys
 *   6. point out hooks / extensions that would defeat the setting, offer to remove them
 *   7. summary + reload
 */
export async function enableAutonomousMode(context: vscode.ExtensionContext): Promise<void> {
  const settingsPath = resolveClaudeSettingsPath();
  log(`Enable: settings file = ${settingsPath}`);

  // 1a. Official extension contract
  const contract = inspectOfficialExtension();
  if (contract.installed && !contract.supportsBypass) {
    void vscode.window.showErrorMessage(
      l10n.t(
        'Your Claude Code extension ({0}) does not expose the settings this command needs ({1}). Update the Claude Code extension and try again. Nothing was changed.',
        contract.version ?? '?',
        'claudeCode.allowDangerouslySkipPermissions, claudeCode.initialPermissionMode',
      ),
    );
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

  // 2. Nothing to do?
  const { next, changes } = applyAutonomous(current.exists ? current.data : undefined);
  const prevVs = contract.installed ? readOfficialGlobalValues() : {};
  const vsNeedsWrite = contract.installed && (prevVs.allow !== true || prevVs.mode !== BYPASS_MODE);
  if (changes.length === 0 && !vsNeedsWrite) {
    const doctor = l10n.t('Run Doctor');
    const pick = await vscode.window.showInformationMessage(l10n.t('Autonomous mode is already configured. Nothing was changed. If Claude still asks for permission, the Doctor will tell you why.'), doctor);
    if (pick === doctor) await vscode.commands.executeCommand('handsfree.doctor');
    return;
  }

  // 3. Consent
  const enable = l10n.t('Enable autonomous mode');
  const willTouch = [settingsPath, contract.installed ? l10n.t('VS Code user settings (claudeCode.*)') : undefined].filter(Boolean).join('\n');
  const choice = await vscode.window.showWarningMessage(
    l10n.t('Let Claude Code run without asking for permission?'),
    {
      modal: true,
      detail:
        l10n.t(
          'This turns on Claude Code\'s own "bypass permissions" mode: Claude will read, write and run commands in your projects without confirmation prompts. That includes anything a prompt could ask for — deleting files, running scripts, pushing to git.\n\nUse it in repositories you trust and keep backups. A byte-exact copy of your current settings is saved first (next to the file, in backups/handsfree — it may contain the same secrets as the file itself); "Handsfree: Revert" restores it.\n\nChanges apply to NEW Claude Code conversations.',
        ) +
        '\n\n' +
        l10n.t('Files that will change:') +
        '\n' +
        willTouch,
    },
    enable,
  );
  if (choice !== enable) {
    log('Enable cancelled by user at consent dialog');
    return;
  }
  await recordConsent(context);

  // 4. Snapshot (keep the original one if the user never reverted)
  const dir = resolveBackupDir();
  const backupPath = await backupSettingsFile(settingsPath, dir, new Date(), 'before-enable');
  const existing = await loadSnapshot(context);
  let snap: Snapshot;
  if (existing) {
    log(`Existing snapshot from ${existing.createdAt} kept (Revert returns to that state)`);
    snap = { ...existing, claude: { ...existing.claude } };
  } else {
    snap = {
      version: 1,
      createdAt: new Date().toISOString(),
      claude: { settingsPath, existedBefore: current.exists, backupPath },
      vscode: { allowDangerouslySkipPermissions: prevVs.allow, initialPermissionMode: prevVs.mode },
    };
  }

  // 5. Write
  const written = await writeJsonFileAtomic(settingsPath, next);
  snap.claude.writtenSha256 = sha256(written);
  await storeSnapshot(context, snap);
  await pruneBackups(dir, 10, [backupPath, snap.claude.backupPath]);
  for (const c of changes) log(`claude ${c.path}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
  log(`Snapshot stored (backup: ${backupPath ?? 'none — file did not exist'})`);

  let vsWritten = false;
  if (contract.installed) {
    try {
      await writeOfficialAutonomous();
      vsWritten = true;
      log('vscode claudeCode.allowDangerouslySkipPermissions=true, claudeCode.initialPermissionMode=bypassPermissions (Global)');
    } catch (e) {
      log(`vscode settings write failed: ${String(e)}`);
      void vscode.window.showErrorMessage(
        l10n.t('Claude settings were updated, but the VS Code settings could not be written: {0}. Fix your VS Code settings.json and run "Enable autonomous mode" again, or run "Revert" to undo everything.', String(e)),
      );
    }
  } else {
    log('Official Claude Code extension not installed — VS Code side skipped');
  }

  // 6. Things that would defeat the setting
  const allRogue = findRogueHooks(next);
  const knownHooks = allRogue.filter((h) => h.reason === 'known-tool');
  const wildcardHooks = allRogue.filter((h) => h.reason === 'wildcard');
  let hooksRemoved = 0;
  if (knownHooks.length > 0) {
    const r = await offerRemoveHooks(settingsPath, next, knownHooks);
    hooksRemoved = r.removed;
    if (r.written !== undefined) {
      // keep the fingerprint in sync with what is on disk now
      snap.claude.writtenSha256 = sha256(r.written);
      await storeSnapshot(context, snap);
    }
  }

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

  // 7. Summary
  const out = output();
  out.appendLine('');
  out.appendLine(l10n.t('Autonomous mode configured.'));
  out.appendLine(`  ${settingsPath}`);
  for (const c of changes) out.appendLine(`    ${c.path}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
  if (vsWritten) out.appendLine('  VS Code (user): claudeCode.allowDangerouslySkipPermissions = true, claudeCode.initialPermissionMode = "bypassPermissions"');
  if (backupPath) out.appendLine(`  ${l10n.t('Backup')}: ${backupPath}`);
  if (hooksRemoved) out.appendLine(`  ${l10n.t('Hooks removed')}: ${hooksRemoved}`);
  if (extsRemoved) out.appendLine(`  ${l10n.t('Extensions uninstalled')}: ${extsRemoved}`);
  if (wildcardHooks.length) out.appendLine(`  ${l10n.t('Hooks matching every tool (review with the Doctor)')}: ${wildcardHooks.length}`);

  const notes: string[] = [];
  const remainingExts = rogueExts.length - extsRemoved;
  if (remainingExts > 0) notes.push(l10n.t('{0} conflicting extension(s) were kept.', remainingExts));
  if (wildcardHooks.length > 0) notes.push(l10n.t('{0} hook(s) apply to every tool and may still ask.', wildcardHooks.length));
  const tail = notes.length ? ' ' + notes.join(' ') + ' ' + l10n.t('Run the Doctor to confirm.') : '';

  const message = vsWritten
    ? l10n.t('Autonomous mode configured. New Claude Code conversations will start without permission prompts. Reload the window so the Claude Code extension picks up its new settings.')
    : l10n.t('Autonomous mode configured for the Claude Code CLI. New sessions will start without permission prompts.');
  if (vsWritten) await offerReload(message + tail);
  else void vscode.window.showInformationMessage(message + tail);
}

async function offerRemoveHooks(settingsPath: string, settings: Record<string, any>, hooks: RogueHook[]): Promise<{ removed: number; written?: string }> {
  const remove = l10n.t('Remove hook(s)');
  const keep = l10n.t('Keep');
  const list = hooks.map((h) => `${h.event}${h.matcher ? ` [${h.matcher}]` : ''}: ${h.command}`).join('\n');
  const pick = await vscode.window.showWarningMessage(
    l10n.t('Your Claude settings contain {0} hook(s) that auto-approve permissions (typically left by a third-party auto-accept tool). They decide permissions before Claude Code does and can override the mode you just enabled.', hooks.length),
    { modal: true, detail: list },
    remove,
    keep,
  );
  if (pick !== remove) return { removed: 0 };
  const { next, removed, skipped } = removeHooksDetailed(settings, hooks);
  const written = removed > 0 ? await writeJsonFileAtomic(settingsPath, next) : undefined;
  for (const h of hooks) log(`${skipped.includes(h) ? 'Skipped (changed since)' : 'Removed'} hook ${h.event}[${h.groupIndex}].hooks[${h.hookIndex}]: ${h.command}`);
  return { removed, written };
}
