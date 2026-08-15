/**
 * Licence state machine, pure and testable. The VS Code layer supplies storage (secrets/globalState),
 * a fetch implementation and the clock.
 *
 * Polar customer-portal endpoints (unauthenticated, per https://polar.sh/docs/features/benefits/license-keys):
 *   POST /v1/customer-portal/license-keys/activate   { key, organization_id, label, meta? }  → { id, ... } (activation)
 *   POST /v1/customer-portal/license-keys/validate   { key, organization_id, activation_id? } → { status, expires_at, ... }
 *   POST /v1/customer-portal/license-keys/deactivate { key, organization_id, activation_id }
 *
 * Rules:
 *  - A licence validated within REVALIDATE_HOURS is Pro without touching the network.
 *  - Offline grace: a licence last *validated* within GRACE_DAYS keeps working when the network is down
 *    or the API answers something we do not understand.
 *  - A non-granted status is never final: we ask again after REVALIDATE_HOURS (disputes get resolved,
 *    activations get restored, APIs have bad days). Only a 200 with an explicit non-"granted" status
 *    is persisted as such; 4xx answers are treated as soft failures.
 */
export const POLAR_BASE = 'https://api.polar.sh/v1/customer-portal/license-keys';
export const GRACE_DAYS = 14;
export const REVALIDATE_HOURS = 24;

export interface LicenseState {
  version?: 1;
  key?: string;
  activationId?: string;
  /** ISO of the last successful validation with status "granted". */
  lastValidatedAt?: string;
  /** ISO of the last time we asked the API (any outcome) — throttles retries after a bad answer. */
  lastCheckedAt?: string;
  /** Last explicit status from a 200 answer. */
  status?: 'granted' | 'revoked' | 'disabled' | 'expired' | string;
  expiresAt?: string | null;
  label?: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export interface PolarConfig {
  organizationId: string;
  checkoutUrl: string;
}

export type ProDecision =
  | { pro: true; source: 'dev' | 'validated' | 'grace' }
  | { pro: false; reason: 'no-key' | 'not-configured' | 'invalid' | 'expired' | 'grace-expired' | 'revoked' | 'network' };

const H = 3600_000;
const D = 86400_000;

function ageMs(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? now.getTime() - t : undefined;
}

/**
 * Purely from stored state + clock: can we decide without touching the network?
 * Returns undefined when a (re)validation is due — including after a previous bad answer, once
 * REVALIDATE_HOURS have passed. `force` always asks the network when a key exists.
 */
export function decideOffline(state: LicenseState, now: Date, devOverride = false, force = false): ProDecision | undefined {
  if (devOverride) return { pro: true, source: 'dev' };
  if (!state.key) return { pro: false, reason: 'no-key' };
  if (force) return undefined;
  const checkedAge = ageMs(state.lastCheckedAt, now);
  const recentlyChecked = checkedAge !== undefined && checkedAge >= 0 && checkedAge < REVALIDATE_HOURS * H;
  if (state.status && state.status !== 'granted') {
    return recentlyChecked ? { pro: false, reason: state.status === 'expired' ? 'expired' : 'revoked' } : undefined;
  }
  if (state.expiresAt && new Date(state.expiresAt).getTime() < now.getTime()) {
    return recentlyChecked ? { pro: false, reason: 'expired' } : undefined;
  }
  const validatedAge = ageMs(state.lastValidatedAt, now);
  if (validatedAge !== undefined && validatedAge >= 0 && validatedAge < REVALIDATE_HOURS * H) return { pro: true, source: 'validated' };
  return undefined; // due (or clock skew) → revalidate
}

export type ValidationResult = { ok: true; status: string; expiresAt?: string | null } | { ok: false; kind: 'network' | 'invalid' };

/** Applies a validation attempt's outcome. Always records lastCheckedAt. */
export function decideAfterValidation(state: LicenseState, now: Date, result: ValidationResult): { decision: ProDecision; next: LicenseState } {
  const nowIso = now.toISOString();
  if (result.ok) {
    const expired = !!result.expiresAt && new Date(result.expiresAt).getTime() < now.getTime();
    const next: LicenseState = { ...state, status: result.status, expiresAt: result.expiresAt ?? null, lastCheckedAt: nowIso };
    if (result.status === 'granted' && !expired) {
      next.lastValidatedAt = nowIso;
      return { decision: { pro: true, source: 'validated' }, next };
    }
    return { decision: { pro: false, reason: result.status === 'expired' || expired ? 'expired' : 'revoked' }, next };
  }
  // Soft failure (network, or an answer we do not understand / 4xx): honour the grace period.
  const next: LicenseState = { ...state, lastCheckedAt: nowIso };
  const validatedAge = ageMs(state.lastValidatedAt, now);
  if (validatedAge !== undefined && validatedAge < GRACE_DAYS * D) {
    // negative age (clock skew) counts as "recent"
    return { decision: { pro: true, source: 'grace' }, next };
  }
  if (state.lastValidatedAt) return { decision: { pro: false, reason: result.kind === 'invalid' ? 'invalid' : 'grace-expired' }, next };
  return { decision: { pro: false, reason: result.kind === 'invalid' ? 'invalid' : 'network' }, next };
}

export function looksLikeLicenseKey(s: string): boolean {
  const k = s.trim();
  return k.length >= 16 && k.length <= 200 && /^[A-Za-z0-9._-]+$/.test(k);
}

// ---- API calls (thin; all decisions above) --------------------------------

export const REQUEST_TIMEOUT_MS = 15_000;

function detailText(data: any, fallback: string): string {
  const d = data?.detail ?? data?.error ?? data?.message;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => (typeof x === 'string' ? x : x?.msg ?? JSON.stringify(x))).join('; ');
  return fallback;
}

