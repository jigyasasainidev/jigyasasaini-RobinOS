export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_allowlist: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean
          note: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          note?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      affiliate_commissions: {
        Row: {
          affiliate_user_id: string
          amount: number
          created_at: string
          id: string
          referred_user_id: string | null
          status: string
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          affiliate_user_id: string
          amount?: number
          created_at?: string
          id?: string
          referred_user_id?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          affiliate_user_id?: string
          amount?: number
          created_at?: string
          id?: string
          referred_user_id?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      affiliate_profiles: {
        Row: {
          created_at: string
          paid_balance: number
          pending_balance: number
          referral_code: string
          total_clicks: number
          total_conversions: number
          total_earned: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          paid_balance?: number
          pending_balance?: number
          referral_code: string
          total_clicks?: number
          total_conversions?: number
          total_earned?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          paid_balance?: number
          pending_balance?: number
          referral_code?: string
          total_clicks?: number
          total_conversions?: number
          total_earned?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_generations: {
        Row: {
          created_at: string
          credits_used: number
          generation_type: string
          id: string
          provider: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_used?: number
          generation_type?: string
          id?: string
          provider?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          credits_used?: number
          generation_type?: string
          id?: string
          provider?: string | null
          user_id?: string
        }
        Relationships: []
      }
      feature_usage: {
        Row: {
          created_at: string
          feature_name: string
          id: string
          usage_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          feature_name: string
          id?: string
          usage_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          feature_name?: string
          id?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          affiliate_commission_percent: number
          agency_price: number
          announcement_banner: string | null
          created_at: string
          creator_price: number
          free_scans_limit: number
          free_scripts_limit: number
          id: string
          maintenance_mode: boolean
          minimum_withdrawal: number
          payout_delay_days: number
          platform_domain: string | null
          pro_price: number
          support_email: string | null
          updated_at: string
        }
        Insert: {
          affiliate_commission_percent?: number
          agency_price?: number
          announcement_banner?: string | null
          created_at?: string
          creator_price?: number
          free_scans_limit?: number
          free_scripts_limit?: number
          id?: string
          maintenance_mode?: boolean
          minimum_withdrawal?: number
          payout_delay_days?: number
          platform_domain?: string | null
          pro_price?: number
          support_email?: string | null
          updated_at?: string
        }
        Update: {
          affiliate_commission_percent?: number
          agency_price?: number
          announcement_banner?: string | null
          created_at?: string
          creator_price?: number
          free_scans_limit?: number
          free_scripts_limit?: number
          id?: string
          maintenance_mode?: boolean
          minimum_withdrawal?: number
          payout_delay_days?: number
          platform_domain?: string | null
          pro_price?: number
          support_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          affiliate_balance: number
          country: string
          created_at: string
          currency: string
          current_plan: string
          display_name: string | null
          elevenlabs_api_key: string | null
          email: string | null
          free_scans_used: number
          free_scripts_used: number
          free_trial_expired: boolean
          free_trial_started_at: string
          full_name: string | null
          id: string
          is_suspended: boolean
          openai_api_key: string | null
          paid_balance: number
          pending_balance: number
          referral_code: string | null
          scripts_reset_at: string
          scripts_used_this_month: number
          subscription_expires_at: string | null
          subscription_tier: string
          total_earnings: number
          updated_at: string
          upi_id: string | null
          user_id: string
          video_api_key: string | null
        }
        Insert: {
          affiliate_balance?: number
          country?: string
          created_at?: string
          currency?: string
          current_plan?: string
          display_name?: string | null
          elevenlabs_api_key?: string | null
          email?: string | null
          free_scans_used?: number
          free_scripts_used?: number
          free_trial_expired?: boolean
          free_trial_started_at?: string
          full_name?: string | null
          id?: string
          is_suspended?: boolean
          openai_api_key?: string | null
          paid_balance?: number
          pending_balance?: number
          referral_code?: string | null
          scripts_reset_at?: string
          scripts_used_this_month?: number
          subscription_expires_at?: string | null
          subscription_tier?: string
          total_earnings?: number
          updated_at?: string
          upi_id?: string | null
          user_id: string
          video_api_key?: string | null
        }
        Update: {
          affiliate_balance?: number
          country?: string
          created_at?: string
          currency?: string
          current_plan?: string
          display_name?: string | null
          elevenlabs_api_key?: string | null
          email?: string | null
          free_scans_used?: number
          free_scripts_used?: number
          free_trial_expired?: boolean
          free_trial_started_at?: string
          full_name?: string | null
          id?: string
          is_suspended?: boolean
          openai_api_key?: string | null
          paid_balance?: number
          pending_balance?: number
          referral_code?: string | null
          scripts_reset_at?: string
          scripts_used_this_month?: number
          subscription_expires_at?: string | null
          subscription_tier?: string
          total_earnings?: number
          updated_at?: string
          upi_id?: string | null
          user_id?: string
          video_api_key?: string | null
        }
        Relationships: []
      }
      scan_history: {
        Row: {
          created_at: string
          id: string
          niche: string
          topics: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          niche: string
          topics?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          niche?: string
          topics?: Json
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["admin_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["admin_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["admin_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          plan: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          plan?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          plan?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      withdrawal_requests: {
        Row: {
          admin_note: string | null
          amount: number
          approved_at: string | null
          completed_at: string | null
          created_at: string
          fee_amount: number
          id: string
          payout_details: string
          payout_method: string
          rejected_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount?: number
          approved_at?: string | null
          completed_at?: string | null
          created_at?: string
          fee_amount?: number
          id?: string
          payout_details?: string
          payout_method?: string
          rejected_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          approved_at?: string | null
          completed_at?: string | null
          created_at?: string
          fee_amount?: number
          id?: string
          payout_details?: string
          payout_method?: string
          rejected_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      admin_profiles_view: {
        Row: {
          affiliate_enabled: boolean | null
          avatar_url: string | null
          created_at: string | null
          current_plan: string | null
          email: string | null
          full_name: string | null
          is_admin: boolean | null
          is_suspended: boolean | null
          total_scripts_generated: number | null
          total_trend_scans: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          affiliate_enabled?: never
          avatar_url?: never
          created_at?: string | null
          current_plan?: string | null
          email?: string | null
          full_name?: string | null
          is_admin?: never
          is_suspended?: boolean | null
          total_scripts_generated?: number | null
          total_trend_scans?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          affiliate_enabled?: never
          avatar_url?: never
          created_at?: string | null
          current_plan?: string | null
          email?: string | null
          full_name?: string | null
          is_admin?: never
          is_suspended?: boolean | null
          total_scripts_generated?: number | null
          total_trend_scans?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_process_withdrawal_request: {
        Args: { p_admin_note?: string; p_request_id: string; p_status: string }
        Returns: Json
      }
      get_admin_access: { Args: never; Returns: Json }
      get_admin_role: { Args: { user_uuid: string }; Returns: string }
      get_usage_status: { Args: { p_feature_name?: string }; Returns: Json }
      initialize_user_account:
        | { Args: never; Returns: Json }
        | { Args: { p_referred_by?: string }; Returns: Json }
    }
    Enums: {
      admin_role: "super_admin" | "admin" | "support"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      admin_role: ["super_admin", "admin", "support"],
    },
  },
} as const
