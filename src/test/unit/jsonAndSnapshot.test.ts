import * as assert from 'assert';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { lineColFromOffset, offsetFromMessage, parseStrictJson, readJsonFile, stripBom, writeJsonFileAtomic } from '../../core/jsonFile';
import { backupDir, claudeConfigDir, claudeSettingsPath, expandHome, managedSettingsCandidates } from '../../core/paths';
import { backupSettingsFile, loadSnapshotFile, pruneBackups, restoreClaudeSettings, saveSnapshot, Snapshot, timestampForFilename } from '../../core/snapshot';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');

describe('parseStrictJson', () => {
  it('reports line/column for the trailing-comma file we broke by hand this week', () => {
    const raw = fs.readFileSync(path.join(FIXTURES, 'settings.trailing-comma.json'), 'utf8');
    const r = parseStrictJson(raw);
    assert.strictEqual(r.ok, false);
    if (r.ok) return;
    assert.ok(r.error.line! >= 9 && r.error.line! <= 10, `line was ${r.error.line}`);
    assert.ok(r.error.column! >= 1);
    assert.match(r.error.message, /JSON/);
  });

  it('parses valid JSON and strips a BOM', () => {
    const r = parseStrictJson<{ a: number }>('\uFEFF{"a":1}');
    assert.ok(r.ok && r.data.a === 1);
    assert.strictEqual(stripBom('x'), 'x');
  });

  it('helper functions', () => {
    assert.strictEqual(offsetFromMessage("Unexpected token } in JSON at position 42"), 42);
    assert.strictEqual(offsetFromMessage('nope'), undefined);
    assert.deepStrictEqual(lineColFromOffset('ab\ncd\nef', 4), { line: 2, column: 2 });
    assert.deepStrictEqual(lineColFromOffset('ab', 99), { line: 1, column: 3 });
  });
});

describe('paths', () => {
  const env = {} as NodeJS.ProcessEnv;
  it('defaults to ~/.claude/settings.json', () => {
    assert.strictEqual(claudeSettingsPath(undefined, env, '/home/u'), path.join('/home/u', '.claude', 'settings.json'));
  });
  it('honours CLAUDE_CONFIG_DIR and ~ expansion', () => {
    assert.strictEqual(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/cfg' } as any, '/home/u'), '/cfg');
    assert.strictEqual(claudeConfigDir({ CLAUDE_CONFIG_DIR: '~/cc' } as any, '/home/u'), path.join('/home/u', 'cc'));
    assert.strictEqual(claudeConfigDir({ CLAUDE_CONFIG_DIR: '  ' } as any, '/home/u'), path.join('/home/u', '.claude'));
  });
  it('override wins', () => {
    assert.strictEqual(claudeSettingsPath('~/x.json', { CLAUDE_CONFIG_DIR: '/cfg' } as any, '/home/u'), path.join('/home/u', 'x.json'));
    assert.strictEqual(expandHome('~', '/h'), '/h');
    assert.strictEqual(expandHome('/abs', '/h'), '/abs');
  });
  it('backup dir sits next to the settings file; managed candidates per platform', () => {
    assert.strictEqual(backupDir('/home/u/.claude/settings.json'), path.join('/home/u/.claude', 'backups', 'handsfree'));
    assert.deepStrictEqual(managedSettingsCandidates('linux'), ['/etc/claude-code/managed-settings.json']);
    assert.ok(managedSettingsCandidates('win32', { ProgramData: 'D:\\PD' })[0].startsWith('D:\\PD'));
    assert.ok(managedSettingsCandidates('darwin')[0].includes('Application Support'));
  });
});

describe('file IO + snapshot round trip', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'handsfree-test-'));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('readJsonFile distinguishes missing / invalid / valid', async () => {
    const f = path.join(dir, 's.json');
    const missing = await readJsonFile(f);
    assert.ok(missing.ok && !missing.exists);
    await fsp.writeFile(f, '{ bad', 'utf8');
    const bad = await readJsonFile(f);
    assert.ok(!bad.ok && bad.exists);
    await writeJsonFileAtomic(f, { a: 1 });
    const good = await readJsonFile<{ a: number }>(f);
    assert.ok(good.ok && good.exists && good.data.a === 1);
    assert.ok((await fsp.readFile(f, 'utf8')).endsWith('}\n'), 'pretty + trailing newline');
    const leftovers = (await fsp.readdir(dir)).filter((n) => n.endsWith('.tmp'));
    assert.deepStrictEqual(leftovers, [], 'no temp files left behind');
  });

  it('backup → restore is byte-exact; restore deletes when the file did not exist before', async () => {
    const settings = path.join(dir, 'settings.json');
    const bdir = path.join(dir, 'backups');
    const original = '{\n  "model": "x"\n}\n';
    await fsp.writeFile(settings, original, 'utf8');
    const backup = await backupSettingsFile(settings, bdir, new Date('2026-08-14T18:30:00.123Z'));
    assert.ok(backup && backup.endsWith('settings.2026-08-14T18-30-00-123Z.json'));

    await fsp.writeFile(settings, '{"model":"changed"}', 'utf8');
    const snap: Snapshot = { version: 1, createdAt: 'now', claude: { settingsPath: settings, existedBefore: true, backupPath: backup }, vscode: {} };
    assert.strictEqual(await restoreClaudeSettings(snap), 'restored');
    assert.strictEqual(await fsp.readFile(settings, 'utf8'), original);

    const snap2: Snapshot = { version: 1, createdAt: 'now', claude: { settingsPath: settings, existedBefore: false }, vscode: {} };
    assert.strictEqual(await restoreClaudeSettings(snap2), 'deleted');
    assert.ok(!fs.existsSync(settings));

    const snap3: Snapshot = { version: 1, createdAt: 'now', claude: { settingsPath: settings, existedBefore: true, backupPath: path.join(dir, 'nope.json') }, vscode: {} };
    assert.strictEqual(await restoreClaudeSettings(snap3), 'backup-missing');
  });

  it('backup of a missing file returns undefined; snapshot file round-trips; prune keeps newest', async () => {
    const bdir = path.join(dir, 'backups');
    assert.strictEqual(await backupSettingsFile(path.join(dir, 'missing.json'), bdir), undefined);
    const snap: Snapshot = { version: 1, createdAt: 'now', claude: { settingsPath: 'p', existedBefore: false }, vscode: { initialPermissionMode: 'default' } };
    await saveSnapshot(bdir, snap);
    assert.deepStrictEqual(await loadSnapshotFile(bdir), snap);
    for (let i = 0; i < 12; i++) await fsp.writeFile(path.join(bdir, `settings.2026-01-${String(i + 1).padStart(2, '0')}T00-00-00-000Z.json`), '{}');
    assert.strictEqual(await pruneBackups(bdir, 10), 2);
    const left = (await fsp.readdir(bdir)).filter((n) => n.startsWith('settings.'));
    assert.strictEqual(left.length, 10);
    assert.ok(!left.includes('settings.2026-01-01T00-00-00-000Z.json'));
    assert.ok(left.includes('settings.2026-01-12T00-00-00-000Z.json'));
    assert.ok(fs.existsSync(path.join(bdir, 'last-snapshot.json')), 'snapshot file untouched by prune');
  });

  it('timestampForFilename is filesystem-safe', () => {
    assert.doesNotMatch(timestampForFilename(new Date()), /[:.]/);
  });
});
