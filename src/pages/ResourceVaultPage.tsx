import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Download,
  Star,
  FileText,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";

import { db } from "@/lib/cloudDb";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PublicLayout } from "@/components/public/PublicLayout";
import { PageSeo } from "@/components/seo/PageSeo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const CATEGORIES = [
  "Content Creation",
  "Marketing",
  "AI Tools",
  "Growth",
  "Personal Branding",
  "Productivity",
  "Templates",
] as const;

type ResourceRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  pdf_url: string;
  cover_image_url: string | null;
  featured: boolean;
  download_count: number;
  created_at: string;
  updated_at: string;
};

function getPublicUrl(bucket: string, path: string) {
  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);
  return publicUrl;
}

function ResourceCard({ resource }: { resource: ResourceRow }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.25 }}
      className="group relative flex flex-col rounded-2xl border border-border/40 bg-card/30 overflow-hidden hover:border-border/60 hover:bg-card/50 transition-all"
    >
      <Link to={`/resources/${resource.slug}`} className="block relative aspect-[16/10] overflow-hidden bg-muted">
        {resource.cover_image_url ? (
          <img
            src={getPublicUrl("resource-covers", resource.cover_image_url)}
            alt={resource.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <FileText className="w-12 h-12 text-muted-foreground/30" />
          </div>
        )}
        {resource.featured && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
            <Star className="w-3 h-3 fill-amber-400" />
            Featured
          </div>
        )}
      </Link>
      <div className="flex flex-col flex-1 p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <Badge variant="secondary" className="text-[10px] font-medium uppercase tracking-wider">
            {resource.category}
          </Badge>
          <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
            <Download className="w-3 h-3" />
            {resource.download_count.toLocaleString()}
          </span>
        </div>
        <h3 className="font-semibold text-foreground text-sm mb-1.5 line-clamp-1 group-hover:text-primary transition-colors">
          <Link to={`/resources/${resource.slug}`}>{resource.title}</Link>
        </h3>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-4 flex-1">
          {resource.description}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full rounded-lg text-xs font-medium"
          asChild
        >
          <Link to={`/resources/${resource.slug}`}>
            View Resource <ArrowRight className="w-3 h-3 ml-1.5" />
          </Link>
        </Button>
      </div>
    </motion.div>
  );
}

export default function ResourceVaultPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const {
    data: resources,
    isLoading,
    error,
  } = useQuery<ResourceRow[]>({
    queryKey: ["resources"],
    queryFn: async () => {
      const { data, error } = await db
        .from("resources")
        .select("*")
        .order("featured", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ResourceRow[];
    },
  });

  const filtered = useMemo(() => {
    if (!resources) return [];
    return resources.filter((r) => {
      const matchesSearch =
        search === "" ||
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        (r.description ?? "").toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        activeCategory === "all" || r.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [resources, search, activeCategory]);

  const featured = useMemo(() => filtered.filter((r) => r.featured), [filtered]);
  const regular = useMemo(() => filtered.filter((r) => !r.featured), [filtered]);

  return (
    <PublicLayout>
      <PageSeo
        title="Resource Vault | RobinOS"
        description="Free creator resources, guides, templates, and frameworks to grow your content business."
        canonicalPath="/resources"
      />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-30" style={{ backgroundImage: "radial-gradient(ellipse 60% 50% at 50% 0%, hsl(217 91% 60% / 0.08), transparent)" }} />
        <div className="relative mx-auto w-full max-w-[1240px] px-4 pt-14 pb-8 sm:px-6 sm:pt-20 sm:pb-12">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-center max-w-2xl mx-auto"
          >
            <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold bg-primary/10 text-primary border border-primary/15 mb-5">
              <Star className="w-3 h-3" />
              Free Creator Resources
            </div>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              Resource Vault
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto mb-8">
              Curated guides, templates, frameworks, and swipe files to level up your content creation and marketing.
            </p>

            {/* Search bar */}
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
              <Input
                placeholder="Search resources..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-11 rounded-xl bg-card/60 border-border/50"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* Category filters */}
      <section className="mx-auto w-full max-w-[1240px] px-4 sm:px-6 pb-6">
        <div className="flex flex-wrap items-center gap-2 justify-center">
          <button
            onClick={() => setActiveCategory("all")}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
              activeCategory === "all"
                ? "bg-primary text-white shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted border border-border/30"
            }`}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                activeCategory === cat
                  ? "bg-primary text-white shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted border border-border/30"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* Resources grid */}
      <section className="mx-auto w-full max-w-[1240px] px-4 sm:px-6 pb-20">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/40 bg-card/30 overflow-hidden">
                <Skeleton className="aspect-[16/10] rounded-none" />
                <div className="p-4 space-y-3">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">Unable to load resources. Please try again later.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium mb-4">{search || activeCategory !== "all" ? "No resources match your filters." : "New creator resources are being added soon."}</p>
            <Button variant="outline" size="sm" onClick={() => window.location.href = "/"}>
              Return Home
            </Button>
          </div>
        ) : (
          <div className="space-y-10">
            {featured.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <h2 className="text-sm font-semibold text-foreground">Featured Resources</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  <AnimatePresence mode="popLayout">
                    {featured.map((resource) => (
                      <ResourceCard key={resource.id} resource={resource} />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
            {regular.length > 0 && (
              <div>
                {featured.length > 0 && (
                  <h2 className="text-sm font-semibold text-foreground mb-4">All Resources</h2>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  <AnimatePresence mode="popLayout">
                    {regular.map((resource) => (
                      <ResourceCard key={resource.id} resource={resource} />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
