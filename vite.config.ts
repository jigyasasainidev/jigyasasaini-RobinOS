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
  };
});
