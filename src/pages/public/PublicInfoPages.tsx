import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { CheckCircle2, Clock3, Search, ShieldCheck, Activity, Database, CreditCard, Users, Bot, LifeBuoy, KeyRound, Workflow, Webhook, Package, Gauge, Sparkles } from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { PageSeo } from "@/components/seo/PageSeo";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

function PublicPageShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <PublicLayout>
      <section className="mx-auto w-full max-w-[1120px] px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <div className="rounded-lg border border-border/60 bg-card/40 p-6 backdrop-blur-md sm:p-8">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">{subtitle}</p>
        </div>
        <div className="mt-6">{children}</div>
      </section>
    </PublicLayout>
  );
}

function LegalPage({
  seoTitle,
  seoDescription,
  canonical,
  pageTitle,
  effectiveDate,
  sections,
}: {
  seoTitle: string;
  seoDescription: string;
  canonical: string;
  pageTitle: string;
  effectiveDate: string;
  sections: { id: string; title: string; body: string[] }[];
}) {
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

  const renderParagraph = (paragraph: string) => {
    const chunks = paragraph.split(emailRegex);

    return chunks.map((chunk, index) => {
      if (chunk.match(emailRegex)) {
        return (
          <a key={`${chunk}-${index}`} href={`mailto:${chunk}`} className="select-text text-foreground underline underline-offset-4">
            {chunk}
          </a>
        );
      }

      return <span key={`${chunk}-${index}`}>{chunk}</span>;
    });
  };

  return (
    <PublicLayout>
      <PageSeo title={seoTitle} description={seoDescription} canonicalPath={canonical} />
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative mx-auto grid w-full max-w-[1240px] gap-6 px-4 pb-16 pt-14 sm:px-6 sm:pb-20 lg:grid-cols-[260px_1fr] lg:pt-20"
      >
        <div className="pointer-events-none absolute left-0 right-0 top-6 h-40 select-none bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.12),transparent_70%)]" />

        <motion.aside
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: "easeOut", delay: 0.05 }}
          className="relative h-fit select-none rounded-lg border border-border/60 bg-card/40 p-4 backdrop-blur-md lg:sticky lg:top-24"
        >
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">On this page</p>
          <div className="mt-3 h-px bg-gradient-to-r from-primary/40 via-border/70 to-transparent" />
          <ul className="mt-3 space-y-2.5">
            {sections.map((section, index) => (
              <motion.li key={section.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.1 + index * 0.04 }}>
                <a href={`#${section.id}`} className="block text-sm text-muted-foreground transition-colors hover:text-foreground">
                  {section.title}
                </a>
              </motion.li>
            ))}
          </ul>
        </motion.aside>

        <main className="relative overflow-hidden rounded-lg border border-border/60 bg-card/40 p-6 backdrop-blur-md sm:p-8 lg:p-9">
          <div className="pointer-events-none absolute -right-20 top-14 h-52 w-52 select-none rounded-full bg-primary/18 blur-3xl" />
          <div className="pointer-events-none absolute -left-16 bottom-10 h-44 w-44 select-none rounded-full bg-accent/14 blur-3xl" />

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.12 }} className="relative">
            <p className="select-none text-[11px] uppercase tracking-[0.18em] text-foreground/80">Legal Documentation</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{pageTitle}</h1>
            <p className="mt-2 select-text text-sm text-muted-foreground">Effective date: {effectiveDate}</p>
          </motion.div>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
            className="relative mt-8 space-y-10"
          >
            {sections.map((section) => (
              <motion.section
                key={section.id}
                id={section.id}
                className="scroll-mt-28"
                variants={{ hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              >
                <motion.div initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: 0.8 }} transition={{ duration: 0.55, ease: "easeOut" }} className="pointer-events-none mb-4 h-px origin-left select-none bg-gradient-to-r from-primary/55 via-border/80 to-transparent" />
                <h2 className="select-text text-lg font-semibold text-foreground">{section.title}</h2>
                <div className="mt-3 space-y-3.5">
                  {section.body.map((paragraph) => (
                    <p key={paragraph.slice(0, 36)} className="select-text text-sm leading-relaxed text-muted-foreground sm:text-[0.95rem]">
                      {renderParagraph(paragraph)}
                    </p>
                  ))}
                </div>
              </motion.section>
            ))}
          </motion.div>
        </main>
      </motion.section>
    </PublicLayout>
  );
}

