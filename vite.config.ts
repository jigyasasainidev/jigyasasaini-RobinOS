import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const lovableProjectId = process.env.__LOVABLE_PROJECT_ID;
  const lovablePreviewHost = lovableProjectId
    ? `${lovableProjectId}.lovableproject.com`
    : undefined;

  return {
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
      protocol: lovablePreviewHost ? "wss" : undefined,
      host: lovablePreviewHost,
      clientPort: lovablePreviewHost ? 443 : undefined,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Improve chunk caching — vendor libs change less often than app code
    rollupOptions: {
      output: {
        manualChunks: {
          // React core — most stable, longest cache lifetime
          "vendor-react": ["react", "react-dom"],
          // Router — stable
          "vendor-router": ["react-router-dom"],
          // Animation — large but stable
          "vendor-motion": ["framer-motion"],
          // Query — stable
          "vendor-query": ["@tanstack/react-query"],
          // Supabase — stable
          "vendor-supabase": ["@supabase/supabase-js"],
          // Charts — large, rarely changes
          "vendor-charts": ["recharts"],
          // UI primitives — stable
          "vendor-radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-tabs",
            "@radix-ui/react-accordion",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
          ],
        },
      },
    },
    // Increase warning threshold slightly — we know about the admin bundle
    chunkSizeWarningLimit: 600,
  },
  };
});
