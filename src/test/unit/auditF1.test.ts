/** Regression tests for the F1 audit findings. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { findRogueHooks, matcherIsWildcard, removeHooksDetailed, RogueHook } from '../../core/claudeSettings';
import { writeJsonFileAtomic } from '../../core/jsonFile';
import {
  backupSettingsFile,
  loadSnapshotFile,
  pruneBackups,
  restoreClaudeSettings,
  retireSnapshotFile,
  saveSnapshot,
  settingsChangedSinceSnapshot,
  sha256,
  Snapshot,
  SNAPSHOT_FILE,
} from '../../core/snapshot';

describe('audit F1 · matcherIsWildcard (matcher is a regex in Claude Code)', () => {
  it('catch-all forms', () => {
    for (const m of [undefined, '', '  ', '*', '.*', '^.*$', '.+', '(.*)', '.*?', '[\\s\\S]*', 'Bash|Read|Edit|Write|Glob|Grep|Agent|WebFetch|NotebookEdit']) {
      assert.strictEqual(matcherIsWildcard(m), true, `expected wildcard for ${JSON.stringify(m)}`);
    }
  });
  it('narrow forms and invalid regex are not wildcard', () => {
    for (const m of ['Bash', 'Bash|Edit', '^Bash$', 'Write|Edit', 'mcp__.*', '[unclosed']) {
      assert.strictEqual(matcherIsWildcard(m), false, `expected NOT wildcard for ${JSON.stringify(m)}`);
    }
  });
  it('findRogueHooks uses it', () => {
    const s = { hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'echo log' }] }] } };
    assert.strictEqual(findRogueHooks(s)[0]?.reason, 'wildcard');
  });
});

describe('audit F1 · removeHooksDetailed verifies the command before deleting', () => {
  const settings = () => ({
    hooks: {
      PreToolUse: [
        { matcher: '*', hooks: [{ type: 'command', command: 'a' }, { type: 'command', command: 'b' }, { type: 'command', command: 'c' }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'keep-me' }] },
        { matcher: '.*', hooks: [{ type: 'command', command: 'd' }] },
      ],
    },
  });
  const rh = (groupIndex: number, hookIndex: number, command: string): RogueHook => ({ event: 'PreToolUse', groupIndex, hookIndex, matcher: '*', command, reason: 'wildcard' });

  it('removes hooks 0 and 2 of a group of 3, and groups 0 and 2 of three groups', () => {
    const { next, removed, skipped } = removeHooksDetailed(settings(), [rh(0, 0, 'a'), rh(0, 2, 'c'), rh(2, 0, 'd')]);
    assert.strictEqual(removed, 3);
    assert.deepStrictEqual(skipped, []);
    assert.deepStrictEqual(next.hooks.PreToolUse, [
      { matcher: '*', hooks: [{ type: 'command', command: 'b' }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'keep-me' }] },
    ]);
  });

  it('skips a stale index whose command no longer matches (file edited since the report)', () => {
    const { next, removed, skipped } = removeHooksDetailed(settings(), [rh(0, 1, 'NOT-b'), rh(1, 0, 'keep-me-but-wrong-idx-ok?')]);
    assert.strictEqual(removed, 0);
    assert.strictEqual(skipped.length, 2);
    assert.deepStrictEqual(next, settings(), 'nothing removed, nothing mutated');
  });

  it('skips references beyond the array', () => {
    const { removed, skipped } = removeHooksDetailed(settings(), [rh(9, 0, 'x'), { ...rh(0, 0, 'a'), event: 'PermissionRequest' }]);
    assert.strictEqual(removed, 0);
    assert.strictEqual(skipped.length, 2);
  });
});

describe('audit F1 · file semantics', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'handsfree-audit-'));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('backup → restore is byte-exact for BOM + CRLF content', async () => {
    const settings = path.join(dir, 'settings.json');
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{\r\n  "model": "x"\r\n}\r\n', 'utf8')]);
    await fsp.writeFile(settings, original);
    const backup = await backupSettingsFile(settings, path.join(dir, 'b'), new Date(), 'before-enable');
    assert.ok(backup && path.basename(backup).startsWith('before-enable.'));
    await writeJsonFileAtomic(settings, { model: 'changed' });
    const snap: Snapshot = { version: 1, createdAt: 'now', claude: { settingsPath: settings, existedBefore: true, backupPath: backup }, vscode: {} };
    assert.strictEqual(await restoreClaudeSettings(snap), 'restored');
    assert.ok(Buffer.compare(await fsp.readFile(settings), original) === 0, 'bytes differ');
  });

  it('writeJsonFileAtomic follows a symlink and preserves mode (skipped where symlinks are unavailable)', async function () {
    const real = path.join(dir, 'real.json');
    const link = path.join(dir, 'link.json');
    await fsp.writeFile(real, '{}\n', { mode: 0o600 });
    try {
      await fsp.symlink(real, link);
    } catch {
      this.skip(); // Windows without developer mode
      return;
    }
    await writeJsonFileAtomic(link, { a: 1 });
    const st = await fsp.lstat(link);
    assert.ok(st.isSymbolicLink(), 'symlink was replaced by a regular file');
    assert.strictEqual(JSON.parse(await fsp.readFile(real, 'utf8')).a, 1);
    if (process.platform !== 'win32') assert.strictEqual((await fsp.stat(real)).mode & 0o777, 0o600);
  });

  it('writtenSha256 detects edits since Enable', async () => {
    const settings = path.join(dir, 'settings.json');
    const written = await writeJsonFileAtomic(settings, { a: 1 });
    const snap: Snapshot = { version: 1, createdAt: 'now', claude: { settingsPath: settings, existedBefore: false, writtenSha256: sha256(written) }, vscode: {} };
    assert.strictEqual(await settingsChangedSinceSnapshot(snap), false);
    await fsp.appendFile(settings, '\n');
    assert.strictEqual(await settingsChangedSinceSnapshot(snap), true);
    assert.strictEqual(await settingsChangedSinceSnapshot({ ...snap, claude: { ...snap.claude, writtenSha256: undefined } }), undefined);
  });

  it('retireSnapshotFile makes a second Revert impossible; corrupt/wrong-version snapshots are ignored', async () => {
    const snap: Snapshot = { version: 1, createdAt: 'now', claude: { settingsPath: 'p', existedBefore: false }, vscode: {} };
    await saveSnapshot(dir, snap);
    assert.ok(await loadSnapshotFile(dir));
    await retireSnapshotFile(dir);
    assert.strictEqual(await loadSnapshotFile(dir), undefined);
    assert.ok((await fsp.readdir(dir)).some((n) => n.startsWith('reverted-') && n.endsWith('.snapshot.json')));
    await retireSnapshotFile(dir); // idempotent when missing

    await fsp.writeFile(path.join(dir, SNAPSHOT_FILE), '{ nope', 'utf8');
    assert.strictEqual(await loadSnapshotFile(dir), undefined);
    await fsp.writeFile(path.join(dir, SNAPSHOT_FILE), JSON.stringify({ version: 2, claude: { settingsPath: 'p' } }), 'utf8');
    assert.strictEqual(await loadSnapshotFile(dir), undefined);
    await fsp.writeFile(path.join(dir, SNAPSHOT_FILE), JSON.stringify({ version: 1 }), 'utf8');
    assert.strictEqual(await loadSnapshotFile(dir), undefined, 'snapshot without settingsPath is unusable');
  });

  it('pruneBackups protects named files and never touches snapshot files', async () => {
    for (let i = 0; i < 12; i++) await fsp.writeFile(path.join(dir, `before-enable.2026-01-${String(i + 1).padStart(2, '0')}T00-00-00-000Z.json`), '{}');
    await fsp.writeFile(path.join(dir, 'reverted-2026-01-01T00-00-00-000Z.snapshot.json'), '{}');
    await fsp.writeFile(path.join(dir, SNAPSHOT_FILE), '{}');
    const oldest = path.join(dir, 'before-enable.2026-01-01T00-00-00-000Z.json');
    const n = await pruneBackups(dir, 10, [oldest, undefined]);
    assert.strictEqual(n, 1, 'only 02 is deleted; 01 is protected');
    assert.ok(fs.existsSync(oldest));
    assert.ok(!fs.existsSync(path.join(dir, 'before-enable.2026-01-02T00-00-00-000Z.json')));
    assert.ok(fs.existsSync(path.join(dir, 'reverted-2026-01-01T00-00-00-000Z.snapshot.json')));
    assert.ok(fs.existsSync(path.join(dir, SNAPSHOT_FILE)));
  });
});
