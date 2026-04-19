import { useEffect, useMemo, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useBill } from '@/context/BillContext'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { APP_CURRENCY, formatCents } from '@/lib/money'

function mapShareAmongError(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('cannot_clear') || m.includes('clear_share')) {
    return "Remove everyone's picks on this line before clearing the shared split."
  }
  if (m.includes('share_too_low') || m.includes('claims')) {
    return 'That number is lower than slots already claimed on this line.'
  }
  if (m.includes('bill_closed')) return 'This bill is closed.'
  if (m.includes('forbidden')) return 'You must be on this bill to change this.'
  return raw
}

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
  const { bill, items, participants, assignments, applyMyLineQty, setItemShareAmong, participantLabel } = useBill()
  const isHost = bill !== null && user !== null && bill.host_id === user.id
  const cur = bill?.currency ?? APP_CURRENCY
  const billOpen = bill !== null && bill.status !== 'closed'
  const [localUnits, setLocalUnits] = useState<Map<string, number>>(() => new Map())
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [shareModal, setShareModal] = useState<{ lineId: string; n: string } | null>(null)
  const [shareBusy, setShareBusy] = useState(false)

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
        Tick <span className="font-medium text-foreground">I had this</span>, set units or slots when needed, and use the
        line <span className="font-medium text-foreground">⋯</span> menu for a <span className="font-medium text-foreground">shared dish</span> (split the line total across several people). Then tap{' '}
        <span className="font-medium text-foreground">Confirm my order</span> at the bottom.
      </p>

      {hasPendingChanges ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">You have unsaved picks — confirm at the bottom.</p>
      ) : null}
      {err ? <p className="text-sm text-destructive">{err}</p> : null}

      {items.map((it) => {
        const rows = byItem.get(it.id) ?? []
        const lineQty = Math.max(1, Math.trunc(it.qty))
        const shareN = it.share_among != null && it.share_among >= 2 ? Math.trunc(it.share_among) : null
        const slotCap = shareN ?? lineQty
        const myUnits = localUnits.get(it.id) ?? 0
        const checked = myUnits > 0
        const picks = picksOnLine(rows, it.id, user.id, localUnits, dirty, participantLabel)
        const lineUnsaved =
          localUnits.has(it.id) && (localUnits.get(it.id) ?? 0) !== (serverMyUnits.get(it.id) ?? 0)
        const slotsClaimed = picks.reduce((s, p) => s + p.qty, 0)
        /** No unclaimed slots left; you can still uncheck if you already have a pick. */
        const lineHasNoRoomForNewClaim = slotsClaimed >= slotCap
        const checkboxDisabled =
          saving || !billOpen || (myUnits === 0 && lineHasNoRoomForNewClaim)

        return (
          <div key={it.id} className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{it.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Line {formatCents(it.unit_price_cents * it.qty, cur)}
                  {shareN != null ? (
                    <>
                      {' '}
                      · Shared among {shareN} · {slotsClaimed}/{shareN} slots claimed
                    </>
                  ) : (
                    <> · Qty {lineQty}</>
                  )}
                </p>
              </div>
              <div className="relative shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground"
                  disabled={!billOpen || shareBusy || saving}
                  aria-label="Line options"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuFor((v) => (v === it.id ? null : it.id))
                  }}
                >
                  <MoreVertical className="size-4" />
                </Button>
                {menuFor === it.id ? (
                  <div
                    className="absolute right-0 top-full z-20 mt-1 min-w-[11rem] rounded-md border border-border bg-card py-1 text-sm shadow-md"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left hover:bg-muted/60"
                      onClick={() => {
                        setMenuFor(null)
                        setShareModal({
                          lineId: it.id,
                          n: String(shareN != null ? shareN : 2),
                        })
                      }}
                    >
                      Shared dish…
                    </button>
                    {shareN != null ? (
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left text-destructive hover:bg-muted/60 disabled:opacity-50"
                        disabled={slotsClaimed > 0}
                        title={slotsClaimed > 0 ? 'Remove all picks on this line first' : undefined}
                        onClick={() => {
                          setMenuFor(null)
                          setShareBusy(true)
                          setErr(null)
                          void setItemShareAmong(it.id, null)
                            .catch((e) =>
                              setErr(mapShareAmongError(e instanceof Error ? e.message : 'Could not clear shared dish'))
                            )
                            .finally(() => setShareBusy(false))
                        }}
                      >
                        Clear shared split
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border bg-background/60 px-3 py-2 touch-manipulation">
              <Checkbox
                checked={checked}
                disabled={checkboxDisabled}
                title={
                  myUnits === 0 && lineHasNoRoomForNewClaim
                    ? 'All units on this line are already claimed.'
                    : undefined
                }
                onCheckedChange={(c) => {
                  const on = c === true
                  if (on) {
                    setUnitsForItem(it.id, Math.min(1, slotCap), slotCap)
                  } else {
                    setUnitsForItem(it.id, 0, slotCap)
                  }
                }}
              />
              <span className="text-sm font-medium">I had this</span>
            </label>
            {(lineQty > 1 || shareN != null) && checked ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {shareN != null ? `Slots for you (max ${slotCap})` : `Units for you (max ${lineQty})`}
                  </Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={slotCap}
                    className="h-11 w-24 tabular-nums"
                    value={myUnits}
                    disabled={saving}
                    onChange={(e) => {
                      const v = Math.round(Number(e.target.value) || 0)
                      setUnitsForItem(it.id, v, slotCap)
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
                        {lineQty > 1 || shareN != null ? (
                          <span>
                            {' '}
                            — {qty} {qty === 1 ? 'slot' : 'slots'}
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

      {shareModal ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="presentation"
          onClick={() => !shareBusy && setShareModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg"
            role="dialog"
            aria-labelledby="assign-share-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="assign-share-title" className="text-base font-semibold">
              Shared dish
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              How many people share this line total (e.g. pizza for 3)? Everyone can then claim how many slots they
              had.
            </p>
            <div className="mt-3 space-y-1">
              <Label htmlFor="assign-share-n">People</Label>
              <Input
                id="assign-share-n"
                type="number"
                min={2}
                className="min-h-11"
                disabled={shareBusy}
                value={shareModal.n}
                onChange={(e) => setShareModal((s) => (s ? { ...s, n: e.target.value } : s))}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={shareBusy}
                onClick={() => {
                  const v = Math.round(Number(shareModal.n))
                  if (!Number.isFinite(v) || v < 2) return
                  setShareBusy(true)
                  setErr(null)
                  void setItemShareAmong(shareModal.lineId, v)
                    .then(() => setShareModal(null))
                    .catch((e) =>
                      setErr(mapShareAmongError(e instanceof Error ? e.message : 'Could not save shared dish'))
                    )
                    .finally(() => setShareBusy(false))
                }}
              >
                {shareBusy ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" variant="outline" disabled={shareBusy} onClick={() => setShareModal(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
