import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, MousePointerClick, Copy, ArrowRight, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { BrandMark } from "@/components/BrandMark";

interface OnboardingPopupProps {
  onComplete: () => void;
}

const steps = [
  {
    id: 1,
    title: "Let’s build your creator workflow.",
    subtitle: "RobinOS adapts to your content style.",
    content: "demo",
  },
  {
    id: 2,
    title: "Creator OS Flow",
    subtitle: "Scan trends. Generate faster. Publish smarter.",
    content: "steps",
  },
  {
    id: 3,
    title: "See RobinOS in Action",
    subtitle: "From signal to script in seconds.",
    content: "result",
  },
  {
    id: 4,
    title: "Creator Workspace Ready",
    subtitle: "Launch your first RobinOS workflow.",
    content: "cta",
  },
];

export const OnboardingPopup = ({ onComplete }: OnboardingPopupProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [typedText, setTypedText] = useState("");
  const demoInput = "How to grow on Instagram";

  // Typing animation for step 1
  useEffect(() => {
    if (currentStep !== 0) return;
    setTypedText("");
    let i = 0;
    const interval = setInterval(() => {
      if (i < demoInput.length) {
        setTypedText(demoInput.slice(0, i + 1));
        i++;
      } else {
        clearInterval(interval);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [currentStep]);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem("robinos_onboarding_done_permanent", "true");
    }
    localStorage.setItem("robinos_onboarding_done", "true");
    onComplete();
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleClose();
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-4">
            <div className="rounded-xl bg-secondary/50 border border-border/40 p-4">
              <p className="text-[10px] font-mono text-muted-foreground/60 mb-2">YOUR TOPIC</p>
              <div className="flex items-center gap-2">
                <span className="text-foreground text-sm">{typedText}</span>
                <span className="w-0.5 h-4 bg-primary animate-pulse" />
              </div>
            </div>
            <div className="flex justify-center">
              <div className="w-px h-6 bg-gradient-to-b from-primary/60 to-transparent" />
            </div>
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
              <p className="text-[10px] font-mono text-primary mb-2">🎬 VIRAL SCRIPT</p>
              <p className="text-foreground/90 text-sm font-medium">"Stop posting randomly on Instagram..."</p>
              <p className="text-foreground/70 text-sm mt-1">"You're killing your reach and don't even know it."</p>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
            {[
              { icon: "✍️", title: "Enter your topic", desc: "Type what your video is about" },
              { icon: "⚡", title: "Click Generate", desc: "AI creates your script instantly" },
              { icon: "🎬", title: "Copy & Record", desc: "Start recording immediately" },
            ].map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.15 }}
                className="flex items-start gap-4 rounded-xl bg-secondary/30 border border-border/30 p-4"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-lg shrink-0">
                  {step.icon}
                </div>
                <div>
                  <p className="text-foreground text-sm font-medium">{step.title}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        );

      case 2:
        return (
          <div className="space-y-3">
            <div className="rounded-xl bg-secondary/40 border border-border/30 p-3">
              <p className="text-[10px] font-mono text-muted-foreground/60 mb-1">INPUT</p>
              <p className="text-foreground text-sm">"How to grow on Instagram"</p>
            </div>
            <div className="flex justify-center">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="w-8 h-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center"
              >
                <Sparkles className="w-4 h-4 text-primary" />
              </motion.div>
            </div>
            <div className="rounded-xl bg-primary/5 border border-primary/25 p-4 space-y-2">
              <p className="text-[10px] font-mono text-primary">🎬 READY TO RECORD:</p>
              <p className="text-foreground text-sm font-medium">"Stop posting randomly…"</p>
              <p className="text-foreground/80 text-sm">"You're killing your reach…"</p>
              <p className="text-foreground/70 text-sm">"Do this instead…"</p>
              <div className="flex items-center gap-3 pt-2 mt-2 border-t border-border/20">
                <span className="text-[10px] text-muted-foreground/50 font-mono">🎥 Front Camera</span>
                <span className="text-[10px] text-muted-foreground/50 font-mono">🗣 Bold Tone</span>
              </div>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4 flex flex-col items-center">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-2"
            >
              <Sparkles className="w-8 h-8 text-primary" />
            </motion.div>
            <p className="text-muted-foreground text-sm text-center max-w-xs">
              Your first creator workflow is one click away.
            </p>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleClose}
              className="btn-primary shimmer-btn w-full !py-3.5 text-base font-semibold"
            >
              Start Creating →
            </motion.button>
            <button
              onClick={handleClose}
              className="text-muted-foreground/50 text-xs hover:text-muted-foreground transition-colors"
            >
              Skip for now
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-background/80 backdrop-blur-md" onClick={handleClose} />

        {/* Popup */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="relative w-full max-w-md rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-[0_0_80px_hsl(217_91%_60%/0.08),0_20px_60px_hsl(0_0%_0%/0.5)] overflow-hidden"
        >
          {/* Top glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-primary/10 blur-[60px] pointer-events-none" />

          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 z-10 w-7 h-7 rounded-lg bg-secondary/50 border border-border/30 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <div className="relative p-6 pt-8">
            <div className="flex justify-center mb-4">
              <BrandMark size={24} withWordmark={false} className="drop-shadow-[0_0_20px_hsl(217_91%_60%/0.3)]" />
            </div>
            {/* Progress indicator */}
            <div className="flex items-center gap-1.5 mb-6">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-300 ${
                    i <= currentStep
                      ? "bg-primary flex-[2]"
                      : "bg-border flex-1"
                  }`}
                />
              ))}
            </div>

            {/* Step title */}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25 }}
              >
                <h2 className="text-chrome text-xl font-semibold mb-1">
                  {steps[currentStep].title}
                </h2>
                <p className="text-muted-foreground text-sm mb-6">
                  {steps[currentStep].subtitle}
                </p>

                {renderStepContent()}
              </motion.div>
            </AnimatePresence>

            {/* Footer */}
            {currentStep < 3 && (
              <div className="mt-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="dont-show"
                    checked={dontShowAgain}
                    onCheckedChange={(v) => setDontShowAgain(!!v)}
                    className="w-3.5 h-3.5"
                  />
                  <label htmlFor="dont-show" className="text-[11px] text-muted-foreground/50 cursor-pointer">
                    Don't show again
                  </label>
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleNext}
                  className="btn-primary !py-2.5 !px-6 flex items-center gap-2 text-sm"
                >
                  Next <ArrowRight className="w-3.5 h-3.5" />
                </motion.button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
