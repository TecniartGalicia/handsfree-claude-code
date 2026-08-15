import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { removeAllowRules, removeHooksDetailed } from '../core/claudeSettings';
import { DoctorInput, evaluate, Finding, FixKind, maskSecrets, planFixAll, summarize } from '../core/findings';
import { readJsonFile, writeJsonFileAtomic } from '../core/jsonFile';
import { claudeConfigDir, legacyManagedSettingsCandidates } from '../core/paths';
import { fileExists } from '../core/jsonFile';
import { DoctorReport, redact, renderReportMarkdown } from '../core/report';
import { backupSettingsFile, pruneBackups } from '../core/snapshot';
import { enableAutonomousMode } from '../commands/enable';
import { loadSnapshot, log, offerReload, openFileAt, readClaudeSettings, readManagedSettings, resolveBackupDir, resolveClaudeSettingsPath } from '../vscode/env';
import { inspectOfficialExtension, OfficialValues, readOfficialValues } from '../vscode/officialExtension';
import { findInstalledRogueExtensions, uninstalledThisSession, uninstallExtension } from '../vscode/rogueExtensions';

export type { DoctorReport } from '../core/report';

/** Per-file read timeout so a hung network drive cannot freeze the Doctor. */
const READ_TIMEOUT_MS = 5000;

/** Collects everything the pure evaluator needs. Never throws for a single unreadable file. */
export async function collect(): Promise<DoctorInput> {
  const claudePath = resolveClaudeSettingsPath();
  const [claude, managed] = await Promise.all([readClaudeSettings(READ_TIMEOUT_MS), readManagedSettings(READ_TIMEOUT_MS)]);
  const contract = inspectOfficialExtension();
  const values: OfficialValues = contract.installed ? readOfficialValues() : { allowScope: 'unset', modeScope: 'unset' };

  const workspaceFiles: DoctorInput['workspaceFiles'] = [];
  const seen = new Set<string>([path.normalize(claudePath).toLowerCase()]);
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') continue; // virtual workspaces: nothing to read
    for (const name of ['settings.json', 'settings.local.json']) {
      const p = path.join(folder.uri.fsPath, '.claude', name);
      const key = path.normalize(p).toLowerCase();
      if (seen.has(key)) continue; // e.g. the home folder opened as a workspace → same file as user settings
      seen.add(key);
      workspaceFiles.push({ path: p, result: await readJsonFile(p, READ_TIMEOUT_MS) });
    }
  }
  const legacyManagedFiles: string[] = [];
  for (const p of legacyManagedSettingsCandidates()) if (await fileExists(p)) legacyManagedFiles.push(p);
  return {
    claudePath,
    claude,
    managed,
    legacyManagedFiles,
    official: {
      installed: contract.installed,
      version: contract.version,
      supportsBypass: contract.supportsBypass,
      olderThanTested: contract.olderThanTested,
      allow: values.allow,
      mode: values.mode,
    },
    rogueExtensions: findInstalledRogueExtensions(),
    uninstalledPendingReload: [...uninstalledThisSession],
    workspaceFiles,
  };
}

export async function runDoctor(context: vscode.ExtensionContext): Promise<DoctorReport> {
  const input = await collect();
  const findings = evaluate(input, l10n.t);
  const report: DoctorReport = {
    generatedAt: new Date().toISOString(),
    findings,
    env: {
      platform: `${os.platform()} ${os.release()}`,
      vscodeVersion: vscode.version,
      officialVersion: input.official.version,
      claudeSettingsPath: input.claudePath,
      extensionVersion: String((context.extension.packageJSON as any)?.version ?? '?'),
    },
  };
  const s = summarize(findings);
  log(`Doctor: ${s.errors} error(s), ${s.warnings} warning(s), ${s.infos} info, ${s.oks} ok`);
  return report;
}

const ICON: Record<Finding['severity'], string> = { error: '$(error)', warn: '$(warning)', info: '$(info)', ok: '$(pass)' };

interface Item extends vscode.QuickPickItem {
  finding?: Finding;
  action?: 'copy' | 'open-report' | 'rerun' | 'fix-all';
}

function redactOpts(): { extraDirs: string[] } {
  return { extraDirs: [claudeConfigDir(), path.dirname(resolveClaudeSettingsPath())] };
}

