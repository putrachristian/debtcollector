import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex min-h-[44px] w-full rounded-xl border border-border/80 bg-white/55 px-3.5 py-2 text-base shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_16px_32px_-28px_rgba(15,23,42,0.7)] backdrop-blur-xl transition-[border-color,box-shadow,background-color] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/10 md:h-10 md:min-h-0 md:py-2 md:text-sm',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
