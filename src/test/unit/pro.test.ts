import * as assert from 'assert';
import { evaluate, DoctorInput } from '../../core/findings';
import { applyGuardrails, GUARDRAIL_TEMPLATES, installedGuardrails, removeGuardrails } from '../../core/guardrails';
import { decideAfterValidation, decideOffline, FetchLike, LicenseState, looksLikeLicenseKey, polarActivate, polarValidate } from '../../core/license';
import { applyCarefulProfile, applyProfile, buildProfile, hasCarefulProfile, parseProfile, removeCarefulProfile } from '../../core/profile';

describe('guardrails', () => {
  it('templates are well-formed permission rules', () => {
    for (const t of GUARDRAIL_TEMPLATES) {
      for (const r of [...(t.ask ?? []), ...(t.deny ?? [])]) assert.match(r, /^(Bash|Read|Edit|Write|WebFetch)\(.+\)$/, r);
      assert.ok((t.ask?.length ?? 0) + (t.deny?.length ?? 0) > 0);
    }
  });
  it('apply adds without duplicates and keeps user rules; remove takes only ours', () => {
    const user = { permissions: { ask: ['Bash(git push --force*)', 'Bash(my-own-thing *)'], deny: ['Read(**/secret.txt)'] } };
    const { next, added } = applyGuardrails(user, ['destructive-shell', 'secrets']);
    assert.ok(!added.ask.includes('Bash(git push --force*)'), 'already present → not counted as added');
    assert.ok(next.permissions.ask.includes('Bash(my-own-thing *)'));
    assert.strictEqual(new Set(next.permissions.ask).size, next.permissions.ask.length, 'no duplicates');
    assert.deepStrictEqual(installedGuardrails(next), ['destructive-shell', 'secrets']);
    const { next: back, removed } = removeGuardrails(next, ['destructive-shell', 'secrets']);
    assert.deepStrictEqual(back.permissions.ask, ['Bash(git push --force*)', 'Bash(my-own-thing *)'].filter((r) => r === 'Bash(my-own-thing *)'), 'the shared rule was ours too — removed; user rule kept');
    assert.deepStrictEqual(back.permissions.deny, ['Read(**/secret.txt)']);
    assert.ok(removed > 0);
    assert.deepStrictEqual(installedGuardrails(back), []);
  });
  it('works on empty settings and tolerates junk', () => {
    const { next } = applyGuardrails(undefined, ['publishing']);
    assert.ok(next.permissions.ask.length > 0);
    assert.deepStrictEqual(applyGuardrails({ permissions: 'x' }, ['infra']).next.permissions.ask.length > 0, true);
    assert.deepStrictEqual(installedGuardrails(undefined), []);
    assert.strictEqual(removeGuardrails({}).removed, 0);
  });
});

