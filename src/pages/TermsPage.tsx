import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import Lenis from "lenis";

const sections = [
  { title: "1. Acceptance of Terms", body: "By accessing or using RobinOS ('the Service'), you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use the Service. We reserve the right to update these terms at any time." },
  { title: "2. Account Registration", body: "You must provide accurate and complete information when creating an account. You are responsible for maintaining the security of your account credentials. You must be at least 18 years old to use the Service." },
  { title: "3. Subscription & Billing", body: "Paid plans are billed on a monthly or yearly basis as selected. Prices are listed in US Dollars (USD). Plans include Creator ($19/mo), Pro Creator ($39/mo), and Agency ($99/mo). All plans auto-renew unless cancelled before the renewal date. We offer a 14-day money-back guarantee on all plans. Cancellation can be done from your dashboard." },
  { title: "4. BYOK Responsibility", body: "When using the Bring Your Own Key (BYOK) feature, you are solely responsible for your API keys and their associated costs. We do not monitor, limit, or control your API usage with third-party providers. You are responsible for staying within your API provider's usage limits and terms. BYOK is available on Pro Creator and Agency plans." },
  { title: "5. Trending Audio & Hashtag Discovery", body: "The Trending Audio and Trending Hashtag features use AI to curate currently trending content across TikTok, Instagram, Facebook, and YouTube. Results are AI-generated suggestions based on current trends and may not be 100% accurate. Usage is subject to your plan's limits: Free (2 audio scans, 3 hashtag scans), Creator (50 audio, 70 hashtags — Instagram only), Pro Creator (200 audio, 200 hashtags — all platforms), Agency (unlimited audio, 500 hashtags — all platforms)." },
  { title: "6. Acceptable Use", body: "You agree not to use the Service for illegal purposes, spam generation, harassment, misinformation, or any content that violates applicable laws. We reserve the right to suspend accounts that violate this policy without prior notice." },
  { title: "7. Content Ownership", body: "You retain ownership of all content generated using the Service. We do not claim any intellectual property rights over scripts, trends, or other outputs created through your use of the platform. You grant us a limited license to process your inputs for service delivery." },
  { title: "8. Affiliate Program", body: "The affiliate program offers 30% commission on referred users' paid plan subscriptions. Monthly plan referrals earn recurring commission; yearly plan referrals earn a one-time 30% commission. Commission is credited when the referred user completes payment. Minimum withdrawal is $10. Fraudulent referrals or self-referrals will result in account termination." },
  { title: "9. Service Availability", body: "We aim to keep the service reliably available but do not guarantee uninterrupted access. Scheduled maintenance will be communicated in advance. We are not liable for downtime caused by third-party API providers (OpenAI, ElevenLabs, etc.)." },
  { title: "10. Limitation of Liability", body: "The Service is provided 'as is' without warranties of any kind. We are not liable for any indirect, incidental, or consequential damages arising from your use of the Service. Our total liability is limited to the amount paid by you in the 12 months preceding the claim." },
  { title: "11. Termination", body: "We may terminate or suspend your account at our discretion for violation of these terms. Upon termination, your right to use the Service ceases immediately. You may request data export before account closure." },
  { title: "12. Governing Law", body: "These terms are governed by applicable international commercial law principles and the governing jurisdiction defined in your active service agreement." },
];

const AnimatedSection = ({ s, i }: { s: typeof sections[0]; i: number }) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: i * 0.05 }}
    >
      <h2 className="text-sm font-medium text-foreground mb-3">{s.title}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed font-mono">{s.body}</p>
    </motion.div>
  );
};

const TermsPage = () => {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => {
    const lenis = new Lenis({ duration: 1.4, easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    function raf(time: number) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
    return () => lenis.destroy();
  }, []);

  return (
    <div className="relative bg-background grain select-none-all overflow-x-hidden min-h-screen">
      <div className="fixed top-6 left-6 z-50">
        <Link to="/" className="flex items-center gap-2 px-4 py-2 rounded-lg glass text-xs font-mono tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Home
        </Link>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-24 sm:pt-28 pb-20">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
          <p className="text-xs font-mono tracking-[0.3em] uppercase text-muted-foreground mb-4">Legal</p>
          <h1 className="text-chrome text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight mb-2">Terms of Service</h1>
          <p className="text-xs text-muted-foreground/60 font-mono mb-12">Last updated: March 2026</p>
        </motion.div>

        <div className="space-y-10">
          {sections.map((s, i) => (
            <AnimatedSection key={s.title} s={s} i={i} />
          ))}
        </div>
      </div>

      <footer className="border-t border-border py-12 px-4 sm:px-6">
        <p className="text-center text-muted-foreground/40 text-xs">© {new Date().getFullYear()} RobinOS. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default TermsPage;
