import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { enableAutonomousMode } from './commands/enable';
import { revertAutonomousMode } from './commands/revert';
import { runDoctor, showDoctor } from './doctor/doctor';
import { log } from './vscode/env';

/**
 * Activation only registers commands. Nothing runs at startup, nothing watches, nothing hooks:
 * this extension configures Claude Code's native permission mode and then gets out of the way.
 */
export function activate(context: vscode.ExtensionContext): void {
  const wrap = (name: string, fn: () => Promise<void>) => async () => {
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`${name} failed: ${msg}`);
      void vscode.window.showErrorMessage(l10n.t('Handsfree: {0} failed — {1}', name, msg));
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('handsfree.enable', wrap('enable', () => enableAutonomousMode(context))),
    vscode.commands.registerCommand('handsfree.revert', wrap('revert', () => revertAutonomousMode(context))),
    vscode.commands.registerCommand('handsfree.doctor', wrap('doctor', () => showDoctor(context))),
    // Internal, non-interactive: used by tests and by the status bar. Not listed in the palette.
    vscode.commands.registerCommand('handsfree._doctorReport', () => runDoctor(context)),
  );
}

export function deactivate(): void {
  // nothing to tear down
}
