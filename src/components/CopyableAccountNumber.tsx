import { useCallback, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = {
  value: string
  className?: string
  /** Shown to screen readers on the copy control */
  copyLabel?: string
}

export function CopyableAccountNumber({ value, className, copyLabel = 'Copy account number' }: Props) {
  const [copied, setCopied] = useState(false)
  const trimmed = value.trim()
  const copy = useCallback(async () => {
    if (!trimmed) return
    try {
      await navigator.clipboard.writeText(trimmed)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.alert('Could not copy. Select the number and copy manually.')
    }
  }, [trimmed])

  if (!trimmed) return null

  return (
    <span className={cn('inline-flex max-w-full flex-wrap items-center gap-1.5', className)}>
      <span className="min-w-0 break-all font-mono font-medium tabular-nums text-foreground">{trimmed}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 touch-manipulation"
        aria-label={copyLabel}
        title={copyLabel}
        onClick={() => void copy()}
      >
        {copied ? (
          <Check className="size-4 text-emerald-600 dark:text-emerald-500" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
      </Button>
    </span>
  )
}

/** Icon-only copy control for arbitrary text (e.g. next to an input). */
export function CopyTextButton({
  text,
  label = 'Copy to clipboard',
}: {
  text: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  const trimmed = text.trim()
  const copy = useCallback(async () => {
    if (!trimmed) return
    try {
      await navigator.clipboard.writeText(trimmed)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.alert('Could not copy. Select the text and copy manually.')
    }
  }, [trimmed])

  if (!trimmed) return null

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-11 shrink-0 touch-manipulation sm:size-9"
      aria-label={label}
      title={label}
      onClick={() => void copy()}
    >
      {copied ? (
        <Check className="size-4 text-emerald-600 dark:text-emerald-500" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
    </Button>
  )
}
