import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useBill } from '@/context/BillContext'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { APP_CURRENCY, formatCents } from '@/lib/money'

function mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) {
    if ((b.get(k) ?? 0) !== v) return false
  }
  return true
}

function serializeUnits(m: Map<string, number>): string {
  return [...m.entries()]
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|')
}

type AssignmentRow = { user_id: string; claimed_qty?: number }

/** Server rows merged with your draft quantities so everyone sees the same list updating live. */
function picksOnLine(
  rows: AssignmentRow[],
  itemId: string,
  me: string,
  localUnits: Map<string, number>,
  dirty: boolean,
  label: (userId: string) => string
): { userId: string; qty: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    m.set(r.user_id, Math.max(0, Math.trunc(r.claimed_qty ?? 1)))
  }
  if (dirty && localUnits.has(itemId)) {
    const local = localUnits.get(itemId) ?? 0
    if (local <= 0) m.delete(me)
    else m.set(me, local)
  }
  return [...m.entries()]
    .filter(([, q]) => q > 0)
    .map(([userId, qty]) => ({ userId, qty }))
    .sort((a, b) => {
      if (a.userId === me) return -1
      if (b.userId === me) return 1
      return label(a.userId).localeCompare(label(b.userId), undefined, { sensitivity: 'base' })
    })
}

type Props = {
  /** Called after a successful confirm so the bill view can switch to totals. */
  onOrderConfirmed?: () => void
}

/**
 * Everyone (host + guests) picks how many units per line, then Confirm saves in one batch.
 */