export function AboutPage() {
  return (
    <PublicPageShell
      title="About RobinOS"
      subtitle="RobinOS exists to help creators turn ideas into repeatable publishing systems with AI-assisted scripting, trend analysis, voice workflows, and content operations tooling."
    >
      <PageSeo
        title="About RobinOS | AI Content Operating System"
        description="Learn why RobinOS exists, our creator-first mission, and how we build practical AI content infrastructure for global teams."
        canonicalPath="/about"
      />
      <section className="grid gap-4 md:grid-cols-2">
        {[
          ["Mission", "Build practical AI infrastructure that helps creators produce better content faster without sacrificing editorial control."],
          ["Creator Economy Focus", "We prioritize solo creators, small studios, and lean media teams who need output quality and publishing speed."],
          ["AI Productivity Vision", "RobinOS treats AI as an operating layer: research, scripting, planning, and workflow orchestration in one place."],
          ["Remote-First Operations", "RobinOS is built by a remote team shipping globally and designing for distributed creator workflows by default."],
        ].map(([title, text]) => (
          <article key={title} className="rounded-lg border border-border/60 bg-card/35 p-5">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 rounded-lg border border-border/60 bg-card/35 p-6">
        <h2 className="text-lg font-semibold text-foreground">Why RobinOS exists</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Most creators lose momentum because ideation, trend tracking, scripting, voice production, and publishing run in disconnected tools.
          RobinOS was designed to reduce that operational overhead. Instead of adding another AI textbox, RobinOS provides an operating model
          where creators can run content like a system: brief → trend check → script → production handoff.
        </p>
      </section>

      <section className="mt-6 rounded-lg border border-border/60 bg-card/35 p-6">
        <h2 className="text-lg font-semibold text-foreground">Platform timeline</h2>
        <ol className="mt-4 space-y-4">
          {[
            "Foundation: AI scripting and trend scanning for fast publishing loops.",
            "Expansion: Voice workflow integration and structured creator operations.",
            "Current phase: Reliability, policy clarity, and payment-provider-safe compliance infrastructure.",
          ].map((item, index) => (
            <li key={item} className="flex gap-3 text-sm text-muted-foreground">
              <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/60 text-xs text-foreground">{index + 1}</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </section>
    </PublicPageShell>
  );
}

const contactSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(100, "Name is too long"),
  email: z.string().trim().email("Enter a valid email").max(255, "Email is too long"),
  topic: z.string().trim().min(2, "Please choose a topic").max(100, "Topic is too long"),
  message: z.string().trim().min(10, "Message should be at least 10 characters").max(1200, "Message is too long"),
});

type ContactInput = z.infer<typeof contactSchema>;

export function ContactPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", email: "", topic: "creator support", message: "" },
  });

  const onSubmit = form.handleSubmit(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    setSent(true);
    form.reset();
  });

  return (
    <PublicPageShell title="Contact RobinOS" subtitle="Reach the RobinOS team for creator workflows, billing, affiliates, and account support.">
      <PageSeo
        title="Contact RobinOS | Creator and Billing Support"
        description="Contact RobinOS support for account help, billing questions, affiliate support, and AI workflow guidance."
        canonicalPath="/contact"
      />

      <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-4 rounded-lg border border-border/60 bg-card/35 p-5">
          <h2 className="text-lg font-semibold text-foreground">Support channels</h2>
          <p className="text-sm text-muted-foreground">Email: <a href="mailto:support@tryrobin.xyz" className="text-foreground underline underline-offset-4">support@tryrobin.xyz</a></p>
          <p className="text-sm text-muted-foreground">Domain: <a href="https://tryrobin.xyz" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">tryrobin.xyz</a></p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Creator support: response target within 24 hours on business days.</li>
            <li>Billing support: response target within 24 hours for payment and invoicing requests.</li>
            <li>Affiliate support: response target within 48 hours for commission and payout review.</li>
          </ul>

          <div className="rounded-md border border-border/60 bg-secondary/30 p-4">
            <h3 className="text-sm font-semibold text-foreground">FAQ</h3>
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              <li><strong className="text-foreground">How do I cancel?</strong> Cancel from your account billing section before renewal.</li>
              <li><strong className="text-foreground">How do refunds work?</strong> See the refund policy and contact support within the eligible window.</li>
              <li><strong className="text-foreground">How do affiliate payouts run?</strong> Payouts are reviewed against fraud checks and threshold rules.</li>
            </ul>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-border/60 bg-card/35 p-5">
          <h2 className="text-lg font-semibold text-foreground">Contact form</h2>

          <div>
            <Input placeholder="Your name" {...form.register("name")} />
            {form.formState.errors.name ? <p className="mt-1 text-xs text-destructive">{form.formState.errors.name.message}</p> : null}
          </div>
          <div>
            <Input type="email" placeholder="you@example.com" {...form.register("email")} />
            {form.formState.errors.email ? <p className="mt-1 text-xs text-destructive">{form.formState.errors.email.message}</p> : null}
          </div>
          <div>
            <Input placeholder="Topic (creator support, billing, affiliate)" {...form.register("topic")} />
            {form.formState.errors.topic ? <p className="mt-1 text-xs text-destructive">{form.formState.errors.topic.message}</p> : null}
          </div>
          <div>
            <Textarea rows={6} placeholder="How can we help?" {...form.register("message")} />
            {form.formState.errors.message ? <p className="mt-1 text-xs text-destructive">{form.formState.errors.message.message}</p> : null}
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Sending..." : "Send message"}</Button>
            {sent ? <p className="text-xs text-primary">Message sent. Team will reply on email.</p> : null}
          </div>
        </form>
      </section>
    </PublicPageShell>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalPage
      seoTitle="Privacy Policy | RobinOS"
      seoDescription="Read how RobinOS collects, stores, processes, and protects your data — including AI prompt processing, content moderation systems, and automated safety scanning."
      canonical="/privacy"
      pageTitle="Privacy Policy"
      effectiveDate="January 1, 2025"
      sections={[
        {
          id: "data-collection",
          title: "Data We Collect",
          body: [
            "RobinOS collects account data including name, email address, authentication identifiers, and subscription plan information required to provide access to the platform and process payments.",
            "We collect usage data necessary to operate core features, including AI generation logs, workflow actions, subscription activity, feature usage metrics, and affiliate program operations where applicable.",
            "We collect technical data including IP addresses, browser user agent strings, session identifiers, and access timestamps for security, fraud prevention, and platform integrity purposes.",
          ],
        },
        {
          id: "ai-prompt-processing",
          title: "AI Prompt Processing & Content Handling",
          body: [
            "All prompts submitted to RobinOS AI generation features are processed by our AI providers (Groq) to generate the requested content. Prompts are transmitted securely over encrypted connections.",
            "RobinOS does not use user prompts to train, fine-tune, or improve AI models. Prompts are processed transiently for content generation and are not retained by our AI providers for model training purposes.",
            "Generated AI content (scripts, captions, trend reports) may be stored in your account generation history to support workflow continuity, user-controlled retrieval, and usage tracking for quota management.",
            "Users can delete their generation history at any time through account settings. Deletion requests remove stored content from active databases within 30 days.",
          ],
        },
        {
          id: "moderation-safety",
          title: "AI Moderation & Automated Safety Systems",
          body: [
            "RobinOS uses automated content moderation and safety systems to detect and prevent abusive, harmful, illegal, or policy-violating AI-generated content. These systems operate on all generation requests.",
            "Prompts and generated outputs are automatically analyzed by safety classification systems for content policy enforcement, abuse prevention, and platform security. This processing occurs before and after AI generation.",
            "RobinOS actively blocks NSFW, exploitative, hateful, violent, extremist, and illegal AI-generated content. Blocked content is not delivered to users.",
            "Moderation events — including blocked content attempts — are logged to a structured audit system. Logs include severity level, content category, and timestamp, but not the full text of blocked prompts.",
            "We reserve the right to suspend or terminate accounts that engage in prohibited content generation, repeated safety violations, or abuse of platform systems.",
            "In cases involving illegal content including CSAM (Child Sexual Abuse Material), account data may be preserved and reported to relevant law enforcement authorities as required by applicable law.",
          ],
        },
        {
          id: "fraud-prevention",
          title: "Fraud Prevention & Security Logging",
          body: [
            "RobinOS employs automated fraud detection, anomaly analysis, and security monitoring to protect the platform and its users. Security events are logged with IP addresses, timestamps, and action types.",
            "Affiliate program activity is monitored for fraudulent referrals, self-referral abuse, chargeback manipulation, and coordinated exploitation. Suspicious patterns trigger automated review.",
            "Security logs are retained for a minimum of 12 months for investigation, legal compliance, and platform integrity purposes.",
          ],
        },
        {
          id: "cookies",
          title: "Cookies and Similar Technologies",
          body: [
            "RobinOS uses authentication cookies to maintain secure user sessions, preference cookies to remember settings, and analytics to understand product usage patterns.",
            "We do not deploy broad third-party marketing trackers or cross-site advertising trackers on core application surfaces.",
          ],
        },
        {
          id: "payments",
          title: "Payment and Billing Processing",
          body: [
            "Subscription and transaction processing is handled by approved payment providers (Creem, Stripe, or equivalent). Billing data flows through compliant payment infrastructure.",
            "RobinOS does not store full card details in product databases. Billing records include transaction status, amounts, provider references, and invoice metadata for operations, tax, and support purposes.",
          ],
        },
        {
          id: "retention-deletion",
          title: "Data Retention and Deletion",
          body: [
            "Account and billing records are retained for legal, tax, fraud prevention, and support obligations for the minimum period required by applicable law and payment processor terms.",
            "Moderation and security audit logs are retained for 12 months minimum for platform integrity and legal compliance purposes.",
            "Users can request account deletion. Deletion requests are processed through support within 30 days and include removal or anonymization of personal data where legally permitted.",
            "Data subject to active fraud investigations, law enforcement requests, or legal hold obligations is exempt from deletion until the relevant obligation is fulfilled.",
          ],
        },
        {
          id: "third-party-sharing",
          title: "Third-Party Data Sharing",
          body: [
            "RobinOS does not sell personal data to third parties. We share data only with service providers necessary to operate the platform: cloud infrastructure (Supabase), AI providers (Groq), payment processors, and analytics services.",
            "All third-party service providers are contractually bound to process data only as directed and in accordance with applicable privacy law.",
            "RobinOS may disclose data to law enforcement, regulatory authorities, or legal counsel when required by valid legal process, court order, or applicable law.",
          ],
        },
        {
          id: "rights",
          title: "Your Privacy Rights",
          body: [
            "Depending on your jurisdiction, you may have rights including: access to your personal data, correction of inaccurate data, deletion of your data, objection to processing, restriction of processing, and data portability.",
            "For data rights requests, contact support@tryrobin.xyz with your account email and request details. We respond to verified rights requests within 30 days.",
            "RobinOS aligns with GDPR principles of transparency, purpose limitation, data minimisation, and security for all users globally.",
          ],
        },
        {
          id: "contact",
          title: "Privacy Contact",
          body: [
            "For privacy questions, data rights requests, or concerns: support@tryrobin.xyz",
            "For trust and safety, abuse reports, compliance inquiries, and moderation appeals: support@tryrobin.xyz",
            "For legal inquiries and law enforcement requests: support@tryrobin.xyz",
          ],
        },
      ]}
    />
  );
}

