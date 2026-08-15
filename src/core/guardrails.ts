/**
 * Guardrail templates: Claude Code `permissions.ask` / `permissions.deny` rules that keep working in
 * bypass mode (the docs are explicit: explicit ask rules still prompt, deny rules still block).
 * No hooks involved, so nothing can break or start answering "ask" to everything.
 */
import { ClaudeSettings, isPlainObject } from './claudeSettings';

export interface GuardrailTemplate {
  id: string;
  /** Localised by the VS Code layer via the `titleKey`/`detailKey` strings; core keeps them English. */
  title: string;
  detail: string;
  ask?: string[];
  deny?: string[];
}

export const GUARDRAIL_TEMPLATES: GuardrailTemplate[] = [
  {
    id: 'destructive-shell',
    title: 'Ask before destructive shell commands',
    detail: 'rm -rf, git push --force, git reset --hard, git clean, branch -D, sudo, chmod -R, dd, mkfs',
    ask: [
      'Bash(rm -rf *)',
      'Bash(rm -r *)',
      'Bash(rm -fr *)',
      'Bash(git push --force*)',
      'Bash(git push -f *)',
      'Bash(git reset --hard*)',
      'Bash(git clean -f*)',
      'Bash(git branch -D *)',
      'Bash(sudo *)',
      'Bash(chmod -R *)',
      'Bash(chown -R *)',
      'Bash(dd *)',
      'Bash(mkfs*)',
    ],
  },
  {
    id: 'secrets',
    title: 'Never read secret files',
    detail: '.env*, *.pem, *.key, SSH keys, ~/.aws, ~/.ssh — Claude cannot read them, even in bypass mode',
    deny: ['Read(**/.env)', 'Read(**/.env.*)', 'Read(**/*.pem)', 'Read(**/*.key)', 'Read(**/id_rsa*)', 'Read(**/id_ed25519*)', 'Read(~/.aws/**)', 'Read(~/.ssh/**)', 'Read(~/.gnupg/**)'],
  },
  {
    id: 'publishing',
    title: 'Ask before publishing packages or releases',
    detail: 'npm/pnpm/yarn/cargo publish, docker push, gh release, vsce publish',
    ask: ['Bash(npm publish*)', 'Bash(pnpm publish*)', 'Bash(yarn publish*)', 'Bash(cargo publish*)', 'Bash(docker push*)', 'Bash(gh release *)', 'Bash(vsce publish*)', 'Bash(npx vsce publish*)'],
  },
  {
    id: 'infra',
    title: 'Ask before touching cloud infrastructure',
    detail: 'terraform apply/destroy, kubectl apply/delete, aws, gcloud, az',
    ask: ['Bash(terraform apply*)', 'Bash(terraform destroy*)', 'Bash(kubectl apply*)', 'Bash(kubectl delete*)', 'Bash(aws *)', 'Bash(gcloud *)', 'Bash(az *)'],
  },
];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Adds the rules of the given templates to permissions.ask / permissions.deny (deduplicated, order kept). */
export function applyGuardrails(input: ClaudeSettings | undefined, templateIds: string[]): { next: ClaudeSettings; added: { ask: string[]; deny: string[] } } {
  const next: ClaudeSettings = isPlainObject(input) ? clone(input) : {};
  if (!isPlainObject(next.permissions)) next.permissions = {};
  const added = { ask: [] as string[], deny: [] as string[] };
  for (const id of templateIds) {
    const tpl = GUARDRAIL_TEMPLATES.find((t) => t.id === id);
    if (!tpl) continue;
    for (const kind of ['ask', 'deny'] as const) {
      const rules = tpl[kind] ?? [];
      if (!rules.length) continue;
      const list: unknown[] = Array.isArray(next.permissions[kind]) ? next.permissions[kind] : [];
      const have = new Set(list.filter((r): r is string => typeof r === 'string'));
      for (const r of rules) {
        if (!have.has(r)) {
          list.push(r);
          have.add(r);
          added[kind].push(r);
        }
      }
      next.permissions[kind] = list;
    }
  }
  return { next, added };
}

/** Removes exactly the rules that belong to our templates; leaves user-authored rules alone. */
export function removeGuardrails(input: ClaudeSettings, templateIds: string[] = GUARDRAIL_TEMPLATES.map((t) => t.id)): { next: ClaudeSettings; removed: number } {
  const next: ClaudeSettings = clone(input);
  let removed = 0;
  if (!isPlainObject(next.permissions)) return { next, removed };
  const ours = new Set<string>();
  for (const id of templateIds) {
    const tpl = GUARDRAIL_TEMPLATES.find((t) => t.id === id);
    if (!tpl) continue;
    for (const r of [...(tpl.ask ?? []), ...(tpl.deny ?? [])]) ours.add(r);
  }
  for (const kind of ['ask', 'deny'] as const) {
    if (!Array.isArray(next.permissions[kind])) continue;
    const before = next.permissions[kind].length;
    next.permissions[kind] = next.permissions[kind].filter((r: unknown) => !(typeof r === 'string' && ours.has(r)));
    removed += before - next.permissions[kind].length;
    if (next.permissions[kind].length === 0) delete next.permissions[kind];
  }
  return { next, removed };
}

/** Which templates are (fully) present in the settings — for the QuickPick pre-selection. */
export function installedGuardrails(s: ClaudeSettings | undefined): string[] {
  const ask = new Set<string>(Array.isArray(s?.permissions?.ask) ? s!.permissions.ask.filter((r: unknown) => typeof r === 'string') : []);
  const deny = new Set<string>(Array.isArray(s?.permissions?.deny) ? s!.permissions.deny.filter((r: unknown) => typeof r === 'string') : []);
  return GUARDRAIL_TEMPLATES.filter((t) => (t.ask ?? []).every((r) => ask.has(r)) && (t.deny ?? []).every((r) => deny.has(r))).map((t) => t.id);
}
