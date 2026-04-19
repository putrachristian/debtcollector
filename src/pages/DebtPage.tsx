import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useDebt } from '@/context/DebtContext'
import { CopyTextButton, CopyableAccountNumber } from '@/components/CopyableAccountNumber'
import { Button } from '@/components/ui/button'
import { PaymentConfirmDialog } from '@/components/PaymentConfirmDialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCents } from '@/lib/money'

export function DebtPage() {
  const { user, profile, updateProfile } = useAuth()
  const { outstandingDebts, recordBillSharePaid, loading, error } = useDebt()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmPay, setConfirmPay] = useState<{
    billId: string
    toUserId: string
    amountCents: number
  } | null>(null)
  const [myAccount, setMyAccount] = useState('')
  const [savingAccount, setSavingAccount] = useState(false)
  const [accountMsg, setAccountMsg] = useState<string | null>(null)

  useEffect(() => {
    setMyAccount(profile?.payment_account_number?.trim() ?? '')
  }, [profile?.payment_account_number])

  const rows = useMemo(() => outstandingDebts, [outstandingDebts])

  async function confirmPaid(billId: string, toUserId: string, amountCents: number) {
    setMsg(null)
    setBusyId(billId)
    try {
      await recordBillSharePaid({ billId, toUserId, amountCents })
      setConfirmPay(null)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to record payment')
    } finally {
      setBusyId(null)
    }
  }

  async function saveMyAccount() {
    setAccountMsg(null)
    setSavingAccount(true)
    try {
      const v = myAccount.trim()
      await updateProfile({ payment_account_number: v || null })
      setAccountMsg('Saved.')
    } catch (e) {
      setAccountMsg(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSavingAccount(false)
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
          Bills where you still owe your share — usually to the host, or to whoever is set as payee when you hosted the
          bill. Matches <span className="font-medium">My total</span> on each bill.
        </p>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">My account number</CardTitle>
          <p className="text-xs text-muted-foreground">
            Used when you host a bill and choose <span className="font-medium text-foreground">I’m the payer</span> — guests
            see this with your name so they know where to transfer.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="my-acct">Bank / e-wallet number</Label>
              <Input
                id="my-acct"
                className="font-mono"
                value={myAccount}
                onChange={(e) => setMyAccount(e.target.value)}
                placeholder="e.g. VA or account number"
                autoComplete="off"
              />
            </div>
            <CopyTextButton text={myAccount} label="Copy my account number" />
            <Button
              type="button"
              className="min-h-11 shrink-0 touch-manipulation sm:min-h-9"
              disabled={savingAccount}
              onClick={() => void saveMyAccount()}
            >
              {savingAccount ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {accountMsg ? <p className="text-sm text-muted-foreground">{accountMsg}</p> : null}
        </CardContent>
      </Card>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3">
        {rows.map((d) => (
          <Card key={d.billId}>
            <CardHeader className="py-4">
              <CardTitle className="text-base">{d.title?.trim() || 'Untitled bill'}</CardTitle>
              <div className="text-xs text-muted-foreground">
                <p>
                  Pay <span className="font-medium text-foreground">{d.payToLabel}</span>
                </p>
                {d.payToAccountHint ? (
                  <div className="mt-1 text-foreground/90">
                    <CopyableAccountNumber value={d.payToAccountHint} copyLabel="Copy payee account number" />
                  </div>
                ) : null}
              </div>
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
              {d.paymentToUserId === user.id ? (
                <p className="text-xs text-muted-foreground">
                  Confirm only after you transferred this amount to the payee outside the app. This saves your progress
                  here (not a transfer to another DebtCollector user).
                </p>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  type="button"
                  className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
                  disabled={busyId === d.billId}
                  onClick={() =>
                    setConfirmPay({
                      billId: d.billId,
                      toUserId: d.paymentToUserId,
                      amountCents: d.remainingCents,
                    })
                  }
                >
                  {busyId === d.billId ? 'Saving…' : `Confirm paid ${formatCents(d.remainingCents)}`}
                </Button>
                <Button variant="outline" className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10" asChild>
                  <Link to={d.billPath}>Open bill</Link>
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

      <PaymentConfirmDialog
        open={confirmPay !== null}
        busy={confirmPay !== null && busyId === confirmPay.billId}
        onCancel={() => setConfirmPay(null)}
        onConfirm={() => {
          if (!confirmPay) return
          void confirmPaid(confirmPay.billId, confirmPay.toUserId, confirmPay.amountCents)
        }}
      />
    </div>
  )
}