async function post(fetchImpl: FetchLike, path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: any }> {
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? (AbortSignal as any).timeout(REQUEST_TIMEOUT_MS) : undefined;
  const res = await fetchImpl(`${POLAR_BASE}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal });
  let data: any = undefined;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  return { ok: res.ok, status: res.status, data };
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function polarActivate(fetchImpl: FetchLike, cfg: PolarConfig, key: string, label: string, meta: Record<string, string>): Promise<{ ok: true; activationId: string; status: string; expiresAt?: string | null } | { ok: false; kind: 'network' | 'invalid' | 'limit' | 'unexpected'; message: string }> {
  try {
    const r = await post(fetchImpl, 'activate', { key, organization_id: cfg.organizationId, label, meta });
    if (r.ok && r.data && typeof r.data.id === 'string') {
      const lk = r.data.license_key ?? {};
      return { ok: true, activationId: r.data.id, status: String(lk.status ?? 'granted'), expiresAt: lk.expires_at ?? null };
    }
    if (r.ok) return { ok: false, kind: 'unexpected', message: 'Unexpected answer from the licence server' };
    if (r.status === 404) return { ok: false, kind: 'invalid', message: 'License key not found' };
    if (TRANSIENT.has(r.status)) return { ok: false, kind: 'network', message: `HTTP ${r.status}` };
    if (r.status === 403 || r.status === 422 || r.status === 400) return { ok: false, kind: 'limit', message: detailText(r.data, `HTTP ${r.status}`) };
    return { ok: false, kind: 'invalid', message: detailText(r.data, `HTTP ${r.status}`) };
  } catch (e) {
    return { ok: false, kind: 'network', message: e instanceof Error ? e.message : String(e) };
  }
}

export async function polarValidate(fetchImpl: FetchLike, cfg: PolarConfig, key: string, activationId?: string): Promise<ValidationResult> {
  try {
    const body: Record<string, unknown> = { key, organization_id: cfg.organizationId };
    if (activationId) body.activation_id = activationId;
    const r = await post(fetchImpl, 'validate', body);
    if (r.ok && r.data && typeof r.data.status === 'string') return { ok: true, status: r.data.status, expiresAt: r.data.expires_at ?? null };
    if (r.status === 404 || r.status === 403 || r.status === 422 || r.status === 400) return { ok: false, kind: 'invalid' };
    return { ok: false, kind: 'network' };
  } catch {
    return { ok: false, kind: 'network' };
  }
}

export async function polarDeactivate(fetchImpl: FetchLike, cfg: PolarConfig, key: string, activationId: string): Promise<boolean> {
  try {
    const r = await post(fetchImpl, 'deactivate', { key, organization_id: cfg.organizationId, activation_id: activationId });
    return r.ok || r.status === 404;
  } catch {
    return false;
  }
}
