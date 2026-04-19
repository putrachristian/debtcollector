import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  billUrl: string
  title?: string
  className?: string
  /** Round icon-only control for floating action buttons. */
  iconOnly?: boolean
}

export function BillShareButton({ billUrl, title, className, iconOnly }: Props) {
  const [msg, setMsg] = useState<string | null>(null)

  async function onShare() {
    setMsg(null)
    const shareTitle = title?.trim() || 'Bill'
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareTitle, url: billUrl })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(billUrl)
      setMsg('Link copied')
    } catch {
      setMsg('Could not copy link')
    }
  }

  if (iconOnly) {
    return (
      <div className="relative">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className={
            className ??
            'size-14 shrink-0 touch-manipulation rounded-full border border-border/80 bg-card shadow-lg'
          }
          aria-label="Share bill link"
          onClick={() => void onShare()}
        >
          <Share2 className="size-5 shrink-0" aria-hidden />
        </Button>
        {msg ? (
          <p className="absolute -top-8 right-0 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow">
            {msg}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="secondary"
        className={className ?? 'min-h-11 w-full touch-manipulation gap-2 sm:w-auto sm:min-h-9'}
        onClick={() => void onShare()}
      >
        <Share2 className="size-4 shrink-0" aria-hidden />
        Share bill link
      </Button>
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
    </div>
  )
}
