import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, Clock, ArrowRight, BookOpen } from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { PageSeo } from "@/components/seo/PageSeo";
import { BLOG_POSTS } from "@/data/blogPosts";

const CATEGORIES = ["All", ...Array.from(new Set(BLOG_POSTS.map((p) => p.category)))];

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

function ArticleCard({ post, featured = false, index = 0 }: { post: typeof BLOG_POSTS[0]; featured?: boolean; index?: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.05 }}
      className={`group relative rounded-2xl overflow-hidden ${featured ? "md:col-span-2" : ""}`}
      style={{
        background: "linear-gradient(160deg, hsl(222 28% 8.5% / 0.97) 0%, hsl(222 22% 7% / 0.97) 100%)",
        border: "1px solid hsl(217 28% 13%)",
        boxShadow: "0 4px 24px hsl(0 0% 0% / 0.25)",
      }}
      whileHover={{ y: -3, boxShadow: "0 12px 40px hsl(0 0% 0% / 0.4), 0 0 0 1px hsl(217 91% 60% / 0.15)" }}
    >
      {/* Top glow line */}
      <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent 0%, hsl(217 91% 60% / 0.1) 40%, hsl(217 91% 60% / 0.1) 60%, transparent 100%)" }} />

      <div className={`p-6 ${featured ? "md:p-8" : ""}`}>
        <div className="flex items-center gap-3 mb-4">
          <CategoryBadge category={post.category} />
          <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/40">
            <Clock className="w-3 h-3" />
            {post.readTime} min read
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/30 ml-auto">
            {formatDate(post.publishedAt)}
          </span>
        </div>

        <h2 className={`font-semibold tracking-tight text-foreground/90 mb-3 group-hover:text-foreground transition-colors ${featured ? "text-xl md:text-2xl" : "text-base"}`}>
          {post.title}
        </h2>

        <p className="text-sm text-muted-foreground/60 leading-relaxed mb-5 line-clamp-2">
          {post.excerpt}
        </p>

        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-1.5">
            {post.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="text-[9px] font-mono px-2 py-0.5 rounded-md text-muted-foreground/40"
                style={{ background: "hsl(217 28% 10%)", border: "1px solid hsl(217 28% 14%)" }}>
                {tag}
              </span>
            ))}
          </div>
          <Link
            to={`/blog/${post.slug}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary/70 group-hover:text-primary transition-colors"
          >
            Read article <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </motion.article>
  );
}

export default function BlogPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const filtered = useMemo(() => {
    return BLOG_POSTS.filter((post) => {
      const matchesCategory = activeCategory === "All" || post.category === activeCategory;
      const q = search.toLowerCase();
      const matchesSearch = !q || post.title.toLowerCase().includes(q) || post.excerpt.toLowerCase().includes(q) || post.tags.some((t) => t.toLowerCase().includes(q));
      return matchesCategory && matchesSearch;
    });
  }, [search, activeCategory]);

  const featured = filtered[0];
  const rest = filtered.slice(1);

  return (
    <PublicLayout>
      <PageSeo
        title="Blog — RobinOS | AI Content Creation for Creators"
        description="Guides, strategies, and insights for content creators. Learn how to use AI tools, find viral trends, grow on TikTok and Instagram, and build a sustainable creator business."
        canonicalPath="/blog"
        keywords="content creator blog, AI tools for creators, TikTok growth, Instagram Reels strategy, viral content tips"
      />

      <section className="mx-auto w-full max-w-[1200px] px-4 pb-20 pt-14 sm:px-6 sm:pt-20">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-10">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground/50">Creator Resources</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-3">
            RobinOS Blog
          </h1>
          <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
            Practical guides on AI tools, content strategy, and creator growth. Written for creators who want to work smarter.
          </p>
        </motion.div>

        {/* Search + Filter */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search articles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 h-10 rounded-xl text-sm bg-card/40 border border-border/60 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className="h-10 px-4 rounded-xl text-xs font-medium transition-all"
                style={
                  activeCategory === cat
                    ? { background: "hsl(217 91% 60% / 0.12)", border: "1px solid hsl(217 91% 60% / 0.3)", color: "hsl(217 91% 68%)" }
                    : { background: "hsl(222 28% 8%)", border: "1px solid hsl(217 28% 13%)", color: "hsl(var(--muted-foreground) / 0.5)" }
                }
              >
                {cat}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Results count */}
        {search || activeCategory !== "All" ? (
          <p className="text-xs font-mono text-muted-foreground/40 mb-6">
            {filtered.length} article{filtered.length !== 1 ? "s" : ""} found
          </p>
        ) : null}

        {/* Articles grid */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-muted-foreground/40 text-sm">No articles match your search.</p>
            <button onClick={() => { setSearch(""); setActiveCategory("All"); }} className="mt-3 text-xs text-primary/60 hover:text-primary transition-colors">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Featured article */}
            {featured && !search && activeCategory === "All" && (
              <div className="mb-2">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/30 mb-3">Featured</p>
                <ArticleCard post={featured} featured index={0} />
              </div>
            )}

            {/* Article grid */}
            <div>
              {(!search && activeCategory === "All") && rest.length > 0 && (
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/30 mb-3">All Articles</p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(search || activeCategory !== "All" ? filtered : rest).map((post, i) => (
                  <ArticleCard key={post.slug} post={post} index={i} />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
