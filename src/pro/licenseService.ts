import * as os from 'os';
import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { decideAfterValidation, decideOffline, FetchLike, LicenseState, looksLikeLicenseKey, polarActivate, polarDeactivate, polarValidate, ProDecision } from '../core/license';
import { log } from '../vscode/env';
import { DEV_UNLOCK_ENV, POLAR_CHECKOUT_URL, POLAR_ORGANIZATION_ID, polarConfigured, PRO_INFO_URL, PRO_PRICE_LABEL } from './polarConfig';

const SECRET_KEY = 'handsfree.license';

const fetchImpl: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

export async function loadState(context: vscode.ExtensionContext): Promise<LicenseState> {
  try {
    const raw = await context.secrets.get(SECRET_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? (parsed as LicenseState) : {};
  } catch {
    return {};
  }
}

async function saveState(context: vscode.ExtensionContext, state: LicenseState): Promise<void> {
  if (!state.key) await context.secrets.delete(SECRET_KEY);
  else await context.secrets.store(SECRET_KEY, JSON.stringify(state));
}

function devUnlocked(): boolean {
  return process.env[DEV_UNLOCK_ENV] === '1';
}

/** Cached per session so a burst of commands never causes more than one validation. */
let cached: { at: number; decision: ProDecision } | undefined;

/** Decides Pro status: offline first, network (throttled) only when needed. Never throws. */
export async function proStatus(context: vscode.ExtensionContext, force = false): Promise<ProDecision> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.decision;
  const now = new Date();
  const state = await loadState(context);
  let decision = decideOffline(state, now, devUnlocked());
  if (!decision) {
    if (!polarConfigured()) decision = { pro: false, reason: 'not-configured' };
    else {
      const result = await polarValidate(fetchImpl, { organizationId: POLAR_ORGANIZATION_ID, checkoutUrl: POLAR_CHECKOUT_URL }, state.key!, state.activationId);
      const r = decideAfterValidation(state, now, result);
      decision = r.decision;
      if (JSON.stringify(r.next) !== JSON.stringify(state)) await saveState(context, r.next);
      log(`Licence validation: ${result.ok ? result.status : result.kind} → ${decision.pro ? 'pro' : decision.reason}`);
    }
  }
  cached = { at: Date.now(), decision };
  return decision;
}

export async function isPro(context: vscode.ExtensionContext): Promise<boolean> {
  return (await proStatus(context)).pro;
}

/**
 * Gate for Pro commands. Returns true when allowed; otherwise shows a short, honest upsell and returns false.
 */
export async function ensurePro(context: vscode.ExtensionContext, feature: string): Promise<boolean> {
  const d = await proStatus(context);
  if (d.pro) return true;
  const buy = l10n.t('Get Pro ({0}, one-time)', PRO_PRICE_LABEL);
  const enter = l10n.t('Enter licence key');
  const what = l10n.t("What's in Pro");
  let msg: string;
  switch (d.reason) {
    case 'expired':
      msg = l10n.t('Your Handsfree Pro licence has expired.');
      break;
    case 'revoked':
    case 'invalid':
      msg = l10n.t('Your Handsfree Pro licence key is not valid any more.');
      break;
    case 'grace-expired':
      msg = l10n.t('Handsfree Pro could not be re-validated for more than 14 days (no network). Connect once and try again.');
      break;
    case 'network':
      msg = l10n.t('Handsfree Pro licence could not be validated (no network). Try again when you are online.');
      break;
    default:
      msg = l10n.t('"{0}" is part of Handsfree Pro. The free version keeps Enable, Revert and the Doctor forever; Pro adds per-project profiles, guardrails, export/import and the status bar.', feature);
  }
  const pick = await vscode.window.showInformationMessage(msg, buy, enter, what);
  if (pick === buy) await openCheckout();
  else if (pick === enter) await activateLicenseCommand(context);
  else if (pick === what) await vscode.env.openExternal(vscode.Uri.parse(PRO_INFO_URL));
  return false;
}

