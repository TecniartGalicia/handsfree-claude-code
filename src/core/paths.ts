import * as os from 'os';
import * as path from 'path';

/**
 * Where Claude Code keeps its user-level configuration.
 * Honours CLAUDE_CONFIG_DIR exactly like the CLI does (as seen by the extension host process).
 */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const fromEnv = env.CLAUDE_CONFIG_DIR;
  if (fromEnv && fromEnv.trim()) return expandHome(fromEnv.trim(), home);
  return path.join(home, '.claude');
}

/** User settings file of Claude Code (~/.claude/settings.json unless overridden). */
export function claudeSettingsPath(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (override && override.trim()) return expandHome(override.trim(), home);
  return path.join(claudeConfigDir(env, home), 'settings.json');
}

/** Directory where we keep our own backups, next to the settings file. */
export function backupDir(settingsPath: string): string {
  return path.join(path.dirname(settingsPath), 'backups', 'handsfree');
}

/**
 * Directory of file-based managed (policy) settings, per platform — Claude Code ≥ 2.1.75.
 * Contains `managed-settings.json` and the `managed-settings.d/` drop-in directory.
 * (Windows registry policies, macOS MDM plists and server-managed settings are NOT files and
 * are not inspected by this extension.)
 */
export function managedSettingsDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  switch (platform) {
    case 'win32':
      return path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode');
    case 'darwin':
      return '/Library/Application Support/ClaudeCode';
    default:
      return '/etc/claude-code';
  }
}

/** path module matching the platform we are describing (so tests are deterministic on any host). */
function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** The main managed settings file. */
export function managedSettingsCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  return [pathFor(platform).join(managedSettingsDir(platform, env), 'managed-settings.json')];
}

/** Drop-in directory: every non-hidden *.json inside is merged, in alphabetical order. */
export function managedSettingsDropinDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  return pathFor(platform).join(managedSettingsDir(platform, env), 'managed-settings.d');
}

/** Legacy Windows location, ignored by Claude Code since 2.1.75 — reported by the Doctor only as a note. */
export function legacyManagedSettingsCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform !== 'win32') return [];
  return [path.win32.join(env.ProgramData || 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json')];
}

export function expandHome(p: string, home: string = os.homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}
