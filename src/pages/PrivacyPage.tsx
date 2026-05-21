import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import Lenis from "lenis";

const sections = [
  { title: "1. Information We Collect", body: "We collect information you provide directly: email address, display name, and optionally your API keys (OpenAI, ElevenLabs) which are encrypted at rest using AES-256 encryption. We also collect usage data including scan queries, generated scripts, trending audio/hashtag searches, and interaction patterns to improve our service." },
  { title: "2. How We Use Your Data", body: "Your data is used to provide and improve our services, including trend scanning, script generation, trending audio discovery, trending hashtag discovery, and personalized recommendations. API keys are used solely to make requests on your behalf to third-party providers. We never use your API keys for our own purposes or share them with any third party." },
  { title: "3. API Key Handling (BYOK)", body: "When you provide API keys through our Bring Your Own Key (BYOK) system, they are encrypted and stored securely. Keys are only decrypted at the moment of API calls and are never logged, cached, or stored in plaintext. You can delete your keys at any time from the Settings page. BYOK is available on Pro Creator and Agency plans." },
  { title: "4. Trending Audio & Hashtag Data", body: "Our Trending Audio and Trending Hashtag features use AI to analyze current trends across TikTok, Instagram, Facebook, and YouTube. We track your usage counts (audio scans and hashtag scans) to enforce plan limits. This usage data is stored in your profile and resets monthly." },
  { title: "5. Data Storage & Security", body: "All data is stored on encrypted servers with row-level security policies ensuring users can only access their own data. We use industry-standard encryption for data in transit (TLS 1.3) and at rest (AES-256). Our infrastructure is hosted on enterprise-grade cloud providers." },
  { title: "6. Referral & Affiliate Data", body: "When you participate in our affiliate program, we track referral links, referred user signups, and commission payments. Referral data includes your unique code, referred user IDs, commission amounts, and withdrawal history. This data is used solely for affiliate program administration." },
  { title: "7. Data Retention", body: "Your scan history, generated scripts, trending audio/hashtag search history are retained indefinitely as part of your account history. Upon account deletion, all personal data including API keys, scan history, and generated content will be permanently deleted within 30 days." },
  { title: "8. Third-Party Services", body: "We integrate with OpenAI and ElevenLabs APIs using your provided keys. These services have their own privacy policies. We also use AI services for trending audio/hashtag curation. No personally identifiable information is shared with analytics providers." },
  { title: "9. Your Rights", body: "You have the right to access, correct, or delete your personal data at any time. You can export your data, revoke API key access, and close your account from the Settings page. For data requests, contact us at support@tryrobin.xyz." },
  { title: "10. Updates to This Policy", body: "We may update this policy from time to time. We will notify you of any material changes via email or in-app notification. Continued use of the service after changes constitutes acceptance of the updated policy." },
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

const PrivacyPage = () => {
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
          <h1 className="text-chrome text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight mb-2">Privacy Policy</h1>
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

export default PrivacyPage;