/** Interactive Doctor: list → pick → fix → re-run, until the user closes it. */
export async function showDoctor(context: vscode.ExtensionContext): Promise<void> {
  for (;;) {
    const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t('Handsfree Doctor: checking…') }, () => runDoctor(context));
    const s = summarize(report.findings);
    const plan = planFixAll(report.findings);

    const items: Item[] = [];
    const push = (sev: Finding['severity'], label: string) => {
      const group = report.findings.filter((f) => f.severity === sev);
      if (!group.length) return;
      items.push({ label, kind: vscode.QuickPickItemKind.Separator });
      for (const f of group) {
        items.push({
          label: `${ICON[sev]} ${f.title}`,
          description: f.fix ? (f.fix.kind === 'open-file' ? l10n.t('Open file') : l10n.t('Fix')) : f.detail ? l10n.t('Details') : '',
          detail: f.detail ? f.detail.split('\n')[0] : undefined,
          finding: f,
        });
      }
    };
    push('error', l10n.t('Problems'));
    push('warn', l10n.t('Warnings'));
    push('info', l10n.t('Notes'));
    push('ok', l10n.t('OK'));
    items.push({ label: l10n.t('Actions'), kind: vscode.QuickPickItemKind.Separator });
    if (plan.length > 1) items.push({ label: `$(tools) ${l10n.t('Fix all problems ({0} actions)', plan.length)}`, action: 'fix-all' });
    items.push({ label: `$(clippy) ${l10n.t('Copy report to clipboard')}`, description: l10n.t('for a bug report or a colleague'), action: 'copy' });
    items.push({ label: `$(markdown) ${l10n.t('Open report as Markdown')}`, action: 'open-report' });
    items.push({ label: `$(refresh) ${l10n.t('Run again')}`, action: 'rerun' });

    const title =
      s.errors + s.warnings === 0
        ? l10n.t('Handsfree Doctor — all good. Remember: changes apply to NEW Claude Code conversations.')
        : l10n.t('Handsfree Doctor — {0} problem(s), {1} warning(s)', s.errors, s.warnings);

    const pick = await vscode.window.showQuickPick(items, { title, placeHolder: l10n.t('Select an item to fix it or open the file; Esc to close'), matchOnDetail: true, matchOnDescription: true });
    if (!pick) return;

    if (pick.action === 'copy') {
      await vscode.env.clipboard.writeText(renderReportMarkdown(report, redactOpts()));
      void vscode.window.showInformationMessage(l10n.t('Doctor report copied to the clipboard (home directory and user name redacted).'));
      continue;
    }
    if (pick.action === 'open-report') {
      const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: renderReportMarkdown(report, redactOpts()) });
      await vscode.window.showTextDocument(doc, { preview: false });
      return;
    }
    if (pick.action === 'rerun') continue;
    if (pick.action === 'fix-all') {
      for (const fix of plan) await applyFix(context, fix);
      continue;
    }
    if (pick.finding) {
      const f = pick.finding;
      if (f.fix) await applyFix(context, f.fix, f);
      else if (f.detail) void vscode.window.showInformationMessage(f.title, { modal: true, detail: redact(f.detail, redactOpts()) });
      continue;
    }
  }
}

async function applyFix(context: vscode.ExtensionContext, fix: FixKind, finding?: Finding): Promise<void> {
  switch (fix.kind) {
    case 'enable':
      await enableAutonomousMode(context);
      return;
    case 'open-file':
      await openFileAt(fix.path, fix.line, fix.column);
      return;
    case 'uninstall-extension': {
      const yes = l10n.t('Uninstall');
      const pick = await vscode.window.showWarningMessage(l10n.t('Uninstall extension {0}?', fix.id), { modal: true, detail: finding?.detail }, yes);
      if (pick !== yes) return;
      try {
        await uninstallExtension(fix.id);
        log(`Doctor: uninstalled ${fix.id}`);
        await offerReload(l10n.t('{0} uninstalled. Reload the window to finish removing it.', fix.id));
      } catch (e) {
        void vscode.window.showErrorMessage(l10n.t('Could not uninstall {0}: {1}', fix.id, String(e)));
      }
      return;
    }
    case 'remove-hooks':
    case 'clean-allow': {
      const settingsPath = resolveClaudeSettingsPath();
      const current = await readClaudeSettings();
      if (!current.ok) {
        void vscode.window.showErrorMessage(l10n.t('{0} is not readable right now; nothing was changed. Run the Doctor again.', settingsPath));
        return;
      }
      if (!current.exists) return;
      const what =
        fix.kind === 'remove-hooks'
          ? l10n.t('Remove {0} hook(s) from {1}?', fix.hooks.length, settingsPath)
          : l10n.t('Remove {0} allow rule(s) from {1}?', fix.rules.length, settingsPath);
      const detail = fix.kind === 'remove-hooks' ? fix.hooks.map((h) => `${h.event}: ${maskSecrets(h.command)}`).join('\n') : fix.rules.join('\n');
      const yes = l10n.t('Remove');
      const pick = await vscode.window.showWarningMessage(what, { modal: true, detail: detail + '\n\n' + l10n.t('A backup is saved first.') }, yes);
      if (pick !== yes) return;
      const backup = await backupSettingsFile(settingsPath, resolveBackupDir(), new Date(), 'before-doctor');
      await pruneBackups(resolveBackupDir(), 10, [backup, (await loadSnapshot(context))?.claude.backupPath]);
      if (fix.kind === 'remove-hooks') {
        const { next, removed, skipped } = removeHooksDetailed(current.data, fix.hooks);
        if (removed > 0) await writeJsonFileAtomic(settingsPath, next);
        if (skipped.length > 0) void vscode.window.showWarningMessage(l10n.t('{0} hook(s) were not removed because the file changed since the report; run the Doctor again.', skipped.length));
        else void vscode.window.showInformationMessage(l10n.t('{0} hook(s) removed. Backup: {1}', removed, backup ?? '-'));
        log(`Doctor: removed ${removed} hook(s), skipped ${skipped.length} (backup ${backup ?? 'n/a'})`);
      } else {
        await writeJsonFileAtomic(settingsPath, removeAllowRules(current.data, fix.rules));
        void vscode.window.showInformationMessage(l10n.t('{0} allow rule(s) removed. Backup: {1}', fix.rules.length, backup ?? '-'));
        log(`Doctor: clean-allow applied (backup ${backup ?? 'n/a'})`);
      }
      return;
    }
  }
}
