/**
 * Polar (merchant of record) configuration for Handsfree Pro.
 * Fill POLAR_ORGANIZATION_ID and POLAR_CHECKOUT_URL once the Polar organisation and product exist
 * (see docs/TUS-TAREAS.md, block B). While empty, licence activation reports "not configured" and
 * every Pro command shows the upsell without a working purchase link.
 */
export const POLAR_ORGANIZATION_ID = 'fa5605f8-f935-44c5-9923-686f9479d390';
export const POLAR_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_kjC1NsuFxMmKVQgk8Wpf546ufufCk7wFY63jb1qoC3q';
export const PRO_PRICE_LABEL = '7 €';
export const PRO_INFO_URL = 'https://github.com/TecniartGalicia/handsfree-claude-code#pro';

/** Environment override for local development and CI: any Pro feature unlocked, no network. */
export const DEV_UNLOCK_ENV = 'HANDSFREE_PRO_DEV';

export function polarConfigured(): boolean {
  return POLAR_ORGANIZATION_ID.trim().length > 0;
}
