import * as assert from 'assert';
import { evaluate, DoctorInput } from '../../core/findings';
import { allTemplateRules, applyGuardrails, GUARDRAIL_TEMPLATES, guardrailPresence, installedGuardrails, removeGuardrails } from '../../core/guardrails';
import { decideAfterValidation, decideOffline, FetchLike, LicenseState, looksLikeLicenseKey, polarActivate, polarValidate } from '../../core/license';
import { applyCarefulProfile, applyProfile, buildProfile, hasCarefulProfile, parseProfile, profileEnablesBypass, removeCarefulProfile } from '../../core/profile';

describe('guardrails', () => {
  it('templates are well-formed permission rules', () => {
    for (const t of GUARDRAIL_TEMPLATES) {
      for (const r of [...(t.ask ?? []), ...(t.deny ?? [])]) assert.match(r, /^(Bash|Read|Edit|Write|WebFetch)\(.+\)$/, r);
      assert.ok((t.ask?.length ?? 0) + (t.deny?.length ?? 0) > 0);
    }
    assert.ok(allTemplateRules().has('Bash(sudo *)'));
  });
  it('apply adds without duplicates and keeps user rules; remove-all takes template rules only', () => {
    const user = { permissions: { ask: ['Bash(sudo *)', 'Bash(my-own-thing *)'], deny: ['Read(**/secret.txt)'] } };
    const { next, added, addedBySet } = applyGuardrails(user, ['destructive-shell', 'secrets']);
    assert.ok(!added.ask.includes('Bash(sudo *)'), 'already present → not counted as added');
    assert.ok(!addedBySet['destructive-shell'].includes('Bash(sudo *)'));
    assert.ok(next.permissions.ask.includes('Bash(my-own-thing *)'));
    assert.strictEqual(new Set(next.permissions.ask).size, next.permissions.ask.length, 'no duplicates');
    assert.deepStrictEqual(installedGuardrails(next), ['destructive-shell', 'secrets']);
    const { next: back, removed } = removeGuardrails(next, ['destructive-shell', 'secrets']);
    assert.deepStrictEqual(back.permissions.ask, ['Bash(my-own-thing *)']);
    assert.deepStrictEqual(back.permissions.deny, ['Read(**/secret.txt)']);
    assert.ok(removed > 0);
    assert.deepStrictEqual(installedGuardrails(back), []);
  });
  it('remove with the recorded "added" list leaves a rule the user had before', () => {
    const user = { permissions: { ask: ['Bash(sudo *)'] } };
    const { next, addedBySet } = applyGuardrails(user, ['destructive-shell']);
    const { next: back } = removeGuardrails(next, ['destructive-shell'], addedBySet['destructive-shell']);
    assert.deepStrictEqual(back.permissions.ask, ['Bash(sudo *)'], 'user rule survives');
  });
  it('presence: full / partial / none — a hand-removed rule shows partial', () => {
    const { next } = applyGuardrails(undefined, ['publishing']);
    assert.strictEqual(guardrailPresence(next).publishing, 'full');
    next.permissions.ask = next.permissions.ask.filter((r: string) => r !== 'Bash(npm publish*)');
    assert.strictEqual(guardrailPresence(next).publishing, 'partial');
    assert.strictEqual(guardrailPresence(next).infra, 'none');
    assert.deepStrictEqual(installedGuardrails(next), []);
    const { next: cleaned } = removeGuardrails(next, ['publishing']);
    assert.strictEqual(guardrailPresence(cleaned).publishing, 'none');
  });
  it('works on empty settings and tolerates junk', () => {
    const { next } = applyGuardrails(undefined, ['publishing']);
    assert.ok(next.permissions.ask.length > 0);
    assert.ok(applyGuardrails({ permissions: 'x' }, ['infra']).next.permissions.ask.length > 0);
    assert.deepStrictEqual(installedGuardrails(undefined), []);
    assert.strictEqual(removeGuardrails({}).removed, 0);
  });
});

