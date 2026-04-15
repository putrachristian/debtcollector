import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useBill } from '@/context/BillContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function JoinPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { joinBill } = useBill()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onJoin() {
    if (!code || !user) return
    setBusy(true)
    setErr(null)
    try {
      const id = await joinBill(code)
      navigate(`/bill/${id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Join failed')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Join a bill</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Sign in first, then return to this link.</p>
          <Button asChild>
            <Link to="/auth">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 -ml-2 w-fit touch-manipulation gap-2 px-2 md:hidden"
        onClick={() => navigate('/')}
      >
        <ArrowLeft className="size-5" aria-hidden />
        Home
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Join bill</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="break-all font-mono text-sm text-muted-foreground">Code: {code}</p>
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
          <Button
            className="min-h-12 w-full touch-manipulation text-base sm:min-h-10 sm:text-sm"
            disabled={busy || !code}
            onClick={() => void onJoin()}
          >
            {busy ? 'Joining…' : 'Join'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
