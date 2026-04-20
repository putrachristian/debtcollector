import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, BanknoteArrowUp, CheckCircle2, WalletCards } from 'lucide-react'
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
      <section className="glass-panel rounded-[1.5rem] px-4 py-4">
        <div className="glass-inner flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/45 bg-white/45 px-3 py-1 text-xs font-medium text-foreground/85 backdrop-blur-xl dark:border-white/10 dark:bg-white/8">
              <WalletCards className="size-4 text-primary" aria-hidden />
              Payments overview
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">My debt</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              See what still needs to be paid and confirm it quickly after you transfer.
            </p>
          </div>
          <div className="flex gap-2 sm:min-w-[14rem]">
            <div className="flex-1 rounded-[1.15rem] border border-white/45 bg-white/36 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Open</p>
              <p className="mt-1 text-2xl font-semibold">{rows.length}</p>
            </div>
            <div className="flex-1 rounded-[1.15rem] border border-white/45 bg-white/36 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Status</p>
              <p className="mt-1 text-sm font-medium text-foreground/85">
                {rows.length > 0 ? 'Pending' : 'Clear'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">My account number</CardTitle>
          <p className="text-xs text-muted-foreground">
            Used when you host a bill and choose <span className="font-medium text-foreground">I'm the payer</span> so guests
            know where to transfer.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="my-acct">Bank / e-wallet number</Label>
              <div className="flex min-w-0 flex-row items-center gap-2">
                <Input
                  id="my-acct"
                  className="min-h-11 min-w-0 flex-1 font-mono"
                  value={myAccount}
                  onChange={(e) => setMyAccount(e.target.value)}
                  placeholder="e.g. VA or account number"
                  autoComplete="off"
                />
                <div className="shrink-0">
                  <CopyTextButton text={myAccount} label="Copy my account number" />
                </div>
              </div>
            </div>
            <Button
              type="button"
              className="min-h-12 w-full touch-manipulation sm:min-h-10"
              disabled={savingAccount}
              onClick={() => void saveMyAccount()}
            >
              {savingAccount ? 'Saving...' : 'Save'}
            </Button>
          </div>
          {accountMsg ? <p className="text-sm text-muted-foreground">{accountMsg}</p> : null}
        </CardContent>
      </Card>

      {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3">
        {rows.map((d) => (
          <Card key={d.billId} className="relative overflow-hidden">
            <Link
              to={d.billPath}
              className="absolute inset-0 z-0 rounded-xl ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Open bill: ${d.title?.trim() || 'Untitled'}`}
            />
            <CardHeader className="pointer-events-none relative z-10 pb-2 pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/45 bg-white/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/8">
                  <BanknoteArrowUp className="size-3.5 text-primary" aria-hidden />
                  Due now
                </div>
                {d.remainingCents === 0 ? (
                  <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    Settled
                  </div>
                ) : null}
              </div>
              <CardTitle className="text-base">{d.title?.trim() || 'Untitled bill'}</CardTitle>
              <div className="mt-1 text-xs text-muted-foreground">
                <p className="inline-flex items-center gap-1.5">
                  <ArrowUpRight className="size-3.5 text-primary/80" aria-hidden />
                  Pay <span className="font-medium text-foreground">{d.payToLabel}</span>
                </p>
                {d.payToAccountHint ? (
                  <div
                    className="pointer-events-auto relative z-20 mt-1 text-foreground/90"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CopyableAccountNumber value={d.payToAccountHint} copyLabel="Copy payee account number" />
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="pointer-events-none relative z-10 space-y-2 pt-0">
              <p className="text-[2rem] font-semibold leading-none tabular-nums">{formatCents(d.remainingCents)}</p>
              {d.settledCents > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Share {formatCents(d.shareTotalCents)} - Already paid {formatCents(d.settledCents)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Your current share on this bill</p>
              )}
              {d.paymentToUserId === user.id ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Confirm after you transfer to the payee outside the app. This only records progress here.
                </p>
              ) : null}
            </CardContent>
            <div className="relative z-20 px-6 pb-5">
              <Button
                type="button"
                className="min-h-11 w-full touch-manipulation sm:min-h-10"
                disabled={busyId === d.billId}
                onClick={() =>
                  setConfirmPay({
                    billId: d.billId,
                    toUserId: d.paymentToUserId,
                    amountCents: d.remainingCents,
                  })
                }
              >
                {busyId === d.billId ? 'Saving...' : `Confirm paid ${formatCents(d.remainingCents)}`}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {!loading && rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-base font-medium">You have no unpaid bill balances.</p>
            <p className="mt-2 text-sm text-muted-foreground">Everything is squared away for now.</p>
          </CardContent>
        </Card>
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
