import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { ClaudeSettings } from '../core/claudeSettings';
import { applyGuardrails, GUARDRAIL_TEMPLATES, guardrailPresence, removeGuardrails } from '../core/guardrails';
import { fileExists, readJsonFile, writeJsonFileAtomic } from '../core/jsonFile';
import { applyCarefulProfile, applyProfile, buildProfile, hasCarefulProfile, parseProfile, profileEnablesBypass, removeCarefulProfile } from '../core/profile';
import { backupSettingsFile, pruneBackups, sha256, Snapshot } from '../core/snapshot';
import { loadSnapshot, log, offerReload, readClaudeSettings, resolveBackupDir, resolveClaudeSettingsPath, storeSnapshot } from '../vscode/env';
import { inspectOfficialExtension, readOfficialGlobalValues, SECTION, KEY_ALLOW, KEY_MODE } from '../vscode/officialExtension';
import { ensurePro } from './licenseService';

/** Careful-profile markers, keyed by the normalised path of the settings.local.json we wrote. */
const STATE_CAREFUL = 'handsfree.carefulProfiles';
/** Rules Handsfree itself added per guardrail set (so removal never takes a rule the user had first). */
const STATE_GUARDRAILS = 'handsfree.guardrailsAdded';

interface CarefulRecord {
  file: string;
  createdFile: boolean;
  setDefaultMode: boolean;
  previousDefaultMode?: string;
  at: string;
}

const norm = (p: string) => path.normalize(p).toLowerCase();

function carefulRecords(context: vscode.ExtensionContext): Record<string, CarefulRecord> {
  return context.globalState.get<Record<string, CarefulRecord>>(STATE_CAREFUL) ?? {};
}

async function snapshotBackupPath(context: vscode.ExtensionContext): Promise<string | undefined> {
  return (await loadSnapshot(context))?.claude.backupPath;
}

/**
 * Walks up from `dir` looking for a `.git` entry (dir or file). Returns the repo root or `dir` itself.
 * Never returns the home directory: versioned dotfiles (`~/.git`) are common, and a "per-project"
 * profile written to `~/.claude/settings.local.json` would silently apply to everything.
 */
