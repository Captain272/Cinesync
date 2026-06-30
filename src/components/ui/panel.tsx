import * as React from "react";
import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel", className)} {...props} />;
}

export function PanelHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-white/5 px-4 py-3",
        className
      )}
      {...props}
    />
  );
}

export function PanelTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("text-xs font-semibold uppercase tracking-[0.18em] text-white/60", className)}
      {...props}
    />
  );
}

export function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}
