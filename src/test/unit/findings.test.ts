import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { DoctorInput, evaluate, Finding, maskSecrets, OfficialInfo, planFixAll, summarize } from '../../core/findings';
import { parseStrictJson, ReadResult } from '../../core/jsonFile';
import { redact, renderReportMarkdown } from '../../core/report';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
const read = (name: string): ReadResult<any> => {
  const raw = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  const r = parseStrictJson<any>(raw);
  return r.ok ? { ok: true, exists: true, data: r.data, raw } : { ok: false, exists: true, raw, error: r.error };
};
const missing: ReadResult<any> = { ok: true, exists: false, data: undefined, raw: '' };
const unreadable: ReadResult<any> = { ok: false, exists: true, raw: '', error: { message: 'EACCES: permission denied', code: 'EACCES' } };
const obj = (data: any): ReadResult<any> => ({ ok: true, exists: true, data, raw: JSON.stringify(data) });

const goodOfficial: OfficialInfo = { installed: true, version: '2.1.233', supportsBypass: true, olderThanTested: false, allow: true, mode: 'bypassPermissions' };

function input(over: Partial<DoctorInput> = {}): DoctorInput {
  return {
    claudePath: '/home/u/.claude/settings.json',
    claude: read('settings.autonomous.json'),
    managed: [],
    official: goodOfficial,
    rogueExtensions: [],
    uninstalledPendingReload: [],
    workspaceFiles: [],
    ...over,
  };
}
const ids = (f: Finding[]) => f.map((x) => x.id);
const byId = (f: Finding[], id: string) => f.find((x) => x.id === id);

