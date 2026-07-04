// ============================================================
// AdminProvidersList — Per-provider cards with settings + products
// ============================================================
// One card per registered provider. Each card shows:
//   - Header: provider name, version, status badge, enable switch
//   - Settings form: display_name, webhook_url, is_test_mode, notes
//   - Products table: existing product mappings + add/edit/delete
//
// All writes go through useAdminPaymentProviders (which calls
// the admin-payment-providers edge function and never touches
// payment_provider_secrets).
// ============================================================

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2, Plus, Power, PowerOff } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import {
  type Provider,
  type ProviderFormValues,
  type ProviderProduct,
  providerSchema,
  formatDuration,
  formatPrice,
  PLAN_LABELS,
  BILLING_CYCLE_LABELS,
} from "@/lib/admin-payment-providers";
import {
  AdminApiError,
  useAdminProvider,
  useAdminProviderProducts,
  useDeleteProduct,
  useToggleProvider,
  useUpsertProvider,
} from "@/hooks/useAdminPaymentProviders";
import { AdminProductFormDialog } from "@/components/admin/AdminProductFormDialog";

// ── Status badge for provider ───────────────────────────────
function ProviderStatusBadge({ provider }: { provider: Provider }) {
  if (provider.is_enabled) {
    return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300">Enabled</Badge>;
  }
  if (provider.is_test_mode) {
    return <Badge variant="secondary">Test mode</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground">Disabled</Badge>;
}

// ── Status badge for product ────────────────────────────────
function ProductStatusBadge({ product }: { product: ProviderProduct }) {
  if (!product.is_enabled) {
    return <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>;
  }
  return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300">Active</Badge>;
}

// ── Provider settings form ──────────────────────────────────
type SettingsFormProps = {
  provider: Provider;
};

function ProviderSettingsForm({ provider }: SettingsFormProps) {
  const upsert = useUpsertProvider();
  const toggle = useToggleProvider();
  const serverError = upsert.error instanceof AdminApiError ? upsert.error : null;

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerSchema),
    defaultValues: {
      id: provider.id,
      display_name: provider.display_name,
      is_enabled: provider.is_enabled,
      is_test_mode: provider.is_test_mode,
      require_signature_verification: provider.require_signature_verification,
      webhook_url: provider.webhook_url ?? "",
      notes: provider.notes ?? "",
    },
    mode: "onBlur",
  });

  const onSubmit = async (values: ProviderFormValues) => {
    try {
      await upsert.mutateAsync(values);
      toast.success(`${values.display_name} saved`);
    } catch {
      // Server error rendered inline below.
    }
  };

  const onToggle = async (next: boolean) => {
    try {
      await toggle.mutateAsync({ id: provider.id, is_enabled: next });
      toast.success(`${provider.display_name} ${next ? "enabled" : "disabled"}`);
      form.setValue("is_enabled", next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Toggle failed");
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {serverError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {serverError.message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="display_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Display name *</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="webhook_url"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Webhook URL</FormLabel>
                <FormControl>
                  <Input placeholder="https://…" {...field} />
                </FormControl>
                <FormDescription>
                  Endpoint to register in the provider dashboard.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="is_test_mode"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Test mode</FormLabel>
                  <FormDescription>
                    Sandbox/test purchases only. Do not enable in production.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="require_signature_verification"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Require signature</FormLabel>
                  <FormDescription>
                    Reject webhooks with invalid signatures. Always leave on.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea rows={2} placeholder="Internal notes" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Provider</span>
            <Switch
              checked={form.watch("is_enabled")}
              onCheckedChange={onToggle}
              disabled={toggle.isPending}
              aria-label="Toggle provider enabled"
            />
            <span className="font-medium">
              {form.watch("is_enabled") ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Power className="h-3.5 w-3.5" /> Enabled
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <PowerOff className="h-3.5 w-3.5" /> Disabled
                </span>
              )}
            </span>
          </div>
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save settings
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Products table ──────────────────────────────────────────
type ProductsTableProps = {
  providerId: string;
  onEdit: (p: ProviderProduct) => void;
};

function ProductsTable({ providerId, onEdit }: ProductsTableProps) {
  const { data: products, isLoading } = useAdminProviderProducts(providerId);
  const del = useDeleteProduct();

  const onDelete = async (p: ProviderProduct) => {
    try {
      await del.mutateAsync({ id: p.id, provider_id: p.provider_id });
      toast.success("Product deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading products…
      </div>
    );
  }

  if (!products || products.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
        No product mappings yet. Click <strong>Add product</strong> to create one.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Display name</TableHead>
            <TableHead>Provider ID</TableHead>
            <TableHead>Offer</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Billing</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">
                {p.display_name || <span className="text-muted-foreground italic">—</span>}
              </TableCell>
              <TableCell className="font-mono text-xs">{p.provider_product_id}</TableCell>
              <TableCell className="font-mono text-xs">
                {p.provider_offer_id || <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>{PLAN_LABELS[p.plan_key]}</TableCell>
              <TableCell className="text-sm">{BILLING_CYCLE_LABELS[p.billing_cycle]}</TableCell>
              <TableCell className="text-sm">{formatDuration(p.duration_value, p.duration_unit)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPrice(p.amount, p.currency)}
              </TableCell>
              <TableCell><ProductStatusBadge product={p} /></TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onEdit(p)}
                    aria-label="Edit product"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete product"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this product mapping?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove <strong>{p.display_name || p.provider_product_id}</strong>.
                          Past purchases are not affected. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => void onDelete(p)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Provider card (composes settings + products) ────────────
type ProviderCardProps = {
  provider: Provider;
};

export function AdminProviderCard({ provider }: ProviderCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderProduct | null>(null);

  const { data: fullProvider } = useAdminProvider(provider.id);
  const displayProvider = fullProvider ?? provider;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (p: ProviderProduct) => {
    setEditing(p);
    setDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {displayProvider.display_name}
              <ProviderStatusBadge provider={displayProvider} />
              <Badge variant="outline" className="font-mono text-xs">
                v{displayProvider.adapter_version}
              </Badge>
            </CardTitle>
            <CardDescription>
              Provider ID: <span className="font-mono">{displayProvider.id}</span>
              {" · "}
              {displayProvider.product_count ?? 0} product mapping
              {(displayProvider.product_count ?? 0) === 1 ? "" : "s"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Settings */}
        <div>
          <h3 className="text-sm font-medium mb-3">Provider settings</h3>
          <ProviderSettingsForm provider={displayProvider} />
        </div>

        {/* Products */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">Product mappings</h3>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add product
            </Button>
          </div>
          <ProductsTable providerId={displayProvider.id} onEdit={openEdit} />
        </div>
      </CardContent>

      <AdminProductFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        providerId={displayProvider.id}
        editing={editing}
      />
    </Card>
  );
}

// ── List (renders one card per provider) ────────────────────
type ListProps = {
  providers: Provider[];
};

export function AdminProvidersList({ providers }: ListProps) {
  if (providers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No payment providers are registered yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {providers.map((p) => (
        <AdminProviderCard key={p.id} provider={p} />
      ))}
    </div>
  );
}