export function TermsOfServicePage() {
  return (
    <LegalPage
      seoTitle="Terms of Service | RobinOS"
      seoDescription="RobinOS Terms of Service covering account responsibilities, subscriptions, AI content restrictions, moderation enforcement, and dispute handling."
      canonical="/terms"
      pageTitle="Terms of Service"
      effectiveDate="January 1, 2025"
      sections={[
        {
          id: "acceptance",
          title: "Acceptance of Terms",
          body: [
            "By accessing or using RobinOS, you agree to be bound by these Terms of Service, our Privacy Policy, and our Acceptable Use Policy. If you do not agree, you may not use the platform.",
            "RobinOS reserves the right to update these Terms at any time. Material changes will be communicated to active users. Continued use constitutes acceptance of updated Terms.",
          ],
        },
        {
          id: "accounts",
          title: "Account Responsibilities",
          body: [
            "You are responsible for account security, credential confidentiality, and all activity performed under your account. You must not share account credentials with third parties.",
            "You must provide accurate account and billing information and keep that information current. Accounts with false information may be suspended.",
            "You must notify RobinOS immediately at support@tryrobin.xyz if you suspect unauthorized access to your account.",
          ],
        },
        {
          id: "billing",
          title: "Subscriptions, Billing & Cancellation",
          body: [
            "RobinOS subscriptions renew automatically at the applicable billing cycle (monthly or yearly) unless cancelled before the renewal date. Pricing and plan terms are displayed at checkout.",
            "Subscriptions expire after their billing period. Access is automatically reverted to the Free plan upon expiry unless renewed. RobinOS does not extend expired plans without valid payment.",
            "Plan changes are subject to a 14-day cooldown period. No partial billing credits are issued when changing plans. Full payment is required for any new billing cycle.",
            "Cancellation takes effect at the end of the current billing period. You retain access through the paid period end date.",
          ],
        },
        {
          id: "ai-content-restrictions",
          title: "AI Content Restrictions & Prohibited Generations",
          body: [
            "RobinOS strictly prohibits the generation, distribution, or use of any AI content that falls into the following categories: NSFW or sexually explicit material, pornographic content, content that sexualizes or endangers minors (zero tolerance, no exceptions), deepfake abuse or non-consensual synthetic media, hate speech or discriminatory content, content promoting violence or self-harm, extremist or terrorist propaganda, content facilitating illegal activities, identity fraud or impersonation, and harassment or stalking facilitation.",
            "RobinOS uses automated moderation systems that detect and block prohibited content in real time. Attempts to generate prohibited content are logged, and repeated violations result in account action.",
            "Users remain responsible for ensuring that all AI-generated content they publish, distribute, or use complies with applicable laws, platform policies, and third-party terms.",
            "RobinOS reserves the right to suspend or permanently terminate accounts involved in prohibited content generation without refund and without prior notice for serious violations.",
          ],
        },
        {
          id: "moderation-enforcement",
          title: "Automated Moderation & Enforcement Disclosure",
          body: [
            "RobinOS employs automated AI content moderation systems that analyze all generation requests. These systems operate continuously and may block, warn, or restrict generation based on content safety rules.",
            "Moderation events are logged to a structured audit system. Users who repeatedly trigger content safety blocks may be automatically flagged for human review.",
            "RobinOS maintains the right to restrict, suspend, or terminate accounts at its sole discretion based on moderation findings, abuse signals, or safety concerns.",
            "Enforcement actions include: individual content blocks, feature restrictions, temporary suspension, permanent termination, and referral to law enforcement for illegal activity.",
          ],
        },
        {
          id: "ai-output",
          title: "AI-Generated Output Limitations",
          body: [
            "AI outputs can contain inaccuracies, hallucinations, or contextual errors. You remain responsible for reviewing, verifying, and approving all content before publishing or distributing it.",
            "RobinOS does not guarantee legal, financial, business, or platform-performance outcomes from AI-generated content. Content is provided as creative assistance only.",
            "RobinOS is not liable for damages arising from reliance on AI-generated content, including claims of defamation, copyright infringement, or factual inaccuracy in published outputs.",
          ],
        },
        {
          id: "intellectual-property",
          title: "Intellectual Property",
          body: [
            "You retain ownership of content you create using RobinOS. AI-generated outputs created with your inputs are yours subject to applicable law and the terms of our AI providers.",
            "RobinOS owns all platform technology, design, branding, and proprietary infrastructure. You may not reproduce, reverse-engineer, or create derivative products from RobinOS systems.",
            "You represent that your prompts do not violate third-party intellectual property rights. You are responsible for any copyright claims arising from your generated content.",
          ],
        },
        {
          id: "prohibited",
          title: "Prohibited Platform Conduct",
          body: [
            "You may not use RobinOS for fraud, abusive automation, illegal content operations, impersonation, malicious campaigns, or rights-violating content workflows.",
            "Affiliate abuse, fake referrals, chargeback manipulation, self-referral exploitation, or coordinated platform abuse may lead to immediate suspension and legal action.",
            "You may not attempt to circumvent, bypass, or undermine any RobinOS content safety, moderation, or access control systems.",
          ],
        },
        {
          id: "liability",
          title: "Limitation of Liability",
          body: [
            "RobinOS is provided 'as is' without warranties of any kind. We do not warrant uninterrupted service, error-free operation, or fitness for any particular purpose.",
            "To the maximum extent permitted by applicable law, RobinOS's total liability to you for any claim arising from these Terms or use of the platform shall not exceed the amount paid by you to RobinOS in the 12 months preceding the claim.",
            "RobinOS is not liable for indirect, incidental, special, consequential, or punitive damages arising from your use of or inability to use the platform.",
          ],
        },
        {
          id: "refund-dispute",
          title: "Refunds and Disputes",
          body: [
            "Refund eligibility is governed by our Refund Policy. Billing disputes should first be raised with RobinOS support before initiating external disputes or chargebacks.",
            "If abusive behavior, policy violation, or fraudulent activity is detected, refund requests may be declined and accounts may be terminated.",
          ],
        },
        {
          id: "termination",
          title: "Termination",
          body: [
            "Either party may terminate the service relationship. You may close your account at any time. RobinOS may suspend or terminate accounts for policy violations, non-payment, or at its discretion.",
            "Upon termination, your access to premium features ceases immediately. For serious violations, account data may be retained for legal, fraud prevention, or law enforcement obligations.",
          ],
        },
        {
          id: "governing-law",
          title: "Governing Law",
          body: [
            "These Terms are governed by the laws of India. Any disputes related to RobinOS services, subscriptions, or affiliate operations shall be resolved under applicable Indian jurisdiction.",
            "For questions about these Terms, contact support@tryrobin.xyz.",
          ],
        },
      ]}
    />
  );
}

