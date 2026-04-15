import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useBill } from '@/context/BillContext'
import { useDebt } from '@/context/DebtContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { APP_CURRENCY, formatCents } from '@/lib/money'

export function BillResults() {
  const { user } = useAuth()
  const { bill, calculateResult, calculateMySharePartial, participantLabel } = useBill()
  const { payments, recordBillSharePaid } = useDebt()
  const cur = bill?.currency ?? APP_CURRENCY
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const partial = useMemo(() => {
    if (!user || !bill) return null
    return calculateMySharePartial()
  }, [user, bill, calculateMySharePartial])
  const full = useMemo(() => calculateResult(), [calculateResult])

  /** Same settled total as My debt: direct from payments so the row still works when the bill drops off the debt list. */
  const settledToHostOnBill = useMemo(() => {
    if (!bill || !user || user.id === bill.host_id) return 0
    return payments
      .filter(
        (p) =>
          p.bill_id === bill.id &&
          p.from_user_id === user.id &&
          p.to_user_id === bill.host_id &&
          p.status === 'settled'
      )
      .reduce((s, p) => s + p.amount_cents, 0)
  }, [bill, user, payments])

  const remainingToHost = useMemo(() => {
    if (!bill || !user || bill.host_id === user.id) return 0
    if (!partial?.ok) return 0
    return Math.max(0, partial.totalCents - settledToHostOnBill)
  }, [bill, user, partial, settledToHostOnBill])

  const handleConfirmPaid = useCallback(async () => {
    if (!bill || !user || bill.host_id === user.id) return
    if (remainingToHost <= 0) return
    setMsg(null)
    setBusy(true)
    try {
      await recordBillSharePaid({
        billId: bill.id,
        toUserId: bill.host_id,
        amountCents: remainingToHost,
      })
      setMsg('Marked as paid.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not record payment')
    } finally {
      setBusy(false)
    }
  }, [bill, user, remainingToHost, recordBillSharePaid])

  if (!user) {
    return <p className="text-sm text-muted-foreground">Sign in to see your share.</p>
  }

  if (!partial) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (!partial.ok) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="font-medium">Cannot show your share</p>
        <ul className="mt-2 list-disc pl-5">
          {partial.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    )
  }

  const p = partial
  const showFullTable = full.ok && full.usersOrdered.length > 1
  const otherWarnings = p.warnings.filter((w) => !/not assigned yet/i.test(w))

  return (
    <div className="space-y-5">
      <Card className="border-primary/25">
        <CardHeader className="py-4">
          <CardTitle className="text-base">What you owe on this bill</CardTitle>
          <p className="text-sm text-muted-foreground">
            From lines you claimed: your food, your share of discount and tax, and an equal split of the service
            charge.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <p className="text-3xl font-semibold tabular-nums tracking-tight">{formatCents(p.totalCents, cur)}</p>
          <dl className="grid gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-6 border-b border-border/80 pb-2">
              <dt className="text-muted-foreground">Your food</dt>
              <dd className="shrink-0 tabular-nums font-medium text-foreground">{formatCents(p.foodSubtotalCents, cur)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-6">
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="shrink-0 tabular-nums text-foreground">−{formatCents(p.discountCents, cur)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-6">
              <dt className="text-muted-foreground">After discount</dt>
              <dd className="shrink-0 tabular-nums font-medium text-foreground">
                {formatCents(p.postDiscountSubtotalCents, cur)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-6">
              <dt className="text-muted-foreground">Service</dt>
              <dd className="shrink-0 tabular-nums text-foreground">{formatCents(p.serviceChargeCents, cur)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-6 border-b border-border/80 pb-2">
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="shrink-0 tabular-nums text-foreground">{formatCents(p.taxCents, cur)}</dd>
            </div>
            {settledToHostOnBill > 0 ? (
              <>
                <div className="flex items-baseline justify-between gap-6">
                  <dt className="text-muted-foreground">Already marked paid</dt>
                  <dd className="shrink-0 tabular-nums text-foreground">−{formatCents(settledToHostOnBill, cur)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-6">
                  <dt className="font-medium text-foreground">Still to pay host</dt>
                  <dd className="shrink-0 tabular-nums font-semibold text-foreground">
                    {formatCents(remainingToHost, cur)}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
          {otherWarnings.length > 0 ? (
            <ul className="text-xs text-amber-600 dark:text-amber-500 list-disc pl-5">
              {otherWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {bill && user.id !== bill.host_id && remainingToHost > 0 ? (
            <Button
              type="button"
              className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
              disabled={busy}
              onClick={() => void handleConfirmPaid()}
            >
              {busy ? 'Saving…' : `Confirm paid ${formatCents(remainingToHost, cur)}`}
            </Button>
          ) : bill && user.id !== bill.host_id && remainingToHost === 0 && p.totalCents > 0 ? (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-500">Paid up on this bill.</p>
          ) : null}
          {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
        </CardContent>
      </Card>

      {showFullTable ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Everyone (full split)</p>
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {full.usersOrdered.map((uid) => {
                  const row = full.byUser[uid]!
                  return (
                    <TableRow key={uid}>
                      <TableCell className="text-sm">
                        {uid === user.id ? 'You' : participantLabel(uid)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCents(row.totalCents, cur)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Open <Link to="/debts" className="font-medium text-primary underline-offset-2 hover:underline">My debt</Link>{' '}
        for all unpaid bills; confirming paid here updates that list.
      </p>
    </div>
  )
}
