import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { DoctorInput, evaluate, Finding, OfficialInfo, summarize } from '../../core/findings';
import { parseStrictJson, ReadResult } from '../../core/jsonFile';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
const read = (name: string): ReadResult<any> => {
  const raw = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  const r = parseStrictJson<any>(raw);
  return r.ok ? { ok: true, exists: true, data: r.data, raw } : { ok: false, exists: true, raw, error: r.error };
};
const missing: ReadResult<any> = { ok: true, exists: false, data: undefined, raw: '' };

const goodOfficial: OfficialInfo = { installed: true, version: '2.1.232', supportsBypass: true, tested: true, allow: true, mode: 'bypassPermissions', allowScope: 'global', modeScope: 'global' };

function input(over: Partial<DoctorInput> = {}): DoctorInput {
  return {
    claudePath: '/home/u/.claude/settings.json',
    claude: read('settings.autonomous.json'),
    managed: [],
    official: goodOfficial,
    rogueExtensions: [],
    workspaceFiles: [],
    ...over,
  };
}
const ids = (f: Finding[]) => f.map((x) => x.id);
const byId = (f: Finding[], id: string) => f.find((x) => x.id === id);

describe('evaluate (Doctor)', () => {
  it('all green on a fully configured machine', () => {
    const f = evaluate(input());
    const s = summarize(f);
    assert.strictEqual(s.errors, 0, JSON.stringify(f, null, 2));
    assert.strictEqual(s.warnings, 0);
    assert.ok(s.oks >= 5);
  });

  it('invalid JSON is the only finding (nothing else is trustworthy) and points at the line', () => {
    const f = evaluate(input({ claude: read('settings.trailing-comma.json') }));
    assert.strictEqual(f.length, 1);
    assert.strictEqual(f[0].id, 'claude.json-invalid');
    assert.strictEqual(f[0].severity, 'error');
    assert.strictEqual(f[0].fix?.kind, 'open-file');
    assert.match(f[0].title, /line \d+/);
  });

  it('reproduces this week\'s incident: paid hook + stale rules + mode not set', () => {
    const f = evaluate(input({ claude: read('settings.with-rogue-hook.json'), official: { ...goodOfficial, allow: undefined, mode: undefined, allowScope: 'unset', modeScope: 'unset' } }));
    const known = byId(f, 'hooks.known-tool');
    assert.ok(known && known.severity === 'error' && known.fix?.kind === 'remove-hooks');
    assert.strictEqual((known!.fix as any).hooks.length, 3);
    assert.ok(byId(f, 'claude.defaultMode')?.severity === 'warn');
    assert.ok(byId(f, 'claude.skipDialog')?.severity === 'warn');
    assert.ok(byId(f, 'ext.allow')?.severity === 'warn');
    assert.ok(byId(f, 'ext.mode')?.severity === 'warn');
    assert.ok(byId(f, 'allow.stale')?.fix?.kind === 'clean-allow');
    // errors first
    assert.strictEqual(f[0].severity, 'error');
  });

  it('wildcard logging hook is a warning, not an error', () => {
    const f = evaluate(input({ claude: read('settings.logging-hook.json') }));
    assert.strictEqual(byId(f, 'hooks.wildcard')?.severity, 'warn');
    assert.strictEqual(byId(f, 'hooks.known-tool'), undefined);
  });

  it('policy in user settings and in managed settings', () => {
    const f1 = evaluate(input({ claude: read('settings.policy-disabled.json') }));
    assert.strictEqual(byId(f1, 'policy.user')?.severity, 'error');
    const f2 = evaluate(input({ managed: [{ path: '/etc/claude-code/managed-settings.json', result: read('settings.policy-disabled.json') }] }));
    assert.strictEqual(byId(f2, 'policy.managed')?.severity, 'error');
    assert.strictEqual(byId(f2, 'policy.managed')?.fix, undefined, 'no fix: only an admin can change it');
  });

  it('official extension: missing / unsupported / untested / workspace override', () => {
    assert.strictEqual(byId(evaluate(input({ official: { ...goodOfficial, installed: false } })), 'ext.missing')?.severity, 'warn');
    assert.strictEqual(byId(evaluate(input({ official: { ...goodOfficial, supportsBypass: false } })), 'ext.contract')?.severity, 'error');
    assert.strictEqual(byId(evaluate(input({ official: { ...goodOfficial, tested: false } })), 'ext.untested')?.severity, 'info');
    const ws = byId(evaluate(input({ official: { ...goodOfficial, mode: 'default', modeScope: 'workspace' } })), 'ext.mode');
    assert.strictEqual(ws?.severity, 'info', 'a workspace profile is deliberate, not a problem');
    assert.strictEqual(ws?.fix, undefined);
  });

  it('conflicting extensions get one error each with an uninstall fix', () => {
    const f = evaluate(input({ rogueExtensions: [{ id: 'ra1d7.claude-auto-accept', name: 'Claude Auto-Accept', why: 'quota', version: '1.2.0' }] }));
    const r = byId(f, 'rogue.ra1d7.claude-auto-accept');
    assert.strictEqual(r?.severity, 'error');
    assert.deepStrictEqual(r?.fix, { kind: 'uninstall-extension', id: 'ra1d7.claude-auto-accept' });
    assert.strictEqual(byId(f, 'rogue.none'), undefined);
  });

  it('workspace files: override, invalid, hooks; missing files are silent', () => {
    const f = evaluate(
      input({
        workspaceFiles: [
          { path: '/w/.claude/settings.json', result: read('settings.logging-hook.json') },
          { path: '/w/.claude/settings.local.json', result: read('settings.trailing-comma.json') },
          { path: '/w2/.claude/settings.json', result: missing },
        ],
      }),
    );
    assert.strictEqual(byId(f, 'ws.mode:/w/.claude/settings.json')?.severity, 'info');
    assert.strictEqual(byId(f, 'ws.hooks:/w/.claude/settings.json')?.severity, 'warn');
    assert.strictEqual(byId(f, 'ws.invalid:/w/.claude/settings.local.json')?.severity, 'error');
    assert.ok(!ids(f).some((i) => i.includes('/w2/')));
  });

  it('missing settings file is an info, and the fixes point to enable', () => {
    const f = evaluate(input({ claude: missing }));
    assert.strictEqual(byId(f, 'claude.missing')?.severity, 'info');
    assert.strictEqual(byId(f, 'claude.defaultMode')?.fix?.kind, 'enable');
  });

  it('translate hook is used', () => {
    const f = evaluate(input({ claude: missing }), (m) => `T:${m}`);
    assert.ok(f.every((x) => x.title.startsWith('T:')));
  });
});
