// ============================================================
// ROBINOS PAYMENT TYPES
// Shared types for the Dodo Payments integration layer.
// ============================================================

export type BillingCycle = "monthly";  // monthly only — yearly not supported

export type PlanKey = "creator" | "pro_creator" | "agency";

export interface CheckoutSessionRequest {
  planKey: PlanKey;
  userId: string;
  userEmail: string;
  userName?: string;
}

export interface CheckoutSessionResponse {
  checkoutUrl: string;
  sessionId: string;
}

export interface SubscriptionState {
  plan: string;
  status: "active" | "trialing" | "expiring" | "grace_period" | "expired" | "cancelled" | "payment_failed" | "none";
  billingCycle: BillingCycle;
  expiresAt: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  provider: "dodo" | null;
  isActive: boolean;
}

// ── Dodo webhook event types ───────────────────────────────
export type DodoEventType =
  | "subscription.active"
  | "subscription.renewed"
  | "subscription.cancelled"
  | "subscription.on_hold"
  | "subscription.paused"
  | "subscription.expired"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded"
  | "dispute.opened"
  | "dispute.accepted"
  | "dispute.challenged"
  | "dispute.won"
  | "dispute.lost";

export interface DodoWebhookPayload {
  business_id: string;
  type: DodoEventType;
  timestamp: string;
  data: DodoSubscriptionData | DodoPaymentData | Record<string, unknown>;
}

export interface DodoSubscriptionData {
  payload_type: "Subscription";
  subscription_id: string;
  customer: {
    customer_id: string;
    email: string;
    name: string;
  };
  product_id: string;
  status: string;
  billing_cycle?: {
    frequency: number;
    interval: "Month" | "Year" | "Week" | "Day";
  };
  current_period_start?: string;
  current_period_end?: string;
  cancelled_at?: string;
  metadata?: Record<string, string>;
  next_billing_date?: string;
  recurring_pre_tax_amount?: number;
  currency?: string;
}

export interface DodoPaymentData {
  payload_type: "Payment";
  payment_id: string;
  subscription_id?: string;
  customer: {
    customer_id: string;
    email: string;
    name: string;
  };
  product_cart?: Array<{ product_id: string; quantity: number }>;
  status: string;
  total_amount: number;
  currency: string;
  metadata?: Record<string, string>;
  created_at: string;
}

export interface PaymentError {
  code: string;
  message: string;
  retryable: boolean;
}