describe('careful profile', () => {
  it('apply/remove round trip, preserving other keys and deleting empty containers', () => {
    const { next, changed } = applyCarefulProfile({ permissions: { allow: ['Read'] }, model: 'x' });
    assert.ok(changed);
    assert.strictEqual(next.permissions.disableBypassPermissionsMode, 'disable');
    assert.strictEqual(next.permissions.defaultMode, 'default');
    assert.ok(hasCarefulProfile(next));
    assert.strictEqual(applyCarefulProfile(next).changed, false, 'idempotent');
    const r = removeCarefulProfile(next);
    assert.deepStrictEqual(r.next, { permissions: { allow: ['Read'] }, model: 'x' });
    assert.strictEqual(r.empty, false);
    const r2 = removeCarefulProfile(applyCarefulProfile(undefined).next);
    assert.strictEqual(r2.empty, true, 'file created only for the profile → empty after removal');
    assert.ok(!hasCarefulProfile(undefined));
  });
  it('remove does not touch a user-set defaultMode other than "default"', () => {
    const r = removeCarefulProfile({ permissions: { disableBypassPermissionsMode: 'disable', defaultMode: 'plan' } });
    assert.deepStrictEqual(r.next, { permissions: { defaultMode: 'plan' } });
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
});

describe('portable profile', () => {
  it('build → parse → apply carries only Handsfree keys', () => {
    const settings = { permissions: { defaultMode: 'bypassPermissions', allow: ['Bash'], ask: ['Bash(sudo *)'], deny: ['Read(**/.env)'] }, skipDangerousModePermissionPrompt: true, env: { ANTHROPIC_API_KEY: 'sk-secret' }, hooks: { PreToolUse: [] } };
    const p = buildProfile(settings, { allow: true, mode: 'bypassPermissions' }, new Date('2026-08-15T00:00:00Z'));
    const text = JSON.stringify(p);
    assert.ok(!text.includes('sk-secret') && !text.includes('hooks') && !text.includes('"allow"'), 'no secrets, hooks or allow rules');
    assert.deepStrictEqual(parseProfile(JSON.parse(text)), JSON.parse(text), 'round-trips through JSON (undefined keys dropped)');
    assert.strictEqual(parseProfile({ format: 'other' }), undefined);
    assert.strictEqual(parseProfile('nope'), undefined);
    const { next, changes } = applyProfile({ permissions: { ask: ['Bash(sudo *)', 'Bash(mine *)'] } }, p);
    assert.strictEqual(next.permissions.defaultMode, 'bypassPermissions');
    assert.deepStrictEqual(next.permissions.ask, ['Bash(sudo *)', 'Bash(mine *)']);
    assert.deepStrictEqual(next.permissions.deny, ['Read(**/.env)']);
    assert.ok(changes.includes('permissions.deny (+1)') && !changes.some((c) => c.startsWith('permissions.ask')));
    assert.deepStrictEqual(applyProfile(next, p).changes, [], 'idempotent');
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
    assert.deepStrictEqual(decideOffline({ key: 'k', status: 'revoked', lastValidatedAt: iso(1) }, now), { pro: false, reason: 'revoked' });
    assert.deepStrictEqual(decideOffline({ key: 'k', status: 'granted', lastValidatedAt: iso(1), expiresAt: iso(2) }, now), { pro: false, reason: 'expired' });
    assert.strictEqual(decideOffline({ key: 'k', lastValidatedAt: new Date(now.getTime() + 3600_000).toISOString() }, now), undefined, 'clock skew forward → revalidate');
  });

  it('after validation: granted / revoked / expired / network within and beyond grace', () => {
    const base: LicenseState = { key: 'k', activationId: 'a', lastValidatedAt: iso(48) };
    let r = decideAfterValidation(base, now, { ok: true, status: 'granted', expiresAt: null });
    assert.deepStrictEqual(r.decision, { pro: true, source: 'validated' });
    assert.strictEqual(r.next.lastValidatedAt, now.toISOString());
    r = decideAfterValidation(base, now, { ok: true, status: 'revoked' });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'revoked' });
    r = decideAfterValidation(base, now, { ok: true, status: 'granted', expiresAt: iso(1) });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'expired' });
    r = decideAfterValidation(base, now, { ok: false, kind: 'invalid' });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'invalid' });
    assert.strictEqual(r.next.status, 'revoked');
    r = decideAfterValidation({ ...base, lastValidatedAt: iso(24 * 10) }, now, { ok: false, kind: 'network' });
    assert.deepStrictEqual(r.decision, { pro: true, source: 'grace' }, '10 days offline → still Pro');
    r = decideAfterValidation({ ...base, lastValidatedAt: iso(24 * 15) }, now, { ok: false, kind: 'network' });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'grace-expired' });
    r = decideAfterValidation({ key: 'k' }, now, { ok: false, kind: 'network' });
    assert.deepStrictEqual(r.decision, { pro: false, reason: 'network' });
  });

  it('key shape', () => {
    assert.ok(looksLikeLicenseKey('ABCD-1234-EFGH-5678-IJKL'));
    assert.ok(!looksLikeLicenseKey('short'));
    assert.ok(!looksLikeLicenseKey('has spaces in it and is long enough'));
  });

  it('polar calls: request shape and response mapping (fake fetch)', async () => {
    const calls: { url: string; body: any }[] = [];
    const fake =
      (status: number, data: any): FetchLike =>
      async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: status >= 200 && status < 300, status, json: async () => data };
      };
    const cfg = { organizationId: 'org_1', checkoutUrl: '' };
    const a = await polarActivate(fake(200, { id: 'act_1', license_key: { status: 'granted', expires_at: null } }), cfg, 'KEY', 'my-pc', { platform: 'win32' });
    assert.deepStrictEqual(a, { ok: true, activationId: 'act_1', status: 'granted', expiresAt: null });
    assert.ok(calls[0].url.endsWith('/activate'));
    assert.deepStrictEqual(calls[0].body, { key: 'KEY', organization_id: 'org_1', label: 'my-pc', meta: { platform: 'win32' } });
    assert.deepStrictEqual(await polarActivate(fake(404, { detail: 'nope' }), cfg, 'KEY', 'pc', {}), { ok: false, kind: 'invalid', message: 'License key not found' });
    const lim = await polarActivate(fake(403, { detail: 'License key activation limit already reached' }), cfg, 'KEY', 'pc', {});
    assert.ok(!lim.ok && lim.kind === 'limit' && /limit/.test(lim.message));
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
