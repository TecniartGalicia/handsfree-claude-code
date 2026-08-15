import * as fs from 'fs/promises';
import * as path from 'path';

export interface JsonError {
  message: string;
  /** 0-based character offset into the raw text, when the engine reports one. */
  offset?: number;
  /** 1-based line / column derived from `offset`. */
  line?: number;
  column?: number;
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: JsonError };

export type ReadResult<T> =
  | { ok: true; exists: true; data: T; raw: string }
  | { ok: true; exists: false; data: undefined; raw: '' }
  | { ok: false; exists: true; raw: string; error: JsonError };

/** Strict JSON parse (what Claude Code itself uses), with a best-effort line/column on failure. */
export function parseStrictJson<T = unknown>(rawInput: string): ParseResult<T> {
  const raw = stripBom(rawInput);
  try {
    return { ok: true, data: JSON.parse(raw) as T };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const offset = offsetFromMessage(message);
    const err: JsonError = { message };
    if (offset !== undefined) {
      err.offset = offset;
      const lc = lineColFromOffset(raw, offset);
      err.line = lc.line;
      err.column = lc.column;
    }
    return { ok: false, error: err };
  }
}

/** V8 reports `... in JSON at position N ...`; extract N. */
export function offsetFromMessage(message: string): number | undefined {
  const m = /position\s+(\d+)/i.exec(message);
  return m ? Number(m[1]) : undefined;
}

export function lineColFromOffset(raw: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, raw.length));
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < clamped; i++) {
    if (raw.charCodeAt(i) === 10 /* \n */) {
      line++;
      lastBreak = i;
    }
  }
  return { line, column: clamped - lastBreak };
}

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export async function readJsonFile<T = unknown>(file: string): Promise<ReadResult<T>> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (e: any) {
    if (e && e.code === 'ENOENT') return { ok: true, exists: false, data: undefined, raw: '' };
    throw e;
  }
  const parsed = parseStrictJson<T>(raw);
  if (parsed.ok) return { ok: true, exists: true, data: parsed.data, raw };
  return { ok: false, exists: true, raw, error: parsed.error };
}

/** Pretty JSON, 2 spaces, trailing newline — the same shape Claude Code writes. */
export function stringifyPretty(data: unknown): string {
  return JSON.stringify(data, null, 2) + '\n';
}

/**
 * Write via a temp file + rename so a crash never leaves a half-written settings file.
 * - Follows symlinks (dotfile setups keep their link; the real file is what changes).
 * - Preserves the original file mode (a 0600 settings file with secrets stays 0600).
 * Returns the text that was written, so callers can fingerprint it.
 */
export async function writeJsonFileAtomic(file: string, data: unknown): Promise<string> {
  const text = stringifyPretty(data);
  const target = await realpathOrSelf(file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  let mode: number | undefined;
  try {
    mode = (await fs.stat(target)).mode & 0o777;
  } catch {
    mode = undefined; // new file: default umask
  }
  const tmp = `${target}.handsfree-${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(tmp, text, mode !== undefined ? { encoding: 'utf8', mode } : 'utf8');
  try {
    await fs.rename(tmp, target);
  } catch {
    // Windows can refuse to rename over a file another process holds open;
    // fall back to a direct write (still complete content, single write call).
    await fs.writeFile(target, text, 'utf8');
    try {
      await fs.rm(tmp, { force: true });
    } catch {
      /* a stray .tmp is harmless; never fail the command for it */
    }
  }
  return text;
}

async function realpathOrSelf(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch {
    return file;
  }
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
