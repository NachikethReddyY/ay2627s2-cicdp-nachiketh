import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-full border border-[var(--line-strong)] bg-[var(--code)] px-4 text-[15px] text-[var(--tx)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--mu)] focus-visible:border-[var(--acT)] focus-visible:ring-[3px] focus-visible:ring-[var(--acT)] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-[var(--bad)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
