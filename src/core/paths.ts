import * as os from 'os';
import * as path from 'path';

/**
 * Where Claude Code keeps its user-level configuration.
 * Honours CLAUDE_CONFIG_DIR exactly like the CLI does.
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

/** Managed (policy) settings locations, per platform. Any of them can forbid bypass mode. */
export function managedSettingsCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  switch (platform) {
    case 'win32': {
      const programData = env.ProgramData || 'C:\\ProgramData';
      return [path.join(programData, 'ClaudeCode', 'managed-settings.json')];
    }
    case 'darwin':
      return ['/Library/Application Support/ClaudeCode/managed-settings.json'];
    default:
      return ['/etc/claude-code/managed-settings.json'];
  }
}

export function expandHome(p: string, home: string = os.homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}
