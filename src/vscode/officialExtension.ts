import * as vscode from 'vscode';
import { BYPASS_MODE } from '../core/claudeSettings';

/** Anthropic's own extension. We configure it through its public settings, nothing else. */
export const OFFICIAL_EXT_ID = 'anthropic.claude-code';
export const SECTION = 'claudeCode';
export const KEY_ALLOW = 'allowDangerouslySkipPermissions';
export const KEY_MODE = 'initialPermissionMode';

/** Versions this release was exercised against. Newer versions are fine as long as the keys validate. */
export const TESTED_OFFICIAL_VERSIONS = ['2.1.227', '2.1.232', '2.1.233'];

/** semver-ish compare of "a.b.c" strings; non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface OfficialContract {
  installed: boolean;
  version?: string;
  hasAllowKey: boolean;
  hasModeKey: boolean;
  modeEnum?: string[];
  /** Both keys exist and the mode enum accepts bypassPermissions. */
  supportsBypass: boolean;
  /** Older than the oldest tested version (newer versions are not flagged: the contract check covers them). */
  olderThanTested: boolean;
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
  if (!ext) return { installed: false, hasAllowKey: false, hasModeKey: false, supportsBypass: false, olderThanTested: false };
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
    olderThanTested: !!version && compareVersions(version, TESTED_OFFICIAL_VERSIONS[0]) < 0,
  };
}

export interface OfficialValues {
  allow?: boolean;
  mode?: string;
  /** Where each effective value comes from. Both keys are `scope: "machine"` in the official manifest, so only global/default/unset can occur. */
  allowScope: Scope;
  modeScope: Scope;
}

export type Scope = 'unset' | 'default' | 'global';

function scopeOf(inspect: ReturnType<vscode.WorkspaceConfiguration['inspect']>): Scope {
  if (!inspect) return 'unset';
  if (inspect.globalValue !== undefined) return 'global';
  if (inspect.defaultValue !== undefined) return 'default';
  return 'unset';
}

/** Effective values plus their origin. */
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

