import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  billUrl: string
  title?: string
  className?: string
}

export function BillShareButton({ billUrl, title, className }: Props) {
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
