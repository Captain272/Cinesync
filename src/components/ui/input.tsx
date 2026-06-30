"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-white/10 bg-ink-900/60 px-3 py-2 text-sm text-white",
        "placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex w-full rounded-md border border-white/10 bg-ink-900/60 px-3 py-2 text-sm text-white",
        "placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40",
        "min-h-[80px] resize-y",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
