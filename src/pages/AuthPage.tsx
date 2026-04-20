import { useState } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GoogleIcon } from '@/components/GoogleIcon'

export function AuthPage() {
  const { signInWithGoogle, user } = useAuth()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5 md:grid-cols-[1.1fr_0.9fr]">
      <section className="page-hero glass-panel min-h-[20rem]">
        <div className="glass-inner flex h-full flex-col justify-between gap-6">
          <div className="space-y-4">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/45 bg-white/45 px-3 py-1 text-xs font-medium text-foreground/85 backdrop-blur-xl dark:border-white/10 dark:bg-white/8">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              Secure split-bill workspace
            </div>
            <div className="space-y-3">
              <h1 className="max-w-md text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Keep bill sharing simple, clear, and calm.
              </h1>
              <p className="max-w-lg text-sm leading-6 text-muted-foreground sm:text-base">
                Sign in once to create bills, invite friends, track what is still owed, and keep payment details easy to find.
              </p>
            </div>
          </div>
          <div className="grid gap-3 text-sm text-foreground/85 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/45 bg-white/38 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
              Create polished bill rooms with receipt scanning and manual edits.
            </div>
            <div className="rounded-3xl border border-white/45 bg-white/38 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
              Share one link, confirm payments, and keep totals visible on mobile.
            </div>
          </div>
        </div>
      </section>

      <Card className="mx-auto w-full max-w-md self-center">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <p className="text-sm text-muted-foreground">Google sign-in keeps onboarding fast and familiar.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="min-h-12 w-full touch-manipulation justify-between gap-3 px-4 text-base sm:min-h-11 sm:text-sm"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setErr(null)
              void signInWithGoogle('/').catch((e) => {
                setErr(e instanceof Error ? e.message : 'Google sign-in failed')
                setBusy(false)
              })
            }}
          >
            <span className="flex items-center gap-3">
              <GoogleIcon className="h-5 w-5 shrink-0" />
              Continue with Google
            </span>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
          </Button>
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}