describe('careful profile', () => {
  it('apply/remove round trip, preserving other keys and deleting empty containers', () => {
    const r = applyCarefulProfile({ permissions: { allow: ['Read'] }, model: 'x' });
    assert.ok(r.changed && r.setDefaultMode && r.previousDefaultMode === undefined);
    assert.strictEqual(r.next.permissions.disableBypassPermissionsMode, 'disable');
    assert.strictEqual(r.next.permissions.defaultMode, 'default');
    assert.ok(hasCarefulProfile(r.next));
    assert.strictEqual(applyCarefulProfile(r.next).changed, false, 'idempotent');
    const back = removeCarefulProfile(r.next, { setDefaultMode: r.setDefaultMode, previousDefaultMode: r.previousDefaultMode });
    assert.deepStrictEqual(back.next, { permissions: { allow: ['Read'] }, model: 'x' });
    assert.strictEqual(back.empty, false);
    const r2 = applyCarefulProfile(undefined);
    assert.strictEqual(removeCarefulProfile(r2.next, r2).empty, true, 'file created only for the profile → empty after removal');
    assert.ok(!hasCarefulProfile(undefined));
  });
  it('leaves a user "plan" mode alone; replaces bypass/dontAsk and restores it on removal', () => {
    const plan = applyCarefulProfile({ permissions: { defaultMode: 'plan' } });
    assert.strictEqual(plan.next.permissions.defaultMode, 'plan');
    assert.strictEqual(plan.setDefaultMode, false);
    const byp = applyCarefulProfile({ permissions: { defaultMode: 'bypassPermissions' } });
    assert.strictEqual(byp.next.permissions.defaultMode, 'default');
    assert.strictEqual(byp.previousDefaultMode, 'bypassPermissions');
    const back = removeCarefulProfile(byp.next, byp);
    assert.deepStrictEqual(back.next, { permissions: { defaultMode: 'bypassPermissions' } }, 'previous mode restored');
    const legacy = removeCarefulProfile({ permissions: { disableBypassPermissionsMode: 'disable', defaultMode: 'plan' } });
    assert.deepStrictEqual(legacy.next, { permissions: { defaultMode: 'plan' } }, 'no record → only delete "default"');
  });
  it('Doctor reports an owned careful profile as info and skips the mode warning', () => {
    const file = '/w/.claude/settings.local.json';
    const data = applyCarefulProfile(undefined).next;
    const base: DoctorInput = {
      claudePath: '/home/u/.claude/settings.json',
      claude: { ok: true, exists: true, data: { permissions: { defaultMode: 'bypassPermissions' }, skipDangerousModePermissionPrompt: true }, raw: '' },
      managed: [],
      official: { installed: true, version: '2.1.233', supportsBypass: true, olderThanTested: false, allow: true, mode: 'bypassPermissions' },
      rogueExtensions: [],
      uninstalledPendingReload: [],
      workspaceFiles: [{ path: file, result: { ok: true, exists: true, data, raw: '' } }],
    };
    const notOwned = evaluate(base);
    assert.strictEqual(notOwned.find((f) => f.id === `ws.policy:${file}`)?.severity, 'warn');
    assert.strictEqual(notOwned.find((f) => f.id === `ws.mode:${file}`)?.severity, 'warn');
    const owned = evaluate({ ...base, ownedProfilePaths: [file.toUpperCase()] });
    assert.strictEqual(owned.find((f) => f.id === `ws.policy:${file}`)?.severity, 'info');
    assert.strictEqual(owned.find((f) => f.id === `ws.mode:${file}`), undefined);
  });
  it('Doctor lists ask rules as info and counts the Handsfree ones', () => {
    const { next } = applyGuardrails({ permissions: { defaultMode: 'bypassPermissions', ask: ['Bash(mine *)'] }, skipDangerousModePermissionPrompt: true }, ['publishing']);
    const f = evaluate({
      claudePath: '/h/.claude/settings.json',
      claude: { ok: true, exists: true, data: next, raw: '' },
      managed: [],
      official: { installed: true, version: '2.1.233', supportsBypass: true, olderThanTested: false, allow: true, mode: 'bypassPermissions' },
      rogueExtensions: [],
      uninstalledPendingReload: [],
      workspaceFiles: [],
    });
    const ask = f.find((x) => x.id === 'ask.rules');
    assert.strictEqual(ask?.severity, 'info');
    assert.match(ask!.title, /^\d+ ask rule\(s\).*\(\d+ from Handsfree/);
    assert.ok(ask!.detail!.includes('Bash(mine *)'));
  });
});

describe('portable profile', () => {
  it('build → parse → apply carries only Handsfree keys and reports before → after', () => {
    const settings = { permissions: { defaultMode: 'bypassPermissions', allow: ['Bash'], ask: ['Bash(sudo *)'], deny: ['Read(**/.env)'] }, skipDangerousModePermissionPrompt: true, env: { ANTHROPIC_API_KEY: 'sk-secret' }, hooks: { PreToolUse: [] } };
    const p = buildProfile(settings, { allow: true, mode: 'bypassPermissions' }, new Date('2026-08-15T00:00:00Z'));
    const text = JSON.stringify(p);
    assert.ok(!text.includes('sk-secret') && !text.includes('hooks') && !text.includes('"allow"'), 'no secrets, hooks or allow rules');
    assert.deepStrictEqual(parseProfile(JSON.parse(text)), JSON.parse(text));
    assert.ok(profileEnablesBypass(p));
    const { next, changes } = applyProfile({ permissions: { defaultMode: 'default', ask: ['Bash(sudo *)', 'Bash(mine *)'] } }, p);
    assert.strictEqual(next.permissions.defaultMode, 'bypassPermissions');
    assert.deepStrictEqual(next.permissions.ask, ['Bash(sudo *)', 'Bash(mine *)']);
    assert.deepStrictEqual(next.permissions.deny, ['Read(**/.env)']);
    assert.deepStrictEqual(changes.find((c) => c.path === 'permissions.defaultMode'), { path: 'permissions.defaultMode', from: 'default', to: 'bypassPermissions' });
    assert.deepStrictEqual(changes.find((c) => c.path === 'permissions.deny')?.to, ['Read(**/.env)']);
    assert.ok(!changes.some((c) => c.path === 'permissions.ask'));
    assert.deepStrictEqual(applyProfile(next, p).changes, [], 'idempotent');
  });
  it('rejects malformed or unsafe profiles', () => {
    const ok = { format: 'handsfree-profile', version: 1, exportedAt: 'x', claude: {}, vscode: {} };
    assert.ok(parseProfile(ok));
    assert.strictEqual(parseProfile({ ...ok, claude: { defaultMode: 'yolo' } }), undefined, 'unknown mode');
    assert.strictEqual(parseProfile({ ...ok, claude: { disableBypassPermissionsMode: 'enable' } }), undefined);
    assert.strictEqual(parseProfile({ ...ok, claude: { ask: 'Bash(x)' } }), undefined, 'ask must be an array');
    assert.strictEqual(parseProfile({ ...ok, claude: { deny: [{ evil: true }] } }), undefined);
    assert.strictEqual(parseProfile({ ...ok, claude: { deny: ['not a rule!'] } }), undefined);
    assert.ok(parseProfile({ ...ok, claude: { deny: ['Bash', 'Read(**/.env)'] } }), 'bare tool and scoped rules are valid');
    assert.strictEqual(parseProfile({ ...ok, vscode: { initialPermissionMode: 'auto' } }), undefined, 'the extension does not accept auto');
    assert.strictEqual(parseProfile({ ...ok, vscode: { allowDangerouslySkipPermissions: 'yes' } }), undefined);
    assert.strictEqual(parseProfile({ format: 'other' }), undefined);
    assert.strictEqual(parseProfile('nope'), undefined);
    assert.strictEqual(profileEnablesBypass(parseProfile(ok)!), false);
    assert.strictEqual(profileEnablesBypass(parseProfile({ ...ok, vscode: { allowDangerouslySkipPermissions: true } })!), true);
  });
});

describe('licence state machine', () => {
  const now = new Date('2026-08-15T12:00:00Z');
  const iso = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString();

  it('offline decisions', () => {
    assert.deepStrictEqual(decideOffline({}, now), { pro: false, reason: 'no-key' });
    assert.deepStrictEqual(decideOffline({}, now, true), { pro: true, source: 'dev' });
    assert.deepStrictEqual(decideOffline({ key: 'k', lastValidatedAt: iso(1), status: 'granted' }, now), { pro: true, source: 'validated' });
    assert.strictEqual(decideOffline({ key: 'k', lastValidatedAt: iso(30), status: 'granted' }, now), undefined, 'older than 24h → revalidate');
    assert.strictEqual(decideOffline({ key: 'k', lastValidatedAt: iso(1), status: 'granted' }, now, false, true), undefined, 'force → always ask');
    assert.strictEqual(decideOffline({ key: 'k', lastValidatedAt: new Date(now.getTime() + 3600_000).toISOString() }, now), undefined, 'clock skew forward → revalidate');
  });

  it('a non-granted status is retried after 24h (no permanent trap)', () => {
    assert.deepStrictEqual(decideOffline({ key: 'k', status: 'revoked', lastCheckedAt: iso(1) }, now), { pro: false, reason: 'revoked' }, 'recently checked → trust it');
    assert.strictEqual(decideOffline({ key: 'k', status: 'revoked', lastCheckedAt: iso(25) }, now), undefined, 'stale → ask again');
    assert.strictEqual(decideOffline({ key: 'k', status: 'revoked' }, now), undefined, 'never checked → ask');
    assert.deepStrictEqual(decideOffline({ key: 'k', status: 'granted', lastValidatedAt: iso(1), lastCheckedAt: iso(1), expiresAt: iso(2) }, now), { pro: false, reason: 'expired' });
    assert.strictEqual(decideOffline({ key: 'k', status: 'granted', lastValidatedAt: iso(1), lastCheckedAt: iso(30), expiresAt: iso(2) }, now), undefined, 'expired but stale check → ask (renewals happen)');
  });

  it('after validation: granted / revoked → re-granted / expired / soft failures honour grace', () => {
    const base: LicenseState = { key: 'k', activationId: 'a', lastValidatedAt: iso(48) };
    let r = decideAfterValidation(base, now, { ok: true, status: 'granted', expiresAt: null });
    assert.deepStrictEqual(r.decision, { pro: true, source: 'validated' });
    assert.strictEqual(r.next.lastValidatedAt, now.toISOString());
    assert.strictEqual(r.next.lastCheckedAt, now.toISOString());
    r = decideAfterValidation(base, now, { ok: true, status: 'revoked' });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'revoked' });
    const regranted = decideAfterValidation(r.next, new Date(now.getTime() + 48 * 3600_000), { ok: true, status: 'granted', expiresAt: null });
    assert.deepStrictEqual(regranted.decision, { pro: true, source: 'validated' }, 'revoked → granted again works');
    r = decideAfterValidation(base, now, { ok: true, status: 'granted', expiresAt: iso(1) });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'expired' });
    r = decideAfterValidation(base, now, { ok: false, kind: 'invalid' });
    assert.deepStrictEqual(r.decision, { pro: true, source: 'grace' }, 'a 4xx within grace is a soft failure');
    assert.notStrictEqual(r.next.status, 'revoked', 'a 4xx never persists a revoked status');
    r = decideAfterValidation({ ...base, lastValidatedAt: iso(24 * 10) }, now, { ok: false, kind: 'network' });
    assert.deepStrictEqual(r.decision, { pro: true, source: 'grace' }, '10 days offline → still Pro');
    r = decideAfterValidation({ ...base, lastValidatedAt: iso(24 * 15) }, now, { ok: false, kind: 'network' });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'grace-expired' });
    r = decideAfterValidation({ ...base, lastValidatedAt: iso(24 * 15) }, now, { ok: false, kind: 'invalid' });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'invalid' });
    r = decideAfterValidation({ key: 'k' }, now, { ok: false, kind: 'network' });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'network' });
    r = decideAfterValidation({ ...base, lastValidatedAt: new Date(now.getTime() + 3600_000).toISOString() }, now, { ok: false, kind: 'network' });
    assert.deepStrictEqual(r.decision, { pro: true, source: 'grace' }, 'clock skew + no network → grace, not "14 days offline"');
  });

  it('key shape', () => {
    assert.ok(looksLikeLicenseKey('ABCD-1234-EFGH-5678-IJKL'));
    assert.ok(!looksLikeLicenseKey('short'));
    assert.ok(!looksLikeLicenseKey('has spaces in it and is long enough'));
  });

  it('polar calls: request shape, response mapping, transient vs invalid (fake fetch)', async () => {
    const calls: { url: string; body: any; signal?: AbortSignal }[] = [];
    const fake =
      (status: number, data: any): FetchLike =>
      async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
        return { ok: status >= 200 && status < 300, status, json: async () => data };
      };
    const cfg = { organizationId: 'org_1', checkoutUrl: '' };
    const a = await polarActivate(fake(200, { id: 'act_1', license_key: { status: 'granted', expires_at: null } }), cfg, 'KEY', 'my-pc', { platform: 'win32' });
    assert.deepStrictEqual(a, { ok: true, activationId: 'act_1', status: 'granted', expiresAt: null });
    assert.ok(calls[0].url.endsWith('/activate'));
    assert.ok(calls[0].signal, 'a timeout signal is passed');
    assert.deepStrictEqual(calls[0].body, { key: 'KEY', organization_id: 'org_1', label: 'my-pc', meta: { platform: 'win32' } });
    assert.deepStrictEqual(await polarActivate(fake(404, { detail: 'nope' }), cfg, 'KEY', 'pc', {}), { ok: false, kind: 'invalid', message: 'License key not found' });
    const lim = await polarActivate(fake(403, { detail: [{ msg: 'License key activation limit already reached' }] }), cfg, 'KEY', 'pc', {});
    assert.ok(!lim.ok && lim.kind === 'limit' && /limit already reached/.test(lim.message), JSON.stringify(lim));
    assert.strictEqual((await polarActivate(fake(429, {}), cfg, 'KEY', 'pc', {}) as any).kind, 'network');
    assert.strictEqual((await polarActivate(fake(200, { weird: true }), cfg, 'KEY', 'pc', {}) as any).kind, 'unexpected');
    const v = await polarValidate(fake(200, { status: 'granted', expires_at: '2027-01-01T00:00:00Z' }), cfg, 'KEY', 'act_1');
    assert.deepStrictEqual(v, { ok: true, status: 'granted', expiresAt: '2027-01-01T00:00:00Z' });
    assert.deepStrictEqual(calls[calls.length - 1].body, { key: 'KEY', organization_id: 'org_1', activation_id: 'act_1' });
    assert.deepStrictEqual(await polarValidate(fake(404, {}), cfg, 'KEY'), { ok: false, kind: 'invalid' });
    assert.deepStrictEqual(await polarValidate(fake(503, {}), cfg, 'KEY'), { ok: false, kind: 'network' });
    const throwing: FetchLike = async () => {
      throw new Error('offline');
    };
    assert.deepStrictEqual(await polarValidate(throwing, cfg, 'KEY'), { ok: false, kind: 'network' });
  });
});
