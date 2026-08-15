import * as vscode from 'vscode';
import { BYPASS_MODE } from '../core/claudeSettings';

/** Anthropic's own extension. We configure it through its public settings, nothing else. */
export const OFFICIAL_EXT_ID = 'anthropic.claude-code';
export const SECTION = 'claudeCode';
export const KEY_ALLOW = 'allowDangerouslySkipPermissions';
export const KEY_MODE = 'initialPermissionMode';

/** Versions this release was exercised against. Unknown versions are still supported if the keys validate. */
export const TESTED_OFFICIAL_VERSIONS = ['2.1.227', '2.1.232'];

export interface OfficialContract {
  installed: boolean;
  version?: string;
  hasAllowKey: boolean;
  hasModeKey: boolean;
  modeEnum?: string[];
  /** Both keys exist and the mode enum accepts bypassPermissions. */
  supportsBypass: boolean;
  tested: boolean;
}

function configurationProperties(pkg: any): Record<string, any> {
  const c = pkg?.contributes?.configuration;
  if (!c) return {};
  const list = Array.isArray(c) ? c : [c];
  const props: Record<string, any> = {};
  for (const entry of list) Object.assign(props, entry?.properties ?? {});
  return props;
}

/** Reads the installed official extension's manifest and checks the keys we intend to write still exist. */
export function inspectOfficialExtension(): OfficialContract {
  const ext = vscode.extensions.getExtension(OFFICIAL_EXT_ID);
  if (!ext) return { installed: false, hasAllowKey: false, hasModeKey: false, supportsBypass: false, tested: false };
  const pkg: any = ext.packageJSON ?? {};
  const version: string | undefined = typeof pkg.version === 'string' ? pkg.version : undefined;
  const props = configurationProperties(pkg);
  const allowProp = props[`${SECTION}.${KEY_ALLOW}`];
  const modeProp = props[`${SECTION}.${KEY_MODE}`];
  const modeEnum: string[] | undefined = Array.isArray(modeProp?.enum) ? modeProp.enum.map(String) : undefined;
  const hasAllowKey = !!allowProp;
  const hasModeKey = !!modeProp;
  const supportsBypass = hasAllowKey && hasModeKey && (!modeEnum || modeEnum.includes(BYPASS_MODE));
  return {
    installed: true,
    version,
    hasAllowKey,
    hasModeKey,
    modeEnum,
    supportsBypass,
    tested: !!version && TESTED_OFFICIAL_VERSIONS.includes(version),
  };
}

export interface OfficialValues {
  allow?: boolean;
  mode?: string;
  /** Where each effective value comes from, for the Doctor / status bar. */
  allowScope: Scope;
  modeScope: Scope;
}

export type Scope = 'unset' | 'default' | 'global' | 'workspace' | 'workspaceFolder';

function scopeOf(inspect: ReturnType<vscode.WorkspaceConfiguration['inspect']>): Scope {
  if (!inspect) return 'unset';
  if (inspect.workspaceFolderValue !== undefined) return 'workspaceFolder';
  if (inspect.workspaceValue !== undefined) return 'workspace';
  if (inspect.globalValue !== undefined) return 'global';
  if (inspect.defaultValue !== undefined) return 'default';
  return 'unset';
}

/** Effective values (all scopes merged) plus their origin. */
export function readOfficialValues(): OfficialValues {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const allowI = cfg.inspect<boolean>(KEY_ALLOW);
  const modeI = cfg.inspect<string>(KEY_MODE);
  return {
    allow: cfg.get<boolean>(KEY_ALLOW),
    mode: cfg.get<string>(KEY_MODE),
    allowScope: scopeOf(allowI),
    modeScope: scopeOf(modeI),
  };
}

/** Global (user) values only — what we snapshot and restore. */
export function readOfficialGlobalValues(): { allow?: boolean; mode?: string } {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    allow: cfg.inspect<boolean>(KEY_ALLOW)?.globalValue,
    mode: cfg.inspect<string>(KEY_MODE)?.globalValue,
  };
}

export async function writeOfficialAutonomous(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  await cfg.update(KEY_ALLOW, true, vscode.ConfigurationTarget.Global);
  await cfg.update(KEY_MODE, BYPASS_MODE, vscode.ConfigurationTarget.Global);
}

export async function restoreOfficialGlobalValues(prev: { allow?: boolean; mode?: string }): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  await cfg.update(KEY_ALLOW, prev.allow, vscode.ConfigurationTarget.Global);
  await cfg.update(KEY_MODE, prev.mode, vscode.ConfigurationTarget.Global);
}

/** Workspace-level override of the initial mode (used by profiles and reported by the Doctor). */
export async function writeOfficialWorkspaceMode(mode: string | undefined): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  await cfg.update(KEY_MODE, mode, vscode.ConfigurationTarget.Workspace);
}
