import { Share } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePwaInstall } from '@/hooks/usePwaInstall'

/** Shown on Home so users can install the PWA on their phone (Chrome) or follow iOS steps (Safari). */
export function PwaInstallPrompt() {
  const { canPromptInstall, showIosHint, install, installed } = usePwaInstall()

  if (installed) return null
  if (!canPromptInstall && !showIosHint) return null

  return (
    <Card className="overflow-hidden border-primary/20">
      <CardHeader className="py-4">
        <CardTitle className="text-base">Install DebtCollector</CardTitle>
        <p className="text-sm text-muted-foreground">
          Add this app to your home screen for quick access and a full-screen experience.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {canPromptInstall ? (
          <Button
            type="button"
            className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
            onClick={() => void install()}
          >
            Install app
          </Button>
        ) : null}
        {showIosHint ? (
          <div className="flex gap-3 rounded-2xl border border-white/50 bg-white/45 p-3 text-sm text-muted-foreground backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
            <Share className="mt-0.5 size-5 shrink-0 text-foreground/70" aria-hidden />
            <p>
              Tap the <span className="font-medium text-foreground">Share</span> menu, then{' '}
              <span className="font-medium text-foreground">Add to Home Screen</span> (wording may vary slightly by
              browser).
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
