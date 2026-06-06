import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Shield, ShieldCheck, AlertTriangle, CheckCircle2,
  Loader2, ChevronDown, Flag,
} from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { PageSeo } from "@/components/seo/PageSeo";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

// ── Schema ────────────────────────────────────────────────

const schema = z.object({
  reporterName:  z.string().trim().min(2, "Full name is required").max(100),
  reporterEmail: z.string().trim().email("Enter a valid email address").max(255),
  category:      z.string().min(1, "Select a report category"),
  details:       z.string().trim().min(20, "Please provide at least 20 characters of detail").max(3000, "Details must be under 3000 characters"),
  evidence:      z.string().trim().max(1500, "Evidence notes must be under 1500 characters").optional(),
  confirmed:     z.boolean().refine((v) => v === true, { message: "You must confirm the accuracy of this report" }),
});

type FormData = z.infer<typeof schema>;

const CATEGORIES = [
  "Harmful AI Content",
  "NSFW Content",
  "Violence / Hate Speech",
  "Scam / Fraud",
  "Impersonation",
  "Deepfake Abuse",
  "Copyright Violation",
  "Harassment",
  "Child Safety Concern",
  "Platform Abuse",
  "Other",
];

// ── Field wrapper ─────────────────────────────────────────

function Field({ label, error, required, children }: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10.5px] font-mono uppercase tracking-[0.14em] text-muted-foreground/60">
        {label} {required && <span className="text-primary/60">*</span>}
      </label>
      {children}
      {error && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[11px] text-red-400/80 flex items-center gap-1.5"
        >
          <AlertTriangle className="w-3 h-3 shrink-0" />
          {error}
        </motion.p>
      )}
    </div>
  );
}

// ── Premium input styles ──────────────────────────────────

const inputStyle = {
  background: "hsl(222 28% 6.5%)",
  border: "1px solid hsl(217 28% 14%)",
  borderRadius: "10px",
  color: "hsl(var(--foreground) / 0.85)",
};

const inputFocusClass =
  "bg-transparent h-11 text-sm rounded-xl focus:ring-1 focus:ring-primary/30 focus:border-primary/30 transition-colors placeholder:text-muted-foreground/25";

// ── Main page ─────────────────────────────────────────────

