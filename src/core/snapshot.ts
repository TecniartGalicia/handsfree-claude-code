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
  };
  vscode: {
    /** Global values of the official extension keys before we touched them (undefined = unset). */
    allowDangerouslySkipPermissions?: boolean;
    initialPermissionMode?: string;
  };
}

export const SNAPSHOT_FILE = 'last-snapshot.json';

export function timestampForFilename(d: Date = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

/** Copies `settingsPath` into `dir` and returns the backup path (undefined when the source is missing). */
export async function backupSettingsFile(settingsPath: string, dir: string, now: Date = new Date()): Promise<string | undefined> {
  if (!(await fileExists(settingsPath))) return undefined;
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `settings.${timestampForFilename(now)}.json`);
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
  if (!parsed.ok || !parsed.data || parsed.data.version !== 1) return undefined;
  return parsed.data;
}

/**
 * Puts the Claude settings file back exactly as it was. Returns what happened so the caller
 * can phrase the message: 'restored' | 'deleted' | 'backup-missing'.
 */
export async function restoreClaudeSettings(snap: Snapshot): Promise<'restored' | 'deleted' | 'backup-missing'> {
  const { settingsPath, existedBefore, backupPath } = snap.claude;
  if (!existedBefore) {
    await fs.rm(settingsPath, { force: true });
    return 'deleted';
  }
  if (!backupPath || !(await fileExists(backupPath))) return 'backup-missing';
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.copyFile(backupPath, settingsPath);
  return 'restored';
}

/** Keep the newest `keep` backups, delete the rest. Never touches the snapshot file. */
export async function pruneBackups(dir: string, keep = 10): Promise<number> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  const backups = names.filter((n) => /^settings\..+\.json$/.test(n)).sort();
  const excess = backups.slice(0, Math.max(0, backups.length - keep));
  await Promise.all(excess.map((n) => fs.rm(path.join(dir, n), { force: true })));
  return excess.length;
}
