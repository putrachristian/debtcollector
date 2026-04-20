import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold backdrop-blur-xl transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-primary/30 bg-primary/14 text-primary shadow-sm',
        secondary: 'border-border/70 bg-card/72 text-foreground',
        outline: 'border-border/75 bg-white/35 text-foreground dark:bg-white/6',
        success: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