export function ReportAbusePage() {
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
    setValue,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      reporterName: "",
      reporterEmail: "",
      category: "",
      details: "",
      evidence: "",
      confirmed: false,
    },
  });

  const detailsLength = watch("details")?.length ?? 0;
  const selectedCategory = watch("category");
  const confirmed = watch("confirmed");

  const onSubmit = handleSubmit(async (data) => {
    setSubmitState("sending");
    setServerError("");

    // Helper: attempt one invocation, return { ok, code, message }
    const attempt = async () => {
      try {
        const { data: resData, error } = await supabase.functions.invoke("safety-intake", {
          body: {
            reporterName:  data.reporterName,
            reporterEmail: data.reporterEmail,
            category:      data.category,
            details:       data.details,
            evidence:      data.evidence ?? "",
            confirmed:     data.confirmed,
          },
        });

        if (error) {
          // Parse structured error from edge function
          let code = "UNKNOWN";
          let message = "";
          try {
            const raw = (error as any)?.context?.responseText ?? (error as any)?.message ?? "";
            const parsed = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : {};
            code = parsed.code ?? code;
            message = parsed.message ?? "";
          } catch { /* keep defaults */ }
          return { ok: false, code, message };
        }

        return { ok: true, code: "SUBMITTED", message: "" };
      } catch (e: unknown) {
        // Network-level error (ERR_FAILED, timeout, ad blocker, etc.)
        const isNetworkErr =
          e instanceof TypeError ||
          String(e).includes("Failed to fetch") ||
          String(e).includes("NetworkError");
        return {
          ok: false,
          code: isNetworkErr ? "NETWORK_ERROR" : "UNKNOWN",
          message: "",
        };
      }
    };

    let result = await attempt();

    // Single automatic retry on transient network errors
    if (!result.ok && result.code === "NETWORK_ERROR") {
      await new Promise((r) => setTimeout(r, 1500));
      result = await attempt();
    }

    if (!result.ok) {
      const msgMap: Record<string, string> = {
        RATE_LIMITED:
          "Too many reports submitted recently. Please wait 10 minutes before submitting again.",
        NETWORK_ERROR:
          "Unable to connect to the reporting service. Please check your connection and try again, or email support@tryrobin.xyz directly.",
        VALIDATION_ERROR: result.message || "Please check your form entries.",
        METHOD_NOT_ALLOWED: "Unexpected request error. Please refresh and try again.",
      };
      setServerError(
        msgMap[result.code] ??
        result.message ??
        "Submission failed. Please try again or email support@tryrobin.xyz directly."
      );
      setSubmitState("error");
      return;
    }

    setSubmitState("success");
    reset();
  });

  return (
    <PublicLayout>
      <PageSeo
        title="Report Abuse — RobinOS Trust & Safety"
        description="Submit an abuse or safety concern to the RobinOS Trust & Safety team. We review all reports and take appropriate action."
        canonicalPath="/report-abuse"
      />

      <div className="relative mx-auto w-full max-w-[840px] px-4 pb-20 pt-14 sm:px-6 sm:pt-20">
        {/* Ambient */}
        <div className="pointer-events-none absolute left-0 right-0 top-6 h-40 select-none bg-[radial-gradient(circle_at_50%_0%,hsl(217_91%_60%/0.08),transparent_65%)]" />

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative mb-8 text-center"
        >
          <div
            className="mx-auto mb-5 w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{
              background: "hsl(217 91% 60% / 0.08)",
              border: "1px solid hsl(217 91% 60% / 0.18)",
              boxShadow: "0 0 24px hsl(217 91% 60% / 0.06)",
            }}
          >
            <Flag className="w-5 h-5 text-primary/70" />
          </div>
          <p className="text-[9px] font-mono uppercase tracking-[0.28em] text-primary/55 mb-2">
            Trust & Safety
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground/90 mb-3">
            Report Abuse
          </h1>
          <p className="text-sm text-muted-foreground/65 leading-relaxed max-w-lg mx-auto">
            RobinOS investigates platform abuse, harmful AI generation, impersonation, and safety violations through our Trust & Safety review process. All submitted reports are reviewed in accordance with our platform safety policies.
          </p>
        </motion.div>

        {/* Main card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="relative rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(155deg, hsl(222 28% 8.5% / 0.97) 0%, hsl(222 22% 7% / 0.97) 100%)",
            border: "1px solid hsl(217 28% 13%)",
            boxShadow: "0 12px 48px hsl(0 0% 0% / 0.32), inset 0 1px 0 hsl(0 0% 100% / 0.035)",
          }}
        >
          {/* Top edge shimmer */}
          <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent, hsl(217 91% 60% / 0.2) 40%, hsl(217 91% 60% / 0.2) 60%, transparent)" }} />

          <AnimatePresence mode="wait">

            {/* ── SUCCESS STATE ── */}
            {submitState === "success" ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="p-8 sm:p-12 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
                  className="mx-auto mb-6 w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{
                    background: "hsl(142 70% 45% / 0.1)",
                    border: "1px solid hsl(142 70% 45% / 0.25)",
                    boxShadow: "0 0 32px hsl(142 70% 45% / 0.08)",
                  }}
                >
                  <CheckCircle2 className="w-7 h-7" style={{ color: "hsl(142 70% 55%)" }} />
                </motion.div>
                <h2 className="text-xl font-bold text-foreground/90 mb-3">Report Submitted</h2>
                <p className="text-sm text-muted-foreground/65 leading-relaxed max-w-md mx-auto mb-2">
                  Your report has been submitted successfully. Our Trust & Safety team reviews all reports carefully and takes appropriate action.
                </p>
                <p className="text-[11px] font-mono text-muted-foreground/35 mb-8">
                  Expected review: within 72 business hours
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Link
                    to="/trust-safety"
                    className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-medium text-primary transition-all hover:opacity-90"
                    style={{ background: "hsl(217 91% 60% / 0.08)", border: "1px solid hsl(217 91% 60% / 0.18)" }}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Trust & Safety Center
                  </Link>
                  <button
                    onClick={() => setSubmitState("idle")}
                    className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-medium text-muted-foreground transition-all hover:text-foreground"
                    style={{ border: "1px solid hsl(217 28% 14%)" }}
                  >
                    Submit Another Report
                  </button>
                </div>
              </motion.div>
            ) : (

              /* ── FORM STATE ── */
              <motion.form
                key="form"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onSubmit={onSubmit}
                className="p-6 sm:p-8 space-y-6"
                noValidate
              >
                {/* Reporter info */}
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/35 mb-4">
                    Your Information
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Full Name" required error={errors.reporterName?.message}>
                      <Input
                        {...register("reporterName")}
                        placeholder="Your full name"
                        className={inputFocusClass}
                        style={inputStyle}
                        disabled={isSubmitting}
                        autoComplete="name"
                      />
                    </Field>
                    <Field label="Email Address" required error={errors.reporterEmail?.message}>
                      <Input
                        {...register("reporterEmail")}
                        type="email"
                        placeholder="you@example.com"
                        className={inputFocusClass}
                        style={inputStyle}
                        disabled={isSubmitting}
                        autoComplete="email"
                      />
                    </Field>
                  </div>
                </div>

                {/* Separator */}
                <div className="h-px" style={{ background: "hsl(217 28% 11%)" }} />

                {/* Report category */}
                <Field label="Report Category" required error={errors.category?.message}>
                  <div className="relative">
                    <select
                      {...register("category")}
                      className="w-full h-11 rounded-xl text-sm appearance-none pl-4 pr-10 transition-colors focus:outline-none focus:ring-1 focus:ring-primary/30"
                      style={{
                        ...inputStyle,
                        color: selectedCategory ? "hsl(var(--foreground) / 0.85)" : "hsl(var(--muted-foreground) / 0.25)",
                      }}
                      disabled={isSubmitting}
                    >
                      <option value="" disabled>Select a category</option>
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/35" />
                  </div>
                </Field>

                {/* Report details */}
                <Field label="Describe the Concern" required error={errors.details?.message}>
                  <div className="relative">
                    <Textarea
                      {...register("details")}
                      placeholder="Please describe the issue in detail. Include what happened, when it occurred, and any relevant context that helps our team investigate."
                      rows={6}
                      className="w-full text-sm rounded-xl resize-y focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/22 transition-colors"
                      style={{
                        ...inputStyle,
                        minHeight: "140px",
                      }}
                      disabled={isSubmitting}
                    />
                    <div
                      className="absolute bottom-2.5 right-3 text-[9px] font-mono"
                      style={{ color: detailsLength > 2700 ? "hsl(38 92% 55%)" : "hsl(var(--muted-foreground) / 0.2)" }}
                    >
                      {detailsLength}/3000
                    </div>
                  </div>
                </Field>

                {/* Evidence */}
                <Field label="Evidence / Additional Notes" error={errors.evidence?.message}>
                  <Textarea
                    {...register("evidence")}
                    placeholder="Optional: URLs, screenshots descriptions, usernames, or any additional evidence supporting your report."
                    rows={3}
                    className="w-full text-sm rounded-xl resize-y focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/22 transition-colors"
                    style={{ ...inputStyle, minHeight: "88px" }}
                    disabled={isSubmitting}
                  />
                </Field>

                {/* Confirmation checkbox */}
                <div>
                  <label
                    className="flex items-start gap-3 cursor-pointer group"
                    style={{ opacity: isSubmitting ? 0.6 : 1 }}
                  >
                    <div className="relative mt-0.5 flex-shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only"
                        {...register("confirmed")}
                        disabled={isSubmitting}
                        onChange={(e) => setValue("confirmed", e.target.checked, { shouldValidate: true })}
                      />
                      <div
                        className="w-5 h-5 rounded-md flex items-center justify-center transition-all"
                        style={{
                          background: confirmed ? "hsl(217 91% 60% / 0.15)" : "hsl(222 28% 6.5%)",
                          border: `1px solid ${confirmed ? "hsl(217 91% 60% / 0.4)" : "hsl(217 28% 16%)"}`,
                        }}
                      >
                        {confirmed && <CheckCircle2 className="w-3 h-3 text-primary/80" />}
                      </div>
                    </div>
                    <span className="text-sm text-muted-foreground/65 leading-relaxed select-none">
                      I confirm this report is accurate to the best of my knowledge. I understand that submitting false reports may result in account action.
                    </span>
                  </label>
                  {errors.confirmed && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-1.5 ml-8 text-[11px] text-red-400/80 flex items-center gap-1.5"
                    >
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {errors.confirmed.message}
                    </motion.p>
                  )}
                </div>

                {/* Server error */}
                {submitState === "error" && serverError && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl px-4 py-3 flex items-start gap-3"
                    style={{ background: "hsl(0 72% 55% / 0.07)", border: "1px solid hsl(0 72% 55% / 0.18)" }}
                  >
                    <AlertTriangle className="w-4 h-4 text-red-400/70 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-400/80">{serverError}</p>
                  </motion.div>
                )}

                {/* Submit button */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2">
                  <motion.button
                    type="submit"
                    disabled={isSubmitting}
                    whileHover={!isSubmitting ? { y: -1 } : {}}
                    whileTap={!isSubmitting ? { scale: 0.98 } : {}}
                    className="inline-flex items-center gap-2.5 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all disabled:opacity-55 disabled:cursor-not-allowed"
                    style={{
                      background: "linear-gradient(135deg, hsl(217 91% 52%), hsl(217 78% 44%))",
                      boxShadow: isSubmitting ? "none" : "0 4px 16px hsl(217 91% 60% / 0.2), inset 0 1px 0 hsl(0 0% 100% / 0.1)",
                    }}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Submitting Report...
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        Submit Report
                      </>
                    )}
                  </motion.button>

                  <p className="text-[10.5px] text-muted-foreground/35 leading-relaxed max-w-xs">
                    All submitted reports are reviewed in accordance with our{" "}
                    <Link to="/trust-safety" className="text-primary/50 hover:text-primary/80 transition-colors underline underline-offset-2">
                      platform safety policies
                    </Link>.
                  </p>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Footer info strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-6 grid gap-3 sm:grid-cols-3 text-center"
        >
          {[
            { icon: Shield, label: "Reviewed within 72h", sub: "Business hours response target" },
            { icon: ShieldCheck, label: "Anonymous reporting", sub: "Identity kept confidential" },
            { icon: CheckCircle2, label: "All reports acted on", sub: "Zero-tolerance for serious violations" },
          ].map(({ icon: Icon, label, sub }) => (
            <div
              key={label}
              className="rounded-xl p-4"
              style={{ background: "hsl(222 28% 7% / 0.6)", border: "1px solid hsl(217 28% 11%)" }}
            >
              <Icon className="w-4 h-4 mx-auto mb-2 text-primary/40" />
              <p className="text-[11.5px] font-medium text-foreground/60">{label}</p>
              <p className="text-[10px] text-muted-foreground/35 mt-0.5">{sub}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </PublicLayout>
  );
}

export default ReportAbusePage;
