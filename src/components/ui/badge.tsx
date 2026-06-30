import * as React from "react";
import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  default: "bg-white/8 text-white/80 border-white/10",
  gold: "bg-gold-500/15 text-gold-300 border-gold-400/30",
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  red: "bg-red-500/15 text-red-300 border-red-400/30",
  blue: "bg-sky-500/15 text-sky-300 border-sky-400/30",
};

export function Badge({
  tone = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
