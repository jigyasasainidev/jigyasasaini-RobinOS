import { useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Download,
  Star,
  FileText,
  ArrowLeft,
  Loader2,
  Clock3,
  Eye,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";

import { db } from "@/lib/cloudDb";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PublicLayout } from "@/components/public/PublicLayout";
import { PageSeo } from "@/components/seo/PageSeo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function getPublicUrl(bucket: string, path: string) {
  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);
  return publicUrl;
}

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

export default function ResourceDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pendingDownloadTriggeredRef = useRef(false);

  const {
    data: resource,
    isLoading,
    error,
  } = useQuery<ResourceRow>({
    queryKey: ["resource", slug],
    queryFn: async () => {
      const { data, error } = await db
        .from("resources")
        .select("*")
        .eq("slug", slug)
        .single();
      if (error) throw error;
      return data as ResourceRow;
    },
    enabled: !!slug,
  });

  const downloadMutation = useMutation({
    mutationFn: async (resourceId: string) => {
      const { error } = await db
        .from("resources")
        .update({ download_count: (resource?.download_count ?? 0) + 1 })
        .eq("id", resourceId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (!resource) return;
      const pdfUrl = getPublicUrl("resource-pdfs", resource.pdf_url);
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
    },
  });

  const handleDownload = () => {
    if (!resource) return;

    if (!user) {
      // Store return path and pending download for post-auth resume
      sessionStorage.setItem("robinos_return_to", `/resources/${resource.slug}`);
      sessionStorage.setItem("robinos_pending_download_slug", resource.slug);
      navigate("/login");
      return;
    }

    downloadMutation.mutate(resource.id);
  };

  useEffect(() => {
    if (loading || !user || !resource || !slug) return;

    const pendingSlug = sessionStorage.getItem("robinos_pending_download_slug");
    if (pendingSlug === slug && !pendingDownloadTriggeredRef.current) {
      pendingDownloadTriggeredRef.current = true;
      sessionStorage.removeItem("robinos_pending_download_slug");
      sessionStorage.removeItem("robinos_return_to");
      downloadMutation.mutate(resource.id);
    }
  }, [loading, user, resource, slug, downloadMutation]);

  if (isLoading) {
    return (
      <PublicLayout>
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-14 pb-16 sm:px-6 sm:pt-20">
          <Skeleton className="h-4 w-24 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            <div className="lg:col-span-3">
              <Skeleton className="aspect-[16/9] rounded-2xl mb-6" />
            </div>
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (error || !resource) {
    return (
      <PublicLayout>
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-14 pb-16 sm:px-6 sm:pt-20 text-center">
          <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
          <h1 className="text-xl font-semibold text-foreground mb-2">Resource not found</h1>
          <p className="text-sm text-muted-foreground mb-6">The resource you're looking for doesn't exist or has been removed.</p>
          <Button variant="outline" onClick={() => navigate("/resources")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Vault
          </Button>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <PageSeo
        title={`${resource.title} | Resource Vault | RobinOS`}
        description={resource.description ?? `Download ${resource.title} from the RobinOS Resource Vault.`}
        canonicalPath={`/resources/${resource.slug}`}
      />

      <div className="mx-auto w-full max-w-[1120px] px-4 pt-14 pb-16 sm:px-6 sm:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Button
            variant="ghost"
            size="sm"
            className="mb-6 text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/resources")}
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Vault
          </Button>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Cover image */}
            <div className="lg:col-span-3">
              <div className="relative aspect-[16/9] rounded-2xl overflow-hidden border border-border/40 bg-muted">
                {resource.cover_image_url ? (
                  <img
                    src={getPublicUrl("resource-covers", resource.cover_image_url)}
                    alt={resource.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileText className="w-20 h-20 text-muted-foreground/20" />
                  </div>
                )}
                {resource.featured && (
                  <div className="absolute top-4 left-4 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                    <Star className="w-3.5 h-3.5 fill-amber-400" />
                    Featured Resource
                  </div>
                )}
              </div>
            </div>

            {/* Details */}
            <div className="lg:col-span-2 space-y-5">
              <div>
                <Badge variant="secondary" className="text-[10px] font-medium uppercase tracking-wider mb-3">
                  {resource.category}
                </Badge>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-2">
                  {resource.title}
                </h1>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Download className="w-3.5 h-3.5" />
                    {resource.download_count.toLocaleString()} downloads
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock3 className="w-3.5 h-3.5" />
                    {new Date(resource.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {resource.description && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {resource.description}
                </p>
              )}

              <div className="space-y-3 pt-2">
                <Button
                  size="lg"
                  className="w-full rounded-xl text-sm font-semibold h-12"
                  onClick={handleDownload}
                  disabled={downloadMutation.isPending}
                >
                  {downloadMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  {user ? "Download PDF" : "Sign in to Download"}
                </Button>
                {!user && (
                  <p className="text-xs text-muted-foreground text-center">
                    Free account required to download resources.
                  </p>
                )}
                {user && (
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full rounded-xl text-sm font-medium h-12"
                    onClick={() => window.open(getPublicUrl("resource-pdfs", resource.pdf_url), "_blank")}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    Preview PDF
                  </Button>
                )}
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-2">
                <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/50">Resource Info</p>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-medium">PDF</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Category</span>
                  <span className="font-medium">{resource.category}</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </PublicLayout>
  );
}
