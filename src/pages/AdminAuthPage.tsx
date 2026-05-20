import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, Mail, Lock, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BrandMark } from "@/components/BrandMark";
import { logAdminAction } from "@/lib/adminAudit";
import { PageSeo } from "@/components/seo/PageSeo";

const AdminAuthPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const unauthorized = searchParams.get("unauthorized") === "1";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Enter email and password");
      return;
    }
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(error.message);
        return;
      }

      const { data: role, error: roleError } = await (supabase as any).rpc("get_admin_role", {
        user_uuid: data.user.id,
      });

      if (roleError || !role) {
        await supabase.auth.signOut();
        toast.error("Unauthorized Access");
        return;
      }

      await logAdminAction("admin_login", data.user.id, {
        email,
        role,
        route: "/adminsh/auth",
      });

      toast.success("Welcome, Admin");
      navigate("/adminsh/dashboard");
    } catch (err: any) {
      toast.error(err?.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background grain p-4">
      <PageSeo
        title="Admin Access | RobinOS"
        description="Restricted RobinOS admin authentication portal."
        canonicalPath="/adminsh/auth"
        noindex
      />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <BrandMark size={26} withWordmark={false} className="drop-shadow-[0_0_16px_hsl(217_91%_60%/0.28)]" />
          </div>
          <h1 className="text-chrome text-2xl font-semibold">RobinOS Admin Access</h1>
          <p className="text-muted-foreground text-xs mt-1 font-mono">Restricted Area — Role Verified</p>
          {unauthorized ? <p className="text-destructive text-xs mt-2 font-mono">Unauthorized Access</p> : null}
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="pl-10 bg-secondary border-border h-11"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-10 bg-secondary border-border h-11"
              />
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium glow-blue disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {loading ? "Verifying..." : "Access Command Center"}
          </motion.button>
        </form>
      </motion.div>
    </div>
  );
};

export default AdminAuthPage;