export function RefundPolicyPage() {
  return (
    <LegalPage
      seoTitle="Refund Policy | RobinOS"
      seoDescription="Understand RobinOS refund windows, duplicate charge handling, cancellation flow, and billing dispute process."
      canonical="/refund-policy"
      pageTitle="Refund Policy"
      effectiveDate="May 19, 2026"
      sections={[
        {
          id: "digital-subscriptions",
          title: "Digital subscription nature",
          body: [
            "RobinOS is a digital software subscription service with immediate access to creator workflow tools once the plan is activated.",
            "Because access is granted instantly, refunds are evaluated through a policy window and abuse checks.",
          ],
        },
        {
          id: "request-window",
          title: "Refund request window",
          body: [
            "Refund requests should be submitted to support@tryrobin.xyz within 14 days of initial subscription charge for eligible first-cycle requests.",
            "Refund eligibility may depend on account usage volume, abuse checks, and violation review.",
            "Renewal-cycle refunds may be granted for accidental renewals reported promptly and reviewed case by case.",
          ],
        },
        {
          id: "duplicate-fraud",
          title: "Duplicate charges and unauthorized payments",
          body: [
            "If duplicate billing or unauthorized transactions are detected, RobinOS prioritizes verification and correction, including direct reversal when confirmed.",
            "Fraudulent account usage, automated abuse patterns, or repeated exploit attempts can disqualify refund approval.",
          ],
        },
        {
          id: "cancellation",
          title: "Cancellation rules",
          body: [
            "Cancellation stops future renewal charges but does not retroactively reverse past billing events unless the request qualifies under policy.",
            "Access typically continues until the end of the paid billing period unless account enforcement actions apply.",
          ],
        },
        {
          id: "workflow",
          title: "Refund workflow",
          body: [
            "1) Submit request with account email and transaction details. 2) Billing team reviews eligibility and usage context. 3) Decision is returned via email.",
            "Approved refunds are processed through the original payment channel and timeline controlled by the payment provider.",
          ],
        },
      ]}
    />
  );
}

export function CookiePolicyPage() {
  return (
    <LegalPage
      seoTitle="Cookie Policy | RobinOS"
      seoDescription="Learn which authentication, analytics, and preference cookies RobinOS uses and how to manage browser controls."
      canonical="/cookie-policy"
      pageTitle="Cookie Policy"
      effectiveDate="May 19, 2026"
      sections={[
        {
          id: "auth-cookies",
          title: "Authentication cookies",
          body: [
            "Authentication cookies are used to maintain secure sessions, reduce repeated logins, and support account integrity checks.",
          ],
        },
        {
          id: "analytics-cookies",
          title: "Analytics cookies",
          body: [
            "Analytics cookies help RobinOS measure page usage, feature adoption, and operational performance so we can improve reliability and user experience.",
          ],
        },
        {
          id: "preferences",
          title: "Preference cookies",
          body: [
            "Preference cookies store UI-level settings such as language, display preferences, and remembered configuration choices.",
          ],
        },
        {
          id: "marketing",
          title: "Marketing limitations",
          body: [
            "RobinOS limits marketing cookie usage on core product surfaces and does not depend on aggressive cross-site ad tracking as a default operating model.",
          ],
        },
        {
          id: "browser-controls",
          title: "Browser controls",
          body: [
            "You can manage, block, or remove cookies from your browser settings. Blocking essential cookies may impact login and account-related functionality.",
          ],
        },
      ]}
    />
  );
}

export function AITransparencyPage() {
  return (
    <LegalPage
      seoTitle="AI Transparency | RobinOS"
      seoDescription="See how RobinOS uses AI models, moderation controls, and policy safeguards for responsible creator workflows."
      canonical="/ai-transparency"
      pageTitle="AI Transparency"
      effectiveDate="May 19, 2026"
      sections={[
        {
          id: "outputs",
          title: "AI-generated outputs",
          body: [
            "RobinOS produces AI-assisted outputs for scripts, trend operations, and creator workflows. These outputs are generated suggestions and require human review before publication.",
          ],
        },
        {
          id: "model-usage",
          title: "Model and provider usage",
          body: [
            "RobinOS may use OpenAI and additional third-party model providers depending on feature context, performance requirements, and availability.",
          ],
        },
        {
          id: "hallucination",
          title: "Hallucination and reliability disclaimer",
          body: [
            "AI systems can generate inaccurate, incomplete, or contextually unsuitable responses. Users are responsible for factual review and final editorial judgment.",
          ],
        },
        {
          id: "moderation",
          title: "Moderation and prohibited usage",
          body: [
            "RobinOS enforces policy boundaries against abusive, illegal, or harmful use cases. We reserve the right to block requests and suspend accounts for policy violations.",
            "Prohibited usage includes fraud operations, malicious impersonation, harassment campaigns, and content intended to evade legal obligations.",
          ],
        },
        {
          id: "content-safety",
          title: "Content Safety & Moderation",
          body: [
            "RobinOS implements safeguards to reduce harmful AI outputs and promote responsible content creation across the platform.",
            "NSFW (not safe for work) content and sexually explicit generation is strictly prohibited. Users may not generate, upload, or distribute any material that falls under prohibited content categories.",
            "The platform may use automated moderation systems, content filtering, and abuse detection mechanisms to identify and restrict policy-violating activities.",
            "Unsafe prompts, abusive behavior, or repeated policy violations may result in restricted platform access, account suspension, or permanent removal from the service.",
            "RobinOS is committed to responsible AI usage and creator safety. We continuously evaluate our moderation practices to maintain a safe and compliant environment for all users.",
          ],
        },
      ]}
    />
  );
}

export function AffiliateTermsPage() {
  return (
    <LegalPage
      seoTitle="Affiliate Terms | RobinOS"
      seoDescription="Read RobinOS affiliate program terms for commission rates, payout delays, fraud checks, and suspension rules."
      canonical="/affiliate-terms"
      pageTitle="Affiliate Terms"
      effectiveDate="May 19, 2026"
      sections={[
        {
          id: "commission",
          title: "Commission structure",
          body: [
            "Standard affiliate commission is 30% on qualifying paid referrals unless campaign-specific terms explicitly override this rate.",
          ],
        },
        {
          id: "payouts",
          title: "Payout timing and threshold",
          body: [
            "Affiliate payouts are subject to a payout delay period to account for fraud checks, reversals, and billing stability.",
            "Minimum withdrawal applies before a payout request can be processed.",
          ],
        },
        {
          id: "fraud",
          title: "Fraud prevention and referral integrity",
          body: [
            "Fake referrals, self-referrals, incentive abuse, identity manipulation, and payment fraud are prohibited.",
            "RobinOS can withhold commissions, reverse balances, or suspend affiliate access where suspicious behavior is detected.",
          ],
        },
        {
          id: "review",
          title: "Payout review and suspension conditions",
          body: [
            "Payout requests are reviewed before release. Additional verification can be required for unusual traffic or conversion patterns.",
            "Repeated policy violations can result in affiliate account suspension or permanent removal.",
          ],
        },
      ]}
    />
  );
}

