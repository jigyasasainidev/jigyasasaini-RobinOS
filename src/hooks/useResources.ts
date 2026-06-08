import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/cloudDb";

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

export function useResources() {
  return useQuery<ResourceRow[]>({
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
}
