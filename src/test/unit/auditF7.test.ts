/**
 * Regression tests for the F7 audit (2026-08-17): every case below reproduced a real bug.
 * They are grouped by the area the finding belongs to, and each one names the promise it protects.
 */
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { applyAutonomous } from '../../core/claudeSettings';
import { findStaleAllowRules, removeAllowRules } from '../../core/claudeSettings';
import { decideAfterValidation, decideOffline, LicenseState } from '../../core/license';
import { maskSecrets } from '../../core/findings';
import { claudeSettingsPath } from '../../core/paths';
import { redact } from '../../core/report';
import { pruneBackups, restoreClaudeSettings, Snapshot } from '../../core/snapshot';
import { writeJsonFileAtomic } from '../../core/jsonFile';

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'handsfree-f7-'));
}

describe('audit F7 · backups and restore', () => {
  it('pruneBackups keeps the newest files even when several labels share the directory', async () => {
    const dir = await tmpdir();
    const old = ['2025-01-01T00-00-00', '2025-01-02T00-00-00', '2025-01-03T00-00-00'];
    const recent = ['2026-08-15T10-00-00', '2026-08-16T10-00-00'];
    for (const t of old) await fs.writeFile(path.join(dir, `before-revert.${t}.json`), '{}');
    for (const t of recent) await fs.writeFile(path.join(dir, `before-enable.${t}.json`), '{}');
    const removed = await pruneBackups(dir, 3);
    const left = (await fs.readdir(dir)).sort();
    assert.strictEqual(removed, 2);
    // The 3 kept ones must be the newest by timestamp, not the ones whose label sorts last.
    assert.deepStrictEqual(left, ['before-enable.2026-08-15T10-00-00.json', 'before-enable.2026-08-16T10-00-00.json', 'before-revert.2025-01-03T00-00-00.json'].sort());
  });

  it('restore never deletes a settings file we have a backup of (stale existedBefore)', async () => {
    const dir = await tmpdir();
    const settings = path.join(dir, 'settings.json');
    const backup = path.join(dir, 'before-enable.2026-08-17T00-00-00.json');
    await fs.writeFile(settings, '{"model":"opus"}\n');
    await fs.writeFile(backup, '{"model":"opus"}\n');
    // The file was created between the read and the consent dialog, so the snapshot says "did not exist"
    // while a backup was taken all the same.
    const snap: Snapshot = { version: 1, createdAt: new Date().toISOString(), claude: { settingsPath: settings, existedBefore: false, backupPath: backup }, vscode: {} };
    assert.strictEqual(await restoreClaudeSettings(snap), 'restored');
    assert.strictEqual(await fs.readFile(settings, 'utf8'), '{"model":"opus"}\n');
  });

  it('restore still deletes the file when there really was none', async () => {
    const dir = await tmpdir();
    const settings = path.join(dir, 'settings.json');
    await fs.writeFile(settings, '{"a":1}');
    const snap: Snapshot = { version: 1, createdAt: new Date().toISOString(), claude: { settingsPath: settings, existedBefore: false, backupPath: undefined }, vscode: {} };
    assert.strictEqual(await restoreClaudeSettings(snap), 'deleted');
    assert.strictEqual(await fs.access(settings).then(() => true).catch(() => false), false);
  });

  it('a failed atomic write leaves no .tmp copy of the settings behind', async () => {
    const dir = await tmpdir();
    const target = path.join(dir, 'settings.json');
    await fs.writeFile(target, '{}');
    // A directory where the file should be makes both the rename and the fallback write fail.
    const blocked = path.join(dir, 'blocked');
    await fs.mkdir(blocked);
    await assert.rejects(() => writeJsonFileAtomic(blocked, { a: 1 }));
    const leftovers = (await fs.readdir(dir)).filter((n) => n.includes('.handsfree-'));
    assert.deepStrictEqual(leftovers, [], 'the temp file must be removed on every path');
  });
});

describe('audit F7 · settings and paths', () => {
  it('a non-object JSON root is reported as a change instead of vanishing silently', () => {
    for (const input of [[1, 2, 3] as any, 42 as any, 'hola' as any, null as any]) {
      const { changes } = applyAutonomous(input);
      assert.ok(
        changes.some((c) => c.path === ''),
        `root replacement must be recorded for ${JSON.stringify(input)}`,
      );
    }
    // The normal case still records only the real changes.
    assert.ok(!applyAutonomous({} as any).changes.some((c) => c.path === ''));
  });

  it('a relative claudeSettingsPath override is ignored (it would resolve against the host cwd)', () => {
    const env = { CLAUDE_CONFIG_DIR: '' } as NodeJS.ProcessEnv;
    const home = process.platform === 'win32' ? 'C:\\Users\\bob' : '/home/bob';
    const def = claudeSettingsPath('', env, home);
    assert.strictEqual(claudeSettingsPath('.claude/settings.json', env, home), def);
    assert.strictEqual(claudeSettingsPath('settings.json', env, home), def);
    // Absolute paths and ~ still work.
    assert.notStrictEqual(claudeSettingsPath('~/other/settings.json', env, home), def);
  });

  it('stale allow rules: prototype keys are not "renamed tools" and legitimate patterns are not "foreign"', () => {
    assert.deepStrictEqual(findStaleAllowRules(['toString', 'constructor', 'valueOf']), []);
    assert.deepStrictEqual(findStaleAllowRules(['Bash(npm run auto-accept-check *)']), []);
    // Real leftovers are still flagged.
    const rogue = findStaleAllowRules(['__claude-auto-approve__', 'MultiEdit']);
    assert.deepStrictEqual(rogue.map((r) => r.reason).sort(), ['foreign', 'renamed-tool']);
  });

  it('removeAllowRules reports how many rules it actually removed', () => {
    const settings = { permissions: { allow: ['Bash', '__x__'] } } as any;
    assert.strictEqual(removeAllowRules(settings, ['__x__']).removed, 1);
    assert.strictEqual(removeAllowRules(settings, ['not-there']).removed, 0);
  });
});

