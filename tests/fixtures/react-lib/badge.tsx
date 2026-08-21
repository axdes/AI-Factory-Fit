import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

// Variants live in the cva config, never as a written union. Looking only for
// TypeScript unions found none of these.
const badgeVariants = cva("badge", {
  variants: {
    variant: { default: "", secondary: "", destructive: "" },
    shape: { default: "", pill: "" },
  },
})

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={className} {...props} />
}

// Declared plainly, exported at the bottom — the shadcn idiom, and invisible to
// anything that reads only the `export` modifier.
export { Badge, badgeVariants }
