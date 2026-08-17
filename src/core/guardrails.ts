/**
 * Guardrail templates: Claude Code `permissions.ask` / `permissions.deny` rules that keep working in
 * bypass mode (the docs are explicit: explicit ask rules still prompt, deny rules still block).
 * No hooks involved, so nothing can break or start answering "ask" to everything.
 *
 * Rule grammar (docs): `Tool(prefix *)` — trailing ` *` matches at a word boundary; `*` may appear
 * anywhere; Read/Edit rules take gitignore-style patterns, `~/` and `**` allowed. Argument-restricting
 * shell patterns are best effort by nature (the docs say so); the sets below prefer a few extra
 * prompts over a missed dangerous variant.
 */
import { ClaudeSettings, isPlainObject } from './claudeSettings';

export interface GuardrailTemplate {
  id: string;
  /** English fallback; the VS Code layer localises by id. */
  title: string;
  detail: string;
  ask?: string[];
  deny?: string[];
}

export const GUARDRAIL_TEMPLATES: GuardrailTemplate[] = [
  {
    id: 'destructive-shell',
    title: 'Ask before destructive shell commands',
    detail: 'Best effort: rm -r/-rf, git push --force/-f, git reset --hard, git clean, branch -D, sudo, chmod/chown -R, dd, mkfs',
    ask: [
      'Bash(rm -r*)',
      'Bash(rm -R*)',
      'Bash(rm -f*)',
      'Bash(git push *--force*)',
      'Bash(git push * -f*)',
      'Bash(git push -f *)',
      'Bash(git reset --hard*)',
      'Bash(git clean *)',
      'Bash(git branch -D *)',
      'Bash(sudo *)',
      'Bash(chmod * -R*)',
      'Bash(chmod -R *)',
      'Bash(chown -R *)',
      'Bash(dd *)',
      'Bash(mkfs*)',
    ],
  },
  {
    id: 'secrets',
    title: 'Keep Claude out of secret files',
    detail: "Deny rules for .env*, *.pem, *.key, SSH/GPG/AWS dirs. Covers Claude's file tools and recognised shell readers (cat, head, sed…), not arbitrary scripts; also blocks creating/editing those files. `.env.*` includes .env.example.",
    // A Read deny already blocks Edit and Write on the same path, but NOT NotebookEdit, so each path is
    // mirrored with an Edit rule (docs: "Edit rules apply to all built-in tools that edit files").
    deny: [
      'Read(**/.env)',
      'Read(**/.env.*)',
      'Read(**/*.pem)',
      'Read(**/*.key)',
      'Read(**/id_rsa*)',
      'Read(**/id_ed25519*)',
      'Read(~/.aws/**)',
      'Read(~/.ssh/**)',
      'Read(~/.gnupg/**)',
      'Edit(**/.env)',
      'Edit(**/.env.*)',
      'Edit(**/*.pem)',
      'Edit(**/*.key)',
      'Edit(**/id_rsa*)',
      'Edit(**/id_ed25519*)',
      'Edit(~/.aws/**)',
      'Edit(~/.ssh/**)',
      'Edit(~/.gnupg/**)',
    ],
  },
  {
    id: 'publishing',
    title: 'Ask before publishing packages or releases',
    detail: 'npm/pnpm/yarn/cargo publish, docker push, gh release create/upload/delete, vsce publish',
    ask: ['Bash(npm publish*)', 'Bash(pnpm publish*)', 'Bash(yarn publish*)', 'Bash(yarn npm publish*)', 'Bash(cargo publish*)', 'Bash(docker push*)', 'Bash(gh release create*)', 'Bash(gh release upload*)', 'Bash(gh release delete*)', 'Bash(vsce publish*)', 'Bash(npx vsce publish*)', 'Bash(ovsx publish*)', 'Bash(npx ovsx publish*)'],
  },
  {
    id: 'infra',
    title: 'Ask before changing cloud infrastructure',
    detail: 'terraform apply/destroy, kubectl apply/delete/drain, helm install/upgrade/uninstall, aws/gcloud/az mutating verbs are hard to enumerate — this set asks for the whole CLIs',
    ask: ['Bash(terraform apply*)', 'Bash(terraform destroy*)', 'Bash(kubectl apply*)', 'Bash(kubectl delete*)', 'Bash(kubectl drain*)', 'Bash(helm install*)', 'Bash(helm upgrade*)', 'Bash(helm uninstall*)', 'Bash(aws *)', 'Bash(gcloud *)', 'Bash(az *)'],
  },
];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function templateRules(id: string): { ask: string[]; deny: string[] } | undefined {
  const t = GUARDRAIL_TEMPLATES.find((x) => x.id === id);
  return t ? { ask: t.ask ?? [], deny: t.deny ?? [] } : undefined;
}

