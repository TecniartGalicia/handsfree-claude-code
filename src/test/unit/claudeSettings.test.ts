import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  applyAutonomous,
  BYPASS_MODE,
  bypassDisabledByPolicy,
  effectiveDefaultMode,
  findRogueHooks,
  findStaleAllowRules,
  removeAllowRules,
  removeHooks,
} from '../../core/claudeSettings';
import { parseStrictJson } from '../../core/jsonFile';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
const load = (name: string) => {
  const r = parseStrictJson<any>(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
  if (!r.ok) throw new Error(`fixture ${name} invalid: ${r.error.message}`);
  return r.data;
};

describe('applyAutonomous', () => {
  it('creates the two keys on an empty/undefined settings object', () => {
    const { next, changes } = applyAutonomous(undefined);
    assert.strictEqual(next.permissions.defaultMode, BYPASS_MODE);
    assert.strictEqual(next.skipDangerousModePermissionPrompt, true);
    assert.deepStrictEqual(
      changes.map((c) => c.path),
      ['permissions.defaultMode', 'skipDangerousModePermissionPrompt'],
    );
  });

  it('preserves every other key and does not mutate the input', () => {
    const input = load('settings.with-rogue-hook.json');
    const before = JSON.stringify(input);
    const { next } = applyAutonomous(input);
    assert.strictEqual(JSON.stringify(input), before, 'input mutated');
    assert.strictEqual(next.model, 'opus[1m]');
    assert.strictEqual(next.effortLevel, 'xhigh');
    assert.deepStrictEqual(next.permissions.allow, input.permissions.allow);
    assert.ok(next.hooks, 'hooks are left alone by applyAutonomous (Doctor handles them)');
    assert.strictEqual(next.permissions.defaultMode, BYPASS_MODE);
  });

  it('is idempotent', () => {
    const once = applyAutonomous(load('settings.autonomous.json'));
    assert.strictEqual(once.changes.length, 0);
    assert.deepStrictEqual(once.next, load('settings.autonomous.json'));
  });

  it('replaces a non-object permissions value instead of crashing', () => {
    const { next, changes } = applyAutonomous({ permissions: 'nope' });
    assert.strictEqual(next.permissions.defaultMode, BYPASS_MODE);
    assert.strictEqual(changes[0].path, 'permissions');
  });
});

describe('effectiveDefaultMode / policy', () => {
  it('reads the mode', () => {
    assert.strictEqual(effectiveDefaultMode(load('settings.autonomous.json')), BYPASS_MODE);
    assert.strictEqual(effectiveDefaultMode(load('settings.logging-hook.json')), 'auto');
    assert.strictEqual(effectiveDefaultMode({}), undefined);
    assert.strictEqual(effectiveDefaultMode(undefined), undefined);
  });
  it('detects disableBypassPermissionsMode', () => {
    assert.strictEqual(bypassDisabledByPolicy(load('settings.policy-disabled.json')), true);
    assert.strictEqual(bypassDisabledByPolicy(load('settings.autonomous.json')), false);
    assert.strictEqual(bypassDisabledByPolicy(undefined), false);
  });
});

describe('findRogueHooks', () => {
  it('flags the real-world paid auto-accept hook as known-tool, and the ExitPlanMode/AskUserQuestion approvers too', () => {
    const hooks = findRogueHooks(load('settings.with-rogue-hook.json'));
    const known = hooks.filter((h) => h.reason === 'known-tool');
    assert.strictEqual(known.length, 3, JSON.stringify(hooks, null, 2));
    assert.ok(known.some((h) => h.command.includes('claude-auto-accept/hook.js') && h.matcher === '*'));
    assert.ok(known.some((h) => h.matcher === 'ExitPlanMode' && /approve/.test(h.command)));
    assert.ok(known.some((h) => h.matcher === 'AskUserQuestion'));
  });

  it('flags a wildcard logging hook only as wildcard (never as known-tool), ignores narrow matchers and PostToolUse', () => {
    const hooks = findRogueHooks(load('settings.logging-hook.json'));
    assert.strictEqual(hooks.length, 1);
    assert.strictEqual(hooks[0].reason, 'wildcard');
    assert.strictEqual(hooks[0].event, 'PreToolUse');
    assert.ok(hooks[0].command.includes('tools.log'));
  });

  it('treats a missing matcher as wildcard and looks at PermissionRequest too', () => {
    const hooks = findRogueHooks({ hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'echo x' }] }] } });
    assert.strictEqual(hooks.length, 1);
    assert.strictEqual(hooks[0].event, 'PermissionRequest');
    assert.strictEqual(hooks[0].reason, 'wildcard');
  });

  it('ignores prompt/agent hooks and malformed entries', () => {
    const hooks = findRogueHooks({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'prompt', prompt: 'ok?' }, 'garbage', null] }, 'garbage'] } });
    assert.strictEqual(hooks.length, 0);
    assert.deepStrictEqual(findRogueHooks(undefined), []);
    assert.deepStrictEqual(findRogueHooks({ hooks: 'nope' }), []);
  });
});