export function AssignmentsPanel({ onOrderConfirmed }: Props) {
  const { user } = useAuth()
  const { bill, items, participants, assignments, applyMyLineQty, participantLabel } = useBill()
  const isHost = bill !== null && user !== null && bill.host_id === user.id
  const cur = bill?.currency ?? APP_CURRENCY
  const [localUnits, setLocalUnits] = useState<Map<string, number>>(() => new Map())
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const serverMyUnits = useMemo(() => {
    const m = new Map<string, number>()
    if (!user) return m
    for (const a of assignments) {
      if (a.user_id === user.id) {
        m.set(a.bill_item_id, Math.max(0, Math.trunc(a.claimed_qty ?? 1)))
      }
    }
    return m
  }, [assignments, user])

  const serverKey = useMemo(() => serializeUnits(serverMyUnits), [serverMyUnits])

  useEffect(() => {
    setDirty(false)
  }, [bill?.id])

  useEffect(() => {
    if (mapsEqual(localUnits, serverMyUnits)) {
      setDirty(false)
    }
  }, [localUnits, serverMyUnits])

  useEffect(() => {
    if (!dirty) {
      setLocalUnits((prev) => (mapsEqual(prev, serverMyUnits) ? prev : new Map(serverMyUnits)))
    }
  }, [bill?.id, serverKey, dirty, serverMyUnits])

  const byItem = useMemo(() => {
    const m = new Map<string, typeof assignments>()
    for (const a of assignments) {
      const list = m.get(a.bill_item_id) ?? []
      list.push(a)
      m.set(a.bill_item_id, list)
    }
    return m
  }, [assignments])

  const hasPendingChanges = !mapsEqual(localUnits, serverMyUnits)

  function setUnitsForItem(itemId: string, units: number, lineQty: number) {
    setErr(null)
    setDirty(true)
    setLocalUnits((prev) => {
      const n = new Map(prev)
      const u = Math.max(0, Math.min(Math.trunc(units), lineQty))
      if (u <= 0) n.set(itemId, 0)
      else n.set(itemId, u)
      return n
    })
  }

  async function confirmOrder() {
    if (!user) return
    setErr(null)
    const changes: { billItemId: string; qty: number }[] = []
    const keys = new Set([...localUnits.keys(), ...serverMyUnits.keys()])
    for (const itemId of keys) {
      const want = localUnits.get(itemId) ?? 0
      const had = serverMyUnits.get(itemId) ?? 0
      if (want !== had) changes.push({ billItemId: itemId, qty: want })
    }
    if (changes.length === 0) {
      setDirty(false)
      return
    }
    setSaving(true)
    try {
      await applyMyLineQty(changes)
      setDirty(false)
      onOrderConfirmed?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save your picks'
      if (msg.includes('over_claim')) {
        setErr('Too many units on one line for others already claimed. Lower your quantity.')
      } else {
        setErr(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {!isHost
          ? 'The host has not added any line items yet. Check back soon.'
          : 'Add line items on the bill before guests can pick their order.'}
      </p>
    )
  }
  if (participants.length === 0) return <p className="text-sm text-muted-foreground">No participants yet.</p>
  if (!user) return null

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Tick lines you shared, set <span className="font-medium text-foreground">how many units</span> are yours when
        quantity is more than 1, then scroll down and tap <span className="font-medium text-foreground">Confirm my order</span>.
        For a single dish split by several people, quantity stays 1 and the price is split evenly.
      </p>

      {hasPendingChanges ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">You have unsaved picks — confirm at the bottom.</p>
      ) : null}
      {err ? <p className="text-sm text-destructive">{err}</p> : null}

      {items.map((it) => {
        const rows = byItem.get(it.id) ?? []
        const lineQty = Math.max(1, Math.trunc(it.qty))
        const myUnits = localUnits.get(it.id) ?? 0
        const checked = myUnits > 0
        const picks = picksOnLine(rows, it.id, user.id, localUnits, dirty, participantLabel)
        const lineUnsaved =
          localUnits.has(it.id) && (localUnits.get(it.id) ?? 0) !== (serverMyUnits.get(it.id) ?? 0)

        return (
          <div key={it.id} className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="font-medium">{it.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Line {formatCents(it.unit_price_cents * it.qty, cur)} · Qty {lineQty}
                </p>
              </div>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border bg-background/60 px-3 py-2 touch-manipulation">
              <Checkbox
                checked={checked}
                disabled={saving}
                onCheckedChange={(c) => {
                  const on = c === true
                  if (on) {
                    setUnitsForItem(it.id, Math.min(1, lineQty), lineQty)
                  } else {
                    setUnitsForItem(it.id, 0, lineQty)
                  }
                }}
              />
              <span className="text-sm font-medium">I had this</span>
            </label>
            {lineQty > 1 && checked ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Units for you (max {lineQty})</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={lineQty}
                    className="h-11 w-24 tabular-nums"
                    value={myUnits}
                    disabled={saving}
                    onChange={(e) => {
                      const v = Math.round(Number(e.target.value) || 0)
                      setUnitsForItem(it.id, v, lineQty)
                    }}
                  />
                </div>
              </div>
            ) : null}
            <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
              <p className="text-xs font-medium text-foreground/85">Who picked this</p>
              {picks.length === 0 ? (
                <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-500/90">Nobody yet.</p>
              ) : (
                <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                  {picks.map(({ userId, qty }) => {
                    const isYou = userId === user.id
                    const name = isYou ? 'You' : participantLabel(userId)
                    return (
                      <li key={userId}>
                        <span className="font-medium text-foreground/90">{name}</span>
                        {lineQty > 1 ? (
                          <span>
                            {' '}
                            — {qty} {qty === 1 ? 'unit' : 'units'}
                            {lineUnsaved && isYou ? (
                              <span className="text-amber-600 dark:text-amber-500"> (not saved)</span>
                            ) : null}
                          </span>
                        ) : lineUnsaved && isYou ? (
                          <span className="text-amber-600 dark:text-amber-500"> (not saved)</span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )
      })}

      <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="button"
          className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
          disabled={!hasPendingChanges || saving}
          onClick={() => void confirmOrder()}
        >
          {saving ? 'Saving…' : 'Confirm my order'}
        </Button>
        {hasPendingChanges ? (
          <span className="text-xs text-amber-600 dark:text-amber-500 sm:self-center">Unsaved picks</span>
        ) : null}
      </div>
    </div>
  )
}