export function DisclaimerPolicyPage() {
  return (
    <LegalPage
      seoTitle="Disclaimer | RobinOS"
      seoDescription="Review RobinOS disclaimers on AI limitations, content responsibility, and no guaranteed business outcomes."
      canonical="/disclaimer"
      pageTitle="Disclaimer"
      effectiveDate="May 19, 2026"
      sections={[
        {
          id: "ai-limits",
          title: "AI limitations",
          body: [
            "RobinOS outputs are generated by AI systems and may include errors. They are not guaranteed to be complete, accurate, or fit for all contexts.",
          ],
        },
        {
          id: "no-guarantees",
          title: "No legal or business guarantees",
          body: [
            "RobinOS does not provide legal, financial, or business guarantees and does not promise specific growth, engagement, revenue, or campaign outcomes.",
          ],
        },
        {
          id: "creator-responsibility",
          title: "Creator responsibility",
          body: [
            "You are responsible for reviewing all generated material before publishing and ensuring compliance with applicable platform rules and laws.",
          ],
        },
      ]}
    />
  );
}

const helpFaq = [
  { category: "billing", q: "How can I update billing details?", a: "Go to account settings and billing to update payment method, invoices, or plan status." },
  { category: "login", q: "I cannot access my account.", a: "Use password reset first. If lockout continues, contact support with your account email." },
  { category: "ai", q: "Why does an AI output need manual editing?", a: "AI outputs are drafts and may contain mistakes. Final review is always required before publishing." },
  { category: "affiliate", q: "When do affiliate payouts clear?", a: "Payouts clear after delay rules and fraud checks, once the minimum withdrawal threshold is met." },
  { category: "refund", q: "Where do I request a refund?", a: "Send a request to support@tryrobin.xyz with billing details and transaction information." },
];

export function HelpCenterPage() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return helpFaq;
    return helpFaq.filter((item) => `${item.category} ${item.q} ${item.a}`.toLowerCase().includes(q));
  }, [query]);

  return (
    <PublicPageShell title="Help Center" subtitle="Search support answers for billing, login, AI usage, affiliates, and refunds.">
      <PageSeo title="Help Center | RobinOS" description="Find quick support answers for RobinOS billing, account access, AI workflows, and affiliate questions." canonicalPath="/help" />
      <div className="rounded-lg border border-border/60 bg-card/35 p-5">
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-secondary/35 px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search FAQs..."
            className="h-10 w-full bg-transparent text-sm text-foreground outline-none"
          />
        </div>
        <div className="mt-4 space-y-3">
          {results.map((item) => (
            <article key={item.q} className="rounded-md border border-border/50 bg-card/35 p-4">
              <p className="text-xs uppercase tracking-[0.12em] text-primary">{item.category}</p>
              <h2 className="mt-1 text-sm font-semibold text-foreground">{item.q}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.a}</p>
            </article>
          ))}
          {!results.length ? <p className="text-sm text-muted-foreground">No matching help articles found.</p> : null}
        </div>
      </div>
    </PublicPageShell>
  );
}

export function DocsPage() {
  const docs = [
    ["Getting Started", "Create your account, configure workspace defaults, and launch your first AI workflow in minutes."],
    ["Account Setup", "Set profile details, user access, and notification preferences for stable operations."],
    ["Subscriptions", "Plan management, billing cycles, invoice access, and cancellation controls."],
    ["Affiliates", "Referral setup, commission visibility, payout thresholds, and compliance checks."],
    ["AI Tools", "Script generation, trend operations, and voice workflow execution guidance."],
    ["Usage Limits", "How usage limits work across plans and what happens when thresholds are reached."],
  ];

  return (
    <PublicPageShell title="Documentation" subtitle="Operational documentation for setup, billing, affiliate programs, and AI tooling in RobinOS.">
      <PageSeo title="Documentation | RobinOS" description="Read RobinOS docs for onboarding, subscriptions, affiliates, AI tooling, and usage policies." canonicalPath="/docs" />
      <div className="grid gap-4 md:grid-cols-2">
        {docs.map(([title, text]) => (
          <article key={title} className="rounded-lg border border-border/60 bg-card/35 p-5">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          </article>
        ))}
      </div>
    </PublicPageShell>
  );
}

const apiRoadmapItems: Array<{
  title: string;
  description: string;
  status: "Coming Soon" | "In Development" | "Planned" | "Future Release";
  icon: typeof KeyRound;
}> = [
  {
    title: "Authentication",
    description: "Secure API authentication and workspace-level access management.",
    status: "Coming Soon",
    icon: KeyRound,
  },
  {
    title: "Content Generation API",
    description: "Generate scripts, captions, hashtags, and workflow outputs programmatically.",
    status: "In Development",
    icon: Sparkles,
  },
  {
    title: "Automation Workflows",
    description: "Connect RobinOS with creator pipelines, publishing systems, and internal tools.",
    status: "Planned",
    icon: Workflow,
  },
  {
    title: "Webhooks",
    description: "Realtime event notifications for subscriptions, generations, and workflow actions.",
    status: "Planned",
    icon: Webhook,
  },
  {
    title: "SDKs & Client Libraries",
    description: "Official SDK support for JavaScript, Python, and modern frameworks.",
    status: "Future Release",
    icon: Package,
  },
  {
    title: "Rate Limits & Usage",
    description: "Enterprise-ready infrastructure with scalable API throughput and usage management.",
    status: "Planned",
    icon: Gauge,
  },
];

const statusStyles: Record<string, string> = {
  "Coming Soon": "border-border/80 text-muted-foreground",
  "In Development": "border-primary/40 text-primary",
  Planned: "border-border/80 text-muted-foreground",
  "Future Release": "border-border/80 text-muted-foreground",
};

