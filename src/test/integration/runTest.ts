import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // When launched from a terminal inside VS Code, the extension host sets ELECTRON_RUN_AS_NODE=1;
  // the test VS Code would inherit it and start as plain Node ("bad option: --...").
  delete process.env.ELECTRON_RUN_AS_NODE;
  const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    // Isolated profile so the test never touches the developer's real VS Code settings.
    launchArgs: [`--user-data-dir=${path.join(extensionDevelopmentPath, '.vscode-test', 'user-data')}`, '--disable-extensions'],
  });
}

main().catch((err) => {
  console.error('Integration tests failed', err);
  process.exit(1);
});
