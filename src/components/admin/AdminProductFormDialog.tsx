// ============================================================
// AdminProductFormDialog — Create / edit provider product mapping
// ============================================================
// Modal form used by AdminProviderCard to add a new product or
// edit an existing one. Uses react-hook-form + zod for client-
// side validation that mirrors admin_upsert_provider_product in
// migration 55. Server errors (including DUPLICATE_PRODUCT_MAPPING)
// are surfaced inline above the form footer.
// ============================================================

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

import {
  BILLING_CYCLE_LABELS,
  BILLING_CYCLES,
  DURATION_UNIT_LABELS,
  DURATION_UNITS,
  PLAN_LABELS,
  PLAN_KEYS,
  CURRENCIES,
  type ProviderProduct,
  type ProviderProductFormValues,
  providerProductSchema,
} from "@/lib/admin-payment-providers";
import {
  AdminApiError,
  useUpsertProduct,
} from "@/hooks/useAdminPaymentProviders";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  editing: ProviderProduct | null;
  onSaved?: (product: { id: string }) => void;
};

const DEFAULTS: Omit<ProviderProductFormValues, "provider_id"> = {
  id: "",
  provider_product_id: "",
  provider_offer_id: "",
  plan_key: "creator",
  billing_cycle: "one_time",
  duration_value: 6,
  duration_unit: "month",
  amount: 39,
  currency: "USD",
  is_subscription: false,
  is_enabled: true,
  display_name: "",
  description: "",
};

export function AdminProductFormDialog({
  open,
  onOpenChange,
  providerId,
  editing,
  onSaved,
}: Props) {
  const upsert = useUpsertProduct();
  const serverError = upsert.error instanceof AdminApiError ? upsert.error : null;

  const form = useForm<ProviderProductFormValues>({
    resolver: zodResolver(providerProductSchema),
    defaultValues: { ...DEFAULTS, provider_id: providerId },
    mode: "onBlur",
  });

  // Reset form when dialog opens or the editing product changes
  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.reset({
        id: editing.id,
        provider_id: editing.provider_id,
        provider_product_id: editing.provider_product_id,
        provider_offer_id: editing.provider_offer_id ?? "",
        plan_key: editing.plan_key,
        billing_cycle: editing.billing_cycle,
        duration_value: editing.duration_value,
        duration_unit: editing.duration_unit,
        amount: editing.amount,
        currency: editing.currency,
        is_subscription: editing.is_subscription,
        is_enabled: editing.is_enabled,
        display_name: editing.display_name ?? "",
        description: editing.description ?? "",
      });
    } else {
      form.reset({ ...DEFAULTS, provider_id: providerId });
    }
  }, [open, editing, providerId, form]);

  const onSubmit = async (values: ProviderProductFormValues) => {
    try {
      const result = await upsert.mutateAsync(values);
      toast.success(editing ? "Product updated" : "Product created");
      onSaved?.(result.product as { id: string });
      onOpenChange(false);
    } catch {
      // Error is rendered via serverError; nothing to do here.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit product mapping" : "Add product mapping"}</DialogTitle>
          <DialogDescription>
            Map a {providerId} product to a RobinOS plan. Duration controls how long the plan
            access lasts after a successful purchase.
          </DialogDescription>
        </DialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>
              {serverError.code === "DUPLICATE_PRODUCT_MAPPING"
                ? "Duplicate product mapping"
                : "Could not save product"}
            </AlertTitle>
            <AlertDescription>
              {serverError.code === "DUPLICATE_PRODUCT_MAPPING"
                ? "Another product already uses this (Provider, Product ID, Offer ID) combination. Edit the existing mapping instead."
                : serverError.message}
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Display name */}
              <FormField
                control={form.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 6-month Creator Plan" {...field} />
                    </FormControl>
                    <FormDescription>Optional. Shown in admin lists.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Plan key */}
              <FormField
                control={form.control}
                name="plan_key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RobinOS plan</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a plan" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PLAN_KEYS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {PLAN_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Provider Product ID */}
              <FormField
                control={form.control}
                name="provider_product_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product ID *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. wp_1234abcd" {...field} />
                    </FormControl>
                    <FormDescription>The ID from the provider dashboard.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Provider Offer ID */}
              <FormField
                control={form.control}
                name="provider_offer_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Offer / Variant ID</FormLabel>
                    <FormControl>
                      <Input placeholder="(optional)" {...field} />
                    </FormControl>
                    <FormDescription>Leave empty if the provider has no offers.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Billing cycle */}
              <FormField
                control={form.control}
                name="billing_cycle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billing type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose billing type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BILLING_CYCLES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {BILLING_CYCLE_LABELS[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Duration value */}
              <FormField
                control={form.control}
                name="duration_value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration value *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>Numeric quantity (must be &gt; 0).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Duration unit */}
              <FormField
                control={form.control}
                name="duration_unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration unit *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose unit" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DURATION_UNITS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {DURATION_UNIT_LABELS[u]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Amount */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Currency */}
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency *</FormLabel>
                    <Select onValueChange={(v) => field.onChange(v.toUpperCase())} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>3-letter ISO 4217 code.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Is subscription */}
              <FormField
                control={form.control}
                name="is_subscription"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Recurring subscription</FormLabel>
                      <FormDescription>
                        Turn on for subscriptions; off for one-time purchases.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Is enabled */}
              <FormField
                control={form.control}
                name="is_enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Active</FormLabel>
                      <FormDescription>
                        Inactive mappings won't grant access on new purchases.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Internal notes (not shown to buyers)"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={upsert.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={upsert.isPending}>
                {upsert.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create mapping"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