/** Adds the rules of the given templates to permissions.ask / permissions.deny (deduplicated, order kept). */
export function applyGuardrails(input: ClaudeSettings | undefined, templateIds: string[]): { next: ClaudeSettings; added: { ask: string[]; deny: string[] }; addedBySet: Record<string, string[]> } {
  const next: ClaudeSettings = isPlainObject(input) ? clone(input) : {};
  if (!isPlainObject(next.permissions)) next.permissions = {};
  const added = { ask: [] as string[], deny: [] as string[] };
  const addedBySet: Record<string, string[]> = {};
  for (const id of templateIds) {
    const tpl = templateRules(id);
    if (!tpl) continue;
    addedBySet[id] = [];
    for (const kind of ['ask', 'deny'] as const) {
      const rules = tpl[kind];
      if (!rules.length) continue;
      const list: unknown[] = Array.isArray(next.permissions[kind]) ? next.permissions[kind] : [];
      const have = new Set(list.filter((r): r is string => typeof r === 'string'));
      for (const r of rules) {
        if (!have.has(r)) {
          list.push(r);
          have.add(r);
          added[kind].push(r);
          addedBySet[id].push(r);
        }
      }
      next.permissions[kind] = list;
    }
  }
  return { next, added, addedBySet };
}

/**
 * Removes template rules. When `onlyRules` is given (what Handsfree itself added, recorded at apply
 * time), only those are removed — a rule the user already had before stays. Otherwise every rule of
 * the given templates is removed.
 */
export function removeGuardrails(input: ClaudeSettings, templateIds: string[] = GUARDRAIL_TEMPLATES.map((t) => t.id), onlyRules?: string[]): { next: ClaudeSettings; removed: number } {
  const next: ClaudeSettings = clone(input);
  let removed = 0;
  if (!isPlainObject(next.permissions)) return { next, removed };
  const ours = new Set<string>();
  if (onlyRules) {
    onlyRules.forEach((r) => ours.add(r));
  } else {
    for (const id of templateIds) {
      const tpl = templateRules(id);
      if (tpl) [...tpl.ask, ...tpl.deny].forEach((r) => ours.add(r));
    }
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

export type GuardrailPresence = 'full' | 'partial' | 'none';

/** Presence of each template in the settings: all rules present, some, or none. */
export function guardrailPresence(s: ClaudeSettings | undefined): Record<string, GuardrailPresence> {
  const ask = new Set<string>(Array.isArray(s?.permissions?.ask) ? s!.permissions.ask.filter((r: unknown) => typeof r === 'string') : []);
  const deny = new Set<string>(Array.isArray(s?.permissions?.deny) ? s!.permissions.deny.filter((r: unknown) => typeof r === 'string') : []);
  const out: Record<string, GuardrailPresence> = {};
  for (const t of GUARDRAIL_TEMPLATES) {
    const rules = [...(t.ask ?? []).map((r) => ask.has(r)), ...(t.deny ?? []).map((r) => deny.has(r))];
    const n = rules.filter(Boolean).length;
    out[t.id] = n === 0 ? 'none' : n === rules.length ? 'full' : 'partial';
  }
  return out;
}

/** Templates fully present (kept for backwards compatibility with earlier callers/tests). */
export function installedGuardrails(s: ClaudeSettings | undefined): string[] {
  const p = guardrailPresence(s);
  return GUARDRAIL_TEMPLATES.filter((t) => p[t.id] === 'full').map((t) => t.id);
}

/** Every rule of every template — the Doctor uses it to tell "ours" from user-authored ask rules. */
export function allTemplateRules(): Set<string> {
  const s = new Set<string>();
  for (const t of GUARDRAIL_TEMPLATES) [...(t.ask ?? []), ...(t.deny ?? [])].forEach((r) => s.add(r));
  return s;
}
