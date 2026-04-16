import { useState } from 'react'
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
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <p className="text-sm text-muted-foreground">This app uses Google sign-in only.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          type="button"
          variant="outline"
          className="min-h-12 w-full touch-manipulation gap-3 text-base sm:min-h-10 sm:text-sm"
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
          <GoogleIcon className="h-5 w-5 shrink-0" />
          Continue with Google
        </Button>
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
      </CardContent>
    </Card>
  )
}
