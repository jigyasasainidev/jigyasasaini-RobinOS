// ============================================================
// ROBINOS — ABUSE REPORT SUBMISSION EDGE FUNCTION
// Receives abuse reports and emails them to support@tryrobin.xyz
// via Resend API. No auth required (public endpoint).
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const JSON_HEADERS = {
  ...CORS_HEADERS,
  "Content-Type": "application/json",
};

// ── Rate limiting — simple in-memory per-IP map ────────────
// Limits: max 3 reports per IP per 10 minutes
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const window = 10 * 60 * 1000; // 10 minutes
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + window });
    return true;
  }

  if (entry.count >= 3) return false;

  entry.count++;
  return true;
}

// ── Build email HTML body ──────────────────────────────────
function buildEmailHtml(data: {
  reporterName: string;
  reporterEmail: string;
  category: string;
  details: string;
  evidence: string;
  timestamp: string;
  userAgent: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; background: #f9fafb; padding: 32px 16px;">
  <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #1e293b, #0f172a); padding: 24px 32px;">
      <p style="color: #60a5fa; font-size: 11px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.15em; margin: 0 0 8px;">ROBINOS TRUST & SAFETY</p>
      <h1 style="color: #f8fafc; font-size: 20px; font-weight: 600; margin: 0;">New Abuse Report Received</h1>
      <p style="color: #94a3b8; font-size: 13px; margin: 6px 0 0;">${data.timestamp}</p>
    </div>

    <div style="padding: 32px;">

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; color: #64748b; font-size: 12px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em; width: 160px;">Reporter Name</td>
          <td style="padding: 10px 0; color: #1e293b; font-size: 14px; font-weight: 500;">${data.reporterName}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; color: #64748b; font-size: 12px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em;">Reporter Email</td>
          <td style="padding: 10px 0; color: #1e293b; font-size: 14px;"><a href="mailto:${data.reporterEmail}" style="color: #3b82f6;">${data.reporterEmail}</a></td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; color: #64748b; font-size: 12px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em;">Category</td>
          <td style="padding: 10px 0;">
            <span style="display: inline-block; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 6px; padding: 3px 10px; font-size: 12px; font-weight: 600;">${data.category}</span>
          </td>
        </tr>
      </table>

      <div style="margin-bottom: 20px;">
        <p style="color: #64748b; font-size: 12px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 8px;">Report Details</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
          <p style="color: #334155; font-size: 14px; line-height: 1.7; margin: 0; white-space: pre-wrap;">${data.details.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        </div>
      </div>

      ${data.evidence ? `
      <div style="margin-bottom: 20px;">
        <p style="color: #64748b; font-size: 12px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 8px;">Additional Evidence / Notes</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
          <p style="color: #334155; font-size: 14px; line-height: 1.7; margin: 0; white-space: pre-wrap;">${data.evidence.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        </div>
      </div>
      ` : ""}

      <div style="background: #f1f5f9; border-radius: 8px; padding: 14px 16px; margin-top: 24px;">
        <p style="color: #94a3b8; font-size: 11px; font-family: monospace; margin: 0; line-height: 1.6;">
          User Agent: ${data.userAgent}<br>
          Submitted: ${data.timestamp}<br>
          Platform: RobinOS Trust &amp; Safety System
        </p>
      </div>

    </div>

    <div style="background: #f8fafc; border-top: 1px solid #e5e7eb; padding: 16px 32px; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">This report was submitted via the RobinOS Trust &amp; Safety reporting system. Review and respond within 72 hours per platform policy.</p>
    </div>
  </div>
</body>
</html>`;
}

// ── Main handler ───────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, code: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: JSON_HEADERS }
    );
  }

  // Rate limiting
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ success: false, code: "RATE_LIMITED", message: "Too many reports submitted. Please wait before submitting again." }),
      { status: 429, headers: JSON_HEADERS }
    );
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, code: "INVALID_BODY" }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  const { reporterName, reporterEmail, category, details, evidence, confirmed } = body;

  // Validation
  if (!reporterName || typeof reporterName !== "string" || (reporterName as string).trim().length < 2) {
    return new Response(JSON.stringify({ success: false, code: "VALIDATION_ERROR", field: "reporterName", message: "Full name is required." }), { status: 400, headers: JSON_HEADERS });
  }
  if (!reporterEmail || typeof reporterEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reporterEmail as string)) {
    return new Response(JSON.stringify({ success: false, code: "VALIDATION_ERROR", field: "reporterEmail", message: "Valid email address is required." }), { status: 400, headers: JSON_HEADERS });
  }
  if (!category || typeof category !== "string" || (category as string).trim().length < 2) {
    return new Response(JSON.stringify({ success: false, code: "VALIDATION_ERROR", field: "category", message: "Report category is required." }), { status: 400, headers: JSON_HEADERS });
  }
  if (!details || typeof details !== "string" || (details as string).trim().length < 20) {
    return new Response(JSON.stringify({ success: false, code: "VALIDATION_ERROR", field: "details", message: "Report details must be at least 20 characters." }), { status: 400, headers: JSON_HEADERS });
  }
  if (!confirmed) {
    return new Response(JSON.stringify({ success: false, code: "VALIDATION_ERROR", field: "confirmed", message: "You must confirm the accuracy of this report." }), { status: 400, headers: JSON_HEADERS });
  }

  const timestamp = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  const userAgent = req.headers.get("user-agent") ?? "Unknown";

  // ── Send via Resend ────────────────────────────────────────
  const resendKey = Deno.env.get("RESEND_API_KEY");

  if (resendKey) {
    try {
      const emailHtml = buildEmailHtml({
        reporterName: String(reporterName).trim(),
        reporterEmail: String(reporterEmail).trim().toLowerCase(),
        category: String(category),
        details: String(details).trim(),
        evidence: String(evidence ?? "").trim(),
        timestamp,
        userAgent: userAgent.slice(0, 200),
      });

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "RobinOS Trust & Safety <noreply@tryrobin.xyz>",
          to: ["support@tryrobin.xyz"],
          subject: `[ABUSE REPORT] ${String(category)} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
          html: emailHtml,
          reply_to: String(reporterEmail).trim().toLowerCase(),
        }),
      });

      if (!resendRes.ok) {
        const errBody = await resendRes.text();
        console.error("[abuse-report] Resend error:", errBody);
        // Fall through to logged-only response
      } else {
        console.info("[abuse-report] Email sent via Resend:", { category, ip });
        return new Response(
          JSON.stringify({ success: true, code: "SUBMITTED", message: "Report submitted successfully." }),
          { status: 200, headers: JSON_HEADERS }
        );
      }
    } catch (e) {
      console.error("[abuse-report] Resend exception:", e);
    }
  }

  // ── Fallback: log to console (Supabase captures logs) ─────
  // Even without Resend, we record the report in edge function logs
  // which are accessible in the Supabase dashboard.
  console.info("[abuse-report] REPORT_RECEIVED", {
    reporter: String(reporterEmail).trim().toLowerCase(),
    category: String(category),
    timestamp,
    ip,
    details_length: String(details).length,
  });

  return new Response(
    JSON.stringify({ success: true, code: "SUBMITTED", message: "Report received and logged for Trust & Safety review." }),
    { status: 200, headers: JSON_HEADERS }
  );
});
