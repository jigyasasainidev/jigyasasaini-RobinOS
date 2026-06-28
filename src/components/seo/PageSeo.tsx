import { Helmet } from "react-helmet-async";

const SITE_URL    = "https://tryrobin.xyz";
const SITE_NAME   = "RobinOS";
const TWITTER_HANDLE = "@tryrobinos";
const DEFAULT_OG_IMAGE = `${SITE_URL}/robinos-logo.png`;

type PageSeoProps = {
  title:         string;
  description:   string;
  canonicalPath: string;          // e.g. "/pricing" or full URL
  ogType?:       "website" | "article";
  keywords?:     string;
  noindex?:      boolean;
  ogImage?:      string;          // absolute URL or path — defaults to logo
  structuredData?: Record<string, unknown> | Array<Record<string, unknown>>;
};

export function PageSeo({
  title,
  description,
  canonicalPath,
  ogType = "website",
  keywords,
  noindex = false,
  ogImage,
  structuredData,
}: PageSeoProps) {
  const schemas = Array.isArray(structuredData)
    ? structuredData
    : structuredData ? [structuredData] : [];

  // Resolve canonical to absolute URL
  const canonical = canonicalPath.startsWith("http")
    ? canonicalPath
    : `${SITE_URL}${canonicalPath}`;

  // Resolve OG image to absolute URL
  const resolvedOgImage = ogImage
    ? (ogImage.startsWith("http") ? ogImage : `${SITE_URL}${ogImage}`)
    : DEFAULT_OG_IMAGE;

  return (
    <Helmet>
      {/* Primary */}
      <title>{title}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      {noindex
        ? <meta name="robots" content="noindex, nofollow" />
        : <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" />
      }
      <link rel="canonical" href={canonical} />

      {/* Open Graph */}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonical} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={resolvedOgImage} />
      <meta property="og:image:alt" content={title} />
      <meta property="og:locale" content="en_US" />

      {/* Twitter / X */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={TWITTER_HANDLE} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={resolvedOgImage} />
      <meta name="twitter:image:alt" content={title} />

      {/* Structured data */}
      {schemas.map((schema, i) => (
        <script key={`${canonical}-schema-${i}`} type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
}

// ── SEO config for all public routes ──────────────────────
// Centralised so titles/descriptions are never duplicated.
export const PAGE_SEO: Record<string, { title: string; description: string; keywords?: string }> = {
  "/": {
    title: "RobinOS — AI Content Operating System for Creators",
    description: "RobinOS helps creators discover viral trends, generate scripts, find trending audio and hashtags, and create high-performing content using AI.",
    keywords: "AI content creator tool, viral script generator, AI trend scanner, trending audio, hashtag discovery, TikTok script, Instagram Reels AI, YouTube Shorts script",
  },
  "/pricing": {
    title: "Pricing — RobinOS AI Creator Tools",
    description: "Simple, transparent pricing for creators. Free trial available. Upgrade to unlock unlimited AI scripts, trend scanning, voice studio, and more.",
    keywords: "RobinOS pricing, AI creator tool pricing, content creator subscription",
  },
  "/affiliates": {
    title: "Affiliate Program — Earn with RobinOS",
    description: "Join the RobinOS affiliate program and earn recurring commissions by referring creators to the AI content operating system.",
    keywords: "RobinOS affiliate program, creator tool affiliate, recurring commission",
  },
  "/launch-partners": {
    title: "Launch Partners — RobinOS Affiliate Program",
    description: "Become a RobinOS launch partner. Earn 60% recurring commission promoting the AI content operating system for creators.",
    keywords: "RobinOS launch partners, affiliate program, creator tool commission",
  },
  "/jvzoo": {
    title: "Creator OS — AI-Powered Content Operating System",
    description: "RobinOS Creator OS: the complete AI workflow for modern creators. Trend scanning, script generation, voice studio, and content intelligence in one platform.",
  },
  "/about": {
    title: "About RobinOS — AI Content Operating System",
    description: "Learn about RobinOS — the AI-powered content operating system built for modern creators, agencies, and personal brands.",
  },
  "/contact": {
    title: "Contact RobinOS — Creator Support",
    description: "Get in touch with the RobinOS team for creator support, billing questions, affiliate inquiries, and platform feedback.",
  },
  "/help": {
    title: "Help Center — RobinOS",
    description: "Find answers to common questions about RobinOS — billing, account access, AI workflows, and affiliate program support.",
  },
  "/creator-guide": {
    title: "Creator Guide — RobinOS AI Workflows",
    description: "Learn how to use RobinOS for trend scanning, script generation, and building repeatable AI content workflows.",
  },
  "/affiliate-guide": {
    title: "Affiliate Guide — RobinOS Partner Program",
    description: "Everything you need to know about the RobinOS affiliate program — referral mechanics, commissions, payouts, and best practices.",
  },
  "/privacy": {
    title: "Privacy Policy — RobinOS",
    description: "RobinOS Privacy Policy: how we collect, use, and protect your data as a creator using our AI content platform.",
  },
  "/terms": {
    title: "Terms of Service — RobinOS",
    description: "RobinOS Terms of Service: platform usage rules, subscription terms, and creator responsibilities.",
  },
};
