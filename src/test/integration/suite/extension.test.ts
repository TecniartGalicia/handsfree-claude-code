import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const EXT_ID = 'argalla.handsfree-claude-code';

describe('extension (integration)', () => {
  it('runs against the hermetic CLAUDE_CONFIG_DIR, not the developer home', () => {
    assert.ok(process.env.CLAUDE_CONFIG_DIR, 'CLAUDE_CONFIG_DIR must be set by runTest');
    assert.ok(!path.resolve(process.env.CLAUDE_CONFIG_DIR!).startsWith(path.join(os.homedir(), '.claude')));
  });

  it('is present and activates on demand', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    await ext!.activate();
    assert.ok(ext!.isActive);
  });

  it('registers its commands', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const c of ['handsfree.enable', 'handsfree.revert', 'handsfree.doctor', 'handsfree._doctorReport', 'handsfree.profile.careful', 'handsfree.profile.remove', 'handsfree.guardrails', 'handsfree.export', 'handsfree.import', 'handsfree.pro.activate', 'handsfree.pro.deactivate', 'handsfree.pro.status', 'handsfree.pro.buy']) {
      assert.ok(all.includes(c), `command ${c} missing`);
    }
  });

  it('Doctor sees the broken user file and the workspace override, and its report is redacted', async () => {
    const report: any = await vscode.commands.executeCommand('handsfree._doctorReport');
    assert.ok(report && Array.isArray(report.findings) && report.findings.length > 0);
    const ids: string[] = report.findings.map((f: any) => f.id);
    assert.ok(ids.includes('claude.json-invalid'), `expected claude.json-invalid in ${ids.join(', ')}`);
    const invalid = report.findings.find((f: any) => f.id === 'claude.json-invalid');
    assert.strictEqual(invalid.severity, 'error');
    assert.match(invalid.title, /line \d+/);
    assert.ok(ids.some((i) => i.startsWith('ws.mode:')), `expected a ws.mode finding in ${ids.join(', ')}`);
    assert.ok(ids.some((i) => i.startsWith('ws.hooks:')));
    assert.ok(report.env.claudeSettingsPath.startsWith(process.env.CLAUDE_CONFIG_DIR!));
    for (const f of report.findings) {
      assert.ok(['error', 'warn', 'info', 'ok'].includes(f.severity), f.severity);
      assert.ok(typeof f.title === 'string' && f.title.length > 0);
      assert.ok(!/\{\d\}/.test(f.title), `unformatted placeholder in ${f.title}`);
    }
  });
});