export function ApiAccessPage() {
  return (
    <PublicLayout>
      <PageSeo
        title="RobinOS API Platform | Developer Preview"
        description="Preview RobinOS API platform roadmap for authentication, automation, webhooks, SDKs, and scalable creator infrastructure."
        canonicalPath="/api-access"
      />
      <section className="relative mx-auto w-full max-w-[1200px] px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-2 h-44 bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.14),transparent_65%)]" />
        <div className="relative rounded-xl border border-border/60 bg-card/45 p-6 backdrop-blur-md sm:p-8">
          <Badge variant="outline" className="mb-4 w-fit border-primary/40 text-primary">Developer Preview</Badge>
          <h1 className="text-chrome text-3xl font-semibold tracking-tight sm:text-4xl">RobinOS API Platform</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Developer infrastructure for automation, integrations, and AI-powered creator workflows.
          </p>
          <p className="mt-4 text-xs font-mono tracking-wide text-muted-foreground/80">
            Public API access is currently in development and will roll out in phases.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {apiRoadmapItems.map((item) => (
            <motion.article
              key={item.title}
              whileHover={{ y: -3 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="rounded-xl border border-border/60 bg-card/40 p-5"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/70 bg-secondary/40">
                  <item.icon className="h-4 w-4 text-primary" />
                </span>
                <Badge variant="outline" className={`text-[10px] ${statusStyles[item.status]}`}>{item.status}</Badge>
              </div>
              <h2 className="text-base font-semibold text-foreground">{item.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
            </motion.article>
          ))}
        </div>

        <div className="mt-7 rounded-xl border border-primary/25 bg-primary/5 p-6 sm:p-7">
          <h2 className="text-lg font-semibold text-foreground">Built for the next generation of creator infrastructure.</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            RobinOS APIs are being designed to support scalable creator operations, automation systems, AI workflows, and multi-platform publishing environments.
          </p>
          <p className="mt-4 text-xs font-mono text-muted-foreground/80">Early developer access will become available in future releases.</p>
        </div>
      </section>
    </PublicLayout>
  );
}

const changelogEntries = [
  {
    version: "v0.8.0",
    title: "Caption Engine Launch",
    description:
      "Introduced platform-optimized caption generation for YouTube, Instagram, TikTok, and Facebook with SEO-aware formatting and intelligent hashtag workflows.",
    tags: ["New Feature", "AI Systems"],
  },
  {
    version: "v0.7.2",
    title: "Subscription & Usage Infrastructure",
    description:
      "Improved generation tracking, plan entitlements, quota reliability, and backend usage synchronization across creator plans.",
    tags: ["Infrastructure", "Billing"],
  },
  {
    version: "v0.7.0",
    title: "Script Engine Improvements",
    description:
      "Enhanced workflow speed, generation stability, dashboard responsiveness, and creator-focused script generation experiences.",
    tags: ["Improvements", "Performance"],
  },
  {
    version: "v0.6.5",
    title: "Affiliate System Upgrades",
    description:
      "Expanded affiliate dashboard visibility, payout workflow architecture, and referral attribution reliability.",
    tags: ["Affiliates", "Backend"],
  },
];

export function ChangelogPage() {
  return (
    <PublicLayout>
      <PageSeo
        title="Product Updates | RobinOS"
        description="Track RobinOS platform improvements, AI workflow enhancements, infrastructure upgrades, and creator-focused releases."
        canonicalPath="/changelog"
      />
      <section className="relative mx-auto w-full max-w-[1080px] px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-4 h-44 bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.12),transparent_70%)]" />
        <div className="relative rounded-xl border border-border/60 bg-card/45 p-6 backdrop-blur-md sm:p-8">
          <Badge variant="outline" className="mb-4 w-fit border-primary/40 text-primary">Active Development</Badge>
          <h1 className="text-chrome text-3xl font-semibold tracking-tight sm:text-4xl">Product Updates</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Track platform improvements, infrastructure upgrades, AI workflow enhancements, and creator-focused feature releases across RobinOS.
          </p>
        </div>

        <div className="relative mt-6 space-y-4 before:absolute before:bottom-0 before:left-[10px] before:top-0 before:w-px before:bg-border/70 sm:before:left-[11px]">
          {changelogEntries.map((entry) => (
            <article key={entry.version} className="relative rounded-xl border border-border/60 bg-card/40 p-5 pl-7 sm:pl-8">
              <span className="absolute left-2 top-6 h-3 w-3 rounded-full border border-primary/50 bg-primary/30 sm:left-2.5" />
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs font-mono tracking-[0.14em] text-primary">{entry.version}</p>
                <div className="flex flex-wrap gap-1.5">
                  {entry.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] border-border/80 text-muted-foreground">{tag}</Badge>
                  ))}
                </div>
              </div>
              <h2 className="mt-2 text-base font-semibold text-foreground sm:text-lg">{entry.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{entry.description}</p>
            </article>
          ))}
        </div>

        <div className="mt-7 rounded-xl border border-primary/25 bg-primary/5 p-6 sm:p-7">
          <h2 className="text-lg font-semibold text-foreground">Building RobinOS in public.</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            RobinOS is actively evolving into a complete creator operating system focused on content generation, workflow automation, discoverability, and scalable creator infrastructure.
          </p>
        </div>
      </section>
    </PublicLayout>
  );
}

export function StatusPage() {
  const systems = [
    { name: "API", status: "Operational", icon: Activity },
    { name: "Generation Systems", status: "Operational", icon: Bot },
    { name: "Affiliate Systems", status: "Operational", icon: Users },
    { name: "Payments", status: "Operational", icon: CreditCard },
    { name: "Authentication", status: "Operational", icon: ShieldCheck },
    { name: "Data Layer", status: "Operational", icon: Database },
  ];

  return (
    <PublicPageShell title="System Status" subtitle="Operational view of RobinOS platform services for creators and partner operations.">
      <PageSeo title="Status | RobinOS" description="Track operational status for API, generation systems, payments, authentication, and affiliate infrastructure." canonicalPath="/status" />
      <div className="grid gap-3">
        {systems.map((item) => (
          <div key={item.name} className="flex items-center justify-between rounded-lg border border-border/60 bg-card/35 p-4">
            <div className="flex items-center gap-3">
              <item.icon className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium text-foreground">{item.name}</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
              <CheckCircle2 className="h-3 w-3" /> {item.status}
            </span>
          </div>
        ))}
      </div>
    </PublicPageShell>
  );
}

export function CreatorGuidePage() {
  return (
    <PublicPageShell title="Creator Guide" subtitle="Build repeatable content pipelines with scripting, trend workflows, and AI-assisted production discipline.">
      <PageSeo title="Creator Guide | RobinOS" description="Learn practical RobinOS workflows for scripting, trend usage, and scalable AI content operations." canonicalPath="/creator-guide" />
      <div className="grid gap-4 md:grid-cols-2">
        {[
          ["Script Generation", "Start with clear content goals, provide context-rich prompts, and iterate hooks before final publishing drafts."],
          ["Trend Usage", "Use trend scans as directional signals, then align trends with your niche voice and audience relevance."],
          ["Workflow Optimization", "Batch ideation, script review, and production scheduling to reduce switching cost across tools."],
          ["Content Pipeline", "Run a weekly cycle: research → script → production handoff → review metrics → improve next cycle."],
        ].map(([title, text]) => (
          <article key={title} className="rounded-lg border border-border/60 bg-card/35 p-5">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          </article>
        ))}
      </div>
    </PublicPageShell>
  );
}

export function AffiliateGuidePage() {
  return (
    <PublicPageShell title="Affiliate Guide" subtitle="How to run referrals, monitor commissions, and keep payouts compliant in the RobinOS affiliate program.">
      <PageSeo title="Affiliate Guide | RobinOS" description="Understand referral mechanics, commission logic, payouts, and affiliate best practices for RobinOS." canonicalPath="/affiliate-guide" />
      <div className="space-y-4 rounded-lg border border-border/60 bg-card/35 p-5">
        {[
          ["Referral setup", "Share your unique referral link in audience channels where RobinOS is contextually relevant."],
          ["Commission system", "Standard commission applies to valid paid referrals based on current affiliate terms and campaign overlays."],
          ["Payouts", "Withdraw only after threshold and review conditions are met; keep payout details accurate to avoid delays."],
          ["Best practices", "Avoid misleading claims, fake urgency tactics, and non-compliant traffic sources to protect account standing."],
        ].map(([title, text]) => (
          <article key={title} className="rounded-md border border-border/50 bg-secondary/25 p-4">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          </article>
        ))}
      </div>
    </PublicPageShell>
  );
}

export function ResourcesPage() {
  return (
    <PublicPageShell title="Resources" subtitle="Operational resources for creators, affiliates, and support workflows.">
      <PageSeo title="Resources | RobinOS" description="Explore RobinOS help resources, documentation, status tracking, and workflow guides." canonicalPath="/resources" />
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { to: "/docs", title: "Documentation", text: "Setup, account, subscriptions, affiliates, AI tools, and usage limits." },
          { to: "/help", title: "Help Center", text: "Searchable FAQs for billing, login, refunds, and operational support." },
          { to: "/creator-guide", title: "Creator Guide", text: "Execution frameworks for script operations and content systems." },
          { to: "/affiliate-guide", title: "Affiliate Guide", text: "Referral playbooks, payout hygiene, and policy-safe growth." },
          { to: "/status", title: "Status Page", text: "Live operational posture of key RobinOS systems." },
          { to: "/contact", title: "Contact", text: "Reach support for account, billing, and affiliate operations." },
        ].map((item) => (
          <Link key={item.title} to={item.to} className="rounded-lg border border-border/60 bg-card/35 p-5 transition-colors hover:bg-card/50">
            <h2 className="text-base font-semibold text-foreground">{item.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
          </Link>
        ))}
      </div>
    </PublicPageShell>
  );
}

