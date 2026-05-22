import { motion } from "framer-motion";
import { Shield, Ban, CheckCircle2, Scale, Flag, AlertTriangle, Gavel } from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { PageSeo } from "@/components/seo/PageSeo";
import { Link } from "react-router-dom";

function Section({ id, title, icon: Icon, children }: { id: string; title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <motion.section
      id={id}
      className="scroll-mt-24"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.45 }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "hsl(217 91% 60% / 0.1)", border: "1px solid hsl(217 91% 60% / 0.2)" }}>
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="pl-11 space-y-3">{children}</div>
    </motion.section>
  );
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground leading-relaxed select-text">{children}</p>;
}

function BulletList({ items, color = "text-primary/60" }: { items: string[]; color?: string }) {
  return (
    <ul className="space-y-2 mt-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${color}`} />
          <span className="select-text">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function BlockedList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <Ban className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400/60" />
          <span className="select-text">{item}</span>
        </li>
      ))}
    </ul>
  );
}

const toc = [
  { id: "overview", label: "Overview" },
  { id: "permitted", label: "Permitted Uses" },
  { id: "prohibited-general", label: "Prohibited Uses — General" },
  { id: "prohibited-ai", label: "Prohibited AI Content" },
  { id: "prohibited-illegal", label: "Illegal & Criminal Content" },
  { id: "prohibited-harassment", label: "Harassment & Abuse" },
  { id: "prohibited-deception", label: "Deception & Fraud" },
  { id: "child-safety", label: "Child Safety" },
  { id: "account-responsibility", label: "Account Responsibility" },
  { id: "enforcement", label: "Enforcement & Consequences" },
  { id: "reporting", label: "Reporting Violations" },
  { id: "appeals", label: "Appeals Process" },
  { id: "changes", label: "Policy Changes" },
];