describe('audit F7 · report redaction', () => {
  it('masks credentials in URLs, webhooks and space-separated key names', () => {
    assert.ok(!maskSecrets('psql postgres://user:S3cretPass@db.host:5432/db').includes('S3cretPass'));
    assert.ok(!maskSecrets('curl https://hooks.slack.com/services/T01/B02/XXXXXXXX').includes('XXXXXXXX'));
    assert.ok(!maskSecrets('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY').includes('wJalrXUtnFEMIK7MDENGbPxRfiCY'));
    assert.ok(!maskSecrets('node hook.js --token abc123SECRET').includes('abc123SECRET'));
    // Already covered before, must keep working.
    assert.ok(!maskSecrets('curl -H "Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRSTU"').includes('ghp_ABCDEFGHIJKLMNOPQRSTU'));
  });

  it('redacts the user name in UNC paths too', () => {
    const opts = { home: 'C:\\Users\\alice', username: 'alice', platform: 'win32' as NodeJS.Platform };
    assert.ok(!redact('\\\\nas01\\Users\\alice\\notes', opts).includes('alice'));
    assert.ok(!redact('\\\\srv\\home\\alice\\notes', opts).includes('alice'));
    assert.ok(!redact('C:\\Users\\alice\\x', opts).includes('alice'));
    // A different user with the same prefix is untouched.
    assert.ok(redact('C:\\Users\\alicia\\x', opts).includes('alicia'));
  });
});

describe('audit F7 · licence decisions', () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const iso = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString();
  const paid: LicenseState = { key: 'k', activationId: 'a', status: 'granted', lastValidatedAt: iso(2) };

  it('an unknown status in a 200 is a soft failure, not a verdict (a proxy must not switch Pro off)', () => {
    const r = decideAfterValidation(paid, now, { ok: true, status: 'blocked' });
    assert.deepStrictEqual(r.decision, { pro: true, source: 'grace' });
    assert.strictEqual(r.next.status, 'granted', 'the unknown status must not be persisted');
    // …and the next offline decision does not inherit a bogus negative state.
    const later = decideAfterValidation(r.next, new Date(now.getTime() + 25 * 3600_000), { ok: false, kind: 'network' });
    assert.deepStrictEqual(later.decision, { pro: true, source: 'grace' });
  });

  it('known negative statuses still switch Pro off and do not resurrect through the grace period', () => {
    const revoked = decideAfterValidation(paid, now, { ok: true, status: 'revoked' });
    assert.deepStrictEqual(revoked.decision, { pro: false, reason: 'revoked' });
    const offline = decideAfterValidation(revoked.next, new Date(now.getTime() + 25 * 3600_000), { ok: false, kind: 'network' });
    assert.deepStrictEqual(offline.decision, { pro: false, reason: 'revoked' });
  });

  it('an expiry date in the past is not covered by the grace period', () => {
    const expired: LicenseState = { ...paid, expiresAt: iso(1) };
    const r = decideAfterValidation(expired, now, { ok: false, kind: 'network' });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'expired' });
  });

  it('after a failed check the network is not hit again on every command while the grace period lasts', () => {
    // Revalidation is due (validated 30 h ago) and the last attempt failed 10 minutes ago.
    const state: LicenseState = { key: 'k', activationId: 'a', status: 'granted', lastValidatedAt: iso(30), lastCheckedAt: iso(0.16) };
    assert.deepStrictEqual(decideOffline(state, now), { pro: true, source: 'grace' });
    // Once the retry window is over, it asks again…
    const stale: LicenseState = { ...state, lastCheckedAt: iso(2) };
    assert.strictEqual(decideOffline(stale, now), undefined);
    // …and `force` always goes to the network.
    assert.strictEqual(decideOffline(state, now, false, true), undefined);
    // Outside the grace period there is no free pass either.
    const old: LicenseState = { ...state, lastValidatedAt: iso(24 * 20) };
    assert.strictEqual(decideOffline(old, now), undefined);
  });
});