describe('evaluate (Doctor)', () => {
  it('all green on a fully configured machine (only infos and oks)', () => {
    const f = evaluate(input());
    const s = summarize(f);
    assert.strictEqual(s.errors, 0, JSON.stringify(f, null, 2));
    assert.strictEqual(s.warnings, 0);
    assert.ok(s.oks >= 5);
    assert.ok(byId(f, 'ext.first-session')?.severity === 'info');
  });

  it('invalid JSON: file-dependent checks are skipped, machine-level ones still run', () => {
    const f = evaluate(input({ claude: read('settings.trailing-comma.json'), rogueExtensions: [{ id: 'x.y', name: 'X', why: 'w' }] }));
    const inv = byId(f, 'claude.json-invalid');
    assert.ok(inv && inv.severity === 'error' && inv.fix?.kind === 'open-file');
    assert.match(inv!.title, /line \d+/);
    assert.strictEqual(byId(f, 'claude.defaultMode'), undefined, 'nothing about the broken file is trustworthy');
    assert.strictEqual(byId(f, 'hooks.none'), undefined);
    assert.ok(byId(f, 'rogue.x.y'), 'machine-level checks still run');
    assert.ok(byId(f, 'ext.allow'));
  });

  it('unreadable file (EACCES) is reported as such, without an open-file fix', () => {
    const f = evaluate(input({ claude: unreadable }));
    const u = byId(f, 'claude.unreadable');
    assert.ok(u && u.severity === 'error' && u.fix === undefined);
    assert.match(u!.title, /EACCES/);
  });

  it('settings root that is not an object', () => {
    const f = evaluate(input({ claude: obj([]) }));
    assert.strictEqual(byId(f, 'claude.not-object')?.severity, 'error');
    assert.strictEqual(byId(f, 'claude.defaultMode'), undefined);
  });

  it("reproduces this week's incident: paid hook + stale rules + mode not set + extension unset", () => {
    const f = evaluate(input({ claude: read('settings.with-rogue-hook.json'), official: { ...goodOfficial, allow: undefined, mode: undefined } }));
    const known = byId(f, 'hooks.known-tool');
    assert.ok(known && known.severity === 'error' && known.fix?.kind === 'remove-hooks');
    assert.strictEqual((known!.fix as any).hooks.length, 1, 'only the wildcard hook is an error');
    const narrow = byId(f, 'hooks.known-tool-narrow');
    assert.ok(narrow && narrow.severity === 'warn');
    assert.strictEqual((narrow!.fix as any).hooks.length, 2, 'ExitPlanMode + AskUserQuestion approvers are narrow');
    assert.ok(byId(f, 'claude.defaultMode')?.severity === 'warn');
    assert.ok(byId(f, 'claude.skipDialog')?.severity === 'warn');
    assert.ok(byId(f, 'ext.allow')?.severity === 'warn');
    const mode = byId(f, 'ext.mode');
    assert.ok(mode?.severity === 'warn' && /not pinned/.test(mode.title));
    assert.match(mode!.detail!, /mode indicator/);
    assert.ok(byId(f, 'allow.stale')?.fix?.kind === 'clean-allow');
    assert.match(byId(f, 'allow.stale')!.detail!, /Bash\(\*\) — redundant/);
    assert.strictEqual(f[0].severity, 'error');
  });

  it('wildcard logging hook is a warning, not an error; regex wildcard counts', () => {
    const f = evaluate(input({ claude: read('settings.logging-hook.json') }));
    assert.strictEqual(byId(f, 'hooks.wildcard')?.severity, 'warn');
    assert.strictEqual(byId(f, 'hooks.known-tool'), undefined);
    const f2 = evaluate(input({ claude: obj({ hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'echo' }] }] } }) }));
    assert.strictEqual(byId(f2, 'hooks.wildcard')?.severity, 'warn');
  });

  it('policy: user, managed, managed mode/hooks, managed invalid; enable fixes are suppressed under policy', () => {
    const f1 = evaluate(input({ claude: read('settings.policy-disabled.json') }));
    assert.strictEqual(byId(f1, 'policy.user')?.severity, 'error');
    assert.strictEqual(byId(f1, 'claude.defaultMode')?.fix, undefined, 'no point offering Enable under policy');
    const managedPath = '/etc/claude-code/managed-settings.json';
    const f2 = evaluate(input({ managed: [{ path: managedPath, result: read('settings.policy-disabled.json') }] }));
    assert.strictEqual(byId(f2, 'policy.managed')?.severity, 'error');
    assert.strictEqual(byId(f2, 'policy.managed')?.fix, undefined);
    assert.strictEqual(byId(f2, 'ext.mode')?.fix, undefined);
    const f3 = evaluate(input({ managed: [{ path: managedPath, result: read('settings.logging-hook.json') }] }));
    assert.strictEqual(byId(f3, 'policy.managed-mode')?.severity, 'warn');
    assert.strictEqual(byId(f3, 'policy.managed-hooks')?.severity, 'warn');
    const f4 = evaluate(input({ managed: [{ path: managedPath, result: read('settings.trailing-comma.json') }] }));
    assert.strictEqual(byId(f4, 'policy.managed-invalid')?.severity, 'warn');
    const f5 = evaluate(input({ managed: [{ path: managedPath, result: unreadable }] }));
    assert.match(byId(f5, 'policy.managed-invalid')!.title, /EACCES/);
  });

  it('official extension: missing (info) / unsupported / older than tested / explicit non-bypass / allow false', () => {
    assert.strictEqual(byId(evaluate(input({ official: { ...goodOfficial, installed: false } })), 'ext.missing')?.severity, 'info');
    assert.strictEqual(byId(evaluate(input({ official: { ...goodOfficial, supportsBypass: false } })), 'ext.contract')?.severity, 'error');
    assert.strictEqual(byId(evaluate(input({ official: { ...goodOfficial, olderThanTested: true } })), 'ext.untested')?.severity, 'info');
    const m = byId(evaluate(input({ official: { ...goodOfficial, mode: 'acceptEdits' } })), 'ext.mode');
    assert.strictEqual(m?.severity, 'warn');
    assert.match(m!.title, /"acceptEdits"/);
    const a = byId(evaluate(input({ official: { ...goodOfficial, allow: false } })), 'ext.allow');
    assert.strictEqual(a?.severity, 'warn');
    assert.match(a!.detail!, /is false/);
  });

  it('conflicting extensions: error with uninstall fix; pending reload becomes info', () => {
    const ext = { id: 'ra1d7.claude-auto-accept', name: 'Claude Auto-Accept', why: 'quota', version: '1.2.0' };
    const f = evaluate(input({ rogueExtensions: [ext] }));
    const r = byId(f, 'rogue.ra1d7.claude-auto-accept');
    assert.strictEqual(r?.severity, 'error');
    assert.deepStrictEqual(r?.fix, { kind: 'uninstall-extension', id: 'ra1d7.claude-auto-accept' });
    assert.strictEqual(byId(f, 'rogue.none'), undefined);
    const f2 = evaluate(input({ rogueExtensions: [ext], uninstalledPendingReload: ['ra1d7.claude-auto-accept'] }));
    assert.strictEqual(byId(f2, 'rogue.ra1d7.claude-auto-accept')?.severity, 'info');
  });

  it('project files: mode override is a warning (terminal sessions), disable is a warning, invalid, hooks; missing files are silent', () => {
    const f = evaluate(
      input({
        workspaceFiles: [
          { path: '/w/.claude/settings.json', result: read('settings.logging-hook.json') },
          { path: '/w/.claude/settings.local.json', result: read('settings.trailing-comma.json') },
          { path: '/w2/.claude/settings.json', result: missing },
          { path: '/w3/.claude/settings.json', result: read('settings.policy-disabled.json') },
        ],
      }),
    );
    assert.strictEqual(byId(f, 'ws.mode:/w/.claude/settings.json')?.severity, 'warn');
    assert.match(byId(f, 'ws.mode:/w/.claude/settings.json')!.detail!, /VS Code conversations are not affected/);
    assert.strictEqual(byId(f, 'ws.hooks:/w/.claude/settings.json')?.severity, 'warn');
    assert.strictEqual(byId(f, 'ws.invalid:/w/.claude/settings.local.json')?.severity, 'error');
    assert.strictEqual(byId(f, 'ws.policy:/w3/.claude/settings.json')?.severity, 'warn');
    assert.ok(!ids(f).some((i) => i.includes('/w2/')));
    assert.ok(summarize(f).warnings > 0, 'title must not say all good');
  });

  it('missing settings file is an info, and the fixes point to enable', () => {
    const f = evaluate(input({ claude: missing }));
    assert.strictEqual(byId(f, 'claude.missing')?.severity, 'info');
    assert.strictEqual(byId(f, 'claude.defaultMode')?.fix?.kind, 'enable');
    assert.strictEqual(byId(f, 'hooks.none'), undefined, 'no file → no claim about hooks');
  });

  it('translate hook is used and placeholders are formatted by defaultT', () => {
    const f = evaluate(input({ claude: missing }), (m) => `T:${m}`);
    assert.ok(f.every((x) => x.title.startsWith('T:')));
    const g = evaluate(input({ claude: read('settings.with-rogue-hook.json') }));
    assert.ok(g.every((x) => !/\{\d\}/.test(x.title) && !/\{\d\}/.test(x.detail ?? '')), 'unformatted placeholder leaked');
  });

  it('never leaks setting VALUES such as env API keys into titles/details', () => {
    const data = { env: { ANTHROPIC_API_KEY: 'sk-ant-SECRETSECRETSECRET' }, permissions: { defaultMode: 'default' }, hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'curl -H "Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ" https://x' }] }] } };
    const f = evaluate(input({ claude: obj(data) }));
    // titles + details are what reaches the UI, the clipboard and the report (fix payloads never do)
    const text = f.map((x) => `${x.title}\n${x.detail ?? ''}`).join('\n');
    assert.ok(!text.includes('SECRETSECRET'));
    assert.ok(!text.includes('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 'token in hook command must be masked');
    assert.ok(text.includes('ghp_ABCD***') || text.includes('Bearer ***'));
  });
});

