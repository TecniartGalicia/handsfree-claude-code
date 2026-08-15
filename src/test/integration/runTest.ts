import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/**
 * Hermetic integration run:
 *  - CLAUDE_CONFIG_DIR points to a temp dir seeded with the trailing-comma fixture, so the Doctor
 *    never reads the developer's real ~/.claude/settings.json;
 *  - a temp workspace folder with .claude/settings.json (logging-hook fixture) is opened;
 *  - VS Code runs with an isolated user-data-dir and no other extensions.
 */
async function main(): Promise<void> {
  // When launched from a terminal inside VS Code, the extension host sets ELECTRON_RUN_AS_NODE=1;
  // the test VS Code would inherit it and start as plain Node ("bad option: --...").
  delete process.env.ELECTRON_RUN_AS_NODE;

  const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const fixtures = path.join(extensionDevelopmentPath, 'src', 'test', 'fixtures');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'handsfree-it-'));
  const configDir = path.join(tmp, 'claude-config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.copyFileSync(path.join(fixtures, 'settings.trailing-comma.json'), path.join(configDir, 'settings.json'));
  const workspace = path.join(tmp, 'workspace');
  fs.mkdirSync(path.join(workspace, '.claude'), { recursive: true });
  fs.copyFileSync(path.join(fixtures, 'settings.logging-hook.json'), path.join(workspace, '.claude', 'settings.json'));

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspace, `--user-data-dir=${path.join(extensionDevelopmentPath, '.vscode-test', 'user-data')}`, '--disable-extensions'],
      extensionTestsEnv: { CLAUDE_CONFIG_DIR: configDir, HANDSFREE_IT_TMP: tmp },
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Integration tests failed', err);
  process.exit(1);
});
