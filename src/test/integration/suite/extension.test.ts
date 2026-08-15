import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'argalla.handsfree-claude-code';

describe('extension (integration)', () => {
  it('is present and activates on demand', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    await ext!.activate();
    assert.ok(ext!.isActive);
  });

  it('registers its commands', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const c of ['handsfree.enable', 'handsfree.revert', 'handsfree.doctor', 'handsfree._doctorReport']) {
      assert.ok(all.includes(c), `command ${c} missing`);
    }
  });

  it('non-interactive doctor report has the expected shape', async () => {
    const report: any = await vscode.commands.executeCommand('handsfree._doctorReport');
    assert.ok(report && Array.isArray(report.findings));
    assert.ok(report.findings.length > 0);
    assert.ok(report.env && typeof report.env.claudeSettingsPath === 'string');
    for (const f of report.findings) {
      assert.ok(['error', 'warn', 'info', 'ok'].includes(f.severity), f.severity);
      assert.ok(typeof f.title === 'string' && f.title.length > 0);
    }
  });
});
