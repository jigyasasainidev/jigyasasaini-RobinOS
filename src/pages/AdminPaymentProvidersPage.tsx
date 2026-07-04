// ============================================================
// AdminPaymentProvidersPage — /adminsh/payment-providers
// ============================================================
// Admin landing page for payment provider configuration.
// Shows summary tiles and one card per registered provider.
// All data flows through useAdminPaymentProviders → admin-payment-providers
// edge function → M55 SECURITY DEFINER RPCs. Secrets are never read.
// ============================================================

import { Helmet } from "react-helmet-async";
import { CreditCard, Package, Power, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";

import {
  useAdminProviders,
  useAdminProvidersSummary,
} from "@/hooks/useAdminPaymentProviders";
import { AdminProvidersList } from "@/components/admin/AdminProvidersList";

// ── Summary tile ────────────────────────────────────────────
type TileProps = {
  label: string;
  value: number | undefined;
  description?: string;
  icon: React.ReactNode;
};

function SummaryTile({ label, value, description, icon }: TileProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        {value === undefined ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
        )}
        {description && (
          <CardDescription className="text-xs mt-1">{description}</CardDescription>
        )}
      </CardContent>
    </Card>
  );
}

// ── Loading skeleton ────────────────────────────────────────
function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-64" />
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────
export default function AdminPaymentProvidersPage() {
  const summary = useAdminProvidersSummary();
  const providers = useAdminProviders();

  const isLoading = summary.isLoading || providers.isLoading;
  const error = summary.error || providers.error;

  return (
    <>
      <Helmet>
        <title>Payment Providers · RobinOS Admin</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <div className="space-y-6">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Payment providers</h1>
          <p className="text-sm text-muted-foreground">
            Configure payment gateways and map provider products to RobinOS plans.
            Secret material is managed server-side and is never displayed here.
          </p>
        </header>

        {/* Loading */}
        {isLoading && <PageSkeleton />}

        {/* Error */}
        {error && !isLoading && (
          <ErrorState
            title="Could not load payment providers"
            message={error instanceof Error ? error.message : "Unknown error"}
            onRetry={() => {
              void summary.refetch();
              void providers.refetch();
            }}
          />
        )}

        {/* Body */}
        {!isLoading && !error && (
          <>
            {/* Summary tiles */}
            <section
              aria-label="Summary"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              <SummaryTile
                label="Total providers"
                value={summary.data?.provider_count}
                description="Registered in the system"
                icon={<CreditCard className="h-4 w-4" />}
              />
              <SummaryTile
                label="Enabled"
                value={summary.data?.enabled_count}
                description="Accepting webhooks"
                icon={<Power className="h-4 w-4" />}
              />
              <SummaryTile
                label="Product mappings"
                value={summary.data?.product_count}
                description={`${summary.data?.active_product_count ?? 0} active`}
                icon={<Package className="h-4 w-4" />}
              />
              <SummaryTile
                label="Active mappings"
                value={summary.data?.active_product_count}
                description="Grant access on purchase"
                icon={<ShieldCheck className="h-4 w-4" />}
              />
            </section>

            {/* Providers */}
            <section aria-label="Providers">
              <AdminProvidersList providers={providers.data ?? []} />
            </section>
          </>
        )}
      </div>
    </>
  );
}
