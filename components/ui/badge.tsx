import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        navy: "bg-vml-navy text-vml-navy-foreground",
        red: "bg-vml-red text-vml-red-foreground",
        green: "bg-transparent px-0 font-semibold text-vml-green",
        eyebrow:
          "bg-transparent px-0 text-[11px] font-semibold tracking-wide text-vml-red uppercase",
        tag: "bg-white/90 text-[11px] font-semibold tracking-wide text-vml-red uppercase shadow-sm backdrop-blur",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
}

export { Badge, badgeVariants }
