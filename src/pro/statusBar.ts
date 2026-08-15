import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { summarize } from '../core/findings';
import { runDoctor } from '../doctor/doctor';
import { isPro } from './licenseService';

/**
 * Pro status bar item. Deliberately created only after the first Handsfree command in a window
 * (the extension promises "nothing runs at startup"), then kept for the session and refreshed
 * whenever settings change.
 */
let item: vscode.StatusBarItem | undefined;
let timer: NodeJS.Timeout | undefined;

export async function ensureStatusBar(context: vscode.ExtensionContext): Promise<void> {
  if (!(await isPro(context))) return;
  if (!item) {
    item = vscode.window.createStatusBarItem('handsfree.status', vscode.StatusBarAlignment.Right, 50);
    item.name = 'Handsfree for Claude Code';
    item.command = 'handsfree.doctor';
    context.subscriptions.push(item);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('claudeCode') || e.affectsConfiguration('handsfree')) scheduleRefresh(context);
      }),
    );
    const watcher = vscode.workspace.createFileSystemWatcher('**/.claude/settings*.json');
    watcher.onDidChange(() => scheduleRefresh(context));
    watcher.onDidCreate(() => scheduleRefresh(context));
    watcher.onDidDelete(() => scheduleRefresh(context));
    context.subscriptions.push(watcher);
  }
  await refresh(context);
  item.show();
}

function scheduleRefresh(context: vscode.ExtensionContext): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void refresh(context), 800);
}

export async function refresh(context: vscode.ExtensionContext): Promise<void> {
  if (!item) return;
  try {
    const report = await runDoctor(context);
    const s = summarize(report.findings);
    const modeOk = report.findings.some((f) => f.id === 'ext.mode' && f.severity === 'ok') || report.findings.some((f) => f.id === 'claude.defaultMode' && f.severity === 'ok');
    const careful = report.findings.some((f) => f.id.startsWith('ws.policy:'));
    if (s.errors > 0) {
      item.text = `$(error) Handsfree`;
      item.tooltip = l10n.t('Handsfree: {0} problem(s) — Claude will ask. Click for the Doctor.', s.errors);
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (careful) {
      item.text = `$(shield) Handsfree: careful`;
      item.tooltip = l10n.t('This project has a careful profile: Claude asks here. Click for the Doctor.');
      item.backgroundColor = undefined;
    } else if (s.warnings > 0) {
      item.text = `$(warning) Handsfree`;
      item.tooltip = l10n.t('Handsfree: {0} warning(s). Click for the Doctor.', s.warnings);
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      item.text = modeOk ? `$(pass) Handsfree` : `$(circle-outline) Handsfree`;
      item.tooltip = modeOk ? l10n.t('Handsfree: autonomous mode configured. Click for the Doctor.') : l10n.t('Handsfree: click for the Doctor.');
      item.backgroundColor = undefined;
    }
  } catch {
    item.text = `$(question) Handsfree`;
    item.tooltip = l10n.t('Handsfree: click for the Doctor.');
  }
}
