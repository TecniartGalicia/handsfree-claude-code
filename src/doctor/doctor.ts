import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { removeAllowRules, removeHooksDetailed } from '../core/claudeSettings';
import { DoctorInput, evaluate, Finding, FixKind, summarize } from '../core/findings';
import { readJsonFile, writeJsonFileAtomic } from '../core/jsonFile';
import { backupSettingsFile } from '../core/snapshot';
import { enableAutonomousMode } from '../commands/enable';
import { log, openFileAt, readClaudeSettings, readManagedSettings, resolveBackupDir, resolveClaudeSettingsPath } from '../vscode/env';
import { inspectOfficialExtension, OFFICIAL_EXT_ID, OfficialValues, readOfficialValues } from '../vscode/officialExtension';
import { findInstalledRogueExtensions, uninstallExtension } from '../vscode/rogueExtensions';

export interface DoctorReport {
  generatedAt: string;
  findings: Finding[];
  env: {
    platform: string;
    vscodeVersion: string;
    officialVersion?: string;
    claudeSettingsPath: string;
    extensionVersion: string;
  };
}

/** Collects everything the pure evaluator needs. */
export async function collect(): Promise<DoctorInput> {
  const claudePath = resolveClaudeSettingsPath();
  const [claude, managed] = await Promise.all([readClaudeSettings(), readManagedSettings()]);
  const contract = inspectOfficialExtension();
  const values: OfficialValues = contract.installed ? readOfficialValues() : { allowScope: 'unset', modeScope: 'unset' };
  const workspaceFiles: DoctorInput['workspaceFiles'] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const name of ['settings.json', 'settings.local.json']) {
      const p = path.join(folder.uri.fsPath, '.claude', name);
      workspaceFiles.push({ path: p, result: await readJsonFile(p) });
    }
  }
  return {
    claudePath,
    claude,
    managed,
    official: {
      installed: contract.installed,
      version: contract.version,
      supportsBypass: contract.supportsBypass,
      tested: contract.tested,
      allow: values.allow,
      mode: values.mode,
      allowScope: values.allowScope,
      modeScope: values.modeScope,
    },
    rogueExtensions: findInstalledRogueExtensions(),
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

/** Interactive Doctor: list → pick → fix → re-run, until the user closes it. */
export async function showDoctor(context: vscode.ExtensionContext): Promise<void> {
  // Loop so that after each fix the list refreshes.
  for (;;) {
    const report = await runDoctor(context);
    const s = summarize(report.findings);
    const fixable = report.findings.filter((f) => f.fix && f.fix.kind !== 'open-file' && f.severity !== 'ok');

    const items: Item[] = [];
    const push = (sev: Finding['severity'], label: string) => {
      const group = report.findings.filter((f) => f.severity === sev);
      if (!group.length) return;
      items.push({ label, kind: vscode.QuickPickItemKind.Separator });
      for (const f of group) {
        items.push({
          label: `${ICON[sev]} ${f.title}`,
          description: f.fix ? (f.fix.kind === 'open-file' ? l10n.t('Open file') : l10n.t('Fix')) : '',
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
    if (fixable.length > 1) items.push({ label: `$(tools) ${l10n.t('Fix everything fixable ({0})', fixable.length)}`, action: 'fix-all' });
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
      await vscode.env.clipboard.writeText(renderReportMarkdown(report));
      void vscode.window.showInformationMessage(l10n.t('Doctor report copied to the clipboard (home directory redacted).'));
      continue;
    }
    if (pick.action === 'open-report') {
      const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: renderReportMarkdown(report) });
      await vscode.window.showTextDocument(doc, { preview: false });
      return;
    }
    if (pick.action === 'rerun') continue;
    if (pick.action === 'fix-all') {
      for (const f of fixable) await applyFix(context, f.fix!);
      continue;
    }
    if (pick.finding) {
      if (pick.finding.fix) await applyFix(context, pick.finding.fix);
      else if (pick.finding.detail) void vscode.window.showInformationMessage(pick.finding.title, { modal: true, detail: pick.finding.detail });
      continue;
    }
  }
}

async function applyFix(context: vscode.ExtensionContext, fix: FixKind): Promise<void> {
  switch (fix.kind) {
    case 'enable':
      await enableAutonomousMode(context);
      return;
    case 'open-file':
      await openFileAt(fix.path, fix.line, fix.column);
      return;
    case 'uninstall-extension': {
      const yes = l10n.t('Uninstall');
      const pick = await vscode.window.showWarningMessage(l10n.t('Uninstall extension {0}?', fix.id), { modal: true }, yes);
      if (pick !== yes) return;
      try {
        await uninstallExtension(fix.id);
        log(`Doctor: uninstalled ${fix.id}`);
      } catch (e) {
        void vscode.window.showErrorMessage(l10n.t('Could not uninstall {0}: {1}', fix.id, String(e)));
      }
      return;
    }
    case 'remove-hooks':
    case 'clean-allow': {
      const settingsPath = resolveClaudeSettingsPath();
      const current = await readClaudeSettings();
      if (!current.ok || !current.exists) return;
      const what =
        fix.kind === 'remove-hooks'
          ? l10n.t('Remove {0} hook(s) from {1}?', fix.hooks.length, settingsPath)
          : l10n.t('Remove {0} allow rule(s) from {1}?', fix.rules.length, settingsPath);
      const detail = fix.kind === 'remove-hooks' ? fix.hooks.map((h) => `${h.event}: ${h.command}`).join('\n') : fix.rules.join('\n');
      const yes = l10n.t('Remove');
      const pick = await vscode.window.showWarningMessage(what, { modal: true, detail: detail + '\n\n' + l10n.t('A backup is saved first.') }, yes);
      if (pick !== yes) return;
      const backup = await backupSettingsFile(settingsPath, resolveBackupDir(), new Date(), 'before-doctor');
      if (fix.kind === 'remove-hooks') {
        const { next, removed, skipped } = removeHooksDetailed(current.data, fix.hooks);
        if (removed > 0) await writeJsonFileAtomic(settingsPath, next);
        if (skipped.length > 0) void vscode.window.showWarningMessage(l10n.t('{0} hook(s) were not removed because the file changed since the report; run the Doctor again.', skipped.length));
        log(`Doctor: removed ${removed} hook(s), skipped ${skipped.length} (backup ${backup ?? 'n/a'})`);
      } else {
        await writeJsonFileAtomic(settingsPath, removeAllowRules(current.data, fix.rules));
        log(`Doctor: clean-allow applied (backup ${backup ?? 'n/a'})`);
      }
      return;
    }
  }
}

/** Markdown for issues / colleagues. Home directory is replaced with ~ so it can be pasted publicly. */
export function renderReportMarkdown(report: DoctorReport, home: string = os.homedir()): string {
  const redact = (s: string) => (home ? s.split(home).join('~') : s);
  const s = summarize(report.findings);
  const lines: string[] = [];
  lines.push('# Handsfree for Claude Code — Doctor report');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Handsfree: ${report.env.extensionVersion} · VS Code: ${report.env.vscodeVersion} · ${OFFICIAL_EXT_ID}: ${report.env.officialVersion ?? 'not installed'}`);
  lines.push(`- Platform: ${report.env.platform}`);
  lines.push(`- Claude settings: ${redact(report.env.claudeSettingsPath)}`);
  lines.push(`- Result: ${s.errors} error(s), ${s.warnings} warning(s), ${s.infos} note(s), ${s.oks} ok`);
  lines.push('');
  const label: Record<Finding['severity'], string> = { error: 'ERROR', warn: 'WARN', info: 'INFO', ok: 'OK' };
  for (const f of report.findings) {
    lines.push(`## [${label[f.severity]}] ${redact(f.title)}`);
    if (f.detail) {
      lines.push('');
      lines.push(...redact(f.detail).split('\n').map((l) => `    ${l}`));
    }
    if (f.fix) lines.push(`\n_Fix available: ${f.fix.kind}_`);
    lines.push('');
  }
  lines.push('---');
  lines.push('Settings changes apply to new Claude Code conversations; reload the VS Code window after fixing.');
  return lines.join('\n') + '\n';
}
