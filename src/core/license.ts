/**
 * Licence state machine, pure and testable. The VS Code layer supplies storage (secrets/globalState),
 * a fetch implementation and the clock.
 *
 * Polar customer-portal endpoints (unauthenticated, per https://polar.sh/docs/features/benefits/license-keys):
 *   POST /v1/customer-portal/license-keys/activate   { key, organization_id, label, meta? }  → { id, ... } (activation)
 *   POST /v1/customer-portal/license-keys/validate   { key, organization_id, activation_id? } → { status, expires_at, ... }
 *   POST /v1/customer-portal/license-keys/deactivate { key, organization_id, activation_id }
 *
 * Offline grace: a licence validated within GRACE_DAYS keeps working when the network is down.
 * Revalidation is throttled to once per REVALIDATE_HOURS so the extension never chats with the API.
 */
export const POLAR_BASE = 'https://api.polar.sh/v1/customer-portal/license-keys';
export const GRACE_DAYS = 14;
export const REVALIDATE_HOURS = 24;

export interface LicenseState {
  key?: string;
  activationId?: string;
  /** ISO of the last successful validation. */
  lastValidatedAt?: string;
  /** Last known status from the API. */
  status?: 'granted' | 'revoked' | 'disabled' | 'expired' | string;
  expiresAt?: string | null;
  label?: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export interface PolarConfig {
  organizationId: string;
  checkoutUrl: string;
}

export type ProDecision =
  | { pro: true; source: 'dev' | 'validated' | 'grace' }
  | { pro: false; reason: 'no-key' | 'not-configured' | 'invalid' | 'expired' | 'grace-expired' | 'revoked' | 'network' };

/** Purely from stored state + clock: can we consider this machine Pro without touching the network? */
export function decideOffline(state: LicenseState, now: Date, devOverride = false): ProDecision | undefined {
  if (devOverride) return { pro: true, source: 'dev' };
  if (!state.key) return { pro: false, reason: 'no-key' };
  if (state.status && state.status !== 'granted') return { pro: false, reason: state.status === 'expired' ? 'expired' : 'revoked' };
  if (state.expiresAt && new Date(state.expiresAt).getTime() < now.getTime()) return { pro: false, reason: 'expired' };
  if (state.lastValidatedAt) {
    const age = now.getTime() - new Date(state.lastValidatedAt).getTime();
    if (age >= 0 && age < REVALIDATE_HOURS * 3600_000) return { pro: true, source: 'validated' };
  }
  return undefined; // needs (re)validation
}

/** Applies a validation attempt's outcome. */
export function decideAfterValidation(state: LicenseState, now: Date, result: { ok: true; status: string; expiresAt?: string | null } | { ok: false; kind: 'network' | 'invalid' }): { decision: ProDecision; next: LicenseState } {
  if (result.ok) {
    const next: LicenseState = { ...state, status: result.status, expiresAt: result.expiresAt ?? null };
    if (result.status === 'granted' && !(result.expiresAt && new Date(result.expiresAt).getTime() < now.getTime())) {
      next.lastValidatedAt = now.toISOString();
      return { decision: { pro: true, source: 'validated' }, next };
    }
    return { decision: { pro: false, reason: result.status === 'expired' || (result.expiresAt && new Date(result.expiresAt).getTime() < now.getTime()) ? 'expired' : 'revoked' }, next };
  }
  if (result.kind === 'invalid') return { decision: { pro: false, reason: 'invalid' }, next: { ...state, status: 'revoked' } };
  // network problem: honour the grace period
  if (state.lastValidatedAt) {
    const age = now.getTime() - new Date(state.lastValidatedAt).getTime();
    if (age >= 0 && age < GRACE_DAYS * 86400_000) return { decision: { pro: true, source: 'grace' }, next: state };
    return { decision: { pro: false, reason: 'grace-expired' }, next: state };
  }
  return { decision: { pro: false, reason: 'network' }, next: state };
}

export function looksLikeLicenseKey(s: string): boolean {
  const k = s.trim();
  return k.length >= 16 && k.length <= 200 && /^[A-Za-z0-9._-]+$/.test(k);
}

// ---- API calls (thin; all decisions above) --------------------------------

async function post(fetchImpl: FetchLike, path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetchImpl(`${POLAR_BASE}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  let data: any = undefined;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  return { ok: res.ok, status: res.status, data };
}

export async function polarActivate(fetchImpl: FetchLike, cfg: PolarConfig, key: string, label: string, meta: Record<string, string>): Promise<{ ok: true; activationId: string; status: string; expiresAt?: string | null } | { ok: false; kind: 'network' | 'invalid' | 'limit'; message: string }> {
  try {
    const r = await post(fetchImpl, 'activate', { key, organization_id: cfg.organizationId, label, meta });
    if (r.ok && r.data && typeof r.data.id === 'string') {
      const lk = r.data.license_key ?? {};
      return { ok: true, activationId: r.data.id, status: String(lk.status ?? 'granted'), expiresAt: lk.expires_at ?? null };
    }
    if (r.status === 404) return { ok: false, kind: 'invalid', message: 'License key not found' };
    if (r.status === 403 || r.status === 422) return { ok: false, kind: 'limit', message: String(r.data?.detail ?? r.data?.error ?? `HTTP ${r.status}`) };
    return { ok: false, kind: r.status >= 500 ? 'network' : 'invalid', message: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, kind: 'network', message: e instanceof Error ? e.message : String(e) };
  }
}

export async function polarValidate(fetchImpl: FetchLike, cfg: PolarConfig, key: string, activationId?: string): Promise<{ ok: true; status: string; expiresAt?: string | null } | { ok: false; kind: 'network' | 'invalid' }> {
  try {
    const body: Record<string, unknown> = { key, organization_id: cfg.organizationId };
    if (activationId) body.activation_id = activationId;
    const r = await post(fetchImpl, 'validate', body);
    if (r.ok && r.data && typeof r.data.status === 'string') return { ok: true, status: r.data.status, expiresAt: r.data.expires_at ?? null };
    if (r.status === 404 || r.status === 403 || r.status === 422) return { ok: false, kind: 'invalid' };
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
