import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useDebt } from '@/context/DebtContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCents } from '@/lib/money'

export function DebtPage() {
  const { user } = useAuth()
  const { outstandingDebts, recordBillSharePaid, loading, error } = useDebt()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const rows = useMemo(() => outstandingDebts, [outstandingDebts])

  async function confirmPaid(billId: string, hostId: string, amountCents: number) {
    setMsg(null)
    setBusyId(billId)
    try {
      await recordBillSharePaid({ billId, toUserId: hostId, amountCents })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to record payment')
    } finally {
      setBusyId(null)
    }
  }

  if (!user) {
    return <p className="text-sm text-muted-foreground">Sign in to view your debt.</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My debt</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bills where you still owe the host. Matches what you see under <span className="font-medium">My total</span>{' '}
          on each bill.
        </p>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3">
        {rows.map((d) => (
          <Card key={d.billId}>
            <CardHeader className="py-4">
              <CardTitle className="text-base">{d.title?.trim() || 'Untitled bill'}</CardTitle>
              <p className="text-xs text-muted-foreground">Pay {d.hostDisplayName}</p>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <p className="text-2xl font-semibold tabular-nums">{formatCents(d.remainingCents)}</p>
              {d.settledCents > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Share {formatCents(d.shareTotalCents)} · Already paid {formatCents(d.settledCents)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Your current share on this bill</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  type="button"
                  className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
                  disabled={busyId === d.billId}
                  onClick={() => void confirmPaid(d.billId, d.hostId, d.remainingCents)}
                >
                  {busyId === d.billId ? 'Saving…' : `Confirm paid ${formatCents(d.remainingCents)}`}
                </Button>
                <Button variant="outline" className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10" asChild>
                  <Link to={`/bill/${d.billId}`}>Open bill</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no unpaid bill balances. Nice.</p>
      ) : null}

      {msg ? <p className="text-sm text-destructive">{msg}</p> : null}
    </div>
  )
}
