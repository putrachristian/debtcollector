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
import { CopyableAccountNumber } from '@/components/CopyableAccountNumber'
import { PaymentConfirmDialog } from '@/components/PaymentConfirmDialog'
import { foodSubtotalCentsForViewerOnLine, type AssignmentInput } from '@/lib/calculateBill'
import { hostIsBillPayee } from '@/lib/billPayee'
import { APP_CURRENCY, formatCents } from '@/lib/money'

export function BillResults() {
  const { user, profile } = useAuth()
  const { bill, items, assignments, calculateResult, calculateMySharePartial, participantLabel } = useBill()
  const { payments, recordBillSharePaid } = useDebt()
  const cur = bill?.currency ?? APP_CURRENCY
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [showPaidConfirm, setShowPaidConfirm] = useState(false)

  const partial = useMemo(() => {
    if (!user || !bill) return null
    return calculateMySharePartial()
  }, [user, bill, calculateMySharePartial])
  const full = useMemo(() => calculateResult(), [calculateResult])

  const myPicks = useMemo(() => {
    if (!user) return []
    const byItemId = new Map<string, typeof assignments>()
    for (const a of assignments) {
      const list = byItemId.get(a.bill_item_id) ?? []
      list.push(a)
      byItemId.set(a.bill_item_id, list)
    }
    const rows: { name: string; qty: number; shareAmong: number | null; foodCents: number }[] = []
    for (const item of items) {
      const rowsForItem = byItemId.get(item.id) ?? []
      const mine = rowsForItem.filter((r) => r.user_id === user.id)
      const qty = mine.reduce((s, r) => s + Math.max(0, Math.trunc(r.claimed_qty ?? 0)), 0)
      if (qty <= 0) continue
      const shareAmong = item.share_among != null && item.share_among >= 2 ? item.share_among : null
      const assignmentInputs: AssignmentInput[] = rowsForItem.map((r) => ({
        billItemId: r.bill_item_id,
        userId: r.user_id,
        mode: r.mode,
        claimedQty: r.claimed_qty ?? 1,
      }))
      const foodCents = foodSubtotalCentsForViewerOnLine(
        {
          id: item.id,
          name: item.name,
          unitPriceCents: item.unit_price_cents,
          qty: item.qty,
          shareAmong: item.share_among,
        },
        assignmentInputs,
        user.id
      )
      rows.push({ name: item.name, qty, shareAmong, foodCents })
    }
    return rows
  }, [assignments, items, user])

  /**
   * Settled payments toward your share on this bill — same rules as My debt:
   * guests: from you → host; host paying an external payee: from you → you (ledger).
   */
  const settledTowardShare = useMemo(() => {
    if (!bill || !user) return 0
    if (user.id !== bill.host_id) {
      return payments
        .filter(
          (p) =>
            p.bill_id === bill.id &&
            p.from_user_id === user.id &&
            p.to_user_id === bill.host_id &&
            p.status === 'settled'
        )
        .reduce((s, p) => s + p.amount_cents, 0)
    }
    return payments
      .filter(
        (p) =>
          p.bill_id === bill.id &&
          p.from_user_id === user.id &&
          p.to_user_id === user.id &&
          p.status === 'settled'
      )
      .reduce((s, p) => s + p.amount_cents, 0)
  }, [bill, user, payments])

  const remainingAfterSettled = useMemo(() => {
    if (!bill || !user || !partial?.ok) return 0
    return Math.max(0, partial.totalCents - settledTowardShare)
  }, [bill, user, partial, settledTowardShare])

  /** Match My debt: confirm only when you still owe (guest → host, or host → external payee via self-ledger). */
  const showConfirmPaid = useMemo(() => {
    if (!bill || !user || !partial?.ok || remainingAfterSettled <= 0) return false
    if (user.id === bill.host_id) {
      return !hostIsBillPayee(bill, profile ?? null, user)
    }
    return true
  }, [bill, user, partial, remainingAfterSettled, profile])

  const handleConfirmPaid = useCallback(async () => {
    if (!bill || !user || remainingAfterSettled <= 0) return
    setMsg(null)
    setBusy(true)
    try {
      const toUserId = user.id === bill.host_id ? user.id : bill.host_id
      await recordBillSharePaid({
        billId: bill.id,
        toUserId,
        amountCents: remainingAfterSettled,
      })
      setMsg('Marked as paid.')
      setShowPaidConfirm(false)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not record payment')
    } finally {
      setBusy(false)
    }
  }, [bill, user, remainingAfterSettled, recordBillSharePaid])

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
      {bill?.payer_name?.trim() || bill?.payer_account_number?.trim() ? (
        <Card>
          <CardHeader className="space-y-1 py-3">
            <CardTitle className="text-base">Pay to</CardTitle>
            <p className="text-xs text-muted-foreground">
              Use these details when you transfer outside the app (e.g. bank or e-wallet).
            </p>
          </CardHeader>
          <CardContent className="pt-0 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pay to</span>
              {bill.payer_name?.trim() ? <span className="font-medium">{bill.payer_name.trim()}</span> : null}
              {bill.payer_account_number?.trim() ? (
                <CopyableAccountNumber value={bill.payer_account_number.trim()} copyLabel="Copy payee account number" />
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-primary/25">
        <CardHeader className="py-4">
          <CardTitle className="text-base">What you owe on this bill</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {myPicks.length > 0 ? (
            <div className="space-y-2 border-b border-border/80 pb-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your picks</p>
              <ul className="space-y-2 text-sm">
                {myPicks.map((row, idx) => (
                  <li
                    key={`${row.name}-${idx}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-foreground">{row.name}</span>
                      <span className="ml-2 text-muted-foreground">
                        {row.shareAmong != null
                          ? `${row.qty} slot${row.qty === 1 ? '' : 's'} of ${row.shareAmong} shared`
                          : `${row.qty} ${row.qty === 1 ? 'unit' : 'units'}`}
                      </span>
                    </div>
                    <span className="shrink-0 tabular-nums font-medium text-foreground">
                      {formatCents(row.foodCents, cur)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
            {settledTowardShare > 0 ? (
              <>
                <div className="flex items-baseline justify-between gap-6">
                  <dt className="text-muted-foreground">Already marked paid</dt>
                  <dd className="shrink-0 tabular-nums text-foreground">−{formatCents(settledTowardShare, cur)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-6">
                  <dt className="font-medium text-foreground">
                    {bill && user.id !== bill.host_id ? 'Still to pay host' : 'Still to pay payee'}
                  </dt>
                  <dd className="shrink-0 tabular-nums font-semibold text-foreground">
                    {formatCents(remainingAfterSettled, cur)}
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
          {bill && showConfirmPaid ? (
            <Button
              type="button"
              className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
              disabled={busy}
              onClick={() => setShowPaidConfirm(true)}
            >
              Confirm paid {formatCents(remainingAfterSettled, cur)}
            </Button>
          ) : bill &&
            remainingAfterSettled === 0 &&
            p.totalCents > 0 &&
            (user.id !== bill.host_id || !hostIsBillPayee(bill, profile ?? null, user)) ? (
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

      <PaymentConfirmDialog
        open={showPaidConfirm}
        busy={busy}
        onCancel={() => setShowPaidConfirm(false)}
        onConfirm={() => void handleConfirmPaid()}
      />
    </div>
  )
}