export function AffiliatesProgramPage() {
  const { data: platformSettings } = usePlatformSettings();
  const commissionPercent = Number(platformSettings?.affiliate_commission_percent ?? 30);
  const minimumWithdrawal = Number(platformSettings?.minimum_withdrawal ?? 25);
  const payoutDelayDays = Number(platformSettings?.payout_delay_days ?? 7);

  const leaderboardRewards = [
    { rank: "Tier 1", reward: "Featured partner incentives", note: "Priority program tier", highlight: true },
    { rank: "Tier 2", reward: "Campaign incentive access", note: "Growth operations tier", highlight: false },
    { rank: "Tier 3", reward: "Partner enablement rewards", note: "Momentum tier", highlight: false },
  ];

  const milestoneBonuses = [
    { sales: "Activation Milestone", bonus: "Bonus eligibility unlocked" },
    { sales: "Performance Milestone", bonus: "Additional incentive eligibility" },
    { sales: "Scale Milestone", bonus: "Expanded partner reward access" },
    { sales: "Elite Milestone", bonus: "Priority program rewards", elite: true },
  ];

  return (
    <PublicPageShell title="Affiliates" subtitle="RobinOS affiliate program for creators, educators, and operators who refer qualified users.">
      <PageSeo title="Affiliates | RobinOS" description="Join RobinOS affiliates to earn commission on qualified referrals with policy-safe payout operations." canonicalPath="/affiliates" />

      <div className="grid gap-4 md:grid-cols-2">
        {[
          ["Commission model", `Standard partner commission is ${commissionPercent}% on qualifying paid referrals under the active affiliate terms.`],
          ["Payout operations", `Payouts are processed after verification windows and threshold rules. Current payout delay target is ${Math.max(1, payoutDelayDays)} day(s).`],
          ["Traffic quality", "Partners should use transparent, policy-compliant acquisition channels and avoid misleading claims."],
          ["Operational links", "Use Affiliate Guide for best practices and Affiliate Terms for legal payout conditions."],
        ].map(([title, text]) => (
          <article key={title} className="rounded-lg border border-border/60 bg-card/35 p-5">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          </article>
        ))}
      </div>

      <section className="relative mt-6 overflow-hidden rounded-[36px] border border-border/60 bg-card/45 px-5 py-8 backdrop-blur-2xl sm:px-8 sm:py-10 lg:px-10">
        <div className="pointer-events-none absolute -left-24 top-8 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-6 h-52 w-52 rounded-full bg-accent/20 blur-3xl" />

        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.25 }} transition={{ duration: 0.55, ease: "easeOut" }} className="relative z-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/40 px-3 py-1 text-xs font-medium text-foreground">
            🔥 Affiliate Rewards Program
          </span>
          <h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
            Build Partner Momentum + Monthly <span className="bg-gradient-to-r from-primary via-foreground to-primary bg-clip-text text-transparent">Program Rewards</span>
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            RobinOS rewards affiliates who build policy-safe partner pipelines. Commission terms and campaign incentives are applied under the active affiliate policy.
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.12 } } }}
          className="relative z-10 mt-8 grid gap-5 lg:grid-cols-2"
        >
          <motion.article
            variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            whileHover={{ y: -6 }}
            className="group relative overflow-hidden rounded-[32px] border border-border/70 bg-card/60 p-6 shadow-2xl shadow-background/60 backdrop-blur-2xl sm:p-7"
          >
            <div className="pointer-events-none absolute inset-0 rounded-[32px] border border-primary/0 transition-colors duration-300 group-hover:border-primary/35" />
            <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }} className="absolute right-5 top-5 text-xl">
              🏆
            </motion.div>

            <h3 className="text-xl font-semibold text-foreground">🏆 Monthly Leaderboard Rewards</h3>
            <p className="mt-2 text-sm text-muted-foreground">Top-performing affiliates may unlock additional campaign rewards under active partner terms.</p>

            <div className="mt-6 space-y-3">
              {leaderboardRewards.map((item) => (
                <motion.div
                  key={item.rank}
                  whileHover={{ scale: 1.01 }}
                  className={`relative flex items-center justify-between rounded-2xl border px-4 py-3 ${item.highlight ? "border-primary/50 bg-primary/12 glow-blue" : "border-border/60 bg-secondary/35"}`}
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.rank}</p>
                    <p className="text-xs text-muted-foreground">{item.note}</p>
                  </div>
                  <p className="text-base font-semibold text-foreground">{item.reward}</p>
                </motion.div>
              ))}
            </div>

            <p className="mt-5 text-xs text-muted-foreground">Leaderboard resets every month.</p>
          </motion.article>

          <motion.article
            variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            whileHover={{ y: -6 }}
            className="group relative overflow-hidden rounded-[32px] border border-border/70 bg-card/60 p-6 shadow-2xl shadow-background/60 backdrop-blur-2xl sm:p-7"
          >
            <div className="pointer-events-none absolute inset-0 rounded-[32px] border border-primary/0 transition-colors duration-300 group-hover:border-primary/35" />
            <h3 className="text-xl font-semibold text-foreground">⚡ Performance Milestone Incentives</h3>
            <p className="mt-2 text-sm text-muted-foreground">Unlock additional incentives as partner activity matures.</p>

            <div className="mt-6 space-y-3">
              {milestoneBonuses.map((item, index) => (
                <motion.div
                  key={item.sales}
                  whileHover={{ y: -2, scale: 1.01 }}
                  className={`relative overflow-hidden rounded-2xl border px-4 py-3 ${item.elite ? "border-primary/60 bg-primary/12 glow-blue-strong" : "border-border/60 bg-secondary/35"}`}
                >
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-primary/10"
                    animate={{ x: ["-110%", "115%"] }}
                    transition={{ duration: 2.8 + index * 0.3, repeat: Infinity, ease: "easeInOut", delay: index * 0.25 }}
                  />
                  <div className="relative z-10 flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{item.sales}</p>
                    <p className="text-base font-semibold text-foreground">{item.bonus}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.article>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.55, delay: 0.1, ease: "easeOut" }}
          className="relative z-10 mt-8 rounded-[30px] border border-border/70 bg-card/55 px-5 py-7 text-center backdrop-blur-xl sm:px-8"
        >
          <h3 className="text-2xl font-semibold text-foreground">Start Promoting RobinOS Today</h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Build a durable affiliate workflow while participating in policy-safe partner reward programs.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <motion.div whileHover={{ scale: 1.03, y: -1 }} whileTap={{ scale: 0.98 }}>
              <Button asChild className="btn-primary min-w-[210px] rounded-2xl">
                <Link to="/auth">Join Affiliate Program</Link>
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02, y: -1 }} whileTap={{ scale: 0.99 }}>
              <Button asChild variant="outline" className="min-w-[210px] rounded-2xl border-border/70 bg-secondary/35 text-foreground hover:bg-secondary/55">
                <Link to="/affiliate-terms">View Commission Structure · Policy Threshold Applies</Link>
              </Button>
            </motion.div>
          </div>
        </motion.div>
      </section>
    </PublicPageShell>
  );
}

