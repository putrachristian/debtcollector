import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GoogleIcon } from '@/components/GoogleIcon'

export function AuthPage() {
  const navigate = useNavigate()
  const { signIn, signUp, signInWithGoogle, user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) {
    return <Navigate to="/" replace />
  }

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      if (mode === 'in') await signIn(email, password)
      else await signUp(email, password, displayName || undefined)
      navigate('/')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Auth error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>{mode === 'in' ? 'Sign in' : 'Create account'}</CardTitle>
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
            void signInWithGoogle('/')
              .catch((e) => {
                setErr(e instanceof Error ? e.message : 'Google sign-in failed')
                setBusy(false)
              })
          }}
        >
          <GoogleIcon className="h-5 w-5 shrink-0" />
          Continue with Google
        </Button>

        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center" aria-hidden>
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or use email</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === 'in' ? 'default' : 'outline'}
            className="min-h-11 touch-manipulation"
            onClick={() => setMode('in')}
          >
            Sign in
          </Button>
          <Button
            type="button"
            variant={mode === 'up' ? 'default' : 'outline'}
            className="min-h-11 touch-manipulation"
            onClick={() => setMode('up')}
          >
            Sign up
          </Button>
        </div>
        {mode === 'up' ? (
          <div className="space-y-1">
            <Label htmlFor="dn">Display name</Label>
            <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="em">Email</Label>
          <Input
            id="em"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pw">Password</Label>
          <Input
            id="pw"
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        <Button
          type="button"
          className="min-h-12 w-full touch-manipulation text-base sm:min-h-10 sm:text-sm"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Sign up'}
        </Button>
      </CardContent>
    </Card>
  )
}
