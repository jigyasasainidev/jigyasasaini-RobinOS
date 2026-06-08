import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Upload,
  Image as ImageIcon,
  FileText,
  Star,
  Loader2,
  Download,
  Eye,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { db } from "@/lib/cloudDb";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

const resourceSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  slug: z.string().min(1, "Slug is required").max(200).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  description: z.string().max(2000).optional(),
  category: z.string().min(1, "Category is required"),
  featured: z.boolean().default(false),
});

type ResourceFormData = z.infer<typeof resourceSchema>;

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

export default function AdminResourcesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<ResourceRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResourceRow | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ResourceFormData>({
    resolver: zodResolver(resourceSchema),
    defaultValues: {
      title: "",
      description: "",
      category: "",
      featured: false,
    },
  });

  const {
    data: resources,
    isLoading,
    error,
  } = useQuery<ResourceRow[]>({
    queryKey: ["admin-resources"],
    queryFn: async () => {
      const { data, error } = await db
        .from("resources")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ResourceRow[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: {
      slug: string;
      title: string;
      description: string | null;
      category: string;
      pdf_url: string;
      cover_image_url: string | null;
      featured: boolean;
    }) => {
      const { error } = await db.from("resources").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Resource created successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-resources"] });
      closeModal();
    },
    onError: (err) => {
      toast.error("Failed to create resource: " + (err as Error).message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      slug: string;
      title: string;
      description: string | null;
      category: string;
      pdf_url: string;
      cover_image_url: string | null;
      featured: boolean;
    }) => {
      const { id, ...rest } = payload;
      const { error } = await db.from("resources").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Resource updated successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-resources"] });
      closeModal();
    },
    onError: (err) => {
      toast.error("Failed to update resource: " + (err as Error).message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("resources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Resource deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-resources"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error("Failed to delete resource: " + (err as Error).message);
    },
  });

  const filteredResources = useMemo(() => {
    if (!resources) return [];
    return resources.filter((r) => {
      const matchesSearch =
        search === "" ||
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        (r.description ?? "").toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        categoryFilter === "all" || r.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [resources, search, categoryFilter]);

  const openCreateModal = () => {
    setEditingResource(null);
    reset({ title: "", slug: "", description: "", category: "", featured: false });
    setPdfFile(null);
    setCoverFile(null);
    setIsModalOpen(true);
  };

  const openEditModal = (resource: ResourceRow) => {
    setEditingResource(resource);
    reset({
      title: resource.title,
      slug: resource.slug,
      description: resource.description ?? "",
      category: resource.category,
      featured: resource.featured,
    });
    setPdfFile(null);
    setCoverFile(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingResource(null);
    setPdfFile(null);
    setCoverFile(null);
    reset();
  };

  const uploadFile = async (
    file: File,
    bucket: string,
  ): Promise<string> => {
    const ext = file.name.split(".").pop() ?? "";
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (error) throw error;
    return path;
  };

  const onSubmit = async (data: ResourceFormData) => {
    try {
      let pdfPath = editingResource?.pdf_url ?? "";
      let coverPath = editingResource?.cover_image_url ?? null;

      if (pdfFile) {
        setPdfUploading(true);
        pdfPath = await uploadFile(pdfFile, "resource-pdfs");
        setPdfUploading(false);
      }
      if (!pdfPath) {
        toast.error("PDF file is required");
        return;
      }

      if (coverFile) {
        setCoverUploading(true);
        coverPath = await uploadFile(coverFile, "resource-covers");
        setCoverUploading(false);
      }

      const payload = {
        slug: data.slug,
        title: data.title,
        description: data.description ?? null,
        category: data.category,
        pdf_url: pdfPath,
        cover_image_url: coverPath,
        featured: data.featured,
      };

      if (editingResource) {
        await updateMutation.mutateAsync({ id: editingResource.id, ...payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
    } catch (err) {
      setPdfUploading(false);
      setCoverUploading(false);
      toast.error("Upload failed: " + (err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative rounded-3xl overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, hsl(222 32% 9%) 0%, hsl(220 36% 11%) 60%, hsl(222 28% 8%) 100%)",
          border: "1px solid hsl(217 30% 14%)",
          boxShadow:
            "0 12px 60px hsl(38 92% 50% / 0.04), 0 4px 20px hsl(0 0% 0% / 0.4)",
        }}
      >
        <div className="absolute inset-0 pointer-events-none opacity-25" style={{ backgroundImage: "linear-gradient(hsl(217 28% 16% / 0.25) 1px, transparent 1px), linear-gradient(90deg, hsl(217 28% 16% / 0.25) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
        <div className="relative px-7 py-6 flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-[8px] font-mono uppercase tracking-[0.28em]" style={{ color: "hsl(38 92% 55% / 0.5)" }}>CONTENT OPERATIONS</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-1.5" style={{ color: "hsl(var(--foreground) / 0.9)", letterSpacing: "-0.02em" }}>Resource Vault</h2>
            <p className="text-[11.5px] max-w-sm" style={{ color: "hsl(var(--muted-foreground) / 0.4)", lineHeight: 1.6 }}>Upload, edit, and manage creator resources and downloadables.</p>
          </div>
          <motion.button
            onClick={openCreateModal}
            className="relative h-10 rounded-xl px-6 text-sm font-semibold text-white transition-all disabled:opacity-50 overflow-hidden"
            style={{
              background: "linear-gradient(135deg, hsl(217 91% 52%), hsl(217 80% 44%))",
              boxShadow: "0 4px 20px hsl(217 91% 60% / 0.25), inset 0 1px 0 hsl(0 0% 100% / 0.1)",
            }}
            whileHover={{ y: -1, boxShadow: "0 6px 28px hsl(217 91% 60% / 0.35)" }}
            whileTap={{ y: 0 }}
          >
            <span className="relative z-10 flex items-center gap-2"><Plus className="w-4 h-4" /> Add Resource</span>
          </motion.button>
        </div>
      </motion.div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
          <Input
            placeholder="Search resources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px] h-10">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Resource</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Featured</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Downloads</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-8" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-12" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    </tr>
                  ))
                ) : error ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Error loading resources. <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["admin-resources"] })}>Retry</Button>
                    </td>
                  </tr>
                ) : filteredResources.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      {search || categoryFilter !== "all" ? "No resources match your filters." : "No resources yet. Click Add Resource to upload one."}
                    </td>
                  </tr>
                ) : (
                  filteredResources.map((resource) => (
                    <motion.tr
                      key={resource.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="border-b border-border/30 hover:bg-muted/10 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {resource.cover_image_url ? (
                            <img
                              src={getPublicUrl("resource-covers", resource.cover_image_url)}
                              alt=""
                              className="w-10 h-10 rounded-lg object-cover bg-muted"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                              <FileText className="w-5 h-5 text-muted-foreground/40" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-foreground">{resource.title}</p>
                            <p className="text-xs text-muted-foreground line-clamp-1 max-w-[280px]">{resource.description}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-xs">
                          {resource.category}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {resource.featured ? (
                          <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{resource.download_count.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => window.open(getPublicUrl("resource-pdfs", resource.pdf_url), "_blank")}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEditModal(resource)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(resource)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create/Edit Modal ── */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingResource ? "Edit Resource" : "Add Resource"}</DialogTitle>
            <DialogDescription>
              {editingResource
                ? "Update the resource details. Upload a new file to replace the existing one."
                : "Upload a PDF resource and set its metadata."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Title</label>
              <Input {...register("title")} placeholder="e.g. Content Calendar Template" />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Slug</label>
              <Input {...register("slug")} placeholder="e.g. content-calendar-template" />
              {errors.slug && <p className="text-xs text-destructive">{errors.slug.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea {...register("description")} placeholder="Short description of what this resource covers..." rows={3} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Category</label>
              <Select value={watch("category")} onValueChange={(v) => setValue("category", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && <p className="text-xs text-destructive">{errors.category.message}</p>}
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={watch("featured")} onCheckedChange={(v) => setValue("featured", v)} id="featured" />
              <label htmlFor="featured" className="text-sm font-medium cursor-pointer">
                Featured resource
              </label>
            </div>

            {/* PDF Upload */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                PDF File {editingResource && "(leave empty to keep current)"}
              </label>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              />
              <div
                onClick={() => pdfInputRef.current?.click()}
                className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 cursor-pointer hover:bg-muted/30 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  {pdfFile ? (
                    <>
                      <p className="text-sm font-medium truncate">{pdfFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </>
                  ) : editingResource ? (
                    <>
                      <p className="text-sm font-medium">Current PDF kept</p>
                      <p className="text-xs text-muted-foreground">Click to replace</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">Click to upload PDF</p>
                      <p className="text-xs text-muted-foreground">Max size 50 MB</p>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Cover Image Upload */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Cover Image {editingResource && "(leave empty to keep current)"}
              </label>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
              />
              <div
                onClick={() => coverInputRef.current?.click()}
                className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 cursor-pointer hover:bg-muted/30 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <ImageIcon className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  {coverFile ? (
                    <>
                      <p className="text-sm font-medium truncate">{coverFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(coverFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </>
                  ) : editingResource?.cover_image_url ? (
                    <>
                      <p className="text-sm font-medium">Current cover kept</p>
                      <p className="text-xs text-muted-foreground">Click to replace</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">Click to upload cover image</p>
                      <p className="text-xs text-muted-foreground">Recommended 1200×630</p>
                    </>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending || pdfUploading || coverUploading}
              >
                {(createMutation.isPending || updateMutation.isPending || pdfUploading || coverUploading) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {editingResource ? "Save Changes" : "Create Resource"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Resource</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.title}</strong>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
