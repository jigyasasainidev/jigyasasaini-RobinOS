import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com","guerrillamail.com","tempmail.com","throwaway.email","yopmail.com",
  "sharklasers.com","guerrillamailblock.com","grr.la","guerrillamail.info","guerrillamail.biz",
  "guerrillamail.de","guerrillamail.net","guerrillamail.org","temp-mail.org","fakeinbox.com",
  "tempail.com","dispostable.com","trashmail.com","trashmail.me","trashmail.net",
  "mailnesia.com","maildrop.cc","discard.email","discardmail.com","discardmail.de",
  "mailcatch.com","meltmail.com","harakirimail.com","mintemail.com","tempr.email",
  "throwam.com","mytemp.email","tempinbox.com","getnada.com","burnermail.io",
  "mailsac.com","10minutemail.com","10minutemail.net","mohmal.com","emailondeck.com",
  "crazymailing.com","tmail.ws","tempmailo.com","tempmailaddress.com","tmpmail.net",
  "tmpmail.org","emailfake.com","generator.email","inboxbear.com","mailforspam.com",
  "spam4.me","spamgourmet.com","trashmail.io","wegwerfmail.de","wegwerfmail.net",
  "binkmail.com","bobmail.info","chammy.info","devnullmail.com","dingbone.com",
  "fakedemail.com","filzmail.com","haltospam.com","jetable.org","mailexpire.com",
  "mailmoat.com","mailnull.com","mailshell.com","mailzilla.com","nomail.xl.cx",
  "nospam.ze.tc","owlpic.com","proxymail.eu","rcpt.at","reallymymail.com",
  "recode.me","regbypass.com","safetymail.info","spambox.us","spamcero.com",
  "spamex.com","spamfree24.org","spamhole.com","spaml.com","uggsrock.com",
  "veryrealemail.com","viditag.com","whyspam.me","wuzup.net","wuzupmail.net",
  "zoemail.org","getairmail.com","mailimate.com","spamdecoy.net","spamstack.net",
  "tempsky.com","trashinbox.com","trashymail.com","turual.com","vomoto.com",
  "zetmail.com","33mail.com","maildax.com","mailnator.com","mailtemp.info",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, user_id } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check disposable email
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || DISPOSABLE_DOMAINS.has(domain)) {
      return new Response(JSON.stringify({ error: "Disposable or invalid email addresses are not allowed. Please use a real email." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get client IP
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") ||
               "unknown";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check IP count
    if (ip !== "unknown") {
      const { count, error } = await supabase
        .from("signup_ips")
        .select("*", { count: "exact", head: true })
        .eq("ip_address", ip);

      if (!error && (count ?? 0) >= 2) {
        return new Response(JSON.stringify({ error: "Maximum accounts reached for this network. Only 2 accounts allowed per IP." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Record IP if user_id provided (called after successful signup)
    if (user_id && ip !== "unknown") {
      await supabase.from("signup_ips").insert({ ip_address: ip, user_id });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("check-signup error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
