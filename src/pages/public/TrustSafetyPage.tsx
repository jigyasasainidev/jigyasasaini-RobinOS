import { motion } from "framer-motion";
import {
  Shield, ShieldCheck, Eye, AlertTriangle, Ban, UserX,
  Activity, Lock, Search, Flag, FileText, Globe, CheckCircle2,
  Zap, Server, Scale, HeartHandshake, BookOpen,
} from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { PageSeo } from "@/components/seo/PageSeo";
import { Link } from "react-router-dom";

// ── Shared layout primitives ──────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.5, delay: i * 0.06, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

function Section({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section
      id={id}
      className={`scroll-mt-24 rounded-2xl border border-border/50 bg-card/40 backdrop-blur-md p-6 sm:p-8 ${className}`}
    >
      {children}
    </section>
  );
}

function SectionHeader({ icon: Icon, title, badge }: { icon: React.ElementType; title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex items-center gap-2.5 flex-wrap">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {badge && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-mono tracking-wider uppercase" style={{ background: "hsl(142 70% 45% / 0.1)", border: "1px solid hsl(142 70% 45% / 0.2)", color: "hsl(142 70% 60%)" }}>
            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

function SafetyBadge({ label, active = true }: { label: string; active?: boolean }) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-3 py-2"
      style={{ background: active ? "hsl(142 70% 45% / 0.07)" : "hsl(222 28% 8%)", border: `1px solid ${active ? "hsl(142 70% 45% / 0.2)" : "hsl(217 28% 14%)"}` }}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/30"}`} />
      <span className="text-[11px] font-mono" style={{ color: active ? "hsl(142 70% 60%)" : "hsl(var(--muted-foreground) / 0.4)" }}>
        {label}
      </span>
    </div>
  );
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>;
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-primary/60 mt-0.5 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const toc = [
  { id: "mission", label: "AI Safety Mission" },
  { id: "moderation-pipeline", label: "Moderation Pipeline" },
  { id: "prompt-filtering", label: "Prompt Safety Filtering" },
  { id: "output-validation", label: "Output Safety Validation" },
  { id: "blocked-content", label: "Blocked Content Categories" },
  { id: "abuse-prevention", label: "Abuse Prevention" },
  { id: "account-enforcement", label: "Account Enforcement" },
  { id: "human-oversight", label: "Human Oversight" },
  { id: "child-safety", label: "Child Safety Commitment" },
  { id: "copyright", label: "Copyright Protection" },
  { id: "reporting", label: "User Reporting System" },
  { id: "platform-integrity", label: "Platform Integrity" },
  { id: "responsible-ai", label: "Responsible AI Usage" },
  { id: "enforcement-actions", label: "Enforcement Actions" },
  { id: "contact", label: "Trust & Safety Contact" },
];

export function TrustSafetyPage() {
  return (
    <PublicLayout>
      <PageSeo
        title="Trust & Safety — RobinOS"
        description="RobinOS Trust & Safety Center: AI content moderation, abuse prevention, responsible AI infrastructure, and platform safety policies."
        canonicalPath="/trust-safety"
      />

      <div className="relative mx-auto w-full max-w-[1240px] px-4 pb-20 pt-14 sm:px-6 sm:pt-20">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute left-0 right-0 top-8 h-48 select-none bg-[radial-gradient(circle_at_50%_0%,hsl(217_91%_60%/0.1),transparent_70%)]" />

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="relative rounded-2xl border border-border/60 bg-card/40 p-7 sm:p-10 backdrop-blur-md overflow-hidden mb-8"
        >
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(ellipse 60% 50% at 80% 50%, hsl(217 91% 60% / 0.05), transparent)" }} />
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-mono uppercase tracking-[0.24em] text-primary/55">TRUST & SAFETY CENTER</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl mb-3">Trust & Safety</h1>
          <p className="max-w-2xl text-sm sm:text-base text-muted-foreground leading-relaxed">
            RobinOS is built with responsible AI principles at every layer. Our moderation infrastructure, safety policies, and enforcement systems are designed to maintain a safe, trustworthy, and legally compliant platform for creators worldwide.
          </p>

          {/* Active safety badges */}
          <div className="mt-6 flex flex-wrap gap-2">
            <SafetyBadge label="AI Moderation Active" />
            <SafetyBadge label="Abuse Detection Enabled" />
            <SafetyBadge label="Prompt Safety Filtering" />
            <SafetyBadge label="Platform Monitoring Active" />
            <SafetyBadge label="Content Filtering Active" />
            <SafetyBadge label="Child Safety Committed" />
          </div>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          {/* Sidebar TOC */}
          <motion.aside
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, delay: 0.08 }}
            className="h-fit rounded-xl border border-border/50 bg-card/40 p-4 backdrop-blur-md lg:sticky lg:top-24 select-none"
          >
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">On This Page</p>
            <div className="h-px bg-gradient-to-r from-primary/40 via-border/60 to-transparent mb-3" />
            <ul className="space-y-2">
              {toc.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="block text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </motion.aside>

          {/* Main content */}
          <div className="space-y-6">

            {/* 1. AI Safety Mission */}
            <motion.div custom={0} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="mission">
                <SectionHeader icon={ShieldCheck} title="AI Safety Mission" badge="CORE COMMITMENT" />
                <Paragraph>
                  RobinOS operates as a responsible AI content platform. Our mission is to provide creators with powerful AI tools while maintaining rigorous safeguards against misuse, harmful content, and platform abuse. Safety is not an afterthought — it is infrastructure.
                </Paragraph>
                {/* AI Governance copy — key compliance statement */}
                <div className="mt-4 rounded-xl px-4 py-3.5" style={{ background: "hsl(217 91% 60% / 0.05)", border: "1px solid hsl(217 91% 60% / 0.14)" }}>
                  <p className="text-sm text-foreground/75 leading-relaxed">
                    RobinOS combines automated moderation systems, abuse detection infrastructure, and human oversight to maintain a safe AI generation environment.
                  </p>
                </div>
                <BulletList items={[
                  "Automated content moderation active on every AI generation request",
                  "Multi-layer safety architecture: pre-generation prompt filtering + post-generation output validation",
                  "Centralized moderation engine with structured audit logging",
                  "Continuous policy enforcement through automated and human review systems",
                  "Regular safety infrastructure upgrades aligned with evolving AI safety standards",
                ]} />
              </Section>
            </motion.div>

            {/* 2. Moderation Pipeline */}
            <motion.div custom={1} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="moderation-pipeline">
                <SectionHeader icon={Activity} title="Moderation Pipeline" badge="ACTIVE" />
                <Paragraph>
                  Every AI generation request on RobinOS passes through a multi-layer moderation pipeline before and after AI processing. This dual-gate architecture prevents both deliberate misuse and accidental harmful generation.
                </Paragraph>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    { icon: Search, label: "Tier 1 — Prompt Scanning", desc: "Instant local classifier checks every prompt against prohibited content patterns before any AI call is made." },
                    { icon: Zap, label: "Tier 2 — AI Classification", desc: "Groq-powered safety classification runs on ambiguous prompts for deeper semantic analysis." },
                    { icon: Eye, label: "Tier 3 — Output Validation", desc: "Generated content is analyzed post-generation to detect any safety-filter bypass attempts." },
                    { icon: Server, label: "Tier 4 — Audit Logging", desc: "All moderation events are logged to a structured audit trail with severity, category, and timestamp." },
                  ].map((tier) => (
                    <div key={tier.label} className="rounded-xl p-4" style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 12%)" }}>
                      <div className="flex items-center gap-2 mb-2">
                        <tier.icon className="w-3.5 h-3.5 text-primary/70" />
                        <span className="text-[11px] font-semibold text-foreground/80">{tier.label}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/65 leading-relaxed">{tier.desc}</p>
                    </div>
                  ))}
                </div>
              </Section>
            </motion.div>

            {/* 3. Prompt Safety Filtering */}
            <motion.div custom={2} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="prompt-filtering">
                <SectionHeader icon={Lock} title="Prompt Safety Filtering" badge="PRE-GENERATION" />
                <Paragraph>
                  Before any user prompt reaches our AI provider, it is evaluated against RobinOS content safety rules. Prompts that match prohibited content patterns are immediately rejected — no AI call is made, and the event is logged.
                </Paragraph>
                <BulletList items={[
                  "Zero-latency local classifier runs on every prompt (no external API call required)",
                  "Pattern-based detection for explicit, violent, harmful, and illegal content categories",
                  "Semantic scoring system assigns risk levels: NONE / LOW / MEDIUM / HIGH / BLOCKED",
                  "BLOCKED prompts are rejected with a clear, policy-aligned error message",
                  "Repeated violation attempts trigger escalated review and account flagging",
                ]} />
              </Section>
            </motion.div>

            {/* 4. Output Safety Validation */}
            <motion.div custom={3} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="output-validation">
                <SectionHeader icon={CheckCircle2} title="Output Safety Validation" badge="POST-GENERATION" />
                <Paragraph>
                  AI-generated content is analyzed after generation before being displayed to the user. This post-generation gate catches jailbreak attempts, prompt injection outputs, and edge cases that bypass initial filtering.
                </Paragraph>
                <BulletList items={[
                  "Generated scripts, captions, and content are scanned for safety violations",
                  "Jailbreak detection identifies attempts to extract harmful instructions through creative framing",
                  "Unsafe outputs are suppressed and replaced with policy-compliant error messages",
                  "All blocked output events are logged with severity classification and content hash",
                  "Users who repeatedly trigger output blocks are automatically flagged for review",
                ]} />
              </Section>
            </motion.div>

            {/* 5. Blocked Content Categories */}
            <motion.div custom={4} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="blocked-content">
                <SectionHeader icon={Ban} title="Blocked Content Categories" />
                <Paragraph>
                  The following categories of content are explicitly prohibited on RobinOS. Generation requests in any of these categories are automatically blocked, logged, and may result in account action.
                </Paragraph>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {[
                    ["🔞", "NSFW / Sexually Explicit Content"],
                    ["👶", "Sexual Content Involving Minors (CSAM)"],
                    ["🚫", "Hate Speech & Discriminatory Content"],
                    ["⚔️", "Violence, Gore & Torture Content"],
                    ["💔", "Self-Harm & Suicide Facilitation"],
                    ["💣", "Extremism & Terrorist Propaganda"],
                    ["⚖️", "Illegal Activities & Criminal Instruction"],
                    ["🎭", "Deepfake Abuse & Non-Consensual Likeness"],
                    ["🎩", "Identity Fraud & Impersonation"],
                    ["©️", "Copyright Infringement at Scale"],
                    ["📧", "Harassment & Stalking Scripts"],
                    ["💀", "Graphic Gore & Shock Content"],
                    ["💰", "Scams, Fraud & Phishing Content"],
                    ["📢", "Automated Spam & Manipulation"],
                  ].map(([emoji, label]) => (
                    <div key={label} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted-foreground/75" style={{ background: "hsl(0 72% 55% / 0.04)", border: "1px solid hsl(0 72% 55% / 0.1)" }}>
                      <span>{emoji}</span>
                      <span className="text-[11.5px]">{label}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </motion.div>

            {/* 6. Abuse Prevention */}
            <motion.div custom={5} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="abuse-prevention">
                <SectionHeader icon={AlertTriangle} title="Abuse Prevention" badge="ACTIVE" />
                <Paragraph>
                  RobinOS operates rate limiting, abuse detection, and automated threat monitoring across all AI generation endpoints. Abuse prevention is enforced at both the API layer and the application layer.
                </Paragraph>
                {/* Governance statement */}
                <div className="mt-4 rounded-xl px-4 py-3.5" style={{ background: "hsl(38 92% 50% / 0.04)", border: "1px solid hsl(38 92% 50% / 0.12)" }}>
                  <p className="text-sm text-foreground/70 leading-relaxed">
                    Repeated policy violations trigger automated account restrictions and enforcement review. Accounts flagged by our abuse detection system are reviewed by the Trust & Safety team within 72 hours.
                  </p>
                </div>
                <BulletList items={[
                  "Per-user rate limits enforced on all AI generation features (daily and per-request)",
                  "Automated detection of repeated safety violation attempts within a session",
                  "Account-level risk scoring based on moderation event history",
                  "IP-level and account-level abuse flagging for escalated review",
                  "Fair usage monitoring for Agency plan users to prevent commercial abuse",
                  "Spam detection and automated content deduplication",
                  "API access suspended automatically on abuse threshold breach",
                ]} />
              </Section>
            </motion.div>

            {/* 7. Account Enforcement */}
            <motion.div custom={6} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="account-enforcement">
                <SectionHeader icon={UserX} title="Account Enforcement" />
                <Paragraph>
                  RobinOS maintains the right to restrict, suspend, or permanently terminate accounts that violate our Acceptable Use Policy or Terms of Service. Enforcement actions are proportional to violation severity.
                </Paragraph>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    { level: "Warning", color: "hsl(38 92% 50%)", desc: "Issued for first-time or minor policy violations. Generation continues with policy reminder." },
                    { level: "Suspension", color: "hsl(0 72% 55%)", desc: "Temporary restriction for repeated violations or moderate policy breaches. Access paused pending review." },
                    { level: "Termination", color: "hsl(0 72% 40%)", desc: "Permanent account removal for serious violations including CSAM, extremism, or persistent abuse." },
                  ].map((tier) => (
                    <div key={tier.level} className="rounded-xl p-4" style={{ background: "hsl(222 28% 6%)", border: `1px solid ${tier.color}22` }}>
                      <p className="text-sm font-semibold mb-1.5" style={{ color: tier.color }}>{tier.level}</p>
                      <p className="text-[11px] text-muted-foreground/65 leading-relaxed">{tier.desc}</p>
                    </div>
                  ))}
                </div>
              </Section>
            </motion.div>

            {/* 8. Human Oversight */}
            <motion.div custom={7} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="human-oversight">
                <SectionHeader icon={Eye} title="Human Oversight" />
                <Paragraph>
                  Automated moderation is the first line of defense, but human oversight is part of our safety architecture. Flagged accounts, escalated moderation events, and abuse reports are reviewed by the RobinOS Trust & Safety team.
                </Paragraph>
                <BulletList items={[
                  "Moderation events above HIGH severity threshold are escalated for human review",
                  "Abuse reports submitted by users are triaged and reviewed within 72 hours",
                  "Account termination decisions are reviewed by a senior trust & safety team member",
                  "Safety policy updates are reviewed and approved before deployment",
                  "Moderation system accuracy is monitored and improved continuously",
                ]} />
              </Section>
            </motion.div>

            {/* 9. Child Safety */}
            <motion.div custom={8} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="child-safety" className="border-red-500/20">
                <SectionHeader icon={ShieldCheck} title="Child Safety Commitment" badge="ZERO TOLERANCE" />
                <Paragraph>
                  RobinOS has a zero-tolerance policy for any content that exploits, endangers, or sexualizes minors. This is the most serious category in our safety infrastructure and is treated with absolute priority.
                </Paragraph>
                <div className="mt-4 rounded-xl p-4" style={{ background: "hsl(0 72% 55% / 0.05)", border: "1px solid hsl(0 72% 55% / 0.15)" }}>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Any prompt or generation attempt involving sexualization, exploitation, or endangerment of minors results in <strong className="text-foreground">immediate and permanent account termination</strong>, content removal, and — where required by law — reporting to relevant authorities including the National Center for Missing & Exploited Children (NCMEC) or equivalent jurisdiction authority.
                  </p>
                </div>
                <BulletList items={[
                  "CSAM detection runs at highest priority in our moderation pipeline",
                  "Zero-tolerance: no warnings, no appeals for CSAM-related violations",
                  "Account data preserved for law enforcement investigation where required",
                  "RobinOS complies with all mandatory CSAM reporting requirements",
                ]} />
              </Section>
            </motion.div>

            {/* 10. Copyright */}
            <motion.div custom={9} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="copyright">
                <SectionHeader icon={BookOpen} title="Copyright Protection" />
                <Paragraph>
                  RobinOS respects intellectual property rights. Our platform is designed to assist creators in generating original content, not to reproduce, replicate, or infringe on copyrighted works.
                </Paragraph>
                <BulletList items={[
                  "Users are responsible for ensuring their prompts do not violate copyright",
                  "Bulk reproduction of copyrighted material using RobinOS is prohibited",
                  "Copyright takedown requests can be submitted to support@tryrobin.xyz",
                  "Accounts engaged in systematic copyright infringement may be suspended",
                  "We respond to valid DMCA / copyright notices in accordance with applicable law",
                ]} />
              </Section>
            </motion.div>

            {/* 11. User Reporting */}
            <motion.div custom={10} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="reporting">
                <SectionHeader icon={Flag} title="User Reporting System" />
                <Paragraph>
                  RobinOS provides a reporting mechanism for users who encounter policy violations, abuse, or safety concerns. All reports are taken seriously and reviewed by our Trust & Safety team.
                </Paragraph>
                <BulletList items={[
                  "Report abuse or safety concerns at /report-abuse or support@tryrobin.xyz",
                  "Reports are triaged based on severity within 72 business hours",
                  "Reporters may remain anonymous — personal information is not disclosed",
                  "Confirmed violations result in immediate action and are logged to our audit system",
                  "Serial false reporters may be subject to account review",
                ]} />
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link to="/report-abuse" className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-primary transition-all hover:opacity-90" style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
                    <Flag className="w-3.5 h-3.5" /> Report Abuse
                  </Link>
                  <a href="mailto:support@tryrobin.xyz" className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-muted-foreground transition-all hover:text-foreground" style={{ border: "1px solid hsl(217 28% 14%)" }}>
                    <Scale className="w-3.5 h-3.5" /> Legal Inquiries
                  </a>
                </div>
              </Section>
            </motion.div>

            {/* 12. Platform Integrity */}
            <motion.div custom={11} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="platform-integrity">
                <SectionHeader icon={Globe} title="Platform Integrity" />
                <BulletList items={[
                  "All platform infrastructure is hosted on enterprise-grade cloud providers with SOC 2 compliance",
                  "Authentication is handled by Supabase Auth with JWT token validation on every API call",
                  "All API keys, credentials, and user data are encrypted at rest and in transit",
                  "RLS (Row-Level Security) policies restrict all database access to authorized users only",
                  "Service role keys are never exposed to client-side code",
                  "Admin panel access is protected by role-based access control with audit logging",
                  "Security events and moderation actions are logged with immutable audit trails",
                ]} />
              </Section>
            </motion.div>

            {/* 13. Responsible AI */}
            <motion.div custom={12} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="responsible-ai">
                <SectionHeader icon={HeartHandshake} title="Responsible AI Usage" />
                <Paragraph>
                  RobinOS is committed to responsible AI development and deployment. Our platform is designed to augment human creativity, not to replace human judgment or enable harmful automation.
                </Paragraph>
                <BulletList items={[
                  "AI-generated content is clearly identified as AI-generated throughout the platform",
                  "Users retain responsibility for how they use AI-generated content",
                  "RobinOS does not use user prompts to train AI models",
                  "AI providers (Groq) are selected based on responsible AI commitments",
                  "AI transparency disclosure is maintained at /ai-transparency",
                  "RobinOS aligns with the EU AI Act principles of transparency, safety, and human oversight",
                ]} />
              </Section>
            </motion.div>

            {/* 14. Enforcement Actions */}
            <motion.div custom={13} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="enforcement-actions">
                <SectionHeader icon={Scale} title="Enforcement Actions" />
                <Paragraph>
                  RobinOS reserves the right to take any of the following enforcement actions in response to confirmed policy violations, abuse, or safety concerns:
                </Paragraph>
                <BulletList items={[
                  "Immediate generation block with policy-aligned error message",
                  "Temporary content creation suspension (24h – 30 days)",
                  "Permanent account termination for serious or repeat violations",
                  "Subscription cancellation without refund for abuse violations (per Refund Policy)",
                  "IP-level access restriction for coordinated abuse",
                  "Legal referral for violations involving illegal activity or CSAM",
                  "Cooperation with law enforcement investigations where required by law",
                ]} />
              </Section>
            </motion.div>

            {/* 15. Contact */}
            <motion.div custom={14} variants={fadeUp} initial="hidden" animate="visible">
              <Section id="contact">
                <SectionHeader icon={FileText} title="Trust & Safety Contact" />
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    { label: "Abuse Reports", email: "support@tryrobin.xyz", desc: "Submit via /report-abuse or email support" },
                    { label: "Legal Inquiries", email: "support@tryrobin.xyz", desc: "DMCA, copyright, law enforcement requests" },
                    { label: "General Support", email: "support@tryrobin.xyz", desc: "Account issues, appeals, policy questions" },
                  ].map((contact) => (
                    <div key={contact.label} className="rounded-xl p-4" style={{ background: "hsl(222 28% 6.5%)", border: "1px solid hsl(217 28% 12%)" }}>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-1">{contact.label}</p>
                      {contact.label === "Abuse Reports" ? (
                        <Link to="/report-abuse" className="text-sm text-primary hover:underline font-mono block mb-1.5">/report-abuse</Link>
                      ) : (
                        <a href={`mailto:${contact.email}`} className="text-sm text-primary hover:underline font-mono block mb-1.5">{contact.email}</a>
                      )}
                      <p className="text-[11px] text-muted-foreground/55">{contact.desc}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-xs text-muted-foreground/50 leading-relaxed">
                  This Trust & Safety policy is effective as of January 1, 2025. RobinOS reserves the right to update this policy at any time. Material changes will be communicated to active users. For the latest version, visit{" "}
                  <Link to="/trust-safety" className="text-primary/70 hover:text-primary underline underline-offset-2">tryrobin.xyz/trust-safety</Link>.
                </p>
              </Section>
            </motion.div>

          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

export default TrustSafetyPage;
