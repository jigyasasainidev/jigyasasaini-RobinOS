import { ReactNode } from "react";
import { PublicNavbar } from "@/components/public/PublicNavbar";
import { PublicFooter } from "@/components/public/PublicFooter";

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background grain">
      <div className="ambient-glow" />
      <PublicNavbar />
      <main className="relative z-10">{children}</main>
      <PublicFooter />
    </div>
  );
}