const roadmapGroups = [
  {
    title: "Completed",
    badge: "✅ Completed",
    description: "Core systems shipped and battle-tested for creator workflows.",
    pulse: false,
    items: [
      "AI Script Generation",
      "Viral Content Engine",
      "Affiliate System",
      "Premium Dashboard",
      "Pricing Infrastructure",
      "Creator Workflow System",
      "Responsive SaaS Website",
      "Payment Integration",
    ],
  },
  {
    title: "In Progress",
    badge: "⚡ In Progress",
    description: "High-impact features actively being developed and refined.",
    pulse: true,
    items: [
      "AI Voice Generation",
      "Advanced Analytics",
      "Team Collaboration",
      "Content Scheduling",
      "AI Thumbnail Assistant",
      "Affiliate Leaderboards",
      "API Infrastructure",
      "Performance Optimization",
    ],
  },
  {
    title: "Coming Soon",
    badge: "🔮 Planned",
    description: "The next expansion layer for scale, quality, and automation.",
    pulse: false,
    items: [
      "AI Video Editing",
      "Multi-Platform Publishing",
      "Mobile App",
      "AI Research Agent",
      "Creator Marketplace",
      "Brand Workspace System",
      "Smart AI Automation Flows",
      "Enterprise Features",
    ],
  },
];

export function RoadmapPage() {
  return (
    <PublicLayout>
      <PageSeo
        title="RobinOS Product Roadmap | AI Content Platform"
        description="Track RobinOS roadmap progress across completed releases, in-progress features, and long-term vision for AI-native creator operations."
        canonicalPath="/roadmap"
      />

      <section className="relative isolate overflow-hidden border-b border-border/60">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,hsl(var(--primary)/0.24),transparent_45%),radial-gradient(circle_at_84%_8%,hsl(var(--primary)/0.18),transparent_42%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--card)))]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(hsl(var(--border)/0.45)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.45)_1px,transparent_1px)] bg-[size:30px_30px] opacity-20" />
        <motion.div
          aria-hidden="true"
          animate={{ opacity: [0.45, 0.65, 0.45], scale: [1, 1.03, 1] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="pointer-events-none absolute -left-12 top-10 h-40 w-40 rounded-full bg-primary/25 blur-3xl"
        />

        <div className="relative mx-auto w-full max-w-[1240px] px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-medium tracking-[0.08em] text-foreground"
          >
            🚀 Building The Future of AI Content Creation
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.05, ease: "easeOut" }}
            className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
          >
            RobinOS Product Roadmap
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12, ease: "easeOut" }}
            className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base"
          >
            RobinOS is evolving into a complete AI content operating system for creators, agencies, and modern businesses.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18, ease: "easeOut" }}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/40 px-3 py-1 text-xs text-foreground/90"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            Updated regularly
          </motion.p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1240px] px-4 py-10 sm:px-6 sm:py-12">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.15 }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1 } } }}
          className="grid gap-4 lg:grid-cols-3"
        >
          {roadmapGroups.map((group) => (
            <motion.article
              key={group.title}
              variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              whileHover={{ y: -4 }}
              className="relative overflow-hidden rounded-xl border border-border/70 bg-card/55 p-5 shadow-2xl shadow-background/50 backdrop-blur-xl"
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,hsl(var(--primary)/0.16),transparent_50%)] opacity-75" />
              <div className="relative">
                <p className="inline-flex items-center rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-medium tracking-[0.08em] text-foreground">
                  {group.badge}
                </p>
                <h2 className="mt-4 text-xl font-semibold text-foreground">{group.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{group.description}</p>
                <ul className="mt-4 space-y-2.5 border-l border-border/70 pl-4">
                  {group.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full bg-primary ${group.pulse ? "animate-pulse" : "opacity-80"}`} />
                      <span className="text-foreground/90">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.article>
          ))}
        </motion.div>

        <motion.article
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.55, delay: 0.08, ease: "easeOut" }}
          className="relative mt-6 overflow-hidden rounded-xl border border-border/70 bg-card/60 p-6 shadow-2xl shadow-background/60 backdrop-blur-xl sm:p-8"
        >
          <div className="pointer-events-none absolute -right-16 top-4 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 bottom-0 h-36 w-36 rounded-full bg-accent/20 blur-3xl" />
          <div className="relative">
            <p className="text-xs uppercase tracking-[0.2em] text-foreground/80">Long Term Vision</p>
            <h2 className="mt-3 text-2xl font-semibold text-foreground sm:text-3xl">The Vision Behind RobinOS</h2>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              RobinOS is being built as a complete AI operating system for the next generation of digital creators and internet businesses.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                "AI-native workflows",
                "creator infrastructure",
                "automation systems",
                "scalable publishing",
                "intelligent content pipelines",
              ].map((item) => (
                <div key={item} className="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3 text-sm text-foreground/90">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </motion.article>
      </section>
    </PublicLayout>
  );
}

export function SupportPage() {
  return (
    <PublicPageShell title="Support" subtitle="Direct support channels for product, billing, and affiliate operations.">
      <PageSeo title="Support | RobinOS" description="Contact RobinOS support and access help resources for account, billing, and affiliate needs." canonicalPath="/support" />
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { icon: LifeBuoy, title: "General Support", text: "support@tryrobin.xyz", helper: "Response target: within 24 hours." },
          { icon: Clock3, title: "Billing", text: "Billing and payment disputes", helper: "Include transaction ID for faster handling." },
          { icon: Users, title: "Affiliate Support", text: "Commission and payout review", helper: "Response target: within 48 hours." },
        ].map((card) => (
          <article key={card.title} className="rounded-lg border border-border/60 bg-card/35 p-5">
            <card.icon className="h-5 w-5 text-primary" />
            <h2 className="mt-3 text-sm font-semibold text-foreground">{card.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{card.text}</p>
            <p className="mt-1 text-xs text-muted-foreground">{card.helper}</p>
          </article>
        ))}
      </div>
    </PublicPageShell>
  );
}