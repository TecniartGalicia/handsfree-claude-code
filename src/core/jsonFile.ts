import * as fs from 'fs/promises';
import * as path from 'path';

export interface JsonError {
  /** Human message. Never contains an excerpt of the file (V8 adds one; we strip it — settings may hold secrets). */
  message: string;
  /** Node error code when the file could not be READ at all (EACCES, EISDIR, ETIMEDOUT, ...). Absent for parse errors. */
  code?: string;
  /** 0-based character offset into the raw text, when known. */
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
    const original = e instanceof Error ? e.message : String(e);
    let offset = offsetFromMessage(original);
    if (offset === undefined) offset = offsetFromExcerpt(original, raw);
    const err: JsonError = { message: sanitizeJsonErrorMessage(original) };
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

/**
 * Newer V8 sometimes reports `Unexpected token 'x', ..."<excerpt>"... is not valid JSON` without a
 * position. Locate the excerpt in the raw text to recover an offset (best effort).
 */
export function offsetFromExcerpt(message: string, raw: string): number | undefined {
  const m = /,\s*(?:\.\.\.)?"([\s\S]*?)"(?:\.\.\.)?\s+is not valid JSON/.exec(message);
  if (!m || !m[1]) return undefined;
  const idx = raw.indexOf(m[1]);
  return idx >= 0 ? idx : undefined;
}

/** Drop any file excerpt V8 put in the message; keep the diagnostic part. */
export function sanitizeJsonErrorMessage(message: string): string {
  const posIdx = message.search(/\s+in JSON at position\s+\d+/i);
  if (posIdx >= 0) {
    // "Unexpected token } in JSON at position 42 (line 3 column 1)" — keep everything except a leading excerpt
    const head = message.slice(0, posIdx).replace(/,\s*(?:\.\.\.)?"[\s\S]*?"(?:\.\.\.)?\s*$/, '');
    return head + message.slice(posIdx);
  }
  return message.replace(/,\s*(?:\.\.\.)?"[\s\S]*?"(?:\.\.\.)?\s+is not valid JSON/, ' (file excerpt omitted) is not valid JSON');
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

/**
 * Reads + parses. Never throws for the usual failure modes:
 *  - missing file            → ok:true, exists:false
 *  - unreadable (EACCES...)  → ok:false with error.code
 *  - invalid JSON            → ok:false with line/column
 * Optional timeout guards against hung network drives.
 */
export async function readJsonFile<T = unknown>(file: string, timeoutMs?: number): Promise<ReadResult<T>> {
  let raw: string;
  try {
    raw = timeoutMs ? await withTimeout(fs.readFile(file, 'utf8'), timeoutMs, file) : await fs.readFile(file, 'utf8');
  } catch (e: any) {
    const code: string | undefined = e && typeof e.code === 'string' ? e.code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: true, exists: false, data: undefined, raw: '' };
    return { ok: false, exists: true, raw: '', error: { message: e instanceof Error ? e.message : String(e), code: code ?? 'EUNKNOWN' } };
  }
  const parsed = parseStrictJson<T>(raw);
  if (parsed.ok) return { ok: true, exists: true, data: parsed.data, raw };
  return { ok: false, exists: true, raw, error: parsed.error };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err: any = new Error(`Timed out after ${ms} ms reading ${what}`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
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