export async function openCheckout(): Promise<void> {
  if (!POLAR_CHECKOUT_URL) {
    void vscode.window.showInformationMessage(l10n.t('Handsfree Pro is not on sale yet. Watch the repository for the announcement.'));
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(POLAR_CHECKOUT_URL));
}

export async function activateLicenseCommand(context: vscode.ExtensionContext): Promise<void> {
  if (!polarConfigured()) {
    void vscode.window.showInformationMessage(l10n.t('Licence activation is not configured in this build.'));
    return;
  }
  const key = await vscode.window.showInputBox({
    title: l10n.t('Handsfree Pro — enter your licence key'),
    prompt: l10n.t('The key from your Polar purchase e-mail. It is stored in VS Code\'s secret storage; only the key and this computer\'s name are sent to Polar.'),
    ignoreFocusOut: true,
    password: true,
    validateInput: (v) => (looksLikeLicenseKey(v) ? undefined : l10n.t('That does not look like a licence key')),
  });
  if (!key) return;
  const label = os.hostname();
  const meta = { platform: process.platform, extension: String((context.extension.packageJSON as any)?.version ?? '?') };
  const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t('Activating Handsfree Pro…') }, () =>
    polarActivate(fetchImpl, { organizationId: POLAR_ORGANIZATION_ID, checkoutUrl: POLAR_CHECKOUT_URL }, key.trim(), label, meta),
  );
  if (!r.ok) {
    const why = r.kind === 'invalid' ? l10n.t('The key was not recognised.') : r.kind === 'limit' ? l10n.t('This key has reached its activation limit or is not active: {0}. Deactivate it on another computer or contact support.', r.message) : l10n.t('Network problem: {0}', r.message);
    void vscode.window.showErrorMessage(l10n.t('Could not activate Handsfree Pro. {0}', why));
    return;
  }
  const state: LicenseState = { key: key.trim(), activationId: r.activationId, status: r.status, expiresAt: r.expiresAt ?? null, lastValidatedAt: new Date().toISOString(), label };
  await saveState(context, state);
  cached = undefined;
  log(`Licence activated for ${label} (activation ${r.activationId})`);
  void vscode.window.showInformationMessage(l10n.t('Handsfree Pro activated on this computer. Thank you!'));
}

export async function deactivateLicenseCommand(context: vscode.ExtensionContext): Promise<void> {
  const state = await loadState(context);
  if (!state.key) {
    void vscode.window.showInformationMessage(l10n.t('No Handsfree Pro licence is stored on this computer.'));
    return;
  }
  const yes = l10n.t('Deactivate');
  const pick = await vscode.window.showWarningMessage(l10n.t('Deactivate Handsfree Pro on this computer? The activation slot is freed so you can use the key elsewhere.'), { modal: true }, yes);
  if (pick !== yes) return;
  if (state.activationId && polarConfigured()) {
    const ok = await polarDeactivate(fetchImpl, { organizationId: POLAR_ORGANIZATION_ID, checkoutUrl: POLAR_CHECKOUT_URL }, state.key, state.activationId);
    if (!ok) void vscode.window.showWarningMessage(l10n.t('Polar could not be reached; the key was removed from this computer but the activation slot may still count until you deactivate it from your Polar customer portal.'));
  }
  await saveState(context, {});
  cached = undefined;
  void vscode.window.showInformationMessage(l10n.t('Handsfree Pro deactivated on this computer.'));
}

export async function licenseStatusCommand(context: vscode.ExtensionContext): Promise<void> {
  const d = await proStatus(context, true);
  const state = await loadState(context);
  const lines = [
    d.pro ? l10n.t('Handsfree Pro: active ({0})', d.source) : l10n.t('Handsfree Pro: not active ({0})', d.reason),
    state.label ? l10n.t('Activated as: {0}', state.label) : '',
    state.lastValidatedAt ? l10n.t('Last validated: {0}', new Date(state.lastValidatedAt).toLocaleString()) : '',
    state.expiresAt ? l10n.t('Expires: {0}', new Date(state.expiresAt).toLocaleString()) : '',
  ].filter(Boolean);
  void vscode.window.showInformationMessage(lines.join(' · '));
}
