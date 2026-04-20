import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border text-sm font-medium transition-[transform,background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.985] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border-primary/60 bg-primary/88 text-primary-foreground shadow-[0_18px_40px_-20px_color-mix(in_oklab,var(--color-primary)_80%,black)] hover:bg-primary',
        secondary:
          'border-border/70 bg-card/70 text-foreground shadow-[0_12px_34px_-24px_rgba(15,23,42,0.32)] backdrop-blur-xl hover:bg-card/90',
        outline:
          'border-border/80 bg-white/40 text-foreground shadow-[0_10px_26px_-22px_rgba(15,23,42,0.4)] backdrop-blur-xl hover:bg-white/60 dark:bg-white/8 dark:hover:bg-white/12',
        ghost: 'border-transparent bg-transparent text-muted-foreground hover:bg-white/45 hover:text-foreground dark:hover:bg-white/10',
        destructive:
          'border-destructive/50 bg-destructive/88 text-white shadow-[0_16px_34px_-22px_rgba(190,24,24,0.55)] hover:bg-destructive',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3.5 text-xs',
        lg: 'h-11 px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