describe('maskSecrets', () => {
  it('masks common token shapes', () => {
    assert.strictEqual(maskSecrets('token=abc123 x'), 'token=*** x');
    assert.strictEqual(maskSecrets('-H "Authorization: Bearer abcdefgh"'), '-H "Authorization: Bearer ***"');
    assert.strictEqual(maskSecrets('-H "Authorization: abcdefgh"'), '-H "Authorization: ***"');
    assert.strictEqual(maskSecrets('key sk-ant-api03-verylongtokenvalue1234567890'), 'key sk-ant-ap***');
    assert.strictEqual(maskSecrets('node hook.js'), 'node hook.js');
  });
});

describe('planFixAll', () => {
  it('dedupes enable, merges hook removals, skips wildcard/narrow hooks, opens nothing', () => {
    const f = evaluate(input({ claude: read('settings.with-rogue-hook.json'), official: { ...goodOfficial, allow: undefined, mode: undefined }, rogueExtensions: [{ id: 'a.b', name: 'A', why: 'w' }, { id: 'c.d', name: 'C', why: 'w' }] }));
    const plan = planFixAll(f);
    const kinds = plan.map((p) => p.kind);
    assert.strictEqual(kinds.filter((k) => k === 'enable').length, 1, 'enable exactly once');
    assert.strictEqual(kinds.filter((k) => k === 'remove-hooks').length, 1);
    assert.strictEqual((plan.find((p) => p.kind === 'remove-hooks') as any).hooks.length, 1, 'only the wildcard known-tool hook; narrow ones are opt-in');
    assert.strictEqual(kinds.filter((k) => k === 'uninstall-extension').length, 2);
    assert.ok(!kinds.includes('open-file'));
    assert.ok(!kinds.includes('clean-allow'), 'allow.stale is info → not in fix-all');
    assert.strictEqual(kinds[kinds.length - 1], 'enable', 'enable runs last so its checks see the cleaned file');
  });
  it('wildcard logging hook is not auto-removed', () => {
    const plan = planFixAll(evaluate(input({ claude: read('settings.logging-hook.json') })));
    assert.ok(!plan.some((p) => p.kind === 'remove-hooks'));
  });
});