export async function gitRootOf(dir: string, home: string = os.homedir()): Promise<string> {
  const start = path.resolve(dir);
  const stop = path.resolve(home);
  let cur = start;
  for (;;) {
    if (cur === stop && cur !== start) return start; // reached $HOME without a nearer repo
    if (await fileExists(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return start;
    cur = parent;
  }
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file');
  if (!folders.length) {
    void vscode.window.showInformationMessage(l10n.t("Open a folder first: profiles live in the project's .claude/settings.local.json."));
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
    { title: l10n.t('Which project?') },
  );
  return pick?.folder;
}

/** Best effort: keep the file out of git without touching the user's tracked .gitignore. */
async function excludeFromGit(root: string, relFile: string): Promise<void> {
  try {
    const gitDir = path.join(root, '.git');
    const st = await fs.stat(gitDir);
    if (!st.isDirectory()) return; // worktree/submodule (.git file): skip
    const exclude = path.join(gitDir, 'info', 'exclude');
    let text = '';
    try {
      text = await fs.readFile(exclude, 'utf8');
    } catch {
      text = '';
    }
    const line = relFile.split(path.sep).join('/');
    if (text.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === '/' + line)) return;
    await fs.mkdir(path.dirname(exclude), { recursive: true });
    await fs.writeFile(exclude, text + (text.endsWith('\n') || text === '' ? '' : '\n') + line + '\n', 'utf8');
  } catch (e) {
    log(`git exclude skipped: ${String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Careful profile per project (Pro to add — always free to remove)
// ---------------------------------------------------------------------------

export async function markProjectCareful(context: vscode.ExtensionContext): Promise<void> {
  if (!(await ensurePro(context, l10n.t('Per-project profiles')))) return;
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(l10n.t('This workspace is in Restricted Mode; trust it first (Handsfree writes a file inside the project).'));
    return;
  }
  const folder = await pickFolder();
  if (!folder) return;
  const root = await gitRootOf(folder.uri.fsPath);
  const file = path.join(root, '.claude', 'settings.local.json');
  const current = await readJsonFile<ClaudeSettings>(file);
  if (!current.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not valid JSON; fix it first. Nothing was changed.', file));
    return;
  }
  const r = applyCarefulProfile(current.exists ? current.data : undefined);
  const rootNote = root !== path.resolve(folder.uri.fsPath) ? '\n\n' + l10n.t('Note: Claude Code reads settings.local.json from the git repository root ({0}), so the profile applies to the whole repository, not only to this folder.', root) : '';
  const modeNote = r.setDefaultMode ? '  permissions.defaultMode = "default"' + (r.previousDefaultMode ? ` (${l10n.t('was {0}', `"${r.previousDefaultMode}"`)})` : '') : l10n.t('  permissions.defaultMode: left as it is ({0})', String(current.exists ? current.data?.permissions?.defaultMode : undefined));
  const yes = l10n.t('Mark as careful');
  const pick = await vscode.window.showInformationMessage(
    l10n.t('Make Claude Code ask for permission in "{0}"?', folder.name),
    {
      modal: true,
      detail:
        l10n.t('Writes to {0}:\n  permissions.disableBypassPermissionsMode = "disable"\n{1}\n\nClaude Code refuses bypass mode in this project (terminal and VS Code). Everywhere else your autonomous mode stays as it is. The file is personal (settings.local.json); Handsfree adds it to .git/info/exclude so it is not committed by accident.', file, modeNote) +
        rootNote,
    },
    yes,
  );
  if (pick !== yes) return;
  // Claude Code writes "always allow" rules into this very file: re-read after the dialog and reapply on
  // top of what is there now, so those edits are not overwritten. A copy is kept first.
  const fresh = await readJsonFile<ClaudeSettings>(file);
  if (!fresh.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} changed while the dialog was open and is not valid JSON any more: {1}. Nothing was changed.', file, fresh.error.message));
    return;
  }
  const applied = applyCarefulProfile(fresh.exists ? fresh.data : undefined);
  if (applied.changed) {
    if (fresh.exists) await backupSettingsFile(file, resolveBackupDir(), new Date(), 'before-careful');
    await writeJsonFileAtomic(file, applied.next);
  }
  await excludeFromGit(root, path.join('.claude', 'settings.local.json'));
  const records = carefulRecords(context);
  // Merge, never overwrite: running the command again (e.g. from another folder of the same repo) would
  // otherwise forget that WE set defaultMode and which value to restore, leaving a key nobody removes.
  const prevRec = records[norm(file)];
  records[norm(file)] = {
    file,
    createdFile: prevRec?.createdFile ?? !current.exists,
    setDefaultMode: r.setDefaultMode || (prevRec?.setDefaultMode ?? false),
    previousDefaultMode: r.previousDefaultMode ?? prevRec?.previousDefaultMode,
    at: new Date().toISOString(),
  };
  await context.globalState.update(STATE_CAREFUL, records);
  log(`Careful profile applied to ${file}`);
  void vscode.window.showInformationMessage(l10n.t('"{0}" is now a careful project. New Claude Code conversations here will ask.', folder.name));
}

export async function unmarkProjectCareful(context: vscode.ExtensionContext): Promise<void> {
  // Removing is always free: nobody should be stuck with prompts because a licence lapsed.
  // It still writes inside the project, so Restricted Mode applies here as well (the manifest says so).
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(l10n.t('This workspace is in Restricted Mode; trust it first (Handsfree writes a file inside the project).'));
    return;
  }
  const folder = await pickFolder();
  if (!folder) return;
  const root = await gitRootOf(folder.uri.fsPath);
  const file = path.join(root, '.claude', 'settings.local.json');
  const current = await readJsonFile<ClaudeSettings>(file);
  if (!current.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not valid JSON; fix it first. Nothing was changed.', file));
    return;
  }
  if (!current.exists || !hasCarefulProfile(current.data)) {
    void vscode.window.showInformationMessage(l10n.t('"{0}" has no careful profile.', folder.name));
    return;
  }
  const records = carefulRecords(context);
  const rec = records[norm(file)];
  const { next, changed, empty } = removeCarefulProfile(current.data, rec ? { setDefaultMode: rec.setDefaultMode, previousDefaultMode: rec.previousDefaultMode } : { setDefaultMode: true });
  if (empty && (rec?.createdFile ?? false)) await fs.rm(file, { force: true });
  else if (changed) await writeJsonFileAtomic(file, next);
  delete records[norm(file)];
  await context.globalState.update(STATE_CAREFUL, records);
  log(`Careful profile removed from ${file}${empty && rec?.createdFile ? ' (file deleted)' : ''}`);
  void vscode.window.showInformationMessage(l10n.t('"{0}" is no longer a careful project.', folder.name));
}

/** Used by the Doctor: which project files are our own careful profiles (info, not warning). Prunes stale markers. */
export async function ownedProfilePaths(context: vscode.ExtensionContext): Promise<string[]> {
  const records = carefulRecords(context);
  const out: string[] = [];
  let dirty = false;
  for (const [key, rec] of Object.entries(records)) {
    if (await fileExists(rec.file)) out.push(rec.file);
    else {
      delete records[key];
      dirty = true;
    }
  }
  if (dirty) await context.globalState.update(STATE_CAREFUL, records);
  return out;
}

// ---------------------------------------------------------------------------
// Guardrails (ask / deny rules in the user settings — they keep working in bypass mode)
// ---------------------------------------------------------------------------

function templateTitle(id: string): string {
  switch (id) {
    case 'destructive-shell':
      return l10n.t('Ask before destructive shell commands');
    case 'secrets':
      return l10n.t('Keep Claude out of secret files');
    case 'publishing':
      return l10n.t('Ask before publishing packages or releases');
    case 'infra':
      return l10n.t('Ask before changing cloud infrastructure');
    default:
      return id;
  }
}
function templateDetail(id: string, fallback: string): string {
  switch (id) {
    case 'destructive-shell':
      return l10n.t('Best effort: rm -r/-rf, git push --force/-f, git reset --hard, git clean, branch -D, sudo, chmod/chown -R, dd, mkfs');
    case 'secrets':
      return l10n.t("Deny rules for .env*, *.pem, *.key, SSH/GPG/AWS dirs. Covers Claude's file tools and recognised shell readers (cat, head, sed…), not arbitrary scripts; also blocks creating/editing those files. `.env.*` includes .env.example.");
    case 'publishing':
      return l10n.t('npm/pnpm/yarn/cargo publish, docker push, gh release create/upload/delete, vsce publish');
    case 'infra':
      return l10n.t('terraform apply/destroy, kubectl apply/delete/drain, helm install/upgrade/uninstall; aws/gcloud/az mutating verbs are hard to enumerate, so this set asks for the whole CLIs');
    default:
      return fallback;
  }
}

/** True when `rule` is currently listed under permissions.ask or permissions.deny of `settings`. */
function rulePresent(settings: ClaudeSettings | undefined, rule: string): boolean {
  const p = settings?.permissions as { ask?: unknown; deny?: unknown } | undefined;
  const inList = (v: unknown) => Array.isArray(v) && v.includes(rule);
  return inList(p?.ask) || inList(p?.deny);
}

export async function chooseGuardrails(context: vscode.ExtensionContext): Promise<void> {
  const settingsPath = resolveClaudeSettingsPath();
  const current = await readClaudeSettings();
  if (!current.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not valid JSON; fix it first. Nothing was changed.', settingsPath));
    return;
  }
  const settings = current.exists ? current.data : undefined;
  const presence = guardrailPresence(settings);
  const items = GUARDRAIL_TEMPLATES.map((t) => ({
    label: templateTitle(t.id),
    description: (t.ask ? l10n.t('{0} ask rule(s)', t.ask.length) : l10n.t('{0} deny rule(s)', t.deny?.length ?? 0)) + (presence[t.id] === 'partial' ? ' · ' + l10n.t('partially installed') : ''),
    detail: templateDetail(t.id, t.detail),
    picked: presence[t.id] !== 'none',
    id: t.id,
  }));
  const picks = await vscode.window.showQuickPick(items, {
    title: l10n.t('Guardrails — rules that keep prompting or blocking even in bypass mode'),
    placeHolder: l10n.t('Select the sets you want; unselect to remove'),
    canPickMany: true,
  });
  if (!picks) return;
  const wanted = new Set(picks.map((p) => p.id));
  const toAdd = [...wanted].filter((id) => presence[id] !== 'full');
  const toRemove = GUARDRAIL_TEMPLATES.map((t) => t.id).filter((id) => presence[id] !== 'none' && !wanted.has(id));
  if (!toAdd.length && !toRemove.length) return;
  // Adding is Pro; removing is always free — so a failed Pro check must not cancel the removals too
  // (sets show up as "partial" when the user has an equal rule of their own, and those are pre-picked).
  const sets = toAdd.length && (await ensurePro(context, l10n.t('Guardrails'))) ? toAdd : [];
  if (!sets.length && !toRemove.length) return;

  const addedRecord = context.globalState.get<Record<string, string[]>>(STATE_GUARDRAILS) ?? {};
  // Reconcile the record with the file first: rules that are no longer there (Revert, a restored backup,
  // a hand edit) must not be claimed as ours again — otherwise uninstalling a set would delete rules the
  // user wrote themselves.
  for (const [id, rules] of Object.entries(addedRecord)) {
    const present = rules.filter((rule) => rulePresent(settings, rule));
    if (present.length) addedRecord[id] = present;
    else delete addedRecord[id];
  }
  let next: ClaudeSettings = settings ?? {};
  let removed = 0;
  for (const id of toRemove) {
    const r = removeGuardrails(next, [id], addedRecord[id]);
    next = r.next;
    removed += r.removed;
    delete addedRecord[id];
  }
  const { next: next2, added, addedBySet } = applyGuardrails(next, sets);
  for (const [id, rules] of Object.entries(addedBySet)) addedRecord[id] = [...new Set([...(addedRecord[id] ?? []), ...rules])];
  const backup = await backupSettingsFile(settingsPath, resolveBackupDir(), new Date(), 'before-guardrails');
  await pruneBackups(resolveBackupDir(), 10, [backup, await snapshotBackupPath(context)]);
  await writeJsonFileAtomic(settingsPath, next2);
  await context.globalState.update(STATE_GUARDRAILS, addedRecord);
  log(`Guardrails: +${added.ask.length} ask, +${added.deny.length} deny, -${removed} (backup ${backup ?? 'n/a'})`);
  void vscode.window.showInformationMessage(l10n.t('Guardrails updated: {0} rule(s) added, {1} removed. They apply to new Claude Code sessions.', added.ask.length + added.deny.length, removed));
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

export async function exportProfile(context: vscode.ExtensionContext): Promise<void> {
  if (!(await ensurePro(context, l10n.t('Export / import')))) return;
  const current = await readClaudeSettings();
  if (!current.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not valid JSON; fix it first. Nothing was changed.', resolveClaudeSettingsPath()));
    return;
  }
  const vs = inspectOfficialExtension().installed ? readOfficialGlobalValues() : {};
  const profile = buildProfile(current.exists ? current.data : undefined, vs);
  const target = await vscode.window.showSaveDialog({
    title: l10n.t('Export Handsfree profile'),
    defaultUri: vscode.Uri.file(path.join(os.homedir(), 'handsfree-profile.json')),
    filters: { JSON: ['json'] },
  });
  if (!target) return;
  await fs.writeFile(target.fsPath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  void vscode.window.showInformationMessage(l10n.t('Profile exported to {0}. It contains only permission-mode keys and ask/deny rules — never allow rules, env values or hooks.', target.fsPath));
}

export async function importProfile(context: vscode.ExtensionContext): Promise<void> {
  if (!(await ensurePro(context, l10n.t('Export / import')))) return;
  const picked = await vscode.window.showOpenDialog({ title: l10n.t('Import Handsfree profile'), canSelectMany: false, filters: { JSON: ['json'] } });
  if (!picked?.[0]) return;
  const file = picked[0].fsPath;
  const read = await readJsonFile(file);
  const profile = read.ok && read.exists ? parseProfile(read.data) : undefined;
  if (!profile) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not a valid Handsfree profile file (unknown format, mode or rule).', file));
    return;
  }
  const settingsPath = resolveClaudeSettingsPath();
  const current = await readClaudeSettings();
  if (!current.ok) {
    void vscode.window.showErrorMessage(l10n.t('{0} is not valid JSON; fix it first. Nothing was changed.', settingsPath));
    return;
  }
  const { next, changes } = applyProfile(current.exists ? current.data : undefined, profile);
  const fmt = (v: unknown) => (v === undefined ? l10n.t('unset') : Array.isArray(v) ? v.join(', ') : JSON.stringify(v));
  const lines = changes.map((c) => (Array.isArray(c.to) ? `${c.path}: + ${fmt(c.to)}` : `${c.path}: ${fmt(c.from)} → ${fmt(c.to)}`));
  const contract = inspectOfficialExtension();
  const vsWrites: { key: string; value: unknown }[] = [];
  if (contract.installed && contract.supportsBypass) {
    const cur = readOfficialGlobalValues();
    if (profile.vscode.allowDangerouslySkipPermissions !== undefined && cur.allow !== profile.vscode.allowDangerouslySkipPermissions) {
      vsWrites.push({ key: KEY_ALLOW, value: profile.vscode.allowDangerouslySkipPermissions });
      lines.push(`VS Code ${SECTION}.${KEY_ALLOW}: ${fmt(cur.allow)} → ${fmt(profile.vscode.allowDangerouslySkipPermissions)}`);
    }
    if (profile.vscode.initialPermissionMode !== undefined && cur.mode !== profile.vscode.initialPermissionMode) {
      vsWrites.push({ key: KEY_MODE, value: profile.vscode.initialPermissionMode });
      lines.push(`VS Code ${SECTION}.${KEY_MODE}: ${fmt(cur.mode)} → ${fmt(profile.vscode.initialPermissionMode)}`);
    }
  }
  if (!changes.length && !vsWrites.length) {
    void vscode.window.showInformationMessage(l10n.t('Nothing to import: your settings already match this profile.'));
    return;
  }
  const enablesBypass = profileEnablesBypass(profile);
  const yes = l10n.t('Import');
  const warning = enablesBypass
    ? '\n\n' +
      l10n.t(
        "This profile turns on Claude Code's \"bypass permissions\" mode: Claude will read, write and run commands without confirmation prompts. Anthropic's guidance: use it only in isolated environments (containers, VMs, dev containers without internet access).",
      )
    : '';
  const pick = await vscode.window.showWarningMessage(
    l10n.t('Import profile from {0}?', path.basename(file)),
    { modal: true, detail: lines.join('\n') + warning + '\n\n' + l10n.t('A backup is saved first.') },
    yes,
  );
  if (pick !== yes) return;

  const dir = resolveBackupDir();
  const backup = await backupSettingsFile(settingsPath, dir, new Date(), 'before-import');
  // A profile that switches bypass on must be revertible exactly like Enable: create the snapshot if none exists.
  if (enablesBypass && !(await loadSnapshot(context))) {
    const prev = contract.installed ? readOfficialGlobalValues() : {};
    const snap: Snapshot = { version: 1, createdAt: new Date().toISOString(), claude: { settingsPath, existedBefore: current.exists, backupPath: backup }, vscode: { allowDangerouslySkipPermissions: prev.allow, initialPermissionMode: prev.mode } };
    await storeSnapshot(context, snap);
  }
  await pruneBackups(dir, 10, [backup, await snapshotBackupPath(context)]);
  if (changes.length) {
    const written = await writeJsonFileAtomic(settingsPath, next);
    const snap = await loadSnapshot(context);
    if (snap && enablesBypass) {
      snap.claude.writtenSha256 = sha256(written);
      await storeSnapshot(context, snap);
    }
  }
  for (const w of vsWrites) await vscode.workspace.getConfiguration(SECTION).update(w.key, w.value, vscode.ConfigurationTarget.Global);
  log(`Profile imported from ${file}: ${lines.join(' | ')}`);
  await offerReload(l10n.t('Profile imported. Reload the window so the Claude Code extension picks up its settings.'));
}

