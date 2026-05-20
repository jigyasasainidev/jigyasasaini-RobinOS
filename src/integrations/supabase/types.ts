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
      affiliate_profiles: {
        Row: {
          created_at: string
          id: string
          paid_balance: number
          payout_details: string | null
          payout_method: string | null
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
          id?: string
          paid_balance?: number
          payout_details?: string | null
          payout_method?: string | null
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
          id?: string
          paid_balance?: number
          payout_details?: string | null
          payout_method?: string | null
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
      affiliate_referrals: {
        Row: {
          affiliate_user_id: string
          created_at: string
          id: string
          referral_code: string | null
          referred_user_id: string
          updated_at: string
        }
        Insert: {
          affiliate_user_id: string
          created_at?: string
          id?: string
          referral_code?: string | null
          referred_user_id: string
          updated_at?: string
        }
        Update: {
          affiliate_user_id?: string
          created_at?: string
          id?: string
          referral_code?: string | null
          referred_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      caption_generations: {
        Row: {
          created_at: string
          generated_caption: string
          generated_hashtags: string[]
          generated_keywords: string[]
          generation_status: string
          generation_style: string
          id: string
          is_saved: boolean
          platform: string
          prompt: string
          request_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          generated_caption: string
          generated_hashtags?: string[]
          generated_keywords?: string[]
          generation_status?: string
          generation_style: string
          id?: string
          is_saved?: boolean
          platform: string
          prompt: string
          request_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          generated_caption?: string
          generated_hashtags?: string[]
          generated_keywords?: string[]
          generation_status?: string
          generation_style?: string
          id?: string
          is_saved?: boolean
          platform?: string
          prompt?: string
          request_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      onboarding_states: {
        Row: {
          created_at: string
          current_step: number
          id: string
          is_completed: boolean
          updated_at: string
          user_id: string
          welcome_seen: boolean
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          current_step?: number
          id?: string
          is_completed?: boolean
          updated_at?: string
          user_id: string
          welcome_seen?: boolean
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          current_step?: number
          id?: string
          is_completed?: boolean
          updated_at?: string
          user_id?: string
          welcome_seen?: boolean
          workspace_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          affiliate_enabled: boolean
          country: string
          created_at: string
          currency: string
          current_plan: string
          display_name: string | null
          email: string | null
          free_scans_used: number
          free_scripts_used: number
          free_trial_expired: boolean
          free_trial_started_at: string
          full_name: string | null
          id: string
          is_suspended: boolean
          referral_code: string | null
          referred_by_code: string | null
          scripts_reset_at: string
          scripts_used_this_month: number
          subscription_expires_at: string | null
          subscription_tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          affiliate_enabled?: boolean
          country?: string
          created_at?: string
          currency?: string
          current_plan?: string
          display_name?: string | null
          email?: string | null
          free_scans_used?: number
          free_scripts_used?: number
          free_trial_expired?: boolean
          free_trial_started_at?: string
          full_name?: string | null
          id?: string
          is_suspended?: boolean
          referral_code?: string | null
          referred_by_code?: string | null
          scripts_reset_at?: string
          scripts_used_this_month?: number
          subscription_expires_at?: string | null
          subscription_tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          affiliate_enabled?: boolean
          country?: string
          created_at?: string
          currency?: string
          current_plan?: string
          display_name?: string | null
          email?: string | null
          free_scans_used?: number
          free_scripts_used?: number
          free_trial_expired?: boolean
          free_trial_started_at?: string
          full_name?: string | null
          id?: string
          is_suspended?: boolean
          referral_code?: string | null
          referred_by_code?: string | null
          scripts_reset_at?: string
          scripts_used_this_month?: number
          subscription_expires_at?: string | null
          subscription_tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      script_generations: {
        Row: {
          content_length: string | null
          created_at: string
          generated_output: string | null
          generation_status: string
          id: string
          prompt: string
          request_id: string | null
          tone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content_length?: string | null
          created_at?: string
          generated_output?: string | null
          generation_status?: string
          id?: string
          prompt: string
          request_id?: string | null
          tone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content_length?: string | null
          created_at?: string
          generated_output?: string | null
          generation_status?: string
          id?: string
          prompt?: string
          request_id?: string | null
          tone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscription_entitlements: {
        Row: {
          byok_enabled: boolean
          caption_daily_limit: number
          created_at: string
          is_fair_usage: boolean
          script_daily_limit: number
          tier: string
          updated_at: string
        }
        Insert: {
          byok_enabled?: boolean
          caption_daily_limit: number
          created_at?: string
          is_fair_usage?: boolean
          script_daily_limit: number
          tier: string
          updated_at?: string
        }
        Update: {
          byok_enabled?: boolean
          caption_daily_limit?: number
          created_at?: string
          is_fair_usage?: boolean
          script_daily_limit?: number
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      usage_counters: {
        Row: {
          created_at: string
          feature_name: string
          id: string
          period_key: string
          updated_at: string
          used_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          feature_name: string
          id?: string
          period_key: string
          updated_at?: string
          used_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          feature_name?: string
          id?: string
          period_key?: string
          updated_at?: string
          used_count?: number
          user_id?: string
        }
        Relationships: []
      }
      usage_events: {
        Row: {
          amount: number
          created_at: string
          feature_name: string
          id: string
          idempotency_key: string | null
          period_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          feature_name: string
          id?: string
          idempotency_key?: string | null
          period_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          feature_name?: string
          id?: string
          idempotency_key?: string | null
          period_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
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
      workspace_memberships: {
        Row: {
          created_at: string
          id: string
          role: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      caption_daily_limit_for_tier: {
        Args: { p_tier: string }
        Returns: number
      }
      consume_caption_quota: { Args: { p_increment?: number }; Returns: Json }
      consume_feature_quota: {
        Args: {
          p_feature_name: string
          p_idempotency_key?: string
          p_increment?: number
        }
        Returns: Json
      }
      create_caption_generation_if_allowed: {
        Args: {
          p_generated_caption: string
          p_generated_hashtags?: string[]
          p_generated_keywords?: string[]
          p_generation_style: string
          p_platform: string
          p_prompt: string
          p_request_id: string
        }
        Returns: Json
      }
      ensure_affiliate_profile: { Args: never; Returns: Json }
      generate_referral_code: { Args: never; Returns: string }
      get_admin_role: { Args: { user_uuid?: string }; Returns: string }
      get_caption_usage_status: { Args: never; Returns: Json }
      get_usage_status: { Args: { p_feature_name: string }; Returns: Json }
      initialize_user_account: {
        Args: { p_referred_by?: string }
        Returns: Json
      }
      normalize_tier: { Args: { p_tier: string }; Returns: string }
    }
    Enums: {
      app_role: "user" | "admin" | "support" | "super_admin"
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
      app_role: ["user", "admin", "support", "super_admin"],
    },
  },
} as const