describe('report: redaction', () => {
  it('redacts home with any casing/separator on Windows, extra dirs, and the user name', () => {
    const opts = { home: 'C:\\Users\\alice', username: 'alice', platform: 'win32' as const, extraDirs: ['D:\\cfg\\claude'] };
    assert.strictEqual(redact('c:\\Users\\alice\\proj\\.claude\\settings.json', opts), '~\\proj\\.claude\\settings.json');
    assert.strictEqual(redact('node "C:/Users/alice/.claude/claude-auto-accept/hook.js"', opts), 'node "~/.claude/claude-auto-accept/hook.js"');
    assert.strictEqual(redact('D:/cfg/claude/settings.json', opts), '~/settings.json');
    assert.strictEqual(redact('E:\\Users\\alice\\x and c:/users/ALICE/y', opts), 'E:\\Users\\<user>\\x and ~/y');
  });
  it('POSIX: case-sensitive home, /home/<user> shape', () => {
    const opts = { home: '/home/bob', username: 'bob', platform: 'linux' as const };
    assert.strictEqual(redact('/home/bob/.claude/settings.json', opts), '~/.claude/settings.json');
    assert.strictEqual(redact('/Users/bob/x /home/bobby/y', opts), '/Users/<user>/x /home/bobby/y');
    assert.strictEqual(redact('/HOME/BOB/x', opts), '/HOME/BOB/x', 'no case folding on POSIX');
  });
  it('rendered report contains neither the home dir nor the user name, and lists every finding', () => {
    const findings = evaluate(input({ claudePath: 'C:\\Users\\alice\\.claude\\settings.json', claude: read('settings.with-rogue-hook.json'), workspaceFiles: [{ path: 'c:\\Users\\alice\\proj\\.claude\\settings.json', result: read('settings.logging-hook.json') }] }));
    const md = renderReportMarkdown(
      { generatedAt: 'now', findings, env: { platform: 'win32', vscodeVersion: '1.133.0', officialVersion: '2.1.233', claudeSettingsPath: 'C:\\Users\\alice\\.claude\\settings.json', extensionVersion: '0.1.0' } },
      { home: 'C:\\Users\\alice', username: 'alice', platform: 'win32' },
    );
    assert.ok(!/alice/i.test(md), md);
    assert.ok(md.includes('~\\.claude\\settings.json'));
    for (const f of findings) assert.ok(md.includes(`[${f.severity === 'warn' ? 'WARN' : f.severity.toUpperCase()}]`));
    assert.match(md, /Doctor report/);
  });
});
