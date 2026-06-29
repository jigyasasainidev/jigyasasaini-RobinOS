// ============================================================
// ROBINOS — PLATFORM CONFIGURATION TYPES
// Single source of truth for all platform-wide settings shapes.
// Backend table: public.platform_settings (singleton row).
// ============================================================

/**
 * Full row shape as stored in the database.
 * Matches the platform_settings table schema exactly.
 */
export interface PlatformSettingsRow {
  id: string;
  creator_price: number;
  pro_price: number;
  agency_price: number;
  free_scripts_limit: number;
  free_scans_limit: number;
  affiliate_commission_percent: number;
  minimum_withdrawal: number;
  payout_delay_days: number;
  maintenance_mode: boolean;
  announcement_banner: string | null;
  creator_os_page_enabled: boolean;
  creator_os_demo_video_url: string | null;
  jvzoo_affiliate_enabled: boolean;
  jvzoo_affiliate_demo_video_url: string | null;
  jvzoo_affiliate_cta_url: string | null;
  jvzoo_affiliate_button_text: string | null;
  jvzoo_affiliate_login_url: string | null;
  affiliate_resources_url: string | null;
  resource_vault_enabled: boolean;
  warriorplus_page_enabled: boolean;
  warriorplus_demo_video_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Mutable subset of settings exposed to the Admin Settings UI.
 * Does NOT include id, created_at — those are immutable.
 * Does NOT include support_email, platform_domain — not part of
 * admin-controlled operational configuration.
 */
export interface PlatformSettingsDraft {
  creator_price: number;
  pro_price: number;
  agency_price: number;
  free_scripts_limit: number;
  free_scans_limit: number;
  affiliate_commission_percent: number;
  minimum_withdrawal: number;
  payout_delay_days: number;
  maintenance_mode: boolean;
  announcement_banner: string;
  creator_os_page_enabled: boolean;
  creator_os_demo_video_url: string;
  jvzoo_affiliate_enabled: boolean;
  jvzoo_affiliate_demo_video_url: string;
  jvzoo_affiliate_cta_url: string;
  jvzoo_affiliate_button_text: string;
  jvzoo_affiliate_login_url: string;
  affiliate_resources_url: string;
  resource_vault_enabled: boolean;
  warriorplus_page_enabled: boolean;
  warriorplus_demo_video_url: string;
}

/**
 * Canonical default values — must match the database seed row.
 * Used as the initial draft state before the DB row is loaded.
 */
export const PLATFORM_SETTINGS_DEFAULTS: PlatformSettingsDraft = {
  creator_price: 19,
  pro_price: 39,
  agency_price: 99,
  free_scripts_limit: 3,
  free_scans_limit: 20,
  affiliate_commission_percent: 30,
  minimum_withdrawal: 25,
  payout_delay_days: 7,
  maintenance_mode: false,
  announcement_banner: "",
  creator_os_page_enabled: true,
  creator_os_demo_video_url: "",
  jvzoo_affiliate_enabled: false,
  jvzoo_affiliate_demo_video_url: "",
  jvzoo_affiliate_cta_url: "",
  jvzoo_affiliate_button_text: "Join Affiliate Program",
  jvzoo_affiliate_login_url: "https://www.tryrobin.xyz/login",
  affiliate_resources_url: "",
  resource_vault_enabled: true,
  warriorplus_page_enabled: false,
  warriorplus_demo_video_url: "",
};

/**
 * Validation rules for the settings draft.
 * Returns a map of field → error message string.
 * Empty map means valid.
 */
export function validateSettingsDraft(
  draft: PlatformSettingsDraft,
): Partial<Record<keyof PlatformSettingsDraft, string>> {
  const errors: Partial<Record<keyof PlatformSettingsDraft, string>> = {};

  if (draft.creator_price < 0) errors.creator_price = "Price must be ≥ 0";
  if (draft.pro_price < 0) errors.pro_price = "Price must be ≥ 0";
  if (draft.agency_price < 0) errors.agency_price = "Price must be ≥ 0";
  if (draft.free_scripts_limit < 0) errors.free_scripts_limit = "Limit must be ≥ 0";
  if (draft.free_scans_limit < 0) errors.free_scans_limit = "Limit must be ≥ 0";
  if (draft.affiliate_commission_percent < 0 || draft.affiliate_commission_percent > 100)
    errors.affiliate_commission_percent = "Commission must be 0–100%";
  if (draft.minimum_withdrawal < 1) errors.minimum_withdrawal = "Minimum withdrawal must be ≥ 1";
  if (draft.payout_delay_days < 0) errors.payout_delay_days = "Payout delay must be ≥ 0";

  return errors;
}

/**
 * Lightweight read-only shape used by the live settings hook
 * (usePlatformSettings) and the EntryPage / DashboardLayout consumers.
 */
export interface PlatformSettingsLive {
  creator_price: number;
  pro_price: number;
  agency_price: number;
  free_scripts_limit: number;
  free_scans_limit: number;
  affiliate_commission_percent: number;
  minimum_withdrawal: number;
  payout_delay_days: number;
  maintenance_mode: boolean;
  announcement_banner: string | null;
  creator_os_page_enabled: boolean;
  creator_os_demo_video_url: string | null;
  jvzoo_affiliate_enabled: boolean;
  jvzoo_affiliate_demo_video_url: string | null;
  jvzoo_affiliate_cta_url: string | null;
  jvzoo_affiliate_button_text: string | null;
  jvzoo_affiliate_login_url: string | null;
  updated_at: string;
  resource_vault_enabled: boolean;
  warriorplus_page_enabled: boolean;
  warriorplus_demo_video_url: string | null;
}