export function AcceptableUsePolicyPage() {
  return (
    <PublicLayout>
      <PageSeo
        title="Acceptable Use Policy — RobinOS"
        description="RobinOS Acceptable Use Policy: permitted uses, prohibited content, enforcement actions, and account responsibilities for all platform users."
        canonicalPath="/acceptable-use-policy"
      />

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative mx-auto grid w-full max-w-[1240px] gap-6 px-4 pb-16 pt-14 sm:px-6 sm:pb-20 lg:grid-cols-[260px_1fr] lg:pt-20"
      >
        <div className="pointer-events-none absolute left-0 right-0 top-6 h-40 select-none bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.1),transparent_70%)]" />

        {/* TOC Sidebar */}
        <motion.aside
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="relative h-fit select-none rounded-xl border border-border/60 bg-card/40 p-4 backdrop-blur-md lg:sticky lg:top-24"
        >
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/60">On this page</p>
          <div className="mt-3 h-px bg-gradient-to-r from-primary/40 via-border/70 to-transparent mb-3" />
          <ul className="space-y-2.5">
            {toc.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="block text-xs text-muted-foreground transition-colors hover:text-foreground">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </motion.aside>

        {/* Main content */}
        <main className="relative overflow-hidden rounded-xl border border-border/60 bg-card/40 p-6 backdrop-blur-md sm:p-8 lg:p-9">
          <div className="pointer-events-none absolute -right-16 top-10 h-52 w-52 select-none rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -left-12 bottom-10 h-44 w-44 select-none rounded-full bg-accent/8 blur-3xl" />

          <div className="relative mb-8">
            <p className="select-none text-[10px] font-mono uppercase tracking-[0.18em] text-foreground/60">Legal Documentation</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Acceptable Use Policy</h1>
            <p className="mt-2 select-text text-sm text-muted-foreground">Effective date: January 1, 2025 · Last updated: May 2026</p>
            <p className="mt-3 text-sm text-muted-foreground/70 leading-relaxed max-w-xl">
              This Acceptable Use Policy ("AUP") governs all use of RobinOS services. By accessing or using RobinOS, you agree to comply with this AUP. Violations may result in account suspension or permanent termination.
            </p>
          </div>

          <div className="relative space-y-10">
            <div className="h-px bg-gradient-to-r from-primary/40 via-border/60 to-transparent" />

            <Section id="overview" title="Overview" icon={Shield}>
              <Para>
                RobinOS provides AI-powered content generation tools for creators, marketers, and media professionals. This platform is made available exclusively for lawful, ethical, and constructive purposes. The following policy defines what is permitted and what is strictly prohibited on RobinOS.
              </Para>
              <Para>
                RobinOS maintains automated moderation systems, human oversight processes, and enforcement mechanisms to ensure platform integrity. Accessing RobinOS constitutes acceptance of this policy in its entirety.
              </Para>
            </Section>

            <Section id="permitted" title="Permitted Uses" icon={CheckCircle2}>
              <Para>RobinOS may be used for the following lawful and constructive purposes:</Para>
              <BulletList items={[
                "Creating original content scripts, captions, and marketing copy for social media",
                "Generating trend research and content ideas for creators and brands",
                "Producing voice-over scripts for videos, podcasts, and presentations",
                "Building legitimate business marketing and content workflows",
                "Educational content creation aligned with applicable platform guidelines",
                "Professional content strategy and creative direction assistance",
                "Language translation and content repurposing for global audiences",
                "Research, ideation, and concept development for creative projects",
              ]} />
            </Section>

            <Section id="prohibited-general" title="Prohibited Uses — General" icon={Ban}>
              <Para>The following uses of RobinOS are strictly prohibited and will result in enforcement action:</Para>
              <BlockedList items={[
                "Using RobinOS for any purpose that violates applicable local, national, or international laws",
                "Attempting to bypass, circumvent, or undermine RobinOS content safety systems",
                "Using RobinOS to generate content in violation of any third-party rights",
                "Sharing account credentials or providing unauthorized access to others",
                "Using automated scripts, bots, or crawlers to abuse RobinOS services",
                "Reverse engineering, decompiling, or attempting to extract RobinOS proprietary systems",
                "Reselling RobinOS AI outputs as a standalone AI product without transformative use",
                "Using RobinOS to build competing services without prior written consent",
              ]} />
            </Section>

            <Section id="prohibited-ai" title="Prohibited AI Content" icon={AlertTriangle}>
              <Para>The following types of AI-generated content are explicitly prohibited. Prompts and generation attempts in these categories will be blocked, logged, and may trigger account action:</Para>
              <BlockedList items={[
                "Sexually explicit, pornographic, or NSFW content of any kind",
                "Content that sexualizes, exploits, or endangers minors under any circumstances",
                "Deepfake content or synthetic media using real individuals without consent",
                "Non-consensual intimate imagery (NCII) generation attempts",
                "Hate speech, discriminatory content, or material that promotes hostility based on protected characteristics",
                "Content glorifying, promoting, or facilitating violence, self-harm, or suicide",
                "Extremist, terrorist, or radicalization content of any kind",
                "Medical misinformation, false health claims, or dangerous health advice",
                "Content designed to manipulate, deceive, or psychologically harm users",
              ]} />
            </Section>

            <Section id="prohibited-illegal" title="Illegal & Criminal Content" icon={Gavel}>
              <Para>RobinOS absolutely prohibits generation of content that facilitates, instructs, or promotes illegal activity:</Para>
              <BlockedList items={[
                "Instructions for creating weapons, explosives, or dangerous materials",
                "Drug synthesis guides or instructions for producing controlled substances",
                "Money laundering schemes, tax evasion tactics, or financial fraud instructions",
                "Hacking tutorials, malware scripts, or cyberattack methodology",
                "Human trafficking, labor exploitation, or modern slavery facilitation",
                "Counterfeit documentation or identity fraud content",
                "Content designed to manipulate financial markets or securities fraud",
                "Animal cruelty promotion or illegal wildlife trade facilitation",
              ]} />
            </Section>

            <Section id="prohibited-harassment" title="Harassment & Abuse" icon={Flag}>
              <BlockedList items={[
                "Content designed to harass, threaten, intimidate, or bully individuals or groups",
                "Doxxing scripts or content intended to expose private personal information",
                "Stalking facilitation or content designed to enable surveillance of individuals",
                "Coordinated harassment campaigns or targeted abuse operations",
                "Defamation, false statements of fact, or reputational damage content",
                "Swatting-related content or false emergency reports",
              ]} />
            </Section>

            <Section id="prohibited-deception" title="Deception & Fraud" icon={AlertTriangle}>
              <BlockedList items={[
                "Phishing scripts, social engineering attacks, or identity deception content",
                "Fake news, fabricated journalism, or coordinated disinformation campaigns",
                "Impersonation of real public figures, organizations, or institutions",
                "Scam scripts, pyramid scheme promotion, or fraudulent investment content",
                "Fake reviews, astroturfing content, or manufactured social proof",
                "Spam content designed for mass distribution or inbox flooding",
                "Misleading advertising, false product claims, or deceptive marketing",
              ]} />
            </Section>

            <Section id="child-safety" title="Child Safety — Absolute Prohibition" icon={Shield}>
              <div className="rounded-xl p-4" style={{ background: "hsl(0 72% 55% / 0.05)", border: "1px solid hsl(0 72% 55% / 0.15)" }}>
                <p className="text-sm font-semibold text-red-400/90 mb-2">Zero Tolerance Policy</p>
                <Para>
                  Any attempt to use RobinOS to generate content that sexually exploits, endangers, or harms children in any way is an absolute violation. This includes CSAM (Child Sexual Abuse Material), grooming content, child exploitation facilitation, and any content involving minors in sexual or harmful contexts.
                </Para>
                <p className="mt-3 text-sm text-muted-foreground/80 leading-relaxed">
                  Violations result in <strong className="text-foreground">immediate and permanent account termination</strong> with no possibility of appeal. Account data will be preserved for and reported to law enforcement authorities as required by applicable law, including mandatory CSAM reporting obligations.
                </p>
              </div>
            </Section>

            <Section id="account-responsibility" title="Account Responsibility" icon={Shield}>
              <Para>
                You are fully responsible for all activity that occurs under your RobinOS account. This responsibility cannot be transferred or delegated.
              </Para>
              <BulletList items={[
                "You must keep your account credentials secure and not share them with others",
                "You are responsible for any content generated using your account credentials",
                "You must notify RobinOS immediately if you suspect unauthorized account access",
                "You must ensure that any team members or agents using your account comply with this AUP",
                "Commercial accounts bear responsibility for ensuring all users comply with this policy",
              ]} />
            </Section>

            <Section id="enforcement" title="Enforcement & Consequences" icon={Gavel}>
              <Para>
                RobinOS maintains the right to take any of the following actions in response to AUP violations. Enforcement actions are determined based on violation severity, frequency, and nature.
              </Para>
              <div className="mt-4 space-y-3">
                {[
                  { title: "Content Block", desc: "Individual generation request blocked and logged. User receives policy-aligned error message.", severity: "Minor" },
                  { title: "Feature Restriction", desc: "Access to specific AI generation features temporarily suspended pending review.", severity: "Moderate" },
                  { title: "Account Suspension", desc: "Full account access suspended for 24 hours to 30 days pending investigation.", severity: "Serious" },
                  { title: "Subscription Termination", desc: "Subscription cancelled without refund (per Refund Policy). Access permanently removed.", severity: "Severe" },
                  { title: "Legal Action", desc: "For violations involving illegal activity, law enforcement referral and legal proceedings.", severity: "Criminal" },
                ].map((action) => (
                  <div key={action.title} className="flex items-start gap-3 rounded-lg px-4 py-3" style={{ background: "hsl(222 28% 6%)", border: "1px solid hsl(217 28% 11%)" }}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground/80">{action.title}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(217 28% 10%)", color: "hsl(var(--muted-foreground) / 0.4)" }}>{action.severity}</span>
                      </div>
                      <p className="text-[11.5px] text-muted-foreground/65">{action.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section id="reporting" title="Reporting Violations" icon={Flag}>
              <Para>
                If you observe content or behavior that violates this Acceptable Use Policy, we encourage you to report it immediately. RobinOS investigates all reports and takes appropriate action.
              </Para>
              <Para>
                To report a violation: <a href="mailto:support@tryrobin.xyz" className="text-primary hover:underline font-mono">support@tryrobin.xyz</a>
              </Para>
              <BulletList items={[
                "Reports are triaged by severity within 72 business hours",
                "Reporters may remain anonymous",
                "You will receive confirmation that your report has been received",
                "Personal information of reporters is kept confidential",
              ]} />
            </Section>

            <Section id="appeals" title="Appeals Process" icon={Scale}>
              <Para>
                If you believe an enforcement action taken against your account was in error, you may submit an appeal to <a href="mailto:support@tryrobin.xyz" className="text-primary hover:underline font-mono">support@tryrobin.xyz</a> within 14 days of the enforcement action.
              </Para>
              <BulletList items={[
                "Appeals are reviewed by a senior trust & safety team member",
                "Appeal decisions are final for enforcement actions related to CSAM, extremism, or serious crimes",
                "Account suspensions may be reversed pending successful appeal review",
                "Permanent terminations for serious AUP violations are generally not subject to reversal",
              ]} />
            </Section>

            <Section id="changes" title="Policy Changes" icon={Shield}>
              <Para>
                RobinOS reserves the right to update this Acceptable Use Policy at any time. Material changes will be communicated to active users via email or in-app notification. Continued use of RobinOS following policy updates constitutes acceptance of the revised terms.
              </Para>
              <Para>
                For questions about this policy, contact us at <a href="mailto:support@tryrobin.xyz" className="text-primary hover:underline font-mono">support@tryrobin.xyz</a>.
              </Para>
              <Para>
                See also: <Link to="/trust-safety" className="text-primary hover:underline">Trust & Safety Center</Link> · <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link> · <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
              </Para>
            </Section>

          </div>
        </main>
      </motion.section>
    </PublicLayout>
  );
}

export default AcceptableUsePolicyPage;
