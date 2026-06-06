import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { PageSeo } from "@/components/seo/PageSeo";
import { Button } from "@/components/ui/button";

const checklistItems = [
  "Purchase Completed",
  "Account Created",
  "Dashboard Ready",
];

export function WelcomePage() {
  return (
    <PublicLayout>
      <PageSeo
        title="Welcome to RobinOS — Your Account is Ready"
        description="Your RobinOS purchase was successful. Log in now to access your dashboard and start using AI-powered creator tools immediately."
        canonicalPath="/welcome"
      />

      <section className="mx-auto w-full max-w-lg px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="rounded-2xl border border-border/60 bg-card/40 p-8 backdrop-blur-md sm:p-10"
        >
          {/* Headline */}
          <h1 className="text-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            🎉 Welcome to RobinOS
          </h1>

          {/* Subheadline */}
          <p className="mt-3 text-center text-sm text-muted-foreground sm:text-base">
            Your purchase was successful and your account is ready.
          </p>

          {/* Description */}
          <p className="mt-4 text-center text-sm leading-relaxed text-muted-foreground">
            Thank you for joining RobinOS. You can now log in and start using your dashboard immediately.
          </p>

          {/* CTAs */}
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
            <Button asChild className="w-full sm:w-auto sm:flex-1">
              <Link to="/login">Login to RobinOS</Link>
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto sm:flex-1">
              <Link to="/">Back to Home</Link>
            </Button>
          </div>

          {/* Success checklist */}
          <div className="mt-8 rounded-xl border border-border/50 bg-card/30 p-5">
            <ul className="space-y-3">
              {checklistItems.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </section>
    </PublicLayout>
  );
}

export default WelcomePage;