import * as os from 'os';
import { Finding, summarize } from './findings';

export interface DoctorReport {
  generatedAt: string;
  findings: Finding[];
  env: {
    platform: string;
    vscodeVersion: string;
    officialVersion?: string;
    claudeSettingsPath: string;
    extensionVersion: string;
  };
}

export interface RedactOptions {
  home?: string;
  username?: string;
  platform?: NodeJS.Platform;
  /** Extra directories to redact (e.g. CLAUDE_CONFIG_DIR outside home). */
  extraDirs?: string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Turns a path into a regex that matches it with either separator and (on Windows) any casing. */
function pathPattern(p: string): string {
  return escapeRe(p).replace(/\\\\|\//g, '[\\\\/]');
}

/**
 * Replace the home directory (any casing / separator on Windows), extra dirs, and the bare
 * username in the usual OS user-dir shapes with placeholders, so a report can be pasted publicly.
 */
export function redact(text: string, opts: RedactOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? os.homedir();
  const flags = platform === 'win32' ? 'gi' : 'g';
  let out = text;
  // longest first so CLAUDE_CONFIG_DIR inside home collapses cleanly; boundary so /home/bob never eats /home/bobby
  const dirs = [...(opts.extraDirs ?? []), home].filter((d): d is string => !!d && d.length > 1).sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    out = out.replace(new RegExp(pathPattern(dir) + String.raw`(?=$|[\\/\s"'])`, flags), '~');
  }
  const user = opts.username ?? safeUsername();
  if (user && user.length > 1) {
    const u = escapeRe(user);
    // C:\Users\<user>, /home/<user>, /Users/<user> — any casing on Windows
    out = out.replace(new RegExp(`([A-Za-z]:[\\\\/]Users[\\\\/])${u}(?=$|[\\\\/\\s"'])`, flags), '$1<user>');
    out = out.replace(new RegExp(`(/home/|/Users/)${u}(?=$|[/\\s"'])`, 'g'), '$1<user>');
  }
  return out;
}

function safeUsername(): string | undefined {
  try {
    return os.userInfo().username;
  } catch {
    return undefined;
  }
}

/** Markdown for issues / colleagues. English on purpose (bug reports travel). */
export function renderReportMarkdown(report: DoctorReport, opts: RedactOptions = {}): string {
  const r = (s: string) => redact(s, opts);
  const s = summarize(report.findings);
  const lines: string[] = [];
  lines.push('# Handsfree for Claude Code — Doctor report');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Handsfree: ${report.env.extensionVersion} · VS Code: ${report.env.vscodeVersion} · anthropic.claude-code: ${report.env.officialVersion ?? 'not installed'}`);
  lines.push(`- Platform: ${report.env.platform}`);
  lines.push(`- Claude settings: ${r(report.env.claudeSettingsPath)}`);
  lines.push(`- Result: ${s.errors} error(s), ${s.warnings} warning(s), ${s.infos} note(s), ${s.oks} ok`);
  lines.push('');
  const label: Record<Finding['severity'], string> = { error: 'ERROR', warn: 'WARN', info: 'INFO', ok: 'OK' };
  for (const f of report.findings) {
    lines.push(`## [${label[f.severity]}] ${r(f.title)}`);
    if (f.detail) {
      lines.push('');
      lines.push(...r(f.detail).split('\n').map((l) => `    ${l}`));
    }
    if (f.fix) lines.push(`\n_Fix available: ${f.fix.kind}_`);
    lines.push('');
  }
  lines.push('---');
  lines.push('Settings changes apply to new Claude Code conversations; reload the VS Code window after fixing.');
  return lines.join('\n') + '\n';
}
