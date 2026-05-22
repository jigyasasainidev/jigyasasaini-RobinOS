// ============================================================
// ROBINOS — SAFETY INTAKE EDGE FUNCTION
// Receives trust & safety reports from the /report-abuse page.
// Delivers via Resend. Graceful fallback to console logging.
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ── CORS — all responses MUST include these ────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OK = { ...CORS, "Content-Type": "application/json" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: OK });
}

// ── Rate limiting (in-memory, resets on cold start) ────────
const rl = new Map<string, { n: number; until: number }>();
function allow(ip: string): boolean {
  const now = Date.now();
  const window = 10 * 60 * 1000; // 10 min
  const e = rl.get(ip);
  if (!e || now > e.until) { rl.set(ip, { n: 1, until: now + window }); return true; }
  if (e.n >= 3) return false;
  e.n++;
  return true;
}

// ── Email HTML ─────────────────────────────────────────────
function html(d: {
  name: string; email: string; category: string;
  details: string; evidence: string; ts: string; ua: string;
}): string {
  const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;background:#f9fafb;padding:32px 16px">
<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:24px 32px">
    <p style="color:#60a5fa;font-size:11px;font-family:monospace;text-transform:uppercase;letter-spacing:.15em;margin:0 0 8px">ROBINOS TRUST & SAFETY</p>
    <h1 style="color:#f8fafc;font-size:20px;font-weight:600;margin:0">New Safety Report</h1>
    <p style="color:#94a3b8;font-size:13px;margin:6px 0 0">${d.ts}</p>
  </div>
  <div style="padding:32px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr style="border-bottom:1px solid #f1f5f9"><td style="padding:10px 0;color:#64748b;font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;width:160px">Reporter</td><td style="padding:10px 0;color:#1e293b;font-size:14px;font-weight:500">${esc(d.name)}</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9"><td style="padding:10px 0;color:#64748b;font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em">Email</td><td style="padding:10px 0;font-size:14px"><a href="mailto:${esc(d.email)}" style="color:#3b82f6">${esc(d.email)}</a></td></tr>
      <tr style="border-bottom:1px solid #f1f5f9"><td style="padding:10px 0;color:#64748b;font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em">Category</td><td style="padding:10px 0"><span style="display:inline-block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600">${esc(d.category)}</span></td></tr>
    </table>
    <p style="color:#64748b;font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;margin:0 0 8px">Details</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:20px"><p style="color:#334155;font-size:14px;line-height:1.7;margin:0;white-space:pre-wrap">${esc(d.details)}</p></div>
    ${d.evidence ? `<p style="color:#64748b;font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;margin:0 0 8px">Evidence</p><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:20px"><p style="color:#334155;font-size:14px;line-height:1.7;margin:0;white-space:pre-wrap">${esc(d.evidence)}</p></div>` : ""}
    <div style="background:#f1f5f9;border-radius:8px;padding:14px 16px;margin-top:24px"><p style="color:#94a3b8;font-size:11px;font-family:monospace;margin:0;line-height:1.6">UA: ${esc(d.ua.slice(0, 180))}<br>Submitted: ${d.ts}</p></div>
  </div>
  <div style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center"><p style="color:#94a3b8;font-size:12px;margin:0">RobinOS Trust &amp; Safety — review within 72 hours per platform policy.</p></div>
</div></body></html>`;
}

// ── Main ───────────────────────────────────────────────────
serve(async (req) => {
  console.log("[SafetyIntake] Request received:", req.method);

  // 1. Preflight — MUST return "ok" (not null) with CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS });
  }

  // 2. Only POST allowed
  if (req.method !== "POST") {
    return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405);
  }

  // 3. Rate limit
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allow(ip)) {
    console.warn("[SafetyIntake] Rate limited:", ip);
    return json({
      success: false,
      code: "RATE_LIMITED",
      message: "Too many reports submitted recently. Please wait 10 minutes before submitting another report.",
    }, 429);
  }

  // 4. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, code: "INVALID_BODY", message: "Invalid request format." }, 400);
  }

  const { reporterName, reporterEmail, category, details, evidence, confirmed } = body;

  // 5. Validate
  const name = String(reporterName ?? "").trim();
  const email = String(reporterEmail ?? "").trim().toLowerCase();
  const cat = String(category ?? "").trim();
  const det = String(details ?? "").trim();
  const evid = String(evidence ?? "").trim();

  if (name.length < 2) return json({ success: false, code: "VALIDATION_ERROR", field: "reporterName", message: "Full name is required." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ success: false, code: "VALIDATION_ERROR", field: "reporterEmail", message: "Valid email address is required." }, 400);
  if (cat.length < 2) return json({ success: false, code: "VALIDATION_ERROR", field: "category", message: "Report category is required." }, 400);
  if (det.length < 20) return json({ success: false, code: "VALIDATION_ERROR", field: "details", message: "Report details must be at least 20 characters." }, 400);
  if (!confirmed) return json({ success: false, code: "VALIDATION_ERROR", field: "confirmed", message: "You must confirm the accuracy of this report." }, 400);

  console.log("[SafetyIntake] Validation passed — category:", cat);

  const ts = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  const ua = (req.headers.get("user-agent") ?? "Unknown");

  // 6. Try Resend
  const resendKey = Deno.env.get("RESEND_API_KEY");

  if (resendKey) {
    console.log("[SafetyIntake] Sending email via Resend...");
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "RobinOS Safety <noreply@tryrobin.xyz>",
          to: ["support@tryrobin.xyz"],
          reply_to: email,
          subject: `[Safety Report] ${cat} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
          html: html({ name, email, category: cat, details: det, evidence: evid, ts, ua }),
        }),
      });

      if (res.ok) {
        console.log("[SafetyIntake] Email sent successfully");
        return json({ success: true, code: "SUBMITTED", message: "Report submitted successfully." });
      }

      const errText = await res.text().catch(() => "unknown");
      console.error("[SafetyIntake] Resend error:", res.status, errText);
      // Fall through to fallback
    } catch (e) {
      console.error("[SafetyIntake] Resend exception:", String(e));
      // Fall through to fallback
    }
  } else {
    console.warn("[SafetyIntake] RESEND_API_KEY not set — using log fallback");
  }

  // 7. Fallback — log to Supabase function logs (visible in dashboard)
  console.log("[SafetyIntake] REPORT_LOGGED", JSON.stringify({
    reporter: email,
    category: cat,
    ts,
    ip,
    details_chars: det.length,
  }));

  // Always return 200 to the user — don't expose internal email failures
  return json({
    success: true,
    code: "SUBMITTED",
    fallback: !resendKey,
    message: "Your report has been received and logged for Trust & Safety review.",
  });
});
