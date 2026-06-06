# RobinOS Codebase Exploration Findings

## 1. Affiliate Dashboard/Referrals Page
**File Path:** `/Users/ashad/Documents/RobinOS-main/src/pages/ReferralsPage.tsx`

This is the page where affiliates view their referral statistics, withdrawal history, and manage their payout method. It includes:
- Referral link generation and sharing
- Earnings statistics (total referrals, paid conversions, total earned, available balance, etc.)
- Withdrawal request form with validation
- Withdrawal history table
- Payout method setup (USDT TRC20 wallet address)

## 2. PlatformSettings Type Definition
**File Path:** `/Users/ashad/Documents/RobinOS-main/src/types/platform-config.ts`

The `affiliate_commission_percent` field is defined in multiple interfaces:
- `PlatformSettingsRow`: Full database row shape
- `PlatformSettingsDraft`: Mutable subset for admin UI
- `PlatformSettingsLive`: Read-only shape for live settings hook

Example from the file:
```typescript
export interface PlatformSettingsRow {
  // ... other fields
  affiliate_commission_percent: number;
  // ... other fields
}

export interface PlatformSettingsDraft {
  // ... other fields
  affiliate_commission_percent: number;
  // ... other fields
}

export interface PlatformSettingsLive {
  // ... other fields
  affiliate_commission_percent: number;
  // ... other fields
}
```

## 3. Admin Panel Settings Save Pattern
**Location:** `/Users/ashad/Documents/RobinOS-main/src/pages/AdminDashboard.tsx` (around the `saveSettingsMutation`)

The admin panel saves settings to `platform_settings` using a TanStack React Query mutation:

```typescript
const saveSettingsMutation = useMutation({
  mutationFn: async () => {
    // Validation omitted for brevity
    const payload = {
      // ... all settings fields mapped from settingsDraft
      affiliate_commission_percent: Number(settingsDraft.affiliate_commission_percent),
      // ... other fields
    };

    if (platformSettings?.id) {
      // Update existing row
      const { error } = await db.from("platform_settings").update(payload).eq("id", platformSettings.id);
      if (error) throw error;
    } else {
      // Insert new row (shouldn't happen in practice as there's always a settings row)
      const { error } = await db.from("platform_settings").insert(payload);
      if (error) throw error;
    }

    // Audit log
    await writeAdminLog("platform_settings_updated", platformSettings?.id ?? "new", payload);
    return payload;
  },
  onSuccess: (savedPayload) => {
    // Update draft with saved values to prevent race conditions
    setSettingsDraft((prev) => ({
      ...prev,
      ...savedPayload,
      // ... handle null conversions
    }));
    
    // Invalidate relevant queries to update consumers
    queryClient.invalidateQueries({ queryKey: ["platform-settings-live-v1"] });
    queryClient.invalidateQueries({ queryKey: ["platform-maintenance-v1"] });
    queryClient.invalidateQueries({ queryKey: ["affiliate-settings", user?.id] });
    // Refetch admin settings query in background (won't overwrite draft due to draftHydratedRef)
    queryClient.invalidateQueries({ queryKey: ["admin-platform-settings-v2"] });
  },
  // ... error handling
});
```

The mutation is triggered by the "Deploy Changes" button in the settings page UI.

## 4. Supabase Migration Naming Convention
**Directory:** `/Users/ashad/Documents/RobinOS-main/supabase/migrations/`

Migrations follow a sequential numbering pattern with descriptive names:
- Format: `{two-digit-number}_{description}.sql`
- Examples: `01_master_backend_architecture.sql`, `45_production_reset.sql`
- Latest migration: `45_production_reset.sql` (as of the current directory listing)

## 5. usePlatformSettings Hook
**File Path:** `/Users/ashad/Documents/RobinOS-main/src/hooks/usePlatformSettings.ts`

The hook fetches live platform settings and subscribes to real-time updates:

```typescript
export function usePlatformSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["platform-settings-live-v1"],
    queryFn: async (): Promise<PlatformSettingsLive | null> => {
      // Select specific columns (excluding id, created_at, support_email, platform_domain)
      const { data, error } = await db
        .from("platform_settings")
        .select(
          "creator_price,pro_price,agency_price,free_scripts_limit,free_scans_limit,affiliate_commission_percent,minimum_withdrawal,payout_delay_days,maintenance_mode,announcement_banner,creator_os_page_enabled,creator_os_demo_video_url,jvzoo_affiliate_enabled,jvzoo_affiliate_demo_video_url,jvzoo_affiliate_cta_url,jvzoo_affiliate_button_text,jvzoo_affiliate_login_url,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Error handling for missing table
      if (error) {
        const isMissingTable =
          error.code === "PGRST205" ||
          error.message?.toLowerCase().includes("platform_settings") ||
          error.message?.toLowerCase().includes("schema cache");

        if (isMissingTable) return null;
        throw error;
      }
      return (data ?? null) as PlatformSettingsLive | null;
    },
    staleTime: 15 * 1000,
  });

  // Realtime subscription via centralized manager
  useEffect(() => {
    const unsubscribe = subscribePostgresChanges({
      channelName: "platform-settings-live-global",
      table: "platform_settings",
      event: "*",
      callback: () => {
        queryClient.invalidateQueries({ queryKey: ["platform-settings-live-v1"] });
      },
    });
    return unsubscribe;
  }, [queryClient]);

  return query;
}
```

The hook returns a query object that provides:
- `data`: The live settings object or null if table doesn't exist
- `isLoading`, `isError`, etc. standard query states
- Automatic updates when the database changes via realtime subscription
