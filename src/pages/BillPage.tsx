import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { useBill } from '@/context/BillContext'
import { useAuth } from '@/context/AuthContext'
import type { BillDraft } from '@/features/bill/BillInput'
import { BillInput, type BillInputTab } from '@/features/bill/BillInput'
import { ItemsEditor } from '@/features/bill/ItemsEditor'
import { AssignmentsPanel } from '@/features/bill/AssignmentsPanel'
import { BillResults } from '@/features/bill/BillResults'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { loadDraft } from '@/services/draftStorage'
import { APP_CURRENCY } from '@/lib/money'
import type { BillRow } from '@/types'

function draftFromServer(bill: BillRow, items: ReturnType<typeof useBill>['items']): BillDraft {
  return {
    currency: bill.currency ?? APP_CURRENCY,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      unitPriceCents: i.unit_price_cents,
      qty: i.qty,
    })),
    discountType: bill.discount_type,
    discountValue: Number(bill.discount_value),
    serviceChargeCents: bill.service_charge_cents,
    taxCents: bill.tax_cents,
  }
}

function isPlaceholderBillTitle(t: string | null | undefined): boolean {
  const s = (t ?? '').trim()
  return s === '' || /^new bill$/i.test(s) || /^untitled$/i.test(s)
}

export function BillPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const {
    billId,
    bill,
    items,
    participants,
    loading,
    error,
    setCurrentBillId,
    updateItems,
    updateBillMeta,
    deleteBill,
    persistDraft,
    restoreOfflineDraft,
    setManualDiscount,
    manualDiscount,
    joinBill,
  } = useBill()

  const [editor, setEditor] = useState<BillDraft | null>(null)
  const [addItemTab, setAddItemTab] = useState<BillInputTab>('upload')
  const [draftSource, setDraftSource] = useState<'image' | 'manual' | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [splitTab, setSplitTab] = useState<'assign' | 'results'>('assign')
  /** When false, host sees the same split flow as guests plus Edit bill. */
  const [hostEditMode, setHostEditMode] = useState(false)
  const hostOpenedBillId = useRef<string | null>(null)
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinErr, setJoinErr] = useState<string | null>(null)

  useEffect(() => {
    if (id) setCurrentBillId(id)
  }, [id, setCurrentBillId])

  useEffect(() => {
    setSplitTab('assign')
  }, [id])

  useEffect(() => {
    if (id && hostOpenedBillId.current !== null && hostOpenedBillId.current !== id) {
      hostOpenedBillId.current = null
    }
  }, [id])

  const isHost = bill !== null && user !== null && bill.host_id === user.id
  const onBill =
    !!user && !!bill && (isHost || participants.some((p) => p.user_id === user.id))

  useEffect(() => {
    if (!bill?.id || bill.id !== id || !user) return
    if (bill.host_id !== user.id) return
    if (hostOpenedBillId.current === bill.id) return
    hostOpenedBillId.current = bill.id
    setHostEditMode(false)
  }, [bill?.id, bill?.host_id, id, user])

  useEffect(() => {
    if (!bill || !isHost) return
    if (items.length === 0) {
      setEditor(null)
      setDraftSource(null)
      return
    }
    setEditor(draftFromServer(bill, items))
    setDraftSource(null)
  }, [bill, items, isHost])

  useEffect(() => {
    setAddItemTab('upload')
  }, [bill?.id])

  const inviteUrl = useMemo(() => {
    if (!bill) return ''
    return `${window.location.origin}/join/${bill.invite_code}`
  }, [bill])

  const save = useCallback(async () => {
    if (!editor || !bill) return
    setSaving(true)
    setMsg(null)
    try {
      await updateBillMeta({
        discount_type: editor.discountType,
        discount_value: editor.discountValue,
        service_charge_cents: editor.serviceChargeCents,
        tax_cents: editor.taxCents,
        currency: APP_CURRENCY,
      })
      await updateItems(
        editor.items.map((i) => ({
          id: i.id,
          name: i.name,
          unit_price_cents: i.unitPriceCents,
          qty: i.qty,
        }))
      )
      setMsg('Saved')
      setHostEditMode(false)
      setSplitTab('assign')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editor, bill, updateBillMeta, updateItems])

  async function handleDeleteBill() {
    if (!bill || bill.host_id !== user?.id) return
    if (!window.confirm('Delete this bill for all participants? This cannot be undone.')) return
    setMsg(null)
    try {
      await deleteBill()
      navigate('/', { replace: true })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  if (!user) {
    return <p className="text-sm text-muted-foreground">Sign in to view this bill.</p>
  }
  if (!id || billId !== id) {
    return <p className="text-sm text-muted-foreground">Loading bill…</p>
  }
  if (loading && !bill) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }
  if (!bill) {
    return <p className="text-sm text-destructive">Bill not found.</p>
  }

  const hasLocalDraft = isHost && hostEditMode && !!loadDraft(bill.id)
  const hostFullUi = isHost && hostEditMode

  const manualDraftHidden =
    editor !== null && draftSource === 'manual' && addItemTab !== 'manual'
  const showAddItemsCard =
    hostFullUi && items.length === 0 && (!editor || manualDraftHidden)
  const showLineItemsEditor =
    hostFullUi &&
    editor !== null &&
    (items.length > 0 ||
      draftSource === 'image' ||
      (draftSource === 'manual' && addItemTab === 'manual'))

  return (
    <div className="space-y-5 md:space-y-6">
      <div className="flex items-center gap-1 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 touch-manipulation"
          aria-label="Back"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {isHost ? (hostEditMode ? 'Host' : 'Host · pick your order') : 'Guest'}
          </p>
          <p className="truncate font-semibold leading-tight">{bill.title || 'Untitled'}</p>
        </div>
      </div>

      {hostFullUi ? (
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            key={bill.title ?? ''}
            id="title"
            defaultValue={bill.title ?? ''}
            onBlur={(e) => {
              const v = e.target.value
              if (v !== (bill.title ?? '')) void updateBillMeta({ title: v })
            }}
          />
        </div>
      ) : (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">{bill.title || 'Untitled'}</CardTitle>
          </CardHeader>
        </Card>
      )}

      {user && bill && !onBill && bill.status !== 'closed' ? (
        <Card className="border-primary/30">
          <CardHeader className="py-4">
            <CardTitle className="text-base">Join this bill</CardTitle>
            <p className="text-sm text-muted-foreground">
              You can see this bill, but you are not on the split yet. Join to pick your order and see your total.
            </p>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {joinErr ? <p className="text-sm text-destructive">{joinErr}</p> : null}
            <Button
              type="button"
              className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
              disabled={joinBusy}
              onClick={() => {
                setJoinErr(null)
                setJoinBusy(true)
                void joinBill(bill.invite_code)
                  .then(() => setMsg('You’re on the bill — add your order below.'))
                  .catch((e) => setJoinErr(e instanceof Error ? e.message : 'Join failed'))
                  .finally(() => setJoinBusy(false))
              }}
            >
              {joinBusy ? 'Joining…' : 'Join bill'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isHost && !hostEditMode ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            type="button"
            className="min-h-12 w-full touch-manipulation gap-2 sm:w-auto sm:min-h-10"
            onClick={() => setHostEditMode(true)}
          >
            <Pencil className="size-4 shrink-0" />
            Edit bill
          </Button>
          <p className="text-sm text-muted-foreground">
            Change line items, invite link, or close the bill. Otherwise use{' '}
            <span className="font-medium text-foreground">My order</span> below like everyone else.
          </p>
        </div>
      ) : null}

      {hostFullUi ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-mono break-all">{inviteUrl}</p>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full touch-manipulation sm:w-auto sm:min-h-9"
              onClick={() => void navigator.clipboard.writeText(inviteUrl)}
            >
              Copy link
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          {isHost
            ? 'Use My order to set your units, then My total to see what you owe. Use Edit bill to change the receipt or settings.'
            : 'Only the host can change line items and charges. Use My order to set your share, then My total for your amount.'}
        </p>
      )}

      {hostFullUi ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full touch-manipulation sm:w-auto sm:min-h-9"
            onClick={() => persistDraft()}
          >
            Save offline draft
          </Button>
          {hasLocalDraft ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full touch-manipulation sm:w-auto sm:min-h-9"
              onClick={() => void restoreOfflineDraft().then((ok) => setMsg(ok ? 'Draft restored' : 'No draft'))}
            >
              Restore offline draft
            </Button>
          ) : null}
        </div>
      ) : null}

      {isHost && !hostEditMode && items.length === 0 ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          This bill has no lines yet. Tap Edit bill to add items.
        </p>
      ) : null}

      {showAddItemsCard ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add items</CardTitle>
            <p className="text-xs text-muted-foreground">
              Scan a receipt from Upload or Photo, or open Manual to type lines.
            </p>
          </CardHeader>
          <CardContent>
            <BillInput
              tab={addItemTab}
              onTabChange={setAddItemTab}
              onApply={(d, source) => {
                setEditor(d)
                setDraftSource(source)
                const name = d.billTitle?.trim()
                if (name && bill && user && bill.host_id === user.id && isPlaceholderBillTitle(bill.title)) {
                  void updateBillMeta({ title: name })
                }
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {showLineItemsEditor ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line items & charges</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemsEditor draft={editor} onChange={setEditor} onSave={() => void save()} disabled={saving} />
          </CardContent>
        </Card>
      ) : null}

      {hostFullUi ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Manual discount merge (optional)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Type</Label>
              <select
                className="h-11 w-full rounded-md border border-border bg-card px-2 text-base md:h-9 md:text-sm"
                value={manualDiscount?.kind ?? 'percent'}
                onChange={(e) =>
                  setManualDiscount({
                    kind: e.target.value as 'percent' | 'amount',
                    value: manualDiscount?.value ?? 0,
                  })
                }
              >
                <option value="percent">Percent (bps)</option>
                <option value="amount">Amount (cents)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Value</Label>
              <Input
                type="number"
                value={manualDiscount?.value ?? 0}
                onChange={(e) =>
                  setManualDiscount({
                    kind: manualDiscount?.kind ?? 'percent',
                    value: Math.round(Number(e.target.value) || 0),
                  })
                }
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setManualDiscount(null)}>
              Clear manual discount
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {hostFullUi ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 touch-manipulation sm:min-h-9"
            onClick={() => setHostEditMode(false)}
          >
            Done editing
          </Button>
          <span className="text-xs text-muted-foreground">Return to pick-your-order view.</span>
        </div>
      ) : null}

      <Tabs value={splitTab} onValueChange={(v) => setSplitTab(v as 'assign' | 'results')}>
        <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTrigger value="assign" className="min-h-11 touch-manipulation">
            My order
          </TabsTrigger>
          <TabsTrigger value="results" className="min-h-11 touch-manipulation">
            My total
          </TabsTrigger>
        </TabsList>
        <TabsContent value="assign">
          {onBill ? (
            <AssignmentsPanel onOrderConfirmed={() => setSplitTab('results')} />
          ) : (
            <p className="text-sm text-muted-foreground">Join the bill above to add your order.</p>
          )}
        </TabsContent>
        <TabsContent value="results">
          {onBill ? <BillResults /> : <p className="text-sm text-muted-foreground">Join the bill above to see your total.</p>}
        </TabsContent>
      </Tabs>

      {hostFullUi ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="secondary"
            className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
            onClick={() => void updateBillMeta({ status: 'closed' })}
          >
            Close bill
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
            onClick={() => void handleDeleteBill()}
          >
            Delete bill
          </Button>
        </div>
      ) : null}

      {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
    </div>
  )
}