describe('removeHooks', () => {
  it('removes exactly the given hooks and prunes empty containers', () => {
    const s = load('settings.with-rogue-hook.json');
    const all = findRogueHooks(s);
    const next = removeHooks(s, all);
    assert.strictEqual(next.hooks, undefined, 'hooks object should disappear when empty');
    assert.strictEqual(next.model, 'opus[1m]');
    assert.ok(s.hooks, 'input not mutated');
  });

  it('keeps sibling hooks in the same group and other events', () => {
    const s = load('settings.logging-hook.json');
    const wild = findRogueHooks(s);
    const next = removeHooks(s, wild);
    assert.strictEqual(next.hooks.PreToolUse.length, 1);
    assert.strictEqual(next.hooks.PreToolUse[0].matcher, 'Bash');
    assert.strictEqual(next.hooks.PostToolUse.length, 1);
  });

  it('removes one hook out of a group with two', () => {
    const s = { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'a' }, { type: 'command', command: 'b' }] }] } };
    const next = removeHooks(s, [{ event: 'PreToolUse', groupIndex: 0, hookIndex: 0, matcher: '*', command: 'a', reason: 'wildcard' }]);
    assert.deepStrictEqual(next.hooks.PreToolUse[0].hooks, [{ type: 'command', command: 'b' }]);
  });
});

describe('findStaleAllowRules', () => {
  it('flags the leftovers of the paid extension in the real-world allow list', () => {
    const s = load('settings.with-rogue-hook.json');
    const stale = findStaleAllowRules(s.permissions.allow);
    const rules = stale.map((r) => r.rule);
    assert.ok(rules.includes('__claude-auto-approve__'));
    assert.ok(rules.includes('Bash(*)'), 'Bash(*) is redundant because "Bash" is present');
    assert.ok(rules.includes('MultiEdit'));
    assert.ok(rules.includes('Task'));
    assert.ok(rules.includes('mcp__*(*)'));
    assert.ok(!rules.includes('Bash'));
    assert.ok(!rules.includes('ExitPlanMode'));
  });

  it('does not flag Tool(*) when the bare tool is absent (it may be doing work)', () => {
    assert.deepStrictEqual(findStaleAllowRules(['Bash(*)']), []);
    assert.deepStrictEqual(findStaleAllowRules(['Bash(npm *)', 'Read']), []);
  });

  it('tolerates junk', () => {
    assert.deepStrictEqual(findStaleAllowRules(undefined), []);
    assert.deepStrictEqual(findStaleAllowRules('Bash'), []);
    assert.deepStrictEqual(findStaleAllowRules([1, null, 'Bash']), []);
  });

  it('removeAllowRules removes only the listed rules', () => {
    const s = load('settings.with-rogue-hook.json');
    const stale = findStaleAllowRules(s.permissions.allow).map((r) => r.rule);
    const next = removeAllowRules(s, stale);
    assert.strictEqual(next.permissions.allow.length, s.permissions.allow.length - stale.length);
    assert.ok(next.permissions.allow.includes('Bash'));
    assert.ok(!next.permissions.allow.includes('__claude-auto-approve__'));
  });
});
