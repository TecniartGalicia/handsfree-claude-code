import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileExists, parseStrictJson, stringifyPretty } from './jsonFile';

/**
 * Everything needed to undo one "Enable autonomous mode" run.
 * Persisted both in VS Code globalState and as a JSON file next to the backups,
 * so a revert still works after a reinstall of this extension.
 */
export interface Snapshot {
  version: 1;
  createdAt: string; // ISO
  claude: {
    settingsPath: string;
    existedBefore: boolean;
    /** Byte-exact copy of the previous file (undefined when it did not exist). */
    backupPath?: string;
    /** SHA-256 of the text Enable wrote, to detect later edits before a Revert. */
    writtenSha256?: string;
  };
  vscode: {
    /** Global values of the official extension keys before we touched them (undefined = unset). */
    allowDangerouslySkipPermissions?: boolean;
    initialPermissionMode?: string;
  };
}

export const SNAPSHOT_FILE = 'last-snapshot.json';

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function timestampForFilename(d: Date = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

/**
 * Copies `settingsPath` into `dir` and returns the backup path (undefined when the source is missing).
 * `label` distinguishes why the copy was taken (e.g. "before-enable", "before-revert").
 */
export async function backupSettingsFile(settingsPath: string, dir: string, now: Date = new Date(), label = 'settings'): Promise<string | undefined> {
  if (!(await fileExists(settingsPath))) return undefined;
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${label}.${timestampForFilename(now)}.json`);
  await fs.copyFile(settingsPath, target);
  return target;
}

export async function saveSnapshot(dir: string, snap: Snapshot): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, SNAPSHOT_FILE);
  await fs.writeFile(file, stringifyPretty(snap), 'utf8');
  return file;
}

export async function loadSnapshotFile(dir: string): Promise<Snapshot | undefined> {
  const file = path.join(dir, SNAPSHOT_FILE);
  if (!(await fileExists(file))) return undefined;
  const parsed = parseStrictJson<Snapshot>(await fs.readFile(file, 'utf8'));
  if (!parsed.ok || !parsed.data || parsed.data.version !== 1 || !parsed.data.claude?.settingsPath) return undefined;
  return parsed.data;
}

/** After a successful revert the snapshot must not be reusable: rename it (kept for forensics). */
export async function retireSnapshotFile(dir: string, now: Date = new Date()): Promise<void> {
  const file = path.join(dir, SNAPSHOT_FILE);
  if (!(await fileExists(file))) return;
  await fs.rename(file, path.join(dir, `reverted-${timestampForFilename(now)}.snapshot.json`));
}

/** True when the settings file no longer matches what Enable wrote (edited by user/Claude since). */
export async function settingsChangedSinceSnapshot(snap: Snapshot): Promise<boolean | undefined> {
  if (!snap.claude.writtenSha256) return undefined; // unknown (older snapshot)
  try {
    const current = await fs.readFile(snap.claude.settingsPath, 'utf8');
    return sha256(current) !== snap.claude.writtenSha256;
  } catch {
    return true; // missing now → definitely different
  }
}

/**
 * Puts the Claude settings file back exactly as it was. Returns what happened so the caller
 * can phrase the message: 'restored' | 'deleted' | 'backup-missing'.
 */
export async function restoreClaudeSettings(snap: Snapshot): Promise<'restored' | 'deleted' | 'backup-missing'> {
  const { settingsPath, existedBefore, backupPath } = snap.claude;
  const haveBackup = !!backupPath && (await fileExists(backupPath));
  // A backup exists only when there was a file to copy, so it outranks `existedBefore` (which is
  // recorded from an earlier read and could be stale): never delete a file we have a copy of.
  if (!existedBefore && !haveBackup) {
    await fs.rm(settingsPath, { force: true });
    return 'deleted';
  }
  if (!haveBackup) return 'backup-missing';
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  // Atomic like writeJsonFileAtomic: a crash mid-copy must not leave a truncated settings.json.
  const tmp = `${settingsPath}.handsfree-restore-${process.pid}-${Date.now()}.tmp`;
  try {
    await fs.copyFile(backupPath!, tmp);
    try {
      await fs.rename(tmp, settingsPath);
    } catch {
      await fs.copyFile(backupPath!, settingsPath); // rename refused (Windows): direct copy
    }
  } finally {
    try {
      await fs.rm(tmp, { force: true });
    } catch {
      /* stray temp copy is harmless */
    }
  }
  return 'restored';
}

/**
 * Keep the newest `keep` backups, delete the rest. Names are `<label>.<timestamp>.json` and several
 * labels share the directory (before-enable, before-revert, before-doctor…), so sorting by the whole
 * name would sort by label first and delete the newest files: sort by the timestamp part only.
 * Never touches snapshot files, and never deletes the paths listed in `protect`.
 */
export async function pruneBackups(dir: string, keep = 10, protect: (string | undefined)[] = []): Promise<number> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  const protectedNames = new Set(protect.filter((p): p is string => !!p).map((p) => path.basename(p)));
  const stamp = (n: string) => n.slice(n.indexOf('.') + 1);
  const backups = names
    .filter((n) => /^[a-z-]+\..+\.json$/.test(n) && !n.endsWith('.snapshot.json') && n !== SNAPSHOT_FILE)
    .sort((a, b) => stamp(a).localeCompare(stamp(b)) || a.localeCompare(b));
  const excess = backups.slice(0, Math.max(0, backups.length - keep)).filter((n) => !protectedNames.has(n));
  await Promise.all(excess.map((n) => fs.rm(path.join(dir, n), { force: true })));
  return excess.length;
}
