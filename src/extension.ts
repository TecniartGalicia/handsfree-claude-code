import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { enableAutonomousMode } from './commands/enable';
import { revertAutonomousMode } from './commands/revert';
import { runDoctor, setOwnedProfileProvider, showDoctor } from './doctor/doctor';
import { chooseGuardrails, exportProfile, importProfile, markProjectCareful, ownedProfilePaths, unmarkProjectCareful } from './pro/features';
import { activateLicenseCommand, deactivateLicenseCommand, licenseStatusCommand, openCheckout } from './pro/licenseService';
import { DEV_UNLOCK_ENV, polarConfigured } from './pro/polarConfig';
import { ensureStatusBar } from './pro/statusBar';
import { log, output } from './vscode/env';

/**
 * Activation only registers commands. Nothing runs at startup, nothing watches, nothing hooks:
 * this extension configures Claude Code's native permission mode and then gets out of the way.
 * (The Pro status bar appears after the first Handsfree command in a window, for the same reason.)
 */
export function activate(context: vscode.ExtensionContext): void {
  setOwnedProfileProvider(() => ownedProfilePaths(context));
  // Pro commands are hidden from the palette in builds without licensing configured (nothing unpurchasable on show).
  // Removal commands (profile.remove) stay visible: taking away what Handsfree added is always free.
  void vscode.commands.executeCommand('setContext', 'handsfree.proConfigured', polarConfigured() || process.env[DEV_UNLOCK_ENV] === '1');

  const wrap = (name: string, fn: () => Promise<void>) => async () => {
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`${name} failed: ${msg}`);
      void vscode.window.showErrorMessage(l10n.t('Handsfree: {0} failed — {1}', name, msg));
    } finally {
      void ensureStatusBar(context).catch(() => undefined);
    }
  };

  context.subscriptions.push(
    output(),
    vscode.commands.registerCommand('handsfree.enable', wrap('enable', () => enableAutonomousMode(context))),
    vscode.commands.registerCommand('handsfree.revert', wrap('revert', () => revertAutonomousMode(context))),
    vscode.commands.registerCommand('handsfree.doctor', wrap('doctor', () => showDoctor(context))),
    // Pro
    vscode.commands.registerCommand('handsfree.profile.careful', wrap('careful profile', () => markProjectCareful(context))),
    vscode.commands.registerCommand('handsfree.profile.remove', wrap('remove careful profile', () => unmarkProjectCareful(context))),
    vscode.commands.registerCommand('handsfree.guardrails', wrap('guardrails', () => chooseGuardrails(context))),
    vscode.commands.registerCommand('handsfree.export', wrap('export', () => exportProfile(context))),
    vscode.commands.registerCommand('handsfree.import', wrap('import', () => importProfile(context))),
    vscode.commands.registerCommand('handsfree.pro.activate', wrap('activate licence', () => activateLicenseCommand(context))),
    vscode.commands.registerCommand('handsfree.pro.deactivate', wrap('deactivate licence', () => deactivateLicenseCommand(context))),
    vscode.commands.registerCommand('handsfree.pro.status', wrap('licence status', () => licenseStatusCommand(context))),
    vscode.commands.registerCommand('handsfree.pro.buy', wrap('buy', () => openCheckout())),
    // Internal, non-interactive: used by tests and by the status bar. Not listed in the palette.
    vscode.commands.registerCommand('handsfree._doctorReport', () => runDoctor(context)),
  );
}

export function deactivate(): void {
  // nothing to tear down
}
