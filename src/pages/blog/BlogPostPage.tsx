import { useMemo } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Clock, Calendar, Tag } from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { PageSeo } from "@/components/seo/PageSeo";
import { BLOG_POSTS } from "@/data/blogPosts";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    "AI Tools":        { bg: "hsl(217 91% 60% / 0.08)", text: "hsl(217 91% 68%)", border: "hsl(217 91% 60% / 0.2)" },
    "Growth Strategy": { bg: "hsl(142 70% 45% / 0.08)", text: "hsl(142 70% 58%)", border: "hsl(142 70% 45% / 0.2)" },
    "Content Creation":{ bg: "hsl(38 92% 50% / 0.08)",  text: "hsl(38 92% 62%)",  border: "hsl(38 92% 50% / 0.2)" },
    "Creator Economy": { bg: "hsl(280 70% 60% / 0.08)", text: "hsl(280 70% 70%)", border: "hsl(280 70% 60% / 0.2)" },
    "Productivity":    { bg: "hsl(172 70% 40% / 0.08)", text: "hsl(172 70% 58%)", border: "hsl(172 70% 40% / 0.2)" },
  };
  const c = colors[category] ?? colors["AI Tools"];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em]"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {category}
    </span>
  );
}

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const post = useMemo(() => BLOG_POSTS.find((p) => p.slug === slug), [slug]);

  const related = useMemo(() => {
    if (!post) return [];
    return BLOG_POSTS.filter((p) => p.slug !== post.slug && p.category === post.category).slice(0, 3);
  }, [post]);

  if (!post) return <Navigate to="/blog" replace />;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": post.title,
    "description": post.metaDescription,
    "datePublished": post.publishedAt,
    "author": { "@type": "Organization", "name": "RobinOS" },
    "publisher": { "@type": "Organization", "name": "RobinOS", "url": "https://tryrobin.xyz" },
    "url": `https://tryrobin.xyz/blog/${post.slug}`,
  };

  return (
    <PublicLayout>
      <PageSeo
        title={post.metaTitle}
        description={post.metaDescription}
        canonicalPath={`/blog/${post.slug}`}
        keywords={post.tags.join(", ")}
        structuredData={structuredData}
      />

      <article className="mx-auto w-full max-w-[1200px] px-4 pb-20 pt-14 sm:px-6 sm:pt-20">
        <div className="lg:grid lg:grid-cols-[1fr_280px] lg:gap-10">
          {/* Main content */}
          <div>
            {/* Back link */}
            <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }} className="mb-8">
              <Link
                to="/blog"
                className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Blog
              </Link>
            </motion.div>

            {/* Article header */}
            <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-8">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <CategoryBadge category={post.category} />
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/40">
                  <Clock className="w-3 h-3" /> {post.readTime} min read
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/40">
                  <Calendar className="w-3 h-3" /> {formatDate(post.publishedAt)}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground mb-4 leading-tight">
                {post.title}
              </h1>

              <p className="text-base text-muted-foreground/70 leading-relaxed border-l-2 border-primary/30 pl-4">
                {post.excerpt}
              </p>
            </motion.header>

            {/* Article body */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="prose-blog rounded-2xl p-6 sm:p-8 lg:p-10"
              style={{
                background: "linear-gradient(160deg, hsl(222 28% 8.5% / 0.97) 0%, hsl(222 22% 7% / 0.97) 100%)",
                border: "1px solid hsl(217 28% 13%)",
              }}
              dangerouslySetInnerHTML={{ __html: post.content }}
            />

            {/* Tags */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-6 flex flex-wrap items-center gap-2">
              <Tag className="w-3.5 h-3.5 text-muted-foreground/30" />
              {post.tags.map((tag) => (
                <span key={tag} className="text-[10px] font-mono px-2.5 py-1 rounded-lg text-muted-foreground/50"
                  style={{ background: "hsl(217 28% 9%)", border: "1px solid hsl(217 28% 13%)" }}>
                  {tag}
                </span>
              ))}
            </motion.div>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="mt-8 rounded-2xl p-6 sm:p-8"
              style={{
                background: "linear-gradient(135deg, hsl(217 91% 60% / 0.06), hsl(217 91% 60% / 0.02))",
                border: "1px solid hsl(217 91% 60% / 0.15)",
              }}
            >
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/50 mb-2">Try RobinOS</p>
              <h3 className="text-lg font-semibold text-foreground mb-2">Put these strategies into practice</h3>
              <p className="text-sm text-muted-foreground/60 mb-4 leading-relaxed">
                RobinOS gives you AI-powered trend research, script generation, and content intelligence — everything you need to create faster and grow consistently.
              </p>
              <a
                href="https://tryrobin.xyz"
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-sm font-medium text-white transition-all"
                style={{ background: "hsl(217 91% 55%)", boxShadow: "0 4px 16px hsl(217 91% 60% / 0.25)" }}
              >
                Start free with RobinOS
              </a>
            </motion.div>
          </div>

          {/* Sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-6">
              {/* Related articles */}
              {related.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.45, delay: 0.2 }}
                  className="rounded-2xl p-5"
                  style={{
                    background: "linear-gradient(160deg, hsl(222 28% 8.5% / 0.97) 0%, hsl(222 22% 7% / 0.97) 100%)",
                    border: "1px solid hsl(217 28% 13%)",
                  }}
                >
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/40 mb-4">Related Articles</p>
                  <div className="space-y-4">
                    {related.map((rel) => (
                      <Link key={rel.slug} to={`/blog/${rel.slug}`} className="block group">
                        <p className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors leading-snug mb-1">
                          {rel.title}
                        </p>
                        <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/35">
                          <Clock className="w-3 h-3" /> {rel.readTime} min
                        </span>
                      </Link>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* All articles link */}
              <motion.div
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: 0.3 }}
              >
                <Link
                  to="/blog"
                  className="flex items-center justify-between w-full rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground/60 hover:text-foreground transition-colors"
                  style={{ background: "hsl(222 28% 8%)", border: "1px solid hsl(217 28% 13%)" }}
                >
                  View all articles
                  <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
                </Link>
              </motion.div>
            </div>
          </aside>
        </div>
      </article>
    </PublicLayout>
  );
}